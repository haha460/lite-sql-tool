from __future__ import annotations

import json
import os
import uuid
from functools import lru_cache
from typing import Any

from fastapi import HTTPException
from sqlalchemy import text

from app.dto.database import ConnectionInfo
from app.model.ai_session import AiSession
from app.plugin.database_client import create_sql_engine
from app.service.common import clean_optional_text, json_value
from app.service.time_service import utc_now


AI_SESSION_LOOKUP_LIMIT = 200
AI_SESSION_TABLE = "ai_sessions"
AI_SESSION_TURN_TABLE = "ai_session_turns"
AI_SESSIONS: dict[str, AiSession] = {}
AI_SESSION_STORE_READY = False


def new_session_id() -> str:
    return uuid.uuid4().hex


def trim_session_messages(session: AiSession) -> None:
    if len(session.messages) > 40:
        session.messages = session.messages[-40:]


def new_turn_id() -> str:
    return f"turn_{uuid.uuid4().hex}"


def next_session_turn_index(session: AiSession) -> int:
    indexes = [
        safe_int(message.get("turn_index"), 0)
        for message in session.messages
        if safe_int(message.get("turn_index"), 0) > 0
    ]
    return (max(indexes) + 1) if indexes else (len(messages_to_turns(session.messages)) + 1)


