from __future__ import annotations

import sqlite3
import struct
from typing import Any

import sqlite_vec

from app.model.settings import ROOT_DIR
from app.service.embedding_service import embed_query


KB_DB = ROOT_DIR / "data" / "kb.db"
DEFAULT_TOP_K = 5
MAX_TOP_K = 20


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(KB_DB)
    conn.enable_load_extension(True)
    sqlite_vec.load(conn)
    conn.enable_load_extension(False)
    return conn


def _pack(vec: list[float]) -> bytes:
    return struct.pack(f"{len(vec)}f", *vec)


async def search_knowledge(query: str, top_k: int = DEFAULT_TOP_K) -> dict[str, Any]:
    """在知识库中做语义检索,返回最相关的 top_k 个分块。"""
    query = (query or "").strip()
    if not query:
        return {"query": query, "results": [], "error": "empty query"}
    if not KB_DB.exists():
        return {
            "query": query,
            "results": [],
            "error": "知识库尚未构建,请先运行 scripts/build_kb.py",
        }

    top_k = max(1, min(top_k or DEFAULT_TOP_K, MAX_TOP_K))
    vec = await embed_query(query)
    blob = _pack(vec)

    conn = _connect()
    try:
        rows = conn.execute(
            """
            SELECT c.doc_path, c.title, c.content, v.distance
            FROM kb_vectors v
            JOIN kb_chunks c ON c.id = v.rowid
            WHERE v.embedding MATCH ? AND k = ?
            ORDER BY v.distance
            """,
            (blob, top_k),
        ).fetchall()
    finally:
        conn.close()

    results = [
        {
            "doc_path": doc_path,
            "title": title,
            "content": content,
            "distance": round(distance, 4),
        }
        for (doc_path, title, content, distance) in rows
    ]
    return {"query": query, "count": len(results), "results": results}
