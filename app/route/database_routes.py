from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from app.dto.database import (
    CellUpdateRequest,
    ConnectionInfo,
    DeleteRowsRequest,
    InsertRowRequest,
    RedisKeysRequest,
    RedisValueRequest,
    SavedConnectionsRequest,
    SqlQueryRequest,
)
from app.api.database_api import connection_api, database_api, redis_api


router = APIRouter()


@router.get("/api/health")
def health() -> dict[str, Any]:
    return database_api.health()


@router.get("/api/connections")
def get_saved_connections() -> dict[str, Any]:
    return {"connections": connection_api.load_saved_connections()}


@router.put("/api/connections")
def save_saved_connections(payload: SavedConnectionsRequest) -> dict[str, Any]:
    return connection_api.save_connections(payload)


@router.post("/api/connections/test")
def test_connection(connection: ConnectionInfo) -> dict[str, Any]:
    return connection_api.test_connection(connection)


@router.post("/api/tables")
def list_tables(connection: ConnectionInfo) -> dict[str, Any]:
    return database_api.list_tables(connection)


@router.post("/api/tables/{table_name}/rows")
def get_table_rows(
    table_name: str,
    connection: ConnectionInfo,
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    include_total: bool = Query(default=False),
) -> dict[str, Any]:
    return database_api.get_table_rows(table_name, connection, limit, offset, include_total)


@router.post("/api/query")
def run_query(payload: SqlQueryRequest) -> dict[str, Any]:
    return database_api.run_query(payload)


@router.patch("/api/tables/{table_name}/cell")
def update_cell(table_name: str, payload: CellUpdateRequest) -> dict[str, Any]:
    return database_api.update_cell(table_name, payload)


@router.post("/api/tables/{table_name}/rows/insert")
def insert_row(table_name: str, payload: InsertRowRequest) -> dict[str, Any]:
    return database_api.insert_row(table_name, payload)


@router.post("/api/tables/{table_name}/rows/delete")
def delete_rows(table_name: str, payload: DeleteRowsRequest) -> dict[str, Any]:
    return database_api.delete_rows(table_name, payload)


@router.post("/api/redis/keys")
def list_redis_keys(payload: RedisKeysRequest) -> dict[str, Any]:
    return redis_api.list_keys(payload.connection, payload.pattern, payload.limit)


@router.post("/api/redis/value")
def get_redis_value(payload: RedisValueRequest) -> dict[str, Any]:
    return redis_api.get_value(payload.connection, payload.key)
