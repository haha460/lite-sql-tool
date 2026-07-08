from __future__ import annotations

import json
import os
import asyncio
from collections.abc import AsyncIterator
from contextlib import suppress
from typing import Any

from fastapi import HTTPException

from app.dto.database import ConnectionInfo
from app.model.settings import AI_SESSION_LINKS_FILE, RUNTIME_DIR
from app.model.ai_session import AiSession
from app.plugin import ai_model_client, opencode_client
from app.service import ai_database_service, ai_session_service, ai_skill_service
from app.service.common import clean_optional_text
from app.service.time_service import utc_now


STREAM_LISTENERS: dict[str, set[tuple[asyncio.AbstractEventLoop, asyncio.Queue[dict[str, Any]]]]] = {}
STREAM_SQL_COUNTERS: dict[str, int] = {}


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


def sse_event(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False, default=str)}\n\n"


def stream_step(
    phase: str,
    title: str,
    status: str = "running",
    **extra: Any,
) -> dict[str, Any]:
    return {
        "type": "step",
        "phase": phase,
        "title": title,
        "status": status,
        **{key: value for key, value in extra.items() if value is not None},
    }


def publish_stream_event(session_id: str, payload: dict[str, Any]) -> None:
    listeners = STREAM_LISTENERS.get(session_id)
    if not listeners:
        return
    for loop, queue in list(listeners):
        loop.call_soon_threadsafe(safe_put_stream_event, queue, payload)


def next_stream_sql_index(session_id: str) -> int:
    next_index = STREAM_SQL_COUNTERS.get(session_id, 0) + 1
    STREAM_SQL_COUNTERS[session_id] = next_index
    return next_index


def safe_put_stream_event(queue: asyncio.Queue[dict[str, Any]], payload: dict[str, Any]) -> None:
    with suppress(asyncio.QueueFull):
        queue.put_nowait(payload)


def add_stream_listener(session_id: str) -> asyncio.Queue[dict[str, Any]]:
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=100)
    STREAM_LISTENERS.setdefault(session_id, set()).add((loop, queue))
    return queue


def remove_stream_listener(session_id: str, queue: asyncio.Queue[dict[str, Any]]) -> None:
    listeners = STREAM_LISTENERS.get(session_id)
    if not listeners:
        return
    for listener in list(listeners):
        if listener[1] is queue:
            listeners.discard(listener)
    if not listeners:
        STREAM_LISTENERS.pop(session_id, None)
        STREAM_SQL_COUNTERS.pop(session_id, None)


def merge_stream_step(steps: list[dict[str, Any]], event: dict[str, Any]) -> list[dict[str, Any]]:
    phase = event.get("phase")
    if not phase:
        return steps
    next_steps = list(steps)
    for index, step in enumerate(next_steps):
        if step.get("phase") == phase:
            next_steps[index] = event
            return next_steps
    next_steps.append(event)
    return next_steps


def build_message_steps(sql: str | None, result: dict[str, Any] | None) -> list[dict[str, Any]]:
    steps = [
        stream_step("schema", "解析业务数据与约束", "done"),
        stream_step("plan", "求解优化方案", "done", sql=sql),
    ]
    if sql:
        sql_step = stream_step("sql", "执行只读 SQL", "done", sql=sql)
        if isinstance(result, dict):
            if result.get("error"):
                sql_step["status"] = "error"
                sql_step["error"] = result["error"]
            else:
                sql_step["row_count"] = len(result.get("rows") or [])
                sql_step["truncated"] = bool(result.get("truncated"))
        steps.append(sql_step)
    steps.append(stream_step("summary", "验证方案可行性", "done"))
    return steps


def latest_stream_sql(steps: list[dict[str, Any]]) -> str | None:
    for step in reversed(steps):
        sql = step.get("sql")
        if isinstance(sql, str) and sql.strip():
            return sql
    return None


async def encode_chat_events(events: AsyncIterator[dict[str, Any]]) -> AsyncIterator[str]:
    try:
        async for payload in events:
            event_name = str(payload.get("type") or "message")
            yield sse_event(event_name, payload)
    except HTTPException as exc:
        yield sse_event("error", {"type": "error", "message": str(exc.detail)})
    except Exception as exc:
        yield sse_event("error", {"type": "error", "message": str(exc)})
    finally:
        yield sse_event("done", {"type": "done"})


async def chat_with_direct_model(
    session: AiSession,
    user_message: str,
    limit: int,
    model_config: dict[str, str],
) -> dict[str, Any]:
    assistant_message: dict[str, Any] | None = None
    async for event in stream_chat_with_direct_model(session, user_message, limit, model_config):
        if event.get("type") == "final":
            assistant_message = event["message"]
    if assistant_message is None:
        raise HTTPException(status_code=502, detail="AI did not return a final message")
    return assistant_message


