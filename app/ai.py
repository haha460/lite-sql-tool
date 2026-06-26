from __future__ import annotations

import json
import os
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import inspect, text

from .database import create_sql_engine, row_to_dict

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - python-dotenv is installed with uvicorn[standard].
    load_dotenv = None

if load_dotenv:
    load_dotenv()


router = APIRouter(prefix="/api/ai", tags=["ai"])

SELECT_RE = re.compile(r"^\s*(select|with)\b", re.IGNORECASE)
DEFAULT_AI_LIMIT = 100
MAX_AI_LIMIT = 1000
MAX_SCHEMA_TABLES = 80
MAX_RESULT_CHARS = 14000
MAX_HISTORY_MESSAGES = 12


class ConnectionInfo(BaseModel):
    sql_url: str | None = None
    redis_url: str | None = None
    readonly: bool = False


class AiSessionRequest(BaseModel):
    connection: ConnectionInfo
    connection_name: str | None = None


class AiChatRequest(BaseModel):
    session_id: str
    message: str = Field(min_length=1)
    limit: int = Field(default=DEFAULT_AI_LIMIT, ge=1, le=MAX_AI_LIMIT)
    model_id: str | None = None


class AiToolSchemaRequest(BaseModel):
    session_id: str


class AiToolSelectRequest(BaseModel):
    session_id: str
    sql: str = Field(min_length=1)
    limit: int = Field(default=DEFAULT_AI_LIMIT, ge=1, le=MAX_AI_LIMIT)


@dataclass
class AiSession:
    id: str
    connection: ConnectionInfo
    connection_name: str | None
    messages: list[dict[str, Any]] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: utc_now())
    updated_at: str = field(default_factory=lambda: utc_now())


AI_SESSIONS: dict[str, AiSession] = {}


@router.get("/config")
def ai_config() -> dict[str, Any]:
    config = load_ai_config()
    default_model = config["default_model"]
    return {
        "configured": config["configured"],
        "model": default_model["model"] if default_model else "",
        "api_base": default_model["api_base"] if default_model else "",
        "default_model_id": default_model["id"] if default_model else None,
        "models": public_model_configs(config["models"]),
    }


@router.post("/sessions")
def create_ai_session(payload: AiSessionRequest) -> dict[str, Any]:
    ensure_sql_enabled(payload.connection)
    session_id = uuid.uuid4().hex
    session = AiSession(
        id=session_id,
        connection=payload.connection,
        connection_name=payload.connection_name,
    )
    AI_SESSIONS[session_id] = session
    return {
        "session_id": session_id,
        "created_at": session.created_at,
        "connection_name": payload.connection_name,
    }


@router.get("/sessions/{session_id}/messages")
def get_ai_messages(session_id: str) -> dict[str, Any]:
    session = require_session(session_id)
    return {"messages": session.messages}


@router.post("/chat")
async def ai_chat(payload: AiChatRequest) -> dict[str, Any]:
    session = require_session(payload.session_id)
    ensure_ai_configured()
    ensure_sql_enabled(session.connection)
    model_config = get_model_config(payload.model_id)

    user_message = payload.message.strip()
    schema = load_schema(session.connection)
    session.messages.append({"role": "user", "content": user_message, "created_at": utc_now()})
    session.updated_at = utc_now()

    draft = await call_ai_model(
        [
            {"role": "system", "content": build_sql_planner_prompt(schema)},
            *recent_chat_messages(session.messages[:-1]),
            {"role": "user", "content": user_message},
        ],
        model_config,
    )
    plan = parse_ai_json(draft)
    sql = clean_optional_text(plan.get("sql"))
    answer = clean_optional_text(plan.get("answer")) or draft.strip()
    executed = None

    if sql:
        try:
            executed = execute_readonly_sql(session.connection, sql, payload.limit)
            summary = await call_ai_model(
                [
                    {"role": "system", "content": build_result_summary_prompt()},
                    {
                        "role": "user",
                        "content": json.dumps(
                            {
                                "question": user_message,
                                "sql": sql,
                                "columns": executed["columns"],
                                "rows": executed["rows"],
                                "row_count": len(executed["rows"]),
                                "truncated": executed["truncated"],
                            },
                            ensure_ascii=False,
                            default=str,
                        ),
                    },
                ],
                model_config,
            )
            answer = summary.strip() or answer
        except HTTPException as exc:
            answer = f"{answer}\n\nSQL 未执行：{exc.detail}".strip()
            executed = {"sql": sql, "error": exc.detail}

    assistant_message = {
        "role": "assistant",
        "content": answer,
        "model_id": model_config["id"],
        "model": model_config["model"],
        "sql": sql,
        "result": executed,
        "created_at": utc_now(),
    }
    session.messages.append(assistant_message)
    session.updated_at = utc_now()
    trim_session_messages(session)
    return {"message": assistant_message, "session_id": session.id}


