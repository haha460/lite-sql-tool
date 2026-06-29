from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException
from sqlalchemy import text

from app.dto.database import ConnectionInfo, SavedConnection, SavedConnectionsRequest
from app.model.settings import CONNECTIONS_FILE, DEFAULT_REDIS_URL, RUNTIME_DIR
from app.plugin.database_client import create_redis_client, create_sql_engine


def load_saved_connections() -> list[dict[str, Any]]:
    if not CONNECTIONS_FILE.exists():
        return []
    try:
        raw = json.loads(CONNECTIONS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read saved connections: {exc}") from exc

    items = raw.get("connections") if isinstance(raw, dict) else raw
    if not isinstance(items, list):
        return []

    connections: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        try:
            connections.append(normalize_saved_connection(SavedConnection.model_validate(item)).model_dump())
        except Exception:
            continue
    return connections


def write_saved_connections(connections: list[dict[str, Any]]) -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "connections": connections,
    }
    temp_file = CONNECTIONS_FILE.with_suffix(".json.tmp")
    try:
        temp_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        temp_file.chmod(0o600)
        temp_file.replace(CONNECTIONS_FILE)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save connections: {exc}") from exc


def save_connections(payload: SavedConnectionsRequest) -> dict[str, Any]:
    connections = [normalize_saved_connection(connection).model_dump() for connection in payload.connections]
    write_saved_connections(connections)
    return {"connections": connections}


def test_connection(connection: ConnectionInfo) -> dict[str, Any]:
    if not connection.sql_url and not connection.redis_url:
        raise HTTPException(status_code=400, detail="SQL URL or Redis URL is required")

    sql_ok = False
    redis_ok = False
    redis_error = None
    engine = None

    if connection.sql_url:
        engine = create_sql_engine(connection.sql_url)
        try:
            with engine.connect() as sql_connection:
                sql_connection.execute(text("select 1"))
                sql_ok = True
        except Exception as exc:
            engine.dispose()
            raise HTTPException(status_code=400, detail=f"SQL connection failed: {exc}") from exc

    if connection.redis_url:
        try:
            create_redis_client(connection.redis_url).ping()
            redis_ok = True
        except Exception as exc:
            redis_error = str(exc)

    if engine:
        engine.dispose()
    return {"sql": sql_ok, "redis": redis_ok, "redis_error": redis_error}


def normalize_saved_connection(connection: SavedConnection) -> SavedConnection:
    kind = "redis" if connection.kind == "redis" else "sql"
    redis_enabled = kind == "redis" or bool(connection.redisEnabled)
    return SavedConnection(
        id=connection.id.strip(),
        name=connection.name.strip(),
        kind=kind,
        sqlUrl="" if kind == "redis" else connection.sqlUrl.strip(),
        redisUrl=(connection.redisUrl.strip() or DEFAULT_REDIS_URL) if redis_enabled else "",
        redisEnabled=redis_enabled,
        readonly=True if kind == "redis" else bool(connection.readonly),
    )
