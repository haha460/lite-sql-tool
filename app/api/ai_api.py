from __future__ import annotations

from typing import Any, Protocol

from app.dto.database import ConnectionInfo
from app.model.ai_session import AiSession
from app.service import ai_database_service, ai_service, ai_session_service


class AiApi(Protocol):
    def load_ai_config(self) -> dict[str, Any]: ...

    def agent_backend(self) -> str: ...

    def public_model_configs(self, models: list[dict[str, str]]) -> list[dict[str, str]]: ...

    def load_ai_session_links(self) -> dict[str, str]: ...

    def normalize_ai_session_links(self, links: dict[str, Any]) -> dict[str, str]: ...

    def write_ai_session_links(self, links: dict[str, str]) -> None: ...

    def ensure_ai_configured(self) -> None: ...

    def get_model_config(self, model_id: str | None) -> dict[str, str]: ...

    async def chat_with_direct_model(
        self,
        session: AiSession,
        user_message: str,
        limit: int,
        model_config: dict[str, str],
    ) -> dict[str, Any]: ...

    async def chat_with_opencode(
        self,
        session: AiSession,
        user_message: str,
        model_config: dict[str, str],
    ) -> dict[str, Any]: ...


class AiDatabaseApi(Protocol):
    def ensure_sql_enabled(self, connection: ConnectionInfo) -> None: ...

    def load_schema(self, connection: ConnectionInfo) -> dict[str, Any]: ...

    def execute_readonly_sql(self, connection: ConnectionInfo, sql: str, limit: int) -> dict[str, Any]: ...


class AiSessionApi(Protocol):
    def init_session_store(self) -> None: ...

    def new_session_id(self) -> str: ...

    def save_session(self, session: AiSession) -> None: ...

    def find_latest_session(self, connection_info: ConnectionInfo, connection_name: str | None) -> AiSession | None: ...

    def session_response(self, session: AiSession) -> dict[str, Any]: ...

    def require_session(self, session_id: str) -> AiSession: ...


ai_api: AiApi = ai_service
ai_database_api: AiDatabaseApi = ai_database_service
ai_session_api: AiSessionApi = ai_session_service


__all__ = ["ai_api", "ai_database_api", "ai_session_api"]
