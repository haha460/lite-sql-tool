#!/usr/bin/env python3
"""知识库灌库脚本。

扫描 knowledge_base/ 目录下的 .md / .txt 文档,切块 -> 调 embedding -> 写入 data/kb.db。

用法:
    set -a; source .env; set +a
    .venv/bin/python scripts/build_kb.py            # 增量灌库(按文件修改时间)
    .venv/bin/python scripts/build_kb.py --rebuild  # 全量重建(换 embedding 模型/维度后必须)

环境变量(默认值适配华彦 text-embedding-3-small):
    HUAYAN_API_BASE   embedding 接口 base,如 https://www.huayanapi.com/v1
    HUAYAN_API_KEY    API key
    KB_EMBED_MODEL    embedding 模型名,默认 text-embedding-3-small
    KB_EMBED_DIM      向量维度,默认 1536(必须与模型输出一致)
"""
from __future__ import annotations

import argparse
import os
import re
import sqlite3
import struct
import sys
import time
from pathlib import Path

import httpx
import sqlite_vec

ROOT = Path(__file__).resolve().parent.parent
KB_DIR = ROOT / "knowledge_base"
DB_PATH = ROOT / "data" / "kb.db"

EMBED_MODEL = os.getenv("KB_EMBED_MODEL", "text-embedding-3-small")
EMBED_DIM = int(os.getenv("KB_EMBED_DIM", "1536"))
EMBED_BATCH = int(os.getenv("KB_EMBED_BATCH", "32"))

CHUNK_TARGET = int(os.getenv("KB_CHUNK_TARGET", "400"))  # 每块目标字数
CHUNK_OVERLAP = int(os.getenv("KB_CHUNK_OVERLAP", "60"))  # 块间重叠字数


# --------------------------------------------------------------------------- #
# embedding
# --------------------------------------------------------------------------- #
def _api_config() -> tuple[str, str]:
    base = os.environ.get("HUAYAN_API_BASE")
    key = os.environ.get("HUAYAN_API_KEY")
    if not base or not key:
        sys.exit("缺少 HUAYAN_API_BASE / HUAYAN_API_KEY,请先 `set -a; source .env; set +a`")
    return base.rstrip("/"), key


def embed(texts: list[str]) -> list[list[float]]:
    """对一批文本取 embedding,自动分批。"""
    base, key = _api_config()
    url = f"{base}/embeddings"
    out: list[list[float]] = []
    with httpx.Client(timeout=60) as client:
        for i in range(0, len(texts), EMBED_BATCH):
            batch = texts[i : i + EMBED_BATCH]
            resp = client.post(
                url,
                headers={"Authorization": f"Bearer {key}"},
                json={"model": EMBED_MODEL, "input": batch},
            )
            resp.raise_for_status()
            data = resp.json()["data"]
            # 按 index 排序,确保顺序与输入一致
            data.sort(key=lambda d: d["index"])
            for d in data:
                vec = d["embedding"]
                if len(vec) != EMBED_DIM:
                    sys.exit(
                        f"维度不匹配:模型输出 {len(vec)} 维,但 KB_EMBED_DIM={EMBED_DIM}。"
                        f"请把 KB_EMBED_DIM 设为 {len(vec)} 并 --rebuild。"
                    )
                out.append(vec)
    return out


# --------------------------------------------------------------------------- #
# 切块
# --------------------------------------------------------------------------- #
def split_document(text: str) -> list[tuple[str, str]]:
    """把文档切成 [(title, chunk_text), ...]。

    先按 Markdown 标题分段(记录最近的标题),再对每段按目标字数二次切分并重叠。
    """
    chunks: list[tuple[str, str]] = []

    def emit(title: str, body: str) -> None:
        body = body.strip()
        if not body:
            return
        if len(body) <= CHUNK_TARGET:
            chunks.append((title, body))
            return
        step = max(CHUNK_TARGET - CHUNK_OVERLAP, 1)
        i = 0
        while i < len(body):
            piece = body[i : i + CHUNK_TARGET].strip()
            if piece:
                chunks.append((title, piece))
            i += step

    parts = re.split(r"(?m)^(#{1,6}\s.*)$", text)
    cur_title = ""
    idx = 0
    # 处理第一个标题之前的正文
    if parts and not re.match(r"^#{1,6}\s", parts[0] or ""):
        emit(cur_title, parts[0])
        idx = 1
    while idx < len(parts):
        seg = parts[idx]
        if re.match(r"^#{1,6}\s", seg or ""):
            cur_title = seg.lstrip("#").strip()
            body = parts[idx + 1] if idx + 1 < len(parts) else ""
            emit(cur_title, body)
            idx += 2
        else:
            emit(cur_title, seg)
            idx += 1
    return chunks


