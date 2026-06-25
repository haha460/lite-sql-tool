from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import redis
import sqlalchemy
from sqlalchemy.engine import Engine


DEFAULT_SQL_URL = "sqlite:///app.db"
DEFAULT_REDIS_URL = "redis://localhost:6379/0"


@dataclass(frozen=True)
class Settings:
    sql_url: str = DEFAULT_SQL_URL
    redis_url: str = DEFAULT_REDIS_URL


@lru_cache
def get_settings() -> Settings:
    return Settings(
        sql_url=os.getenv("SQL_URL", DEFAULT_SQL_URL),
        redis_url=os.getenv("REDIS_URL", DEFAULT_REDIS_URL),
    )


@lru_cache
def get_engine() -> Engine:
    return create_sql_engine(get_settings().sql_url)


def create_sql_engine(sql_url: str) -> Engine:
    connect_args: dict[str, Any] = {}
    if sql_url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
    if sql_url.startswith("mysql"):
        connect_args["connect_timeout"] = 5
    if sql_url.startswith("postgresql"):
        connect_args["connect_timeout"] = 5

    return sqlalchemy.create_engine(
        sql_url,
        pool_pre_ping=True,
        future=True,
        connect_args=connect_args,
    )


@lru_cache
def get_redis_client() -> redis.Redis:
    return create_redis_client(get_settings().redis_url)


def create_redis_client(redis_url: str) -> redis.Redis:
    return redis.Redis.from_url(
        redis_url,
        decode_responses=True,
        socket_connect_timeout=3,
        socket_timeout=3,
    )


def row_to_dict(row: Any) -> dict[str, Any]:
    return dict(row._mapping)
