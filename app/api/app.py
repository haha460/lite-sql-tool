from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.model.settings import STATIC_DIR
from app.route.ai_routes import router as ai_router
from app.route.database_routes import router as database_router


def create_app() -> FastAPI:
    app = FastAPI(title="SQL Redis Visual Tool")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    app.include_router(database_router)
    app.include_router(ai_router)
    register_frontend_routes(app)
    return app


def register_frontend_routes(app: FastAPI) -> None:
    @app.middleware("http")
    async def disable_frontend_cache(request: Request, call_next: Any) -> Any:
        response = await call_next(request)
        if request.url.path == "/" or request.url.path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-store, max-age=0"
            response.headers["Pragma"] = "no-cache"
        return response

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-store, max-age=0"})
