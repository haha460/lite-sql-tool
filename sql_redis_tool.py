#!/usr/bin/env python3
"""
Small CLI utility for working with SQL databases and Redis.

Examples:
  SQL_URL="sqlite:///demo.db" REDIS_URL="redis://localhost:6379/0" \
    python sql_redis_tool.py health

  python sql_redis_tool.py query-cache \
    --sql "select id, name from users where id = :id" \
    --params '{"id": 1}' \
    --ttl 300

  python sql_redis_tool.py sync-table \
    --table users \
    --id-column id \
    --prefix user \
    --ttl 3600
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from dataclasses import dataclass
from typing import Any


DEFAULT_SQL_URL = "sqlite:///app.db"
DEFAULT_REDIS_URL = "redis://localhost:6379/0"


@dataclass(frozen=True)
class Settings:
    sql_url: str
    redis_url: str


def load_settings(args: argparse.Namespace) -> Settings:
    return Settings(
        sql_url=args.sql_url or os.getenv("SQL_URL", DEFAULT_SQL_URL),
        redis_url=args.redis_url or os.getenv("REDIS_URL", DEFAULT_REDIS_URL),
    )


def require_dependency(package: str, install_hint: str) -> Any:
    try:
        return __import__(package)
    except ImportError as exc:
        raise SystemExit(
            f"Missing dependency: {package}. Install it with: {install_hint}"
        ) from exc


def make_sql_engine(sql_url: str):
    sqlalchemy = require_dependency("sqlalchemy", "pip install -r requirements.txt")
    return sqlalchemy.create_engine(sql_url, pool_pre_ping=True, future=True)


def make_redis_client(redis_url: str):
    redis = require_dependency("redis", "pip install -r requirements.txt")
    return redis.Redis.from_url(redis_url, decode_responses=True)


def parse_json_object(raw: str | None, field_name: str) -> dict[str, Any]:
    if not raw:
        return {}

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{field_name} must be valid JSON: {exc}") from exc

    if not isinstance(parsed, dict):
        raise SystemExit(f"{field_name} must be a JSON object")

    return parsed


def dump_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def cache_key(sql: str, params: dict[str, Any], explicit_key: str | None) -> str:
    if explicit_key:
        return explicit_key

    payload = dump_json({"sql": sql, "params": params})
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return f"sql-cache:{digest}"


def rows_to_dicts(rows: Any) -> list[dict[str, Any]]:
    return [dict(row._mapping) for row in rows]


def cmd_health(args: argparse.Namespace) -> int:
    settings = load_settings(args)
    engine = make_sql_engine(settings.sql_url)
    redis_client = make_redis_client(settings.redis_url)
    sqlalchemy = require_dependency("sqlalchemy", "pip install -r requirements.txt")

    with engine.connect() as connection:
        connection.execute(sqlalchemy.text("select 1"))

    redis_client.ping()
    print("OK: SQL and Redis connections are healthy")
    return 0


def cmd_query_cache(args: argparse.Namespace) -> int:
    settings = load_settings(args)
    engine = make_sql_engine(settings.sql_url)
    redis_client = make_redis_client(settings.redis_url)
    sqlalchemy = require_dependency("sqlalchemy", "pip install -r requirements.txt")
    params = parse_json_object(args.params, "--params")
    key = cache_key(args.sql, params, args.key)

    cached = redis_client.get(key)
    if cached is not None and not args.refresh:
        print(cached)
        return 0

    with engine.connect() as connection:
        rows = connection.execute(sqlalchemy.text(args.sql), params).fetchall()

    result = dump_json(rows_to_dicts(rows))
    if args.ttl <= 0:
        redis_client.set(key, result)
    else:
        redis_client.setex(key, args.ttl, result)

    print(result)
    return 0


def cmd_invalidate(args: argparse.Namespace) -> int:
    settings = load_settings(args)
    redis_client = make_redis_client(settings.redis_url)
    deleted = redis_client.delete(*args.keys)
    print(f"Deleted {deleted} key(s)")
    return 0


def cmd_sync_table(args: argparse.Namespace) -> int:
    settings = load_settings(args)
    engine = make_sql_engine(settings.sql_url)
    redis_client = make_redis_client(settings.redis_url)
    sqlalchemy = require_dependency("sqlalchemy", "pip install -r requirements.txt")

    sql = f"select * from {args.table}"
    if args.where:
        sql += f" where {args.where}"

    params = parse_json_object(args.params, "--params")
    count = 0

    with engine.connect() as connection:
        rows = connection.execute(sqlalchemy.text(sql), params)
        pipe = redis_client.pipeline(transaction=False)

        for row in rows:
            item = dict(row._mapping)
            if args.id_column not in item:
                raise SystemExit(
                    f"Column {args.id_column!r} was not found in table result"
                )

            key = f"{args.prefix}:{item[args.id_column]}"
            encoded = {str(name): dump_json(value) for name, value in item.items()}
            pipe.hset(key, mapping=encoded)
            if args.ttl > 0:
                pipe.expire(key, args.ttl)
            count += 1

        pipe.execute()

    print(f"Synced {count} row(s) from SQL table {args.table!r} to Redis")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Connect SQL and Redis for health checks, cached queries, and table sync."
    )
    parser.add_argument("--sql-url", help=f"SQLAlchemy URL. Default: {DEFAULT_SQL_URL}")
    parser.add_argument("--redis-url", help=f"Redis URL. Default: {DEFAULT_REDIS_URL}")

    subparsers = parser.add_subparsers(dest="command", required=True)

    health = subparsers.add_parser("health", help="Check SQL and Redis connectivity")
    health.set_defaults(func=cmd_health)

    query_cache = subparsers.add_parser(
        "query-cache", help="Run a SQL query and cache the JSON result in Redis"
    )
    query_cache.add_argument("--sql", required=True, help="SQL query to run")
    query_cache.add_argument("--params", help='JSON query params, for example {"id":1}')
    query_cache.add_argument("--key", help="Redis key. Auto-generated when omitted")
    query_cache.add_argument("--ttl", type=int, default=300, help="Cache TTL in seconds")
    query_cache.add_argument(
        "--refresh", action="store_true", help="Bypass existing cache and refresh it"
    )
    query_cache.set_defaults(func=cmd_query_cache)

    invalidate = subparsers.add_parser("invalidate", help="Delete Redis cache keys")
    invalidate.add_argument("keys", nargs="+", help="Redis keys to delete")
    invalidate.set_defaults(func=cmd_invalidate)

    sync_table = subparsers.add_parser(
        "sync-table", help="Copy SQL table rows into Redis hashes"
    )
    sync_table.add_argument("--table", required=True, help="SQL table name")
    sync_table.add_argument(
        "--id-column", default="id", help="Column used as Redis key suffix"
    )
    sync_table.add_argument("--prefix", required=True, help="Redis key prefix")
    sync_table.add_argument("--where", help="Optional SQL where clause")
    sync_table.add_argument("--params", help='JSON query params, for example {"active":true}')
    sync_table.add_argument("--ttl", type=int, default=0, help="Redis TTL in seconds")
    sync_table.set_defaults(func=cmd_sync_table)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
