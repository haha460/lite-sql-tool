from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.dto.database import ConnectionInfo


DEFAULT_AI_LIMIT = 100
MAX_AI_LIMIT = 1000


class AiSessionRequest(BaseModel):
    connection: ConnectionInfo
    connection_name: str | None = None


class AiSessionLookupRequest(BaseModel):
    connection: ConnectionInfo
    connection_name: str | None = None


class AiSessionLinksRequest(BaseModel):
    links: dict[str, str] = Field(default_factory=dict)


class AiChatRequest(BaseModel):
    session_id: str
    message: str = Field(min_length=1)
    limit: int = Field(default=DEFAULT_AI_LIMIT, ge=1, le=MAX_AI_LIMIT)
    model_id: str | None = None


class AiToolSchemaRequest(BaseModel):
    session_id: str


class AiToolSelectRequest(BaseModel):
    session_id: str
    sql: str = Field(min_length=1)
    limit: int = Field(default=DEFAULT_AI_LIMIT, ge=1, le=MAX_AI_LIMIT)
