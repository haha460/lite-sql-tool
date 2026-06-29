from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Awaitable, Callable
from contextlib import suppress
from typing import Any

import httpx
from fastapi import HTTPException

from app.model.ai_session import AiSession
from app.model.settings import ROOT_DIR
from app.service.common import safe_response_detail
from app.service.time_service import utc_now


class OpenCodeSSEUnavailable(RuntimeError):
    pass


OPENCODE_POLL_INTERVAL_SECONDS = 0.8
OPENCODE_SSE_CONNECT_TIMEOUT_SECONDS = 5
OPENCODE_TRANSIENT_ERROR_GRACE_SECONDS = 20
OPENCODE_RESPONSE_EVENT_TYPES = {
    "message.updated",
    "session.idle",
    "session.status",
    "session.next.step.ended",
    "session.next.text.ended",
    "session.next.tool.success",
    "session.next.tool.failed",
}


async def ensure_opencode_session(
    session: AiSession,
    model_config: dict[str, str],
    save_session: Callable[[AiSession], None],
) -> str:
    if session.opencode_session_id:
        return session.opencode_session_id

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


async def wait_for_opencode_response_sse_first(
    opencode_session_id: str,
    send_message: Callable[[], Awaitable[Any]],
    existing_message_ids: set[str] | None = None,
) -> dict[str, Any]:
    message_task: asyncio.Task[Any] | None = None

    async def send_once() -> Any:
        nonlocal message_task
        if message_task is None:
            message_task = asyncio.create_task(send_message())
        return await message_task

    if opencode_sse_enabled():
        try:
            return await wait_for_opencode_response_sse(opencode_session_id, send_once, existing_message_ids)
        except OpenCodeSSEUnavailable:
            pass
    await send_once()
    return await wait_for_opencode_response(opencode_session_id, existing_message_ids)


async def wait_for_opencode_response_sse(
    opencode_session_id: str,
    send_message: Callable[[], Awaitable[Any]],
    existing_message_ids: set[str] | None = None,
) -> dict[str, Any]:
    base_url = os.getenv("OPENCODE_SERVER_URL", "http://127.0.0.1:4096").rstrip("/")
    timeout = float(os.getenv("OPENCODE_TIMEOUT", "120"))
    deadline = asyncio.get_running_loop().time() + timeout
    headers = {"Accept": "text/event-stream"}
    username = os.getenv("OPENCODE_SERVER_USERNAME", "")
    password = os.getenv("OPENCODE_SERVER_PASSWORD", "")
    auth = (username, password) if username or password else None
    last_data: dict[str, Any] = {}
    send_task: asyncio.Task[Any] | None = None

    client_timeout = httpx.Timeout(
        timeout,
        connect=OPENCODE_SSE_CONNECT_TIMEOUT_SECONDS,
        read=None,
        write=timeout,
        pool=OPENCODE_SSE_CONNECT_TIMEOUT_SECONDS,
    )
    event_task: asyncio.Task[dict[str, Any]] | None = None
    try:
        async with asyncio.timeout(timeout):
            async with httpx.AsyncClient(timeout=client_timeout, auth=auth) as client:
                async with client.stream(
                    "GET",
                    f"{base_url}/event",
                    headers=headers,
                    params=opencode_location_params(),
                ) as response:
                    response.raise_for_status()
                    content_type = response.headers.get("content-type", "")
                    if "text/event-stream" not in content_type.lower():
                        raise OpenCodeSSEUnavailable(f"OpenCode /event did not return SSE: {content_type}")
                    send_task = asyncio.create_task(send_message())
                    event_stream = iter_sse_events(response)
                    event_task = asyncio.create_task(anext(event_stream))

                    while True:
                        now = asyncio.get_running_loop().time()
                        if now >= deadline:
                            raise HTTPException(status_code=502, detail=f"OpenCode response timed out after {int(timeout)} seconds")

                        wait_tasks = [event_task]
                        if send_task is not None:
                            wait_tasks.append(send_task)
                        done, _ = await asyncio.wait(
                            wait_tasks,
                            timeout=deadline - now,
                            return_when=asyncio.FIRST_COMPLETED,
                        )
                        if not done:
                            raise HTTPException(status_code=502, detail=f"OpenCode response timed out after {int(timeout)} seconds")

                        if send_task is not None and send_task in done:
                            sent_data = await send_task
                            send_task = None
                            if has_completed_opencode_assistant_message(sent_data, existing_message_ids):
                                return sent_data

                        if event_task not in done:
                            continue
                        try:
                            event = event_task.result()
                        except StopAsyncIteration as exc:
                            raise OpenCodeSSEUnavailable("OpenCode SSE stream closed") from exc
                        event_task = asyncio.create_task(anext(event_stream))

                        if not opencode_event_matches_session(event, opencode_session_id):
                            continue
                        if opencode_event_type(event) == "session.error":
                            last_data = await load_opencode_messages(opencode_session_id)
                            if has_completed_opencode_assistant_message(last_data, existing_message_ids):
                                return last_data
                            raise HTTPException(status_code=502, detail=f"OpenCode request failed: {opencode_event_error_text(event)}")
                        if not opencode_event_can_complete_response(event):
                            continue

                        last_data = await load_opencode_messages(opencode_session_id)
                        if has_completed_opencode_assistant_message(last_data, existing_message_ids):
                            return last_data
    except TimeoutError:
        if send_task is not None:
            if send_task.done():
                send_task.result()
            else:
                send_task.cancel()
                with suppress(asyncio.CancelledError):
                    await send_task
        if last_data and has_completed_opencode_assistant_message(last_data, existing_message_ids):
            return last_data
        raise HTTPException(status_code=502, detail=f"OpenCode response timed out after {int(timeout)} seconds")
    except httpx.ConnectError as exc:
        if send_task is not None and not send_task.done():
            await send_task
        raise OpenCodeSSEUnavailable(f"OpenCode SSE is not reachable at {base_url}") from exc
    except httpx.HTTPStatusError as exc:
        if send_task is not None and not send_task.done():
            await send_task
        raise OpenCodeSSEUnavailable(safe_response_detail(exc.response)) from exc
    except httpx.HTTPError as exc:
        if send_task is not None and not send_task.done():
            await send_task
        raise OpenCodeSSEUnavailable(str(exc)) from exc
    finally:
        if send_task is not None and not send_task.done():
            await send_task
        if event_task is not None and not event_task.done():
            event_task.cancel()
            with suppress(asyncio.CancelledError):
                await event_task

    if last_data and has_completed_opencode_assistant_message(last_data, existing_message_ids):
        return last_data
    raise HTTPException(status_code=502, detail=f"OpenCode response timed out after {int(timeout)} seconds")