# --------------------------------------------------------------------------- #
# 数据库
# --------------------------------------------------------------------------- #
def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.enable_load_extension(True)
    sqlite_vec.load(conn)
    conn.enable_load_extension(False)
    conn.executescript(
        f"""
        CREATE TABLE IF NOT EXISTS kb_chunks(
            id          INTEGER PRIMARY KEY,
            doc_path    TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            title       TEXT,
            content     TEXT NOT NULL,
            doc_mtime   REAL,
            updated_at  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks(doc_path);
        CREATE VIRTUAL TABLE IF NOT EXISTS kb_vectors USING vec0(embedding float[{EMBED_DIM}]);
        """
    )
    return conn


def pack(vec: list[float]) -> bytes:
    return struct.pack(f"{len(vec)}f", *vec)


def delete_doc(conn: sqlite3.Connection, doc_path: str) -> None:
    ids = [r[0] for r in conn.execute("SELECT id FROM kb_chunks WHERE doc_path=?", (doc_path,))]
    for cid in ids:
        conn.execute("DELETE FROM kb_vectors WHERE rowid=?", (cid,))
    conn.execute("DELETE FROM kb_chunks WHERE doc_path=?", (doc_path,))


def build(rebuild: bool = False) -> None:
    if not KB_DIR.exists():
        sys.exit(f"知识库目录不存在:{KB_DIR}")

    conn = connect()

    if rebuild:
        conn.execute("DELETE FROM kb_vectors")
        conn.execute("DELETE FROM kb_chunks")
        conn.commit()
        print("已清空,准备全量重建")

    files = sorted([*KB_DIR.rglob("*.md"), *KB_DIR.rglob("*.txt")])
    current_paths = {str(f.relative_to(ROOT)) for f in files}

    # 清理已删除文件的残留
    for (stale,) in conn.execute("SELECT DISTINCT doc_path FROM kb_chunks").fetchall():
        if stale not in current_paths:
            delete_doc(conn, stale)
            print(f"purge {stale}(源文件已删除)")
    conn.commit()

    total_chunks = 0
    for f in files:
        rel = str(f.relative_to(ROOT))
        mtime = f.stat().st_mtime
        row = conn.execute(
            "SELECT doc_mtime FROM kb_chunks WHERE doc_path=? LIMIT 1", (rel,)
        ).fetchone()
        if not rebuild and row and row[0] == mtime:
            print(f"skip  {rel}(未修改)")
            continue

        delete_doc(conn, rel)
        chunks = split_document(f.read_text(encoding="utf-8"))
        if not chunks:
            conn.commit()
            print(f"empty {rel}")
            continue

        vectors = embed([c for _, c in chunks])
        now = time.strftime("%Y-%m-%d %H:%M:%S")
        for idx, ((title, content), vec) in enumerate(zip(chunks, vectors)):
            cur = conn.execute(
                "INSERT INTO kb_chunks(doc_path,chunk_index,title,content,doc_mtime,updated_at)"
                " VALUES(?,?,?,?,?,?)",
                (rel, idx, title, content, mtime, now),
            )
            conn.execute(
                "INSERT INTO kb_vectors(rowid, embedding) VALUES(?,?)",
                (cur.lastrowid, pack(vec)),
            )
        conn.commit()
        total_chunks += len(chunks)
        print(f"built {rel}: {len(chunks)} chunks")

    n = conn.execute("SELECT COUNT(*) FROM kb_chunks").fetchone()[0]
    conn.close()
    print(f"\n完成。本次写入 {total_chunks} 块,知识库现有 {n} 块。DB: {DB_PATH}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--rebuild", action="store_true", help="全量重建(换模型/维度后必用)")
    args = ap.parse_args()
    build(rebuild=args.rebuild)
