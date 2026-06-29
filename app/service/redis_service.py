from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from app.dto.database import ConnectionInfo
from app.plugin.database_client import create_redis_client


def ensure_redis_enabled(connection: ConnectionInfo) -> None:
    if not connection.redis_url:
        raise HTTPException(status_code=400, detail="Redis is not enabled for this connection")


def list_keys(connection: ConnectionInfo, pattern: str = "*", limit: int = 100) -> dict[str, Any]:
    ensure_redis_enabled(connection)
    client = create_redis_client(connection.redis_url)
    keys = []
    for key in client.scan_iter(match=pattern, count=limit):
        keys.append(key)
        if len(keys) >= limit:
            break
    return {"keys": keys}


def get_value(connection: ConnectionInfo, key: str) -> dict[str, Any]:
    ensure_redis_enabled(connection)
    client = create_redis_client(connection.redis_url)
    value_type = client.type(key)

    if value_type == "none":
        raise HTTPException(status_code=404, detail="Redis key not found")
    if value_type == "string":
        value: Any = client.get(key)
    elif value_type == "hash":
        value = client.hgetall(key)
    elif value_type == "list":
        value = client.lrange(key, 0, 100)
    elif value_type == "set":
        value = sorted(client.smembers(key))
    elif value_type == "zset":
        value = client.zrange(key, 0, 100, withscores=True)
    else:
        value = f"Unsupported Redis type: {value_type}"

    return {"key": key, "type": value_type, "value": value, "ttl": client.ttl(key)}