async def iter_sse_events(response: httpx.Response):
    data_lines: list[str] = []
    event_name = ""
    event_id = ""
    async for line in response.aiter_lines():
        if line == "":
            event = build_sse_event(data_lines, event_name, event_id)
            data_lines = []
            event_name = ""
            event_id = ""
            if event is not None:
                yield event
            continue
        if line.startswith(":"):
            continue
        field, _, value = line.partition(":")
        if value.startswith(" "):
            value = value[1:]
        if field == "data":
            data_lines.append(value)
        elif field == "event":
            event_name = value
        elif field == "id":
            event_id = value
    event = build_sse_event(data_lines, event_name, event_id)
    if event is not None:
        yield event


def build_sse_event(data_lines: list[str], event_name: str, event_id: str) -> dict[str, Any] | None:
    if not data_lines:
        return None
    data = "\n".join(data_lines)
    try:
        parsed = json.loads(data)
    except ValueError:
        parsed = {"data": data}
    if isinstance(parsed, dict):
        if event_name:
            parsed.setdefault("event", event_name)
        if event_id:
            parsed.setdefault("sse_id", event_id)
        return parsed
    return {"data": parsed, "event": event_name, "sse_id": event_id}


def opencode_sse_enabled() -> bool:
    value = os.getenv("OPENCODE_RESPONSE_TRANSPORT", "sse").strip().lower()
    return value not in {"poll", "polling", "http", "none", "off", "false", "0"}


def opencode_event_payload(event: dict[str, Any]) -> dict[str, Any]:
    payload = event.get("payload")
    return payload if isinstance(payload, dict) else event


def opencode_event_type(event: dict[str, Any]) -> str:
    payload = opencode_event_payload(event)
    return str(payload.get("type") or event.get("type") or event.get("event") or "")


def opencode_event_properties(event: dict[str, Any]) -> dict[str, Any]:
    payload = opencode_event_payload(event)
    properties = payload.get("properties")
    return properties if isinstance(properties, dict) else {}


