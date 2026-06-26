from __future__ import annotations

import json
import os
import re
import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
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

ROOT_DIR = Path(__file__).resolve().parent.parent
SELECT_RE = re.compile(r"^\s*(select|with)\b", re.IGNORECASE)
DEFAULT_AI_LIMIT = 100
MAX_AI_LIMIT = 1000
MAX_SCHEMA_TABLES = 80
MAX_RESULT_CHARS = 14000
MAX_HISTORY_MESSAGES = 12
OPENCODE_POLL_INTERVAL_SECONDS = 0.8
OPENCODE_TRANSIENT_ERROR_GRACE_SECONDS = 20
AI_SESSION_TABLE = "ai_sessions"


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
    opencode_session_id: str | None = None
    messages: list[dict[str, Any]] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: utc_now())
    updated_at: str = field(default_factory=lambda: utc_now())


AI_SESSIONS: dict[str, AiSession] = {}
AI_SESSION_STORE_READY = False


@router.get("/config")
def ai_config() -> dict[str, Any]:
    config = load_ai_config()
    default_model = config["default_model"]
    return {
        "configured": config["configured"],
        "model": default_model["model"] if default_model else "",
        "api_base": default_model["api_base"] if default_model else "",
        "agent_backend": agent_backend(),
        "default_model_id": default_model["id"] if default_model else None,
        "models": public_model_configs(config["models"]),
    }


@router.post("/sessions")
def create_ai_session(payload: AiSessionRequest) -> dict[str, Any]:
    ensure_sql_enabled(payload.connection)
    init_session_store()
    session_id = uuid.uuid4().hex
    session = AiSession(
        id=session_id,
        connection=payload.connection,
        connection_name=payload.connection_name,
    )
    save_session(session)
    return {
        "session_id": session_id,
        "created_at": session.created_at,
        "connection_name": payload.connection_name,
    }


@router.get("/sessions/{session_id}/messages")
def get_ai_messages(session_id: str) -> dict[str, Any]:
    session = require_session(session_id)
    return {
        "session_id": session.id,
        "messages": session.messages,
        "connection_name": session.connection_name,
        "created_at": session.created_at,
        "updated_at": session.updated_at,
        "opencode_session_id": session.opencode_session_id,
    }


@router.post("/chat")
async def ai_chat(payload: AiChatRequest) -> dict[str, Any]:
    session = require_session(payload.session_id)
    ensure_ai_configured()
    ensure_sql_enabled(session.connection)
    model_config = get_model_config(payload.model_id)

    user_message = payload.message.strip()
    if agent_backend() == "opencode":
        assistant_message = await chat_with_opencode(session, user_message, model_config)
        return {"message": assistant_message, "session_id": session.id}

    assistant_message = await chat_with_direct_model(session, user_message, payload.limit, model_config)
    return {"message": assistant_message, "session_id": session.id}


async def chat_with_direct_model(
    session: AiSession,
    user_message: str,
    limit: int,
    model_config: dict[str, str],
) -> dict[str, Any]:
    schema = load_schema(session.connection)
    session.messages.append({"role": "user", "content": user_message, "created_at": utc_now()})
    session.updated_at = utc_now()
    save_session(session)

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
            executed = execute_readonly_sql(session.connection, sql, limit)
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
    save_session(session)
    return assistant_message


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


def agent_backend() -> str:
    backend = os.getenv("AI_AGENT_BACKEND", "direct").strip().lower()
    return "opencode" if backend == "opencode" else "direct"


async def chat_with_opencode(
    session: AiSession,
    user_message: str,
    model_config: dict[str, str],
) -> dict[str, Any]:
    session.messages.append({"role": "user", "content": user_message, "created_at": utc_now()})
    session.updated_at = utc_now()
    save_session(session)
    opencode_session_id = await ensure_opencode_session(session)
    prompt = build_opencode_prompt(session.id, user_message)
    await send_opencode_message(opencode_session_id, prompt, model_config)
    response_data = await wait_for_opencode_response(opencode_session_id)
    answer = extract_latest_opencode_assistant_text(response_data)
    assistant_message = {
        "role": "assistant",
        "content": answer or "OpenCode did not return a text response.",
        "model_id": model_config["id"],
        "model": model_config["model"],
        "sql": None,
        "result": None,
        "agent_backend": "opencode",
        "created_at": utc_now(),
    }
    session.messages.append(assistant_message)
    session.updated_at = utc_now()
    trim_session_messages(session)
    save_session(session)
    return assistant_message


