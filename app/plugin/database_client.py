from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Any
from urllib.parse import quote, unquote

import redis
import sqlalchemy
from sqlalchemy.engine import Engine

from app.model.settings import DEFAULT_REDIS_URL, DEFAULT_SQL_URL


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
    normalized_sql_url = normalize_sql_url(sql_url)
    connect_args: dict[str, Any] = {}
    if normalized_sql_url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
    if normalized_sql_url.startswith("mysql"):
        connect_args["connect_timeout"] = 5
    if normalized_sql_url.startswith("postgresql"):
        connect_args["connect_timeout"] = 5

    return sqlalchemy.create_engine(
        normalized_sql_url,
        pool_pre_ping=True,
        future=True,
        connect_args=connect_args,
    )


def normalize_sql_url(sql_url: str) -> str:
    """Allow users to paste DB URLs with raw password characters."""
    cleaned = sql_url.strip()
    if "://" not in cleaned or cleaned.startswith("sqlite"):
        return cleaned

    scheme, rest = cleaned.split("://", 1)
    if scheme in {"postgres", "postgresql"}:
        scheme = "postgresql+psycopg"
    slash_index = rest.find("/")
    if slash_index == -1:
        authority = rest
        suffix = ""
    else:
        authority = rest[:slash_index]
        suffix = rest[slash_index:]

    if "@" not in authority:
        return cleaned

    userinfo, hostinfo = authority.rsplit("@", 1)
    if ":" in userinfo:
        username, password = userinfo.split(":", 1)
        encoded_userinfo = f"{quote(unquote(username), safe='')}:{quote(unquote(password), safe='')}"
    else:
        encoded_userinfo = quote(unquote(userinfo), safe="")

    return f"{scheme}://{encoded_userinfo}@{hostinfo}{suffix}"


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