def opencode_event_matches_session(event: dict[str, Any], opencode_session_id: str) -> bool:
    properties = opencode_event_properties(event)
    session_id = properties.get("sessionID")
    if session_id == opencode_session_id:
        return True
    info = properties.get("info")
    if isinstance(info, dict) and info.get("sessionID") == opencode_session_id:
        return True
    part = properties.get("part")
    return isinstance(part, dict) and part.get("sessionID") == opencode_session_id


def opencode_event_can_complete_response(event: dict[str, Any]) -> bool:
    event_type = opencode_event_type(event)
    if event_type in OPENCODE_RESPONSE_EVENT_TYPES:
        return True
    return event_type.startswith("session.next.") and event_type.endswith(".ended")


def opencode_event_error_text(event: dict[str, Any]) -> str:
    error = opencode_event_properties(event).get("error")
    if isinstance(error, dict):
        data = error.get("data")
        if isinstance(data, dict) and data.get("message"):
            return str(data["message"])
        if error.get("message"):
            return str(error["message"])
        if error.get("name"):
            return str(error["name"])
    if isinstance(error, str):
        return error
    return "OpenCode session error"


async def wait_for_opencode_response(
    opencode_session_id: str,
    existing_message_ids: set[str] | None = None,
) -> dict[str, Any]:
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
        if has_completed_opencode_assistant_message(last_data, existing_message_ids):
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


def extract_latest_opencode_assistant_text(data: Any, existing_message_ids: set[str] | None = None) -> str:
    messages = data.get("data") if isinstance(data, dict) else data
    if not isinstance(messages, list):
        if is_completed_opencode_assistant_message(data, existing_message_ids):
            info = data.get("info") if isinstance(data.get("info"), dict) else {}
            error_text = opencode_message_error_text(info)
            if error_text:
                return error_text
            return extract_opencode_text(data.get("parts", []))
        return extract_opencode_text(data)

    for message in reversed(messages):
        if not isinstance(message, dict):
            continue
        info = message.get("info") if isinstance(message.get("info"), dict) else {}
        if info.get("role") != "assistant":
            continue
        if existing_message_ids is not None and str(info.get("id") or "") in existing_message_ids:
            continue
        error_text = opencode_message_error_text(info)
        if error_text:
            return error_text
        text = extract_opencode_text(message.get("parts", []))
        if text:
            return text
    return ""


def opencode_message_error_text(info: dict[str, Any]) -> str:
    error = info.get("error")
    if not isinstance(error, dict):
        return ""
    detail = error.get("data")
    if isinstance(detail, dict) and detail.get("message"):
        return f"OpenCode 执行失败：{detail['message']}"
    if error.get("message"):
        return f"OpenCode 执行失败：{error['message']}"
    if error.get("name"):
        return f"OpenCode 执行失败：{error['name']}"
    return "OpenCode 执行失败"


def has_completed_opencode_assistant_message(data: Any, existing_message_ids: set[str] | None = None) -> bool:
    messages = data.get("data") if isinstance(data, dict) else data
    if not isinstance(messages, list):
        return is_completed_opencode_assistant_message(data, existing_message_ids)

    for message in reversed(messages):
        if is_completed_opencode_assistant_message(message, existing_message_ids):
            return True
    return False


def is_completed_opencode_assistant_message(message: Any, existing_message_ids: set[str] | None = None) -> bool:
    if not isinstance(message, dict):
        return False
    info = message.get("info") if isinstance(message.get("info"), dict) else {}
    if info.get("role") != "assistant":
        return False
    message_id = str(info.get("id") or "")
    if existing_message_ids is not None and message_id in existing_message_ids:
        return False
    if info.get("error"):
        return True
    finish = info.get("finish")
    if finish == "tool-calls":
        return False
    time_info = info.get("time") if isinstance(info.get("time"), dict) else {}
    return bool(time_info.get("completed"))


def opencode_message_ids(data: Any) -> set[str]:
    messages = data.get("data") if isinstance(data, dict) else data
    if not isinstance(messages, list):
        messages = [data]
    ids: set[str] = set()
    for message in messages:
        if not isinstance(message, dict):
            continue
        info = message.get("info") if isinstance(message.get("info"), dict) else {}
        message_id = info.get("id")
        if message_id:
            ids.add(str(message_id))
    return ids
