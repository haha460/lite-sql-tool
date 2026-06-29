from __future__ import annotations

import os

import httpx
from fastapi import HTTPException

from app.service.common import safe_response_detail


async def call_ai_model(messages: list[dict[str, str]], model_config: dict[str, str]) -> str:
    timeout = float(os.getenv("AI_API_TIMEOUT", "60"))
    url = chat_completions_url(model_config["api_base"])
    headers = {
        "Authorization": f"Bearer {model_config['api_key']}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model_config["model"],
        "messages": messages,
        "temperature": 0.2,
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        detail = safe_response_detail(exc.response)
        raise HTTPException(status_code=502, detail=f"AI request failed: {detail}") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"AI request failed: {exc}") from exc

    data = response.json()
    try:
        return str(data["choices"][0]["message"]["content"] or "")
    except (KeyError, IndexError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="AI response did not contain a message") from exc


def chat_completions_url(api_base: str) -> str:
    cleaned = api_base.rstrip("/")
    if cleaned.endswith("/chat/completions"):
        return cleaned
    return f"{cleaned}/chat/completions"
