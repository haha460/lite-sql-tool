from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.dto.ai import (
    AiChatRequest,
    AiSessionLinksRequest,
    AiSessionLookupRequest,
    AiSessionRequest,
    AiSkillUploadRequest,
    AiToolSchemaRequest,
    AiToolSelectRequest,
)
from app.api.ai_api import ai_api, ai_database_api, ai_session_api
from app.model.ai_session import AiSession
from app.service import ai_skill_service


router = APIRouter(prefix="/api/ai", tags=["ai"])


@router.get("/config")
def ai_config() -> dict[str, Any]:
    config = ai_api.load_ai_config()
    default_model = config["default_model"]
    return {
        "configured": config["configured"],
        "model": default_model["model"] if default_model else "",
        "api_base": default_model["api_base"] if default_model else "",
        "agent_backend": ai_api.agent_backend(),
        "default_model_id": default_model["id"] if default_model else None,
        "models": ai_api.public_model_configs(config["models"]),
    }


@router.post("/sessions")
def create_ai_session(payload: AiSessionRequest) -> dict[str, Any]:
    ai_database_api.ensure_sql_enabled(payload.connection)
    ai_session_api.init_session_store()
    session_id = ai_session_api.new_session_id()
    session = AiSession(
        id=session_id,
        connection=payload.connection,
        connection_name=payload.connection_name,
    )
    ai_session_api.save_session(session)
    return {
        "session_id": session_id,
        "created_at": session.created_at,
        "connection_name": payload.connection_name,
    }


@router.post("/sessions/lookup")
def lookup_ai_session(payload: AiSessionLookupRequest) -> dict[str, Any]:
    ai_database_api.ensure_sql_enabled(payload.connection)
    session = ai_session_api.find_latest_session(payload.connection, payload.connection_name)
    if not session:
        return {"session": None}
    return {"session": ai_session_api.session_response(session)}


@router.get("/session-links")
def get_ai_session_links() -> dict[str, Any]:
    return {"links": ai_api.load_ai_session_links()}


@router.put("/session-links")
def save_ai_session_links(payload: AiSessionLinksRequest) -> dict[str, Any]:
    links = ai_api.normalize_ai_session_links(payload.links)
    ai_api.write_ai_session_links(links)
    return {"links": links}


@router.get("/sessions/{session_id}/messages")
def get_ai_messages(session_id: str) -> dict[str, Any]:
    session = ai_session_api.require_session(session_id)
    return ai_session_api.session_response(session)


@router.get("/sessions/{session_id}/skill")
def get_ai_session_skill(session_id: str) -> dict[str, Any]:
    session = ai_session_api.require_session(session_id)
    skill = ai_skill_service.current_skill_for_session(session)
    if not skill:
        return {"skill": None}
    return {"skill": {key: value for key, value in skill.items() if key != "content"}}


@router.post("/skills/upload")
async def upload_ai_skill(payload: AiSkillUploadRequest) -> dict[str, Any]:
    session = ai_session_api.require_session(payload.session_id)
    ai_api.ensure_ai_configured()
    ai_database_api.ensure_sql_enabled(session.connection)
    model_config = ai_api.get_model_config(payload.model_id)
    result = await ai_skill_service.create_or_replace_skill(
        session,
        payload.filename,
        payload.content,
        model_config,
    )
    ai_session_api.save_session(session)
    return result


@router.post("/chat")
async def ai_chat(payload: AiChatRequest) -> dict[str, Any]:
    session = ai_session_api.require_session(payload.session_id)
    ai_api.ensure_ai_configured()
    ai_database_api.ensure_sql_enabled(session.connection)
    model_config = ai_api.get_model_config(payload.model_id)

    user_message = payload.message.strip()
    if ai_api.agent_backend() == "opencode":
        assistant_message = await ai_api.chat_with_opencode(session, user_message, model_config)
        return {"message": assistant_message, "session_id": session.id}

    assistant_message = await ai_api.chat_with_direct_model(session, user_message, payload.limit, model_config)
    return {"message": assistant_message, "session_id": session.id}


@router.post("/chat/stream")
async def ai_chat_stream(payload: AiChatRequest) -> StreamingResponse:
    session = ai_session_api.require_session(payload.session_id)
    ai_api.ensure_ai_configured()
    ai_database_api.ensure_sql_enabled(session.connection)
    model_config = ai_api.get_model_config(payload.model_id)

    user_message = payload.message.strip()
    if ai_api.agent_backend() == "opencode":
        events = ai_api.stream_chat_with_opencode(session, user_message, model_config)
    else:
        events = ai_api.stream_chat_with_direct_model(session, user_message, payload.limit, model_config)
    return StreamingResponse(
        ai_api.encode_chat_events(events),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/tool/schema")
def ai_tool_schema(payload: AiToolSchemaRequest) -> dict[str, Any]:
    session = ai_session_api.require_session(payload.session_id)
    schema = ai_database_api.load_schema(session.connection, ai_skill_service.current_skill_for_session(session))
    ai_api.publish_stream_event(
        session.id,
        {
            "type": "step",
            "phase": "schema",
            "title": "读取数据库结构",
            "status": "done",
            "detail": f"已加载 {len(schema.get('tables') or [])} 张表的字段、索引与约束信息"
            + ("，并合并当前绑定 Skill" if schema.get("database_skill") else ""),
        },
    )
    return schema


@router.post("/tool/select")
def ai_tool_select(payload: AiToolSelectRequest) -> dict[str, Any]:
    session = ai_session_api.require_session(payload.session_id)
    sql_index = ai_api.next_stream_sql_index(session.id)
    sql_phase = f"sql:{sql_index}"
    ai_api.publish_stream_event(
        session.id,
        {
            "type": "step",
            "phase": sql_phase,
            "title": "执行只读 SQL",
            "status": "running",
            "detail": "正在向当前数据库连接提交只读查询",
            "sql": payload.sql,
            "sql_index": sql_index,
        },
    )
    try:
        result = ai_database_api.execute_readonly_sql(session.connection, payload.sql, payload.limit)
    except Exception as exc:
        ai_api.publish_stream_event(
            session.id,
            {
                "type": "step",
                "phase": sql_phase,
                "title": "执行只读 SQL",
                "status": "error",
                "detail": "SQL 执行失败，可展开查看语句与错误信息",
                "sql": payload.sql,
                "sql_index": sql_index,
                "error": str(getattr(exc, "detail", exc)),
            },
        )
        raise
    ai_api.publish_stream_event(
        session.id,
        {
            "type": "step",
            "phase": sql_phase,
            "title": "执行只读 SQL",
            "status": "done",
            "detail": "SQL 已执行完成，可展开查看完整语句",
            "sql": result.get("sql") or payload.sql,
            "sql_index": sql_index,
            "row_count": len(result.get("rows") or []),
            "truncated": bool(result.get("truncated")),
        },
    )
    return result