async def ensure_opencode_session(session: AiSession) -> str:
    if session.opencode_session_id:
        return session.opencode_session_id

    model_config = get_model_config(None)
    data = await opencode_request(
        "POST",
        "/session",
        json_payload={
            "title": session.connection_name or "Database analysis",
            "agent": os.getenv("OPENCODE_AGENT", "db-analyst"),
            "model": opencode_model_object(model_config),
        },
    )
    session_id = extract_opencode_session_id(data)
    if not session_id:
        raise HTTPException(status_code=502, detail="OpenCode did not return a session id")
    session.opencode_session_id = session_id
    session.updated_at = utc_now()
    save_session(session)
    return session_id


async def send_opencode_message(
    opencode_session_id: str,
    prompt: str,
    model_config: dict[str, str],
) -> dict[str, Any]:
    return await opencode_request(
        "POST",
        f"/session/{opencode_session_id}/message",
        json_payload={
            "agent": os.getenv("OPENCODE_AGENT", "db-analyst"),
            "model": opencode_prompt_model_object(model_config),
            "parts": [{"type": "text", "text": prompt}],
        },
    )


async def load_opencode_messages(opencode_session_id: str) -> dict[str, Any]:
    return await opencode_request("GET", f"/session/{opencode_session_id}/message", json_payload={})


async def wait_for_opencode_response(opencode_session_id: str) -> dict[str, Any]:
    timeout = float(os.getenv("OPENCODE_TIMEOUT", "120"))
    deadline = asyncio.get_running_loop().time() + timeout
    last_data: dict[str, Any] = {}
    last_error: HTTPException | None = None
    first_error_at: float | None = None

    while True:
        now = asyncio.get_running_loop().time()
        try:
            last_data = await load_opencode_messages(opencode_session_id)
            last_error = None
            first_error_at = None
        except HTTPException as exc:
            last_error = exc
            if first_error_at is None:
                first_error_at = now
            if now >= deadline or now - first_error_at >= OPENCODE_TRANSIENT_ERROR_GRACE_SECONDS:
                raise exc
            await asyncio.sleep(OPENCODE_POLL_INTERVAL_SECONDS)
            continue
        if has_completed_opencode_assistant_message(last_data):
            return last_data
        if now >= deadline:
            if last_error:
                raise last_error
            raise HTTPException(status_code=502, detail=f"OpenCode response timed out after {int(timeout)} seconds")
        await asyncio.sleep(OPENCODE_POLL_INTERVAL_SECONDS)


