from __future__ import annotations

import json
import os
from typing import Any

from fastapi import HTTPException

from app.dto.database import ConnectionInfo
from app.model.settings import AI_SESSION_LINKS_FILE, RUNTIME_DIR
from app.model.ai_session import AiSession
from app.plugin import ai_model_client, opencode_client
from app.service import ai_database_service, ai_session_service
from app.service.common import clean_optional_text
from app.service.time_service import utc_now


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


def load_ai_session_links() -> dict[str, str]:
    if not AI_SESSION_LINKS_FILE.exists():
        return {}
    try:
        raw = json.loads(AI_SESSION_LINKS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read AI session links: {exc}") from exc
    links = raw.get("links") if isinstance(raw, dict) else raw
    if not isinstance(links, dict):
        return {}
    return normalize_ai_session_links(links)


def write_ai_session_links(links: dict[str, str]) -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "links": normalize_ai_session_links(links),
    }
    temp_file = AI_SESSION_LINKS_FILE.with_suffix(".json.tmp")
    try:
        temp_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temp_file.chmod(0o600)
        temp_file.replace(AI_SESSION_LINKS_FILE)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save AI session links: {exc}") from exc


def normalize_ai_session_links(links: dict[str, Any]) -> dict[str, str]:
    normalized: dict[str, str] = {}
    seen_session_ids: set[str] = set()
    for connection_id, session_id in links.items():
        clean_connection_id = clean_optional_text(connection_id)
        clean_session_id = clean_optional_text(session_id)
        if not clean_connection_id or not clean_session_id or clean_session_id in seen_session_ids:
            continue
        seen_session_ids.add(clean_session_id)
        normalized[clean_connection_id] = clean_session_id
    return normalized


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


async def chat_with_direct_model(
    session: AiSession,
    user_message: str,
    limit: int,
    model_config: dict[str, str],
) -> dict[str, Any]:
    schema = ai_database_service.load_schema(session.connection)
    turn_id = ai_session_service.new_turn_id()
    turn_index = ai_session_service.next_session_turn_index(session)
    session.messages.append(
        {
            "role": "user",
            "content": user_message,
            "turn_id": turn_id,
            "turn_index": turn_index,
            "created_at": utc_now(),
        }
    )
    session.updated_at = utc_now()
    ai_session_service.save_session(session)

    draft = await ai_model_client.call_ai_model(
        [
            {"role": "system", "content": ai_database_service.build_sql_planner_prompt(schema)},
            *ai_database_service.recent_chat_messages(session.messages[:-1]),
            {"role": "user", "content": user_message},
        ],
        model_config,
    )
    plan = ai_database_service.parse_ai_json(draft)
    sql = clean_optional_text(plan.get("sql"))
    answer = clean_optional_text(plan.get("answer")) or draft.strip()
    executed = None

    if sql:
        try:
            executed = ai_database_service.execute_readonly_sql(session.connection, sql, limit)
            summary = await ai_model_client.call_ai_model(
                [
                    {"role": "system", "content": ai_database_service.build_result_summary_prompt()},
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
        "turn_id": turn_id,
        "turn_index": turn_index,
        "created_at": utc_now(),
    }
    session.messages.append(assistant_message)
    session.updated_at = utc_now()
    ai_session_service.trim_session_messages(session)
    ai_session_service.save_session(session)
    return assistant_message


async def chat_with_opencode(
    session: AiSession,
    user_message: str,
    model_config: dict[str, str],
) -> dict[str, Any]:
    turn_id = ai_session_service.new_turn_id()
    turn_index = ai_session_service.next_session_turn_index(session)
    session.messages.append(
        {
            "role": "user",
            "content": user_message,
            "turn_id": turn_id,
            "turn_index": turn_index,
            "created_at": utc_now(),
        }
    )
    session.updated_at = utc_now()
    ai_session_service.save_session(session)
    opencode_session_id = await opencode_client.ensure_opencode_session(session, get_model_config(None), save_session=ai_session_service.save_session)
    prompt = opencode_client.build_opencode_prompt(session.id, user_message)
    existing_message_ids = opencode_client.opencode_message_ids(await opencode_client.load_opencode_messages(opencode_session_id))
    response_data = await opencode_client.wait_for_opencode_response_sse_first(
        opencode_session_id,
        lambda: opencode_client.send_opencode_message(opencode_session_id, prompt, model_config),
        existing_message_ids,
    )
    answer = opencode_client.extract_latest_opencode_assistant_text(response_data, existing_message_ids)
    assistant_message = {
        "role": "assistant",
        "content": answer or "OpenCode did not return a text response.",
        "model_id": model_config["id"],
        "model": model_config["model"],
        "sql": None,
        "result": None,
        "agent_backend": "opencode",
        "turn_id": turn_id,
        "turn_index": turn_index,
        "created_at": utc_now(),
    }
    session.messages.append(assistant_message)
    session.updated_at = utc_now()
    ai_session_service.trim_session_messages(session)
    ai_session_service.save_session(session)
    return assistant_message
