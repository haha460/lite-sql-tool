from __future__ import annotations

import re
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

from app.dto.database import ConnectionInfo
from app.model.settings import ROOT_DIR
from app.plugin.database_client import normalize_sql_url


DATABASE_SKILL_DIRS = (ROOT_DIR / "数据库", ROOT_DIR / "docs")
MAX_DATABASE_SKILL_CHARS = 30000


def load_database_skill(connection: ConnectionInfo) -> dict[str, Any] | None:
    """Load a database-specific Markdown skill by database name.

    A connected database named `charge` automatically maps to `docs/charge.md`.
    """
    database_name = database_name_from_connection(connection)
    if not database_name:
        return None

    skill_file = database_skill_file(database_name)
    if not skill_file:
        return None

    try:
        content = skill_file.read_text(encoding="utf-8").strip()
    except OSError:
        return None

    if not content:
        return None

    truncated = len(content) > MAX_DATABASE_SKILL_CHARS
    if truncated:
        content = content[:MAX_DATABASE_SKILL_CHARS].rstrip()

    return {
        "type": "database_markdown",
        "database": database_name,
        "name": skill_file.stem,
        "path": str(skill_file.relative_to(ROOT_DIR)),
        "truncated": truncated,
        "content": content,
    }


def database_skill_file(database_name: str) -> Path | None:
    safe_names = database_skill_candidate_names(database_name)
    for directory in DATABASE_SKILL_DIRS:
        for safe_name in safe_names:
            path = directory / f"{safe_name}.md"
            if path.is_file():
                return path
    return None


def database_skill_candidate_names(database_name: str) -> list[str]:
    cleaned = database_name.strip()
    candidates = [cleaned]
    normalized = re.sub(r"[^0-9A-Za-z_\-]+", "_", cleaned).strip("_")
    if normalized and normalized not in candidates:
        candidates.append(normalized)
    lowered = normalized.lower()
    if lowered and lowered not in candidates:
        candidates.append(lowered)
    return candidates


def database_name_from_connection(connection: ConnectionInfo) -> str | None:
    if not connection.sql_url:
        return None
    normalized_url = normalize_sql_url(connection.sql_url)
    if normalized_url.startswith("sqlite"):
        return database_name_from_sqlite_url(normalized_url)
    parsed = urlsplit(normalized_url)
    path_name = unquote(parsed.path.rsplit("/", 1)[-1]).strip()
    return path_name or None


def database_name_from_sqlite_url(sql_url: str) -> str | None:
    path = sql_url.split(":///", 1)[-1] if ":///" in sql_url else sql_url.split("://", 1)[-1]
    if path in {"", ":memory:"}:
        return None
    return Path(path).stem or None