async def opencode_request(method: str, path: str, json_payload: dict[str, Any]) -> dict[str, Any]:
    base_url = os.getenv("OPENCODE_SERVER_URL", "http://127.0.0.1:4096").rstrip("/")
    timeout = float(os.getenv("OPENCODE_TIMEOUT", "120"))
    headers = {"Content-Type": "application/json"}
    username = os.getenv("OPENCODE_SERVER_USERNAME", "")
    password = os.getenv("OPENCODE_SERVER_PASSWORD", "")
    auth = (username, password) if username or password else None

    try:
        async with httpx.AsyncClient(timeout=timeout, auth=auth) as client:
            response = await client.request(
                method,
                f"{base_url}{path}",
                headers=headers,
                params=opencode_location_params(),
                json=json_payload if method.upper() != "GET" else None,
            )
            response.raise_for_status()
    except httpx.ConnectError as exc:
        raise HTTPException(status_code=502, detail=f"OpenCode server is not reachable at {base_url}") from exc
    except httpx.HTTPStatusError as exc:
        detail = safe_response_detail(exc.response)
        raise HTTPException(status_code=502, detail=f"OpenCode request failed: {detail}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"OpenCode request failed: {exc}") from exc

    if not response.content:
        return {}
    try:
        data = response.json()
    except ValueError:
        return {"text": response.text}
    return data if isinstance(data, dict) else {"data": data}


def build_opencode_prompt(app_session_id: str, user_message: str) -> str:
    return (
        f"app_session_id: {app_session_id}\n\n"
        "请使用 db_schema 和 db_select 工具完成数据库分析。"
        "只能执行 SELECT/WITH 查询。\n\n"
        f"用户问题：\n{user_message}"
    )


def opencode_location_params() -> dict[str, str]:
    return {"directory": os.getenv("OPENCODE_DIRECTORY", str(ROOT_DIR))}


def opencode_provider_id() -> str:
    return os.getenv("OPENCODE_PROVIDER", "huayan").strip() or "huayan"


def opencode_model_object(model_config: dict[str, str]) -> dict[str, str]:
    return {
        "id": model_config["model"],
        "providerID": opencode_provider_id(),
    }


def opencode_prompt_model_object(model_config: dict[str, str]) -> dict[str, str]:
    return {
        "providerID": opencode_provider_id(),
        "modelID": model_config["model"],
    }


def opencode_model_name(model_config: dict[str, str]) -> str:
    provider = os.getenv("OPENCODE_PROVIDER", "huayan").strip() or "huayan"
    return f"{provider}/{model_config['model']}"


def extract_opencode_session_id(data: dict[str, Any]) -> str | None:
    for key in ("id", "sessionID", "session_id", "sessionId"):
        value = data.get(key)
        if value:
            return str(value)
    session = data.get("session")
    if isinstance(session, dict):
        return extract_opencode_session_id(session)
    return None


def extract_opencode_text(data: Any) -> str:
    if isinstance(data, str):
        return data
    if isinstance(data, list):
        return "\n".join(filter(None, (extract_opencode_text(item) for item in data))).strip()
    if not isinstance(data, dict):
        return ""

    for key in ("text", "content", "message", "output", "response"):
        value = data.get(key)
        if isinstance(value, str):
            return value.strip()
        if isinstance(value, (dict, list)):
            nested = extract_opencode_text(value)
            if nested:
                return nested

    parts = data.get("parts")
    if isinstance(parts, list):
        nested = extract_opencode_text(parts)
        if nested:
            return nested

    return ""


def extract_latest_opencode_assistant_text(data: Any) -> str:
    messages = data.get("data") if isinstance(data, dict) else data
    if not isinstance(messages, list):
        return extract_opencode_text(data)

    for message in reversed(messages):
        if not isinstance(message, dict):
            continue
        info = message.get("info") if isinstance(message.get("info"), dict) else {}
        if info.get("role") != "assistant":
            continue
        error = info.get("error")
        if isinstance(error, dict):
            detail = error.get("data")
            if isinstance(detail, dict) and detail.get("message"):
                return f"OpenCode 执行失败：{detail['message']}"
            if error.get("name"):
                return f"OpenCode 执行失败：{error['name']}"
        text = extract_opencode_text(message.get("parts", []))
        if text:
            return text
    return ""


def has_completed_opencode_assistant_message(data: Any) -> bool:
    messages = data.get("data") if isinstance(data, dict) else data
    if not isinstance(messages, list):
        return bool(extract_opencode_text(data))

    for message in reversed(messages):
        if not isinstance(message, dict):
            continue
        info = message.get("info") if isinstance(message.get("info"), dict) else {}
        if info.get("role") != "assistant":
            continue
        if info.get("error"):
            return True
        finish = info.get("finish")
        if finish == "tool-calls":
            continue
        time_info = info.get("time") if isinstance(info.get("time"), dict) else {}
        return bool(time_info.get("completed"))
    return False


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
        session = load_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="AI session not found")
    return session


def session_store_url() -> str:
    return os.getenv("AI_SESSION_DATABASE_URL", "").strip()