@router.post("/tool/schema")
def ai_tool_schema(payload: AiToolSchemaRequest) -> dict[str, Any]:
    session = require_session(payload.session_id)
    return load_schema(session.connection)


@router.post("/tool/select")
def ai_tool_select(payload: AiToolSelectRequest) -> dict[str, Any]:
    session = require_session(payload.session_id)
    return execute_readonly_sql(session.connection, payload.sql, payload.limit)


def load_ai_config() -> dict[str, Any]:
    models = load_model_configs()
    default_model_id = os.getenv("AI_DEFAULT_MODEL", "").strip()
    default_model = find_model_config(models, default_model_id) if default_model_id else (models[0] if models else None)
    return {
        "models": models,
        "default_model": default_model,
        "configured": bool(models),
    }


def load_model_configs() -> list[dict[str, str]]:
    raw_models = os.getenv("AI_MODELS", "").strip()
    if raw_models:
        return normalize_model_configs(parse_json_model_configs(raw_models))

    raw_model_list = os.getenv("AI_MODEL_LIST", "").strip()
    if raw_model_list:
        return normalize_model_configs(parse_compact_model_configs(raw_model_list))

    legacy = {
        "id": os.getenv("AI_MODEL", "").strip(),
        "name": os.getenv("AI_MODEL", "").strip(),
        "model": os.getenv("AI_MODEL", "").strip(),
        "api_base": os.getenv("AI_API_BASE", "").strip(),
        "api_key": os.getenv("AI_API_KEY", "").strip(),
    }
    return normalize_model_configs([legacy])


def parse_json_model_configs(raw_models: str) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(raw_models)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"AI_MODELS must be valid JSON: {exc}") from exc
    if not isinstance(parsed, list):
        raise HTTPException(status_code=500, detail="AI_MODELS must be a JSON array")
    return [item for item in parsed if isinstance(item, dict)]


def parse_compact_model_configs(raw_model_list: str) -> list[dict[str, str]]:
    api_base = os.getenv("AI_API_BASE", "").strip()
    api_key = os.getenv("AI_API_KEY", "").strip()
    models = []
    for item in raw_model_list.split(","):
        model = item.strip()
        if not model:
            continue
        models.append(
            {
                "id": model,
                "name": model,
                "model": model,
                "api_base": api_base,
                "api_key": api_key,
            }
        )
    return models


def normalize_model_configs(items: list[dict[str, Any]]) -> list[dict[str, str]]:
    models: list[dict[str, str]] = []
    seen_ids: set[str] = set()
    for index, item in enumerate(items):
        model = str(item.get("model") or "").strip()
        api_base = str(item.get("api_base") or item.get("base_url") or item.get("baseURL") or "").strip()
        api_key = str(item.get("api_key") or item.get("apiKey") or "").strip()
        if not model or not api_base or not api_key:
            continue

        model_id = str(item.get("id") or model).strip()
        if not model_id:
            model_id = f"model-{index + 1}"
        if model_id in seen_ids:
            model_id = f"{model_id}-{index + 1}"
        seen_ids.add(model_id)
        models.append(
            {
                "id": model_id,
                "name": str(item.get("name") or model_id).strip(),
                "model": model,
                "api_base": api_base.rstrip("/"),
                "api_key": api_key,
            }
        )
    return models


def public_model_configs(models: list[dict[str, str]]) -> list[dict[str, str]]:
    return [
        {
            "id": model["id"],
            "name": model["name"],
            "model": model["model"],
            "api_base": model["api_base"],
        }
        for model in models
    ]


