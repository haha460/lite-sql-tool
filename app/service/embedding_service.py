from __future__ import annotations

import os

import httpx
from fastapi import HTTPException


def _config() -> tuple[str, str, str]:
    base = os.environ.get("HUAYAN_API_BASE")
    key = os.environ.get("HUAYAN_API_KEY")
    if not base or not key:
        raise HTTPException(status_code=500, detail="HUAYAN_API_BASE / HUAYAN_API_KEY not configured")
    model = os.getenv("KB_EMBED_MODEL", "text-embedding-3-small")
    return base.rstrip("/"), key, model


async def embed_query(text: str) -> list[float]:
    """对查询文本取 embedding(与灌库脚本使用同一模型)。"""
    base, key, model = _config()
    timeout = float(os.getenv("KB_EMBED_TIMEOUT", "30"))
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                f"{base}/embeddings",
                headers={"Authorization": f"Bearer {key}"},
                json={"model": model, "input": text},
            )
            resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"embedding failed: {exc.response.text[:200]}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"embedding failed: {exc}") from exc

    try:
        return resp.json()["data"][0]["embedding"]
    except (KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="embedding response malformed") from exc
