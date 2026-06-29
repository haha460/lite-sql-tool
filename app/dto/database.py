from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


DEFAULT_QUERY_LIMIT = 100


class ConnectionInfo(BaseModel):
    sql_url: str | None = None
    redis_url: str | None = None
    readonly: bool = False


class SavedConnection(BaseModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    kind: str = "sql"
    sqlUrl: str = ""
    redisUrl: str = ""
    redisEnabled: bool = False
    readonly: bool = False


class SavedConnectionsRequest(BaseModel):
    connections: list[SavedConnection] = Field(default_factory=list)


class SqlQueryRequest(BaseModel):
    connection: ConnectionInfo
    sql: str = Field(min_length=1)
    params: dict[str, Any] = Field(default_factory=dict)
    limit: int = Field(default=DEFAULT_QUERY_LIMIT, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)


class CellUpdateRequest(BaseModel):
    connection: ConnectionInfo
    primary_key: str
    primary_key_value: Any
    column: str
    value: Any


class InsertRowRequest(BaseModel):
    connection: ConnectionInfo
    values: dict[str, Any] = Field(default_factory=dict)


class DeleteRowsRequest(BaseModel):
    connection: ConnectionInfo
    primary_key: str
    primary_key_values: list[Any] = Field(min_length=1)


class RedisKeysRequest(BaseModel):
    connection: ConnectionInfo
    pattern: str = "*"
    limit: int = Field(default=100, ge=1, le=1000)


class RedisValueRequest(BaseModel):
    connection: ConnectionInfo
    key: str = Field(min_length=1)