def session_store_enabled() -> bool:
    return bool(session_store_url())


@lru_cache(maxsize=1)
def get_session_store_engine() -> Any:
    url = session_store_url()
    if not url:
        raise RuntimeError("AI_SESSION_DATABASE_URL is not configured")
    return create_sql_engine(url)


def init_session_store() -> None:
    global AI_SESSION_STORE_READY
    if AI_SESSION_STORE_READY or not session_store_enabled():
        return

    engine = get_session_store_engine()
    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    f"""
                    create table if not exists {AI_SESSION_TABLE} (
                        id text primary key,
                        connection json not null,
                        connection_name text,
                        opencode_session_id text,
                        messages json not null default '[]',
                        created_at text not null,
                        updated_at text not null
                    )
                    """
                )
            )
            connection.execute(
                text(
                    f"""
                    create index if not exists {AI_SESSION_TABLE}_updated_at_idx
                    on {AI_SESSION_TABLE} (updated_at)
                    """
                )
            )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to initialize AI session store: {exc}") from exc

    AI_SESSION_STORE_READY = True


def save_session(session: AiSession) -> None:
    AI_SESSIONS[session.id] = session
    if not session_store_enabled():
        return
    init_session_store()
    engine = get_session_store_engine()
    payload = {
        "id": session.id,
        "connection": json.dumps(session.connection.model_dump(), ensure_ascii=False),
        "connection_name": session.connection_name,
        "opencode_session_id": session.opencode_session_id,
        "messages": json.dumps(session.messages, ensure_ascii=False, default=str),
        "created_at": session.created_at,
        "updated_at": session.updated_at,
    }
    try:
        with engine.begin() as connection:
            if engine.dialect.name == "postgresql":
                connection.execute(
                    text(
                        f"""
                        insert into {AI_SESSION_TABLE}
                            (id, connection, connection_name, opencode_session_id, messages, created_at, updated_at)
                        values
                            (:id, cast(:connection as json), :connection_name, :opencode_session_id,
                             cast(:messages as json), :created_at, :updated_at)
                        on conflict (id) do update set
                            connection = excluded.connection,
                            connection_name = excluded.connection_name,
                            opencode_session_id = excluded.opencode_session_id,
                            messages = excluded.messages,
                            updated_at = excluded.updated_at
                        """
                    ),
                    payload,
                )
            else:
                connection.execute(
                    text(
                        f"""
                        insert into {AI_SESSION_TABLE}
                            (id, connection, connection_name, opencode_session_id, messages, created_at, updated_at)
                        values
                            (:id, :connection, :connection_name, :opencode_session_id,
                             :messages, :created_at, :updated_at)
                        on conflict (id) do update set
                            connection = excluded.connection,
                            connection_name = excluded.connection_name,
                            opencode_session_id = excluded.opencode_session_id,
                            messages = excluded.messages,
                            updated_at = excluded.updated_at
                        """
                    ),
                    payload,
                )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save AI session: {exc}") from exc


def load_session(session_id: str) -> AiSession | None:
    if not session_store_enabled():
        return None
    init_session_store()
    engine = get_session_store_engine()
    try:
        with engine.connect() as connection:
            row = (
                connection.execute(
                    text(
                        f"""
                        select id, connection, connection_name, opencode_session_id,
                               messages, created_at, updated_at
                        from {AI_SESSION_TABLE}
                        where id = :id
                        """
                    ),
                    {"id": session_id},
                )
                .mappings()
                .first()
            )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load AI session: {exc}") from exc
    if not row:
        return None

    session = AiSession(
        id=str(row["id"]),
        connection=ConnectionInfo(**json_value(row["connection"], {})),
        connection_name=row["connection_name"],
        opencode_session_id=row["opencode_session_id"],
        messages=json_value(row["messages"], []),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )
    AI_SESSIONS[session.id] = session
    return session


def json_value(value: Any, fallback: Any) -> Any:
    if value is None:
        return fallback
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return fallback
    return fallback


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
