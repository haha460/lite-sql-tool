from __future__ import annotations

import json
import re
from typing import Any

from fastapi import HTTPException
from sqlalchemy import MetaData, Table, delete, insert, inspect, text
from sqlalchemy.engine import Engine

from app.dto.database import CellUpdateRequest, ConnectionInfo, DeleteRowsRequest, InsertRowRequest, SqlQueryRequest
from app.plugin.database_client import create_sql_engine, get_engine, get_redis_client, row_to_dict


IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
SELECT_RE = re.compile(r"^\s*(select|with)\b", re.IGNORECASE)


def health() -> dict[str, Any]:
    engine = get_engine()
    sql_ok = False
    redis_ok = False
    redis_error = None

    with engine.connect() as connection:
        connection.execute(text("select 1"))
        sql_ok = True

    try:
        get_redis_client().ping()
        redis_ok = True
    except Exception as exc:  # Redis is useful, but table editing should still work.
        redis_error = str(exc)

    return {"sql": sql_ok, "redis": redis_ok, "redis_error": redis_error}


def list_tables(connection: ConnectionInfo) -> dict[str, Any]:
    ensure_sql_enabled(connection)
    engine = create_sql_engine(connection.sql_url)
    try:
        inspector = inspect(engine)
        table_names = inspector.get_table_names()
        stats_by_table = load_table_stats(engine, table_names)
        tables = []
        for table_name in table_names:
            columns = inspector.get_columns(table_name)
            pk = inspector.get_pk_constraint(table_name).get("constrained_columns") or []
            foreign_keys = safe_inspect_list(inspector.get_foreign_keys, table_name)
            indexes = safe_inspect_list(inspector.get_indexes, table_name)
            stats = stats_by_table.get(table_name, {})
            tables.append(
                {
                    "name": table_name,
                    "primary_key": pk[0] if pk else None,
                    "row_count": stats.get("row_count"),
                    "row_count_estimated": stats.get("row_count_estimated"),
                    "size_bytes": stats.get("size_bytes"),
                    "columns": [
                        {
                            "name": column["name"],
                            "type": str(column["type"]),
                            "nullable": column.get("nullable", True),
                            "default": column.get("default"),
                            "primary_key": column["name"] in pk,
                        }
                        for column in columns
                    ],
                    "foreign_keys": [
                        {
                            "name": item.get("name"),
                            "columns": item.get("constrained_columns") or [],
                            "referred_table": item.get("referred_table"),
                            "referred_columns": item.get("referred_columns") or [],
                        }
                        for item in foreign_keys
                    ],
                    "indexes": [
                        {
                            "name": item.get("name"),
                            "columns": item.get("column_names") or [],
                            "unique": bool(item.get("unique")),
                        }
                        for item in indexes
                    ],
                }
            )
        return {"tables": tables}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to load tables: {exc}") from exc
    finally:
        engine.dispose()


def get_table_rows(
    table_name: str,
    connection: ConnectionInfo,
    limit: int,
    offset: int,
    include_total: bool,
) -> dict[str, Any]:
    ensure_sql_enabled(connection)
    engine = create_sql_engine(connection.sql_url)
    try:
        ensure_table_exists(engine, table_name)
        table_sql = quote_identifier(engine, table_name)
        sql = f"select * from {table_sql} limit :limit offset :offset"

        with engine.connect() as sql_connection:
            fetched_rows = sql_connection.execute(text(sql), {"limit": limit + 1, "offset": offset}).fetchall()
            visible_rows = fetched_rows[:limit]
            total = None
            if include_total:
                total = sql_connection.execute(text(f"select count(*) from {table_sql}")).scalar_one()

        return {
            "rows": [row_to_dict(row) for row in visible_rows],
            "has_more": len(fetched_rows) > limit,
            "loaded": offset + len(visible_rows),
            "total": total,
        }
    finally:
        engine.dispose()


