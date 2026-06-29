from __future__ import annotations

from typing import Any, Protocol

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
from app.service import connection_service, database_service, redis_service


class ConnectionApi(Protocol):
    def load_saved_connections(self) -> list[dict[str, Any]]: ...

    def save_connections(self, payload: SavedConnectionsRequest) -> dict[str, Any]: ...

    def test_connection(self, connection: ConnectionInfo) -> dict[str, Any]: ...


class DatabaseApi(Protocol):
    def health(self) -> dict[str, Any]: ...

    def list_tables(self, connection: ConnectionInfo) -> dict[str, Any]: ...

    def get_table_rows(
        self,
        table_name: str,
        connection: ConnectionInfo,
        limit: int,
        offset: int,
        include_total: bool,
    ) -> dict[str, Any]: ...

    def run_query(self, payload: SqlQueryRequest) -> dict[str, Any]: ...

    def update_cell(self, table_name: str, payload: CellUpdateRequest) -> dict[str, Any]: ...

    def insert_row(self, table_name: str, payload: InsertRowRequest) -> dict[str, Any]: ...

    def delete_rows(self, table_name: str, payload: DeleteRowsRequest) -> dict[str, Any]: ...


class RedisApi(Protocol):
    def list_keys(self, connection: ConnectionInfo, pattern: str = "*", limit: int = 100) -> dict[str, Any]: ...

    def get_value(self, connection: ConnectionInfo, key: str) -> dict[str, Any]: ...


connection_api: ConnectionApi = connection_service
database_api: DatabaseApi = database_service
redis_api: RedisApi = redis_service


__all__ = ["connection_api", "database_api", "redis_api"]
