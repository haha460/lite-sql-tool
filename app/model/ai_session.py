from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.dto.database import ConnectionInfo
from app.service.time_service import utc_now


@dataclass
class AiSession:
    id: str
    connection: ConnectionInfo
    connection_name: str | None
    opencode_session_id: str | None = None
    messages: list[dict[str, Any]] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: utc_now())
    updated_at: str = field(default_factory=lambda: utc_now())