def run_query(payload: SqlQueryRequest) -> dict[str, Any]:
    ensure_sql_enabled(payload.connection)
    if not SELECT_RE.match(payload.sql):
        raise HTTPException(status_code=400, detail="Only SELECT/WITH queries are allowed here")

    sql = payload.sql.strip().rstrip(";")
    limited_sql = f"select * from ({sql}) as visual_query limit :__limit offset :__offset"
    params = dict(payload.params)
    params["__limit"] = payload.limit + 1
    params["__offset"] = payload.offset

    engine = create_sql_engine(payload.connection.sql_url)
    try:
        with engine.connect() as connection:
            result = connection.execute(text(limited_sql), params)
            fetched_rows = result.fetchall()
            visible_rows = fetched_rows[: payload.limit]

        return {
            "columns": list(result.keys()),
            "rows": [row_to_dict(row) for row in visible_rows],
            "limit": payload.limit,
            "offset": payload.offset,
            "loaded": payload.offset + len(visible_rows),
            "has_more": len(fetched_rows) > payload.limit,
        }
    finally:
        engine.dispose()


def update_cell(table_name: str, payload: CellUpdateRequest) -> dict[str, Any]:
    ensure_sql_enabled(payload.connection)
    ensure_writable(payload.connection)
    engine = create_sql_engine(payload.connection.sql_url)
    try:
        columns = ensure_table_exists(engine, table_name)
        column_names = {column["name"] for column in columns}

        if payload.column not in column_names:
            raise HTTPException(status_code=404, detail=f"Column not found: {payload.column}")
        if payload.primary_key not in column_names:
            raise HTTPException(status_code=404, detail=f"Primary key not found: {payload.primary_key}")
        if payload.column == payload.primary_key:
            raise HTTPException(status_code=400, detail="Primary key cells are not editable")

        table_sql = quote_identifier(engine, table_name)
        column_sql = quote_identifier(engine, payload.column)
        pk_sql = quote_identifier(engine, payload.primary_key)
        sql = f"update {table_sql} set {column_sql} = :value where {pk_sql} = :primary_key_value"

        with engine.begin() as connection:
            result = connection.execute(
                text(sql),
                {
                    "value": normalize_cell_value(payload.value),
                    "primary_key_value": payload.primary_key_value,
                },
            )

        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="No row matched that primary key")
        return {"updated": result.rowcount}
    finally:
        engine.dispose()


def insert_row(table_name: str, payload: InsertRowRequest) -> dict[str, Any]:
    ensure_sql_enabled(payload.connection)
    ensure_writable(payload.connection)
    engine = create_sql_engine(payload.connection.sql_url)
    try:
        columns = ensure_table_exists(engine, table_name)
        column_names = {column["name"] for column in columns}
        clean_values = {
            key: normalized_value
            for key, value in payload.values.items()
            if key in column_names and (normalized_value := normalize_cell_value(value)) is not None
        }
        if not clean_values:
            raise HTTPException(status_code=400, detail="No insertable values were provided")

        table = reflected_table(engine, table_name)
        with engine.begin() as connection:
            result = connection.execute(insert(table).values(**clean_values))
        return {"inserted": 1, "primary_key": result.inserted_primary_key[0] if result.inserted_primary_key else None}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to insert row: {exc}") from exc
    finally:
        engine.dispose()


def delete_rows(table_name: str, payload: DeleteRowsRequest) -> dict[str, Any]:
    ensure_sql_enabled(payload.connection)
    ensure_writable(payload.connection)
    engine = create_sql_engine(payload.connection.sql_url)
    try:
        columns = ensure_table_exists(engine, table_name)
        column_names = {column["name"] for column in columns}
        if payload.primary_key not in column_names:
            raise HTTPException(status_code=404, detail=f"Primary key not found: {payload.primary_key}")

        table = reflected_table(engine, table_name)
        pk_column = table.c[payload.primary_key]
        with engine.begin() as connection:
            result = connection.execute(delete(table).where(pk_column.in_(payload.primary_key_values)))
        return {"deleted": result.rowcount}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to delete rows: {exc}") from exc
    finally:
        engine.dispose()


def ensure_table_exists(engine: Engine, table_name: str) -> list[dict[str, Any]]:
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    if table_name not in table_names:
        raise HTTPException(status_code=404, detail=f"Table not found: {table_name}")
    return inspector.get_columns(table_name)


def safe_inspect_list(fn: Any, table_name: str) -> list[dict[str, Any]]:
    try:
        value = fn(table_name)
    except Exception:
        return []
    return value if isinstance(value, list) else []


