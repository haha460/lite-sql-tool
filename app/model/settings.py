from __future__ import annotations

from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - python-dotenv is installed with uvicorn[standard].
    load_dotenv = None


ROOT_DIR = Path(__file__).resolve().parent.parent.parent
STATIC_DIR = ROOT_DIR / "static"
RUNTIME_DIR = ROOT_DIR / ".runtime"
CONNECTIONS_FILE = RUNTIME_DIR / "connections.json"
AI_SESSION_LINKS_FILE = RUNTIME_DIR / "ai_session_links.json"

DEFAULT_SQL_URL = "sqlite:///app.db"
DEFAULT_REDIS_URL = "redis://localhost:6379/0"


def load_environment() -> None:
    if load_dotenv:
        load_dotenv(ROOT_DIR / ".env")


load_environment()
