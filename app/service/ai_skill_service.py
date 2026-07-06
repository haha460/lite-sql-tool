from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from app.dto.database import ConnectionInfo
from app.model.ai_session import AiSession
from app.model.settings import ROOT_DIR, RUNTIME_DIR
from app.plugin import ai_model_client
from app.service.database_skill_service import database_name_from_connection
from app.service.time_service import utc_now


LOCAL_SKILL_DIR = ROOT_DIR / ".skill"
SKILL_BINDINGS_FILE = RUNTIME_DIR / "ai_skill_bindings.json"
MAX_UPLOAD_CHARS = 120000
MAX_SKILL_CHARS = 30000


def load_skill_bindings() -> dict[str, Any]:
    if not SKILL_BINDINGS_FILE.exists():
        return {"version": 1, "by_session": {}, "by_database": {}}
    try:
        raw = json.loads(SKILL_BINDINGS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read skill bindings: {exc}") from exc
    if not isinstance(raw, dict):
        return {"version": 1, "by_session": {}, "by_database": {}}
    raw.setdefault("version", 1)
    raw.setdefault("by_session", {})
    raw.setdefault("by_database", {})
    return raw


def save_skill_bindings(bindings: dict[str, Any]) -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    temp_file = SKILL_BINDINGS_FILE.with_suffix(".json.tmp")
    try:
        temp_file.write_text(json.dumps(bindings, ensure_ascii=False, indent=2), encoding="utf-8")
        temp_file.chmod(0o600)
        temp_file.replace(SKILL_BINDINGS_FILE)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save skill bindings: {exc}") from exc


def current_skill_for_session(session: AiSession) -> dict[str, Any] | None:
    bindings = load_skill_bindings()
    record = bindings.get("by_session", {}).get(session.id)
    if not record:
        database_name = database_name_from_connection(session.connection)
        if database_name:
            record = bindings.get("by_database", {}).get(database_name)
    if not isinstance(record, dict):
        return None
    return hydrate_skill_record(record)


def hydrate_skill_record(record: dict[str, Any]) -> dict[str, Any] | None:
    path_text = str(record.get("path") or "").strip()
    if not path_text:
        return None
    path = (ROOT_DIR / path_text).resolve() if not Path(path_text).is_absolute() else Path(path_text)
    try:
        path.relative_to(ROOT_DIR.resolve())
    except ValueError:
        return None
    if not path.is_file():
        return None
    try:
        content = path.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    truncated = len(content) > MAX_SKILL_CHARS
    if truncated:
        content = content[:MAX_SKILL_CHARS].rstrip()
    return {
        "type": "uploaded_skill",
        "id": record.get("id"),
        "name": record.get("name") or path.stem,
        "database": record.get("database"),
        "source_filename": record.get("source_filename"),
        "path": str(path.relative_to(ROOT_DIR)),
        "created_at": record.get("created_at"),
        "updated_at": record.get("updated_at"),
        "truncated": truncated,
        "content": content,
    }


async def create_or_replace_skill(
    session: AiSession,
    source_filename: str,
    document_content: str,
    model_config: dict[str, str],
) -> dict[str, Any]:
    clean_content = document_content.strip()
    if not clean_content:
        raise HTTPException(status_code=400, detail="Uploaded document is empty")
    if len(clean_content) > MAX_UPLOAD_CHARS:
        clean_content = clean_content[:MAX_UPLOAD_CHARS].rstrip()

    database_name = database_name_from_connection(session.connection) or safe_slug(session.connection_name or "database")
    conversion_error = None
    generated_by = "ai"
    try:
        skill_markdown = await generate_skill_markdown(database_name, source_filename, clean_content, model_config)
    except HTTPException as exc:
        conversion_error = str(exc.detail)
        generated_by = "local_fallback"
        skill_markdown = build_fallback_skill_markdown(database_name, source_filename, clean_content, conversion_error)
    record = write_skill_file(session, database_name, source_filename, skill_markdown)
    record["generated_by"] = generated_by
    if conversion_error:
        record["conversion_error"] = conversion_error
    bind_skill(session, database_name, record)
    return {"skill": {key: value for key, value in record.items() if key != "content"}}


async def generate_skill_markdown(
    database_name: str,
    source_filename: str,
    document_content: str,
    model_config: dict[str, str],
) -> str:
    prompt = (
        "你是 AI 助手的数据库 Skill 转换器。"
        "请把用户上传的数据库业务文档转换为可被数据库分析 Agent 使用的 Skill Markdown。"
        "目标是让 Agent 后续能基于该 Skill 生成 SQL、解释表关系、遵循业务口径和产出规则。"
        "只输出 Markdown 正文，不要代码块，不要额外寒暄。"
        "必须包含以下章节：\n"
        "# 数据库 Skill\n"
        "## 适用数据库\n"
        "## 业务背景\n"
        "## 核心表与字段含义\n"
        "## 表关系与关键流程\n"
        "## 指标口径与查询规则\n"
        "## 输出要求\n"
        "## 注意事项与假设\n"
        "如果原文没有某部分，请写“原文未提供”。\n\n"
        f"适用数据库：{database_name}\n"
        f"来源文件：{source_filename}\n\n"
        "上传文档内容：\n"
        f"{document_content}"
    )
    markdown = await ai_model_client.call_ai_model(
        [
            {"role": "system", "content": "你负责把数据库说明文档压缩、结构化为数据库分析 Skill。"},
            {"role": "user", "content": prompt},
        ],
        model_config,
    )
    cleaned = markdown.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:markdown|md)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    if not cleaned:
        raise HTTPException(status_code=502, detail="AI did not generate a skill")
    return cleaned