async def stream_chat_with_direct_model(
    session: AiSession,
    user_message: str,
    limit: int,
    model_config: dict[str, str],
) -> AsyncIterator[dict[str, Any]]:
    steps: list[dict[str, Any]] = []
    schema_running = stream_step("schema", "解析业务数据与约束", detail="读取数据库结构和业务说明")
    steps = merge_stream_step(steps, schema_running)
    yield schema_running
    schema = ai_database_service.load_schema(session.connection, ai_skill_service.current_skill_for_session(session))
    schema_done = stream_step(
        "schema",
        "解析业务数据与约束",
        "done",
        detail=f"已加载 {len(schema.get('tables') or [])} 张表",
    )
    steps = merge_stream_step(steps, schema_done)
    yield schema_done
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

    plan_running = stream_step("plan", "求解优化方案", detail="生成只读 SQL 与分析思路")
    steps = merge_stream_step(steps, plan_running)
    yield plan_running
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
    plan_done = stream_step("plan", "求解优化方案", "done", detail=answer, sql=sql)
    steps = merge_stream_step(steps, plan_done)
    yield plan_done

    if sql:
        try:
            sql_running = stream_step("sql", "执行只读 SQL", sql=sql)
            steps = merge_stream_step(steps, sql_running)
            yield sql_running
            executed = ai_database_service.execute_readonly_sql(session.connection, sql, limit)
            sql_done = stream_step(
                "sql",
                "执行只读 SQL",
                "done",
                sql=executed.get("sql") or sql,
                row_count=len(executed.get("rows") or []),
                truncated=bool(executed.get("truncated")),
            )
            steps = merge_stream_step(steps, sql_done)
            yield sql_done
            summary_running = stream_step("summary", "验证方案可行性", detail="根据查询结果生成最终结论")
            steps = merge_stream_step(steps, summary_running)
            yield summary_running
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
            summary_done = stream_step("summary", "验证方案可行性", "done")
            steps = merge_stream_step(steps, summary_done)
            yield summary_done
        except HTTPException as exc:
            answer = f"{answer}\n\nSQL 未执行：{exc.detail}".strip()
            executed = {"sql": sql, "error": exc.detail}
            sql_error = stream_step("sql", "执行只读 SQL", "error", sql=sql, error=str(exc.detail))
            steps = merge_stream_step(steps, sql_error)
            yield sql_error
    else:
        summary_done = stream_step("summary", "生成最终结果", "done")
        steps = merge_stream_step(steps, summary_done)
        yield summary_done

    assistant_message = {
        "role": "assistant",
        "content": answer,
        "model_id": model_config["id"],
        "model": model_config["model"],
        "sql": sql,
        "result": executed,
        "steps": steps or build_message_steps(sql, executed),
        "turn_id": turn_id,
        "turn_index": turn_index,
        "created_at": utc_now(),
    }
    session.messages.append(assistant_message)
    session.updated_at = utc_now()
    ai_session_service.trim_session_messages(session)
    ai_session_service.save_session(session)
    yield {"type": "final", "message": assistant_message, "session_id": session.id}


async def chat_with_opencode(
    session: AiSession,
    user_message: str,
    model_config: dict[str, str],
) -> dict[str, Any]:
    assistant_message: dict[str, Any] | None = None
    async for event in stream_chat_with_opencode(session, user_message, model_config):
        if event.get("type") == "final":
            assistant_message = event["message"]
    if assistant_message is None:
        raise HTTPException(status_code=502, detail="OpenCode did not return a final message")
    return assistant_message