def find_model_config(models: list[dict[str, str]], model_id: str) -> dict[str, str] | None:
    return next((model for model in models if model["id"] == model_id), None)


def get_model_config(model_id: str | None) -> dict[str, str]:
    config = load_ai_config()
    models = config["models"]
    if not models:
        raise HTTPException(status_code=400, detail="AI is not configured")
    if model_id:
        model = find_model_config(models, model_id)
        if not model:
            raise HTTPException(status_code=400, detail=f"AI model not found: {model_id}")
        return model
    return config["default_model"] or models[0]


def ensure_ai_configured() -> None:
    if not load_ai_config()["configured"]:
        raise HTTPException(status_code=400, detail="AI is not configured. Set AI_MODELS or AI_API_BASE, AI_API_KEY and AI_MODEL.")


async def call_ai_model(messages: list[dict[str, str]], model_config: dict[str, str]) -> str:
    timeout = float(os.getenv("AI_API_TIMEOUT", "60"))
    url = chat_completions_url(model_config["api_base"])
    headers = {
        "Authorization": f"Bearer {model_config['api_key']}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model_config["model"],
        "messages": messages,
        "temperature": 0.2,
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        detail = safe_response_detail(exc.response)
        raise HTTPException(status_code=502, detail=f"AI request failed: {detail}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"AI request failed: {exc}") from exc

    data = response.json()
    try:
        return str(data["choices"][0]["message"]["content"] or "")
    except (KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="AI response did not contain a message") from exc


def chat_completions_url(api_base: str) -> str:
    cleaned = api_base.rstrip("/")
    if cleaned.endswith("/chat/completions"):
        return cleaned
    return f"{cleaned}/chat/completions"


def build_sql_planner_prompt(schema: dict[str, Any]) -> str:
    return (
        "你是嵌入在数据库管理工具里的数据分析助手。"
        "只能根据用户问题和给定 schema 生成安全的只读 SQL。"
        "如果需要查询数据，只能生成 SELECT 或 WITH SQL，不能生成写操作、DDL 或多语句 SQL。"
        "不要猜测不存在的表和字段。"
        "回复必须是 JSON，不要使用 Markdown 代码块。"
        "JSON 格式：{\"answer\":\"简短中文说明\",\"sql\":\"SELECT ... 或 null\"}。"
        "数据库 schema 如下：\n"
        f"{json.dumps(schema, ensure_ascii=False, default=str)}"
    )


def build_result_summary_prompt() -> str:
    return (
        "你是数据分析助手。请根据用户问题、SQL 和裁剪后的查询结果，用中文给出简洁结论。"
        "可以指出数据量限制或结果被截断。不要编造结果中没有的信息。"
    )


def recent_chat_messages(messages: list[dict[str, Any]]) -> list[dict[str, str]]:
    recent = messages[-MAX_HISTORY_MESSAGES:]
    return [
        {"role": item["role"], "content": str(item.get("content", ""))}
        for item in recent
        if item.get("role") in {"user", "assistant"} and item.get("content")
    ]


def parse_ai_json(raw: str) -> dict[str, Any]:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        return {"answer": raw, "sql": extract_first_sql(raw)}
    return parsed if isinstance(parsed, dict) else {"answer": raw, "sql": None}


def extract_first_sql(raw: str) -> str | None:
    code_match = re.search(r"```sql\s*(.*?)```", raw, flags=re.IGNORECASE | re.DOTALL)
    if code_match:
        return code_match.group(1).strip()
    sql_match = re.search(r"\b(select|with)\b[\s\S]+", raw, flags=re.IGNORECASE)
    return sql_match.group(0).strip() if sql_match else None


def execute_readonly_sql(connection: ConnectionInfo, sql: str, limit: int) -> dict[str, Any]:
    ensure_sql_enabled(connection)
    clean_sql = normalize_readonly_sql(sql)
    safe_limit = max(1, min(MAX_AI_LIMIT, limit))
    limited_sql = f"select * from ({clean_sql}) as ai_query limit :__limit"
    engine = create_sql_engine(connection.sql_url)
    try:
        with engine.connect() as sql_connection:
            result = sql_connection.execute(text(limited_sql), {"__limit": safe_limit + 1})
            rows = result.fetchall()
            visible_rows = rows[:safe_limit]
            payload_rows = trim_rows_for_ai([row_to_dict(row) for row in visible_rows])
            return {
                "sql": clean_sql,
                "columns": list(result.keys()),
                "rows": payload_rows,
                "limit": safe_limit,
                "truncated": len(rows) > safe_limit,
            }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"SQL execution failed: {exc}") from exc
    finally:
        engine.dispose()


def normalize_readonly_sql(sql: str) -> str:
    clean_sql = sql.strip().rstrip(";").strip()
    if ";" in clean_sql:
        raise HTTPException(status_code=400, detail="Only one SQL statement is allowed")
    if not SELECT_RE.match(clean_sql):
        raise HTTPException(status_code=400, detail="Only SELECT/WITH SQL can be executed by AI")
    return clean_sql


def load_schema(connection: ConnectionInfo) -> dict[str, Any]:
    ensure_sql_enabled(connection)
    engine = create_sql_engine(connection.sql_url)
    try:
        inspector = inspect(engine)
        table_names = inspector.get_table_names()[:MAX_SCHEMA_TABLES]
        tables = []
        for table_name in table_names:
            columns = inspector.get_columns(table_name)
            pk = inspector.get_pk_constraint(table_name).get("constrained_columns") or []
            tables.append(
                {
                    "name": table_name,
                    "primary_key": pk[0] if pk else None,
                    "columns": [
                        {
                            "name": column["name"],
                            "type": str(column["type"]),
                            "nullable": column.get("nullable", True),
                            "primary_key": column["name"] in pk,
                        }
                        for column in columns
                    ],
                    "indexes": compact_indexes(safe_inspect_list(inspector.get_indexes, table_name)),
                    "foreign_keys": compact_foreign_keys(safe_inspect_list(inspector.get_foreign_keys, table_name)),
                }
            )
        return {
            "dialect": engine.dialect.name,
            "table_count": len(inspector.get_table_names()),
            "truncated": len(inspector.get_table_names()) > MAX_SCHEMA_TABLES,
            "tables": tables,
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to load schema: {exc}") from exc
    finally:
        engine.dispose()


def compact_indexes(indexes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "name": item.get("name"),
            "columns": item.get("column_names") or [],
            "unique": bool(item.get("unique")),
        }
        for item in indexes
    ]


def compact_foreign_keys(foreign_keys: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "columns": item.get("constrained_columns") or [],
            "referred_table": item.get("referred_table"),
            "referred_columns": item.get("referred_columns") or [],
        }
        for item in foreign_keys
    ]