def write_skill_file(session: AiSession, database_name: str, source_filename: str, content: str) -> dict[str, Any]:
    LOCAL_SKILL_DIR.mkdir(parents=True, exist_ok=True)
    slug = safe_slug(database_name or session.id)
    path = LOCAL_SKILL_DIR / f"{slug}.skill.md"
    header = (
        "---\n"
        f"name: {slug}\n"
        f"database: {database_name}\n"
        f"source: {source_filename}\n"
        f"session_id: {session.id}\n"
        f"updated_at: {utc_now()}\n"
        "---\n\n"
    )
    try:
        path.write_text(header + content.strip() + "\n", encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to write skill file: {exc}") from exc
    now = utc_now()
    return {
        "id": uuid.uuid4().hex,
        "name": slug,
        "database": database_name,
        "source_filename": source_filename,
        "path": str(path.relative_to(ROOT_DIR)),
        "created_at": now,
        "updated_at": now,
    }


def build_fallback_skill_markdown(
    database_name: str,
    source_filename: str,
    document_content: str,
    conversion_error: str,
) -> str:
    clipped_content = document_content[:MAX_SKILL_CHARS].rstrip()
    if len(document_content) > MAX_SKILL_CHARS:
        clipped_content += "\n\n> 原始上传文档较长，已按本地兜底规则截断。"
    return (
        "# 数据库 Skill\n\n"
        "## 适用数据库\n\n"
        f"{database_name}\n\n"
        "## 业务背景\n\n"
        "本 Skill 由上传文档本地兜底导入。AI 转换暂时失败，因此保留原始文档内容供 Agent 后续分析使用。\n\n"
        "## 核心表与字段含义\n\n"
        "请从下方“上传文档原文”中提取表、字段、关系和业务含义；生成 SQL 时仍以实时数据库 schema 为准。\n\n"
        "## 表关系与关键流程\n\n"
        "请优先遵循上传文档原文中的流程描述；如果原文与实时 schema 冲突，请使用实时 schema 并说明差异。\n\n"
        "## 指标口径与查询规则\n\n"
        "请从上传文档原文中识别指标口径、筛选条件、状态枚举、时间字段和产出格式。\n\n"
        "## 输出要求\n\n"
        "回答数据库问题时，请给出 SQL、逻辑说明、关键假设和校验建议。\n\n"
        "## 注意事项与假设\n\n"
        f"- 来源文件：{source_filename}\n"
        f"- AI 转换失败原因：{conversion_error}\n"
        "- 本地兜底 Skill 未做语义重写，仅结构化包装原文。\n\n"
        "## 上传文档原文\n\n"
        f"{clipped_content}"
    )


def bind_skill(session: AiSession, database_name: str, record: dict[str, Any]) -> None:
    bindings = load_skill_bindings()
    by_session = bindings.setdefault("by_session", {})
    for session_id, existing_record in list(by_session.items()):
        if isinstance(existing_record, dict) and existing_record.get("database") == database_name:
            by_session[session_id] = record
    by_session[session.id] = record
    if database_name:
        bindings.setdefault("by_database", {})[database_name] = record
    save_skill_bindings(bindings)


def safe_slug(value: str) -> str:
    slug = re.sub(r"[^0-9A-Za-z_\-]+", "_", value.strip()).strip("_").lower()
    return slug or "database_skill"