async def stream_chat_with_opencode(
    session: AiSession,
    user_message: str,
    model_config: dict[str, str],
) -> AsyncIterator[dict[str, Any]]:
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

    queue = add_stream_listener(session.id)
    steps: list[dict[str, Any]] = []
    schema_step = stream_step(
        "schema",
        "解析业务数据与约束",
        detail="等待 OpenCode 读取数据库结构、字段、索引、外键和当前绑定的业务 Skill。",
    )
    plan_step = stream_step(
        "plan",
        "求解优化方案",
        detail="OpenCode 会根据用户问题规划只读查询路径，并在需要时调用数据库工具。",
    )
    steps = merge_stream_step(steps, schema_step)
    steps = merge_stream_step(steps, plan_step)
    yield schema_step
    yield plan_step

    response_task: asyncio.Task[tuple[dict[str, Any], set[str]]] | None = None
    try:
        response_task = asyncio.create_task(run_opencode_turn(session, user_message, model_config))
        while True:
            get_event = asyncio.create_task(queue.get())
            done, pending = await asyncio.wait({response_task, get_event}, return_when=asyncio.FIRST_COMPLETED)

            if get_event in done:
                event = get_event.result()
                if event.get("type") == "step":
                    steps = merge_stream_step(steps, event)
                yield event
                if response_task not in done:
                    continue

            if response_task in done:
                if get_event in pending:
                    get_event.cancel()
                    with suppress(asyncio.CancelledError):
                        await get_event
                response_data, existing_message_ids = response_task.result()
                break

        answer = opencode_client.extract_latest_opencode_assistant_text(response_data, existing_message_ids)
    except HTTPException as exc:
        assistant_message = build_opencode_error_message(exc.detail, model_config, turn_id, turn_index)
        session.messages.append(assistant_message)
        session.updated_at = utc_now()
        ai_session_service.trim_session_messages(session)
        ai_session_service.save_session(session)
        yield {"type": "error", "message": str(exc.detail)}
        raise exc
    finally:
        if response_task is not None and not response_task.done():
            response_task.cancel()
            with suppress(asyncio.CancelledError):
                await response_task
        remove_stream_listener(session.id, queue)

    if not any(step.get("phase") == "schema" and step.get("status") == "done" for step in steps):
        schema_done = stream_step(
            "schema",
            "解析业务数据与约束",
            "done",
            detail="已完成数据库上下文解析，后续 SQL 会限定在当前会话连接和只读查询范围内。",
        )
        steps = merge_stream_step(steps, schema_done)
        yield schema_done
    plan_done = stream_step(
        "plan",
        "求解优化方案",
        "done",
        detail="已完成分析路径规划与工具调用编排；执行阶段可展开查看每次使用的 SQL。",
    )
    steps = merge_stream_step(steps, plan_done)
    yield plan_done
    summary_done = stream_step(
        "summary",
        "生成可视化结论",
        "done",
        detail="已整合工具返回的数据，最终分析结果展示在下方。",
    )
    steps = merge_stream_step(steps, summary_done)
    yield summary_done

    latest_sql = latest_stream_sql(steps)
    assistant_message = {
        "role": "assistant",
        "content": answer or "OpenCode did not return a text response.",
        "model_id": model_config["id"],
        "model": model_config["model"],
        "sql": latest_sql,
        "result": None,
        "steps": steps or [stream_step("summary", "生成可视化结论", "done")],
        "agent_backend": "opencode",
        "turn_id": turn_id,
        "turn_index": turn_index,
        "created_at": utc_now(),
    }
    session.messages.append(assistant_message)
    session.updated_at = utc_now()
    ai_session_service.trim_session_messages(session)
    ai_session_service.save_session(session)
    yield {"type": "final", "message": assistant_message, "session_id": session.id}


async def run_opencode_turn(
    session: AiSession,
    user_message: str,
    model_config: dict[str, str],
) -> tuple[dict[str, Any], set[str]]:
    opencode_session_id = await reusable_opencode_session_id(session, model_config)
    prompt = opencode_client.build_opencode_prompt(session.id, user_message)
    existing_message_ids = opencode_client.opencode_message_ids(await opencode_client.load_opencode_messages(opencode_session_id))
    response_data = await opencode_client.wait_for_opencode_response_sse_first(
        opencode_session_id,
        lambda: opencode_client.send_opencode_message(opencode_session_id, prompt, model_config),
        existing_message_ids,
    )
    return response_data, existing_message_ids


async def reusable_opencode_session_id(session: AiSession, model_config: dict[str, str]) -> str:
    opencode_session_id = await opencode_client.ensure_opencode_session(
        session,
        model_config,
        save_session=ai_session_service.save_session,
    )
    try:
        messages = await opencode_client.load_opencode_messages(opencode_session_id)
    except HTTPException:
        return await opencode_client.replace_opencode_session(
            session,
            model_config,
            save_session=ai_session_service.save_session,
        )
    if opencode_client.has_unfinished_opencode_assistant_message(messages):
        return await opencode_client.replace_opencode_session(
            session,
            model_config,
            save_session=ai_session_service.save_session,
        )
    return opencode_session_id


def build_opencode_error_message(detail: Any, model_config: dict[str, str], turn_id: str, turn_index: int) -> dict[str, Any]:
    return {
        "role": "assistant",
        "content": f"OpenCode 暂时没有返回可用回复：{detail}",
        "model_id": model_config["id"],
        "model": model_config["model"],
        "sql": None,
        "result": None,
        "agent_backend": "opencode",
        "error": str(detail),
        "turn_id": turn_id,
        "turn_index": turn_index,
        "created_at": utc_now(),
    }