def messages_to_turns(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    turn_slots: list[dict[str, Any]] = []
    explicit_slots: dict[str, dict[str, Any]] = {}
    pending_slot: dict[str, Any] | None = None
    fallback_index = 1

    def new_slot() -> dict[str, Any]:
        return {"user_message": None, "assistant_message": None, "fallback_index": len(turn_slots) + 1}

    def add_to_slot(slot: dict[str, Any], message: dict[str, Any]) -> None:
        role = message.get("role")
        if role == "user" and slot["user_message"] is None:
            slot["user_message"] = message
        elif role == "assistant":
            slot["assistant_message"] = message

    for message in messages:
        if not isinstance(message, dict):
            continue
        turn_id = clean_optional_text(message.get("turn_id"))
        if turn_id:
            if pending_slot is not None:
                turn_slots.append(pending_slot)
                pending_slot = None
            slot = explicit_slots.get(turn_id)
            if slot is None:
                slot = new_slot()
                explicit_slots[turn_id] = slot
                turn_slots.append(slot)
            add_to_slot(slot, message)
            continue

        role = message.get("role")
        if role == "user":
            if pending_slot is not None:
                turn_slots.append(pending_slot)
            pending_slot = new_slot()
            add_to_slot(pending_slot, message)
            continue
        if role != "assistant":
            continue
        if pending_slot is None:
            pending_slot = new_slot()
        add_to_slot(pending_slot, message)

    if pending_slot is not None:
        turn_slots.append(pending_slot)

    turns = []
    for slot in turn_slots:
        turn = build_turn_record(slot["user_message"], slot["assistant_message"], fallback_index)
        turns.append(turn)
        fallback_index = max(fallback_index + 1, safe_int(turn.get("turn_index"), fallback_index) + 1)
    return turns


def build_turn_record(
    user_message: dict[str, Any] | None,
    assistant_message: dict[str, Any] | None,
    fallback_index: int,
) -> dict[str, Any]:
    turn_id = clean_optional_text((assistant_message or {}).get("turn_id")) or clean_optional_text((user_message or {}).get("turn_id")) or new_turn_id()
    turn_index = safe_int((assistant_message or {}).get("turn_index") or (user_message or {}).get("turn_index"), fallback_index)
    user_payload = copy_message_for_turn(user_message, turn_id, turn_index) if user_message else None
    assistant_payload = copy_message_for_turn(assistant_message, turn_id, turn_index) if assistant_message else None
    created_at = clean_optional_text((user_payload or assistant_payload or {}).get("created_at")) or utc_now()
    updated_at = clean_optional_text((assistant_payload or user_payload or {}).get("created_at")) or created_at
    return {
        "turn_id": turn_id,
        "turn_index": turn_index,
        "user_message": user_payload,
        "assistant_message": assistant_payload,
        "created_at": created_at,
        "updated_at": updated_at,
    }


def copy_message_for_turn(message: dict[str, Any] | None, turn_id: str, turn_index: int) -> dict[str, Any] | None:
    if not isinstance(message, dict):
        return None
    copied = dict(message)
    copied["turn_id"] = turn_id
    copied["turn_index"] = turn_index
    return copied


def turns_to_messages(turns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    for turn in sorted(turns, key=lambda item: safe_int(item.get("turn_index"), 0)):
        user_message = turn.get("user_message")
        assistant_message = turn.get("assistant_message")
        turn_index = safe_int(turn.get("turn_index"), 0)
        if isinstance(user_message, dict):
            messages.append(copy_message_for_turn(user_message, str(turn["turn_id"]), turn_index) or user_message)
        if isinstance(assistant_message, dict):
            messages.append(copy_message_for_turn(assistant_message, str(turn["turn_id"]), turn_index) or assistant_message)
    return messages


def safe_int(value: Any, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def require_session(session_id: str) -> AiSession:
    session = AI_SESSIONS.get(session_id)
    if not session:
        session = load_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="AI session not found")
    return session


def session_response(session: AiSession) -> dict[str, Any]:
    turns = messages_to_turns(session.messages)
    return {
        "session_id": session.id,
        "messages": session.messages,
        "turns": turns,
        "connection_name": session.connection_name,
        "created_at": session.created_at,
        "updated_at": session.updated_at,
        "opencode_session_id": session.opencode_session_id,
    }


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
            connection.execute(
                text(
                    f"""
                    create table if not exists {AI_SESSION_TURN_TABLE} (
                        turn_id text primary key,
                        session_id text not null,
                        turn_index integer not null,
                        user_message json,
                        assistant_message json,
                        created_at text not null,
                        updated_at text not null
                    )
                    """
                )
            )
            connection.execute(
                text(
                    f"""
                    create unique index if not exists {AI_SESSION_TURN_TABLE}_session_turn_idx
                    on {AI_SESSION_TURN_TABLE} (session_id, turn_index)
                    """
                )
            )
            connection.execute(
                text(
                    f"""
                    create index if not exists {AI_SESSION_TURN_TABLE}_session_updated_idx
                    on {AI_SESSION_TURN_TABLE} (session_id, updated_at)
                    """
                )
            )
            migrate_legacy_session_turns(connection, engine.dialect.name)
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
        "messages": json.dumps([], ensure_ascii=False),
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
            save_session_turns(connection, engine.dialect.name, session)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save AI session: {exc}") from exc


def save_session_turns(connection: Any, dialect_name: str, session: AiSession) -> None:
    save_turn_rows(connection, dialect_name, session.id, messages_to_turns(session.messages))


def save_turn_rows(connection: Any, dialect_name: str, session_id: str, turns: list[dict[str, Any]]) -> None:
    for turn in turns:
        payload = {
            "turn_id": turn["turn_id"],
            "session_id": session_id,
            "turn_index": turn["turn_index"],
            "user_message": json.dumps(turn["user_message"], ensure_ascii=False, default=str) if turn["user_message"] else None,
            "assistant_message": json.dumps(turn["assistant_message"], ensure_ascii=False, default=str) if turn["assistant_message"] else None,
            "created_at": turn["created_at"],
            "updated_at": turn["updated_at"],
        }
        if dialect_name == "postgresql":
            connection.execute(
                text(
                    f"""
                    insert into {AI_SESSION_TURN_TABLE}
                        (turn_id, session_id, turn_index, user_message, assistant_message, created_at, updated_at)
                    values
                        (:turn_id, :session_id, :turn_index, cast(:user_message as json),
                         cast(:assistant_message as json), :created_at, :updated_at)
                    on conflict (turn_id) do update set
                        session_id = excluded.session_id,
                        turn_index = excluded.turn_index,
                        user_message = excluded.user_message,
                        assistant_message = excluded.assistant_message,
                        updated_at = excluded.updated_at
                    """
                ),
                payload,
            )
        else:
            connection.execute(
                text(
                    f"""
                    insert into {AI_SESSION_TURN_TABLE}
                        (turn_id, session_id, turn_index, user_message, assistant_message, created_at, updated_at)
                    values
                        (:turn_id, :session_id, :turn_index, :user_message,
                         :assistant_message, :created_at, :updated_at)
                    on conflict (turn_id) do update set
                        session_id = excluded.session_id,
                        turn_index = excluded.turn_index,
                        user_message = excluded.user_message,
                        assistant_message = excluded.assistant_message,
                        updated_at = excluded.updated_at
                    """
                ),
                payload,
            )


def migrate_legacy_session_turns(connection: Any, dialect_name: str) -> None:
    rows = (
        connection.execute(
            text(
                f"""
                select id, messages
                from {AI_SESSION_TABLE}
                where messages is not null
                """
            )
        )
        .mappings()
        .all()
    )
    for row in rows:
        session_id = str(row["id"])
        existing_turn = (
            connection.execute(
                text(
                    f"""
                    select 1
                    from {AI_SESSION_TURN_TABLE}
                    where session_id = :session_id
                    limit 1
                    """
                ),
                {"session_id": session_id},
            )
            .first()
        )
        if existing_turn:
            continue
        messages = normalize_legacy_messages(json_value(row["messages"], []))
        if not messages:
            continue
        save_turn_rows(connection, dialect_name, session_id, messages_to_turns(messages))


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
        messages=[],
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )
    turns = load_session_turns(session.id)
    if turns:
        session.messages = turns_to_messages(turns)
    else:
        session.messages = normalize_legacy_messages(json_value(row["messages"], []))
        if session.messages:
            save_session(session)
    AI_SESSIONS[session.id] = session
    return session


def find_latest_session(connection_info: ConnectionInfo, connection_name: str | None) -> AiSession | None:
    candidates = [
        session
        for session in AI_SESSIONS.values()
        if session_lookup_rank(session, connection_info, connection_name) is not None
    ]
    if candidates:
        return best_ranked_session(candidates, connection_info, connection_name)

    if not session_store_enabled():
        return None
    init_session_store()
    engine = get_session_store_engine()
    try:
        with engine.connect() as connection:
            rows = (
                connection.execute(
                    text(
                        f"""
                        select id
                        from {AI_SESSION_TABLE}
                        order by updated_at desc
                        limit :limit
                        """
                    ),
                    {"limit": AI_SESSION_LOOKUP_LIMIT},
                )
                .mappings()
                .all()
            )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to lookup AI session: {exc}") from exc

    matches: list[tuple[int, AiSession]] = []
    for row in rows:
        session = load_session(str(row["id"]))
        if not session:
            continue
        rank = session_lookup_rank(session, connection_info, connection_name)
        if rank is not None:
            matches.append((rank, session))
    if not matches:
        return None
    best_rank = min(rank for rank, _session in matches)
    return sorted(
        (session for rank, session in matches if rank == best_rank),
        key=lambda item: item.updated_at,
        reverse=True,
    )[0]


def best_ranked_session(
    sessions: list[AiSession],
    connection_info: ConnectionInfo,
    connection_name: str | None,
) -> AiSession | None:
    matches = [
        (rank, session)
        for session in sessions
        if (rank := session_lookup_rank(session, connection_info, connection_name)) is not None
    ]
    if not matches:
        return None
    best_rank = min(rank for rank, _session in matches)
    return sorted(
        (session for rank, session in matches if rank == best_rank),
        key=lambda item: item.updated_at,
        reverse=True,
    )[0]


def session_matches_connection(session: AiSession, connection_info: ConnectionInfo, connection_name: str | None) -> bool:
    return session_lookup_rank(session, connection_info, connection_name) == 0


def session_lookup_rank(session: AiSession, connection_info: ConnectionInfo, connection_name: str | None) -> int | None:
    name_matches = bool(connection_name and session.connection_name == connection_name)
    exact_connection_matches = normalized_connection_key(session.connection) == normalized_connection_key(connection_info)
    loose_connection_matches = normalized_connection_identity(session.connection) == normalized_connection_identity(connection_info)

    if connection_name:
        if name_matches and exact_connection_matches:
            return 0
        if name_matches and loose_connection_matches:
            return 1
        return None
    if exact_connection_matches:
        return 0
    if loose_connection_matches:
        return 1
    return None


def normalized_connection_key(connection: ConnectionInfo) -> tuple[str, str, bool]:
    return (
        (connection.sql_url or "").strip(),
        (connection.redis_url or "").strip(),
        bool(connection.readonly),
    )


def normalized_connection_identity(connection: ConnectionInfo) -> tuple[str, str]:
    return (
        (connection.sql_url or "").strip(),
        (connection.redis_url or "").strip(),
    )


def load_session_turns(session_id: str) -> list[dict[str, Any]]:
    if not session_store_enabled():
        return []
    engine = get_session_store_engine()
    try:
        with engine.connect() as connection:
            rows = (
                connection.execute(
                    text(
                        f"""
                        select turn_id, session_id, turn_index, user_message, assistant_message,
                               created_at, updated_at
                        from {AI_SESSION_TURN_TABLE}
                        where session_id = :session_id
                        order by turn_index asc, created_at asc
                        """
                    ),
                    {"session_id": session_id},
                )
                .mappings()
                .all()
            )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load AI session turns: {exc}") from exc

    return [
        {
            "turn_id": str(row["turn_id"]),
            "session_id": str(row["session_id"]),
            "turn_index": int(row["turn_index"]),
            "user_message": json_value(row["user_message"], None),
            "assistant_message": json_value(row["assistant_message"], None),
            "created_at": str(row["created_at"]),
            "updated_at": str(row["updated_at"]),
        }
        for row in rows
    ]


def normalize_legacy_messages(messages: Any) -> list[dict[str, Any]]:
    if not isinstance(messages, list):
        return []
    return turns_to_messages(messages_to_turns([message for message in messages if isinstance(message, dict)]))

