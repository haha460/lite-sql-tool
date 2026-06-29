from __future__ import annotations

import json
import re
from typing import Any

from fastapi import HTTPException
from sqlalchemy import inspect, text

from app.dto.database import ConnectionInfo
from app.plugin.database_client import create_sql_engine, row_to_dict
from app.service.database_service import safe_inspect_list


SELECT_RE = re.compile(r"^\s*(select|with)\b", re.IGNORECASE)
MAX_AI_LIMIT = 1000
MAX_SCHEMA_TABLES = 80
MAX_RESULT_CHARS = 14000
MAX_HISTORY_MESSAGES = 12


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


def ensure_sql_enabled(connection: ConnectionInfo) -> None:
    if not connection.sql_url:
        raise HTTPException(status_code=400, detail="SQL is not enabled for this AI session")