def safe_inspect_list(fn: Any, table_name: str) -> list[dict[str, Any]]:
    try:
        value = fn(table_name)
    except Exception:
        return []
    return value if isinstance(value, list) else []


def trim_rows_for_ai(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    encoded = json.dumps(rows, ensure_ascii=False, default=str)
    if len(encoded) <= MAX_RESULT_CHARS:
        return rows

    trimmed: list[dict[str, Any]] = []
    total = 2
    for row in rows:
        item: dict[str, Any] = {}
        for key, value in row.items():
            text_value = "" if value is None else str(value)
            item[key] = text_value[:500] + ("..." if len(text_value) > 500 else "")
        size = len(json.dumps(item, ensure_ascii=False, default=str))
        if total + size > MAX_RESULT_CHARS:
            break
        total += size
        trimmed.append(item)
    return trimmed


def trim_session_messages(session: AiSession) -> None:
    if len(session.messages) > 40:
        session.messages = session.messages[-40:]


def require_session(session_id: str) -> AiSession:
    session = AI_SESSIONS.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="AI session not found")
    return session


def ensure_sql_enabled(connection: ConnectionInfo) -> None:
    if not connection.sql_url:
        raise HTTPException(status_code=400, detail="SQL is not enabled for this AI session")


def clean_optional_text(value: Any) -> str | None:
    if value is None:
        return None
    text_value = str(value).strip()
    if not text_value or text_value.lower() == "null":
        return None
    return text_value


def safe_response_detail(response: httpx.Response) -> str:
    try:
        data = response.json()
    except ValueError:
        return response.text[:500]
    return str(data.get("error") or data.get("detail") or data)[:500] if isinstance(data, dict) else str(data)[:500]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()