def load_table_stats(engine: Engine, table_names: list[str]) -> dict[str, dict[str, Any]]:
    stats = {name: {"row_count": None, "row_count_estimated": False, "size_bytes": None} for name in table_names}
    if not table_names:
        return stats

    dialect = engine.dialect.name
    try:
        if dialect == "mysql":
            return load_mysql_table_stats(engine, stats)
        if dialect == "postgresql":
            return load_postgresql_table_stats(engine, stats)
        if dialect == "clickhouse":
            return load_clickhouse_table_stats(engine, stats)
        if dialect == "sqlite":
            return load_sqlite_table_stats(engine, stats)
    except Exception:
        return stats
    return stats


def load_mysql_table_stats(engine: Engine, stats: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    sql = """
        select
          table_name,
          table_rows as row_count,
          coalesce(data_length, 0) + coalesce(index_length, 0) as size_bytes
        from information_schema.tables
        where table_schema = database()
    """
    with engine.connect() as connection:
        rows = connection.execute(text(sql)).mappings().all()
    for row in rows:
        table_name = row.get("table_name")
        if table_name in stats:
            stats[table_name]["row_count"] = optional_int(row.get("row_count"))
            stats[table_name]["row_count_estimated"] = True
            stats[table_name]["size_bytes"] = optional_int(row.get("size_bytes"))
    return stats


def load_postgresql_table_stats(engine: Engine, stats: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    sql = """
        select
          c.relname as table_name,
          greatest(c.reltuples::bigint, 0) as row_count,
          pg_total_relation_size(c.oid) as size_bytes
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'p')
          and n.nspname = current_schema()
    """
    with engine.connect() as connection:
        rows = connection.execute(text(sql)).mappings().all()
    for row in rows:
        table_name = row.get("table_name")
        if table_name in stats:
            stats[table_name]["row_count"] = optional_int(row.get("row_count"))
            stats[table_name]["row_count_estimated"] = True
            stats[table_name]["size_bytes"] = optional_int(row.get("size_bytes"))
    return stats


def load_clickhouse_table_stats(engine: Engine, stats: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    sql = """
        select
          name as table_name,
          total_rows as row_count,
          total_bytes as size_bytes
        from system.tables
        where database = currentDatabase()
    """
    with engine.connect() as connection:
        rows = connection.execute(text(sql)).mappings().all()
    for row in rows:
        table_name = row.get("table_name")
        if table_name in stats:
            stats[table_name]["row_count"] = optional_int(row.get("row_count"))
            stats[table_name]["size_bytes"] = optional_int(row.get("size_bytes"))
    return stats


def load_sqlite_table_stats(engine: Engine, stats: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    with engine.connect() as connection:
        for table_name in stats:
            try:
                table_sql = quote_identifier(engine, table_name)
                stats[table_name]["row_count"] = optional_int(
                    connection.execute(text(f"select count(*) from {table_sql}")).scalar_one()
                )
            except Exception:
                stats[table_name]["row_count"] = None

            try:
                stats[table_name]["size_bytes"] = optional_int(
                    connection.execute(text("select sum(pgsize) from dbstat where name = :name"), {"name": table_name}).scalar()
                )
            except Exception:
                stats[table_name]["size_bytes"] = None
    return stats


def optional_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return None


def quote_identifier(engine: Engine, identifier: str) -> str:
    if not IDENTIFIER_RE.match(identifier):
        raise HTTPException(status_code=400, detail=f"Invalid identifier: {identifier}")
    return engine.dialect.identifier_preparer.quote(identifier)


def reflected_table(engine: Engine, table_name: str) -> Table:
    if not IDENTIFIER_RE.match(table_name):
        raise HTTPException(status_code=400, detail=f"Invalid identifier: {table_name}")
    metadata = MetaData()
    return Table(table_name, metadata, autoload_with=engine)


def ensure_writable(connection: ConnectionInfo) -> None:
    if connection.readonly:
        raise HTTPException(status_code=403, detail="This connection is read-only")


def ensure_sql_enabled(connection: ConnectionInfo) -> None:
    if not connection.sql_url:
        raise HTTPException(status_code=400, detail="SQL is not enabled for this connection")


def ensure_redis_enabled(connection: ConnectionInfo) -> None:
    if not connection.redis_url:
        raise HTTPException(status_code=400, detail="Redis is not enabled for this connection")


def normalize_cell_value(value: Any) -> Any:
    if value == "":
        return None
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return json.dumps(value, ensure_ascii=False)
