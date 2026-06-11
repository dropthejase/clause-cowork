from __future__ import annotations
import aiosqlite
import json
import os
from fastapi import APIRouter, Query, Request
from models.config import WorkspaceConfig
from services.db_path import workspace_db_path
from db.migrations import apply_schema

router = APIRouter(prefix="/config", tags=["config"])


async def _read_config(db_path: str) -> WorkspaceConfig | None:
    try:
        async with aiosqlite.connect(db_path) as db:
            cursor = await db.execute("SELECT value FROM config WHERE key='workspace'")
            row = await cursor.fetchone()
        if not row:
            return None
        return WorkspaceConfig(**json.loads(row[0]))
    except Exception:
        return None


async def _write_config(db_path: str, config: WorkspaceConfig, raw: dict | None = None) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
    # Migrate clause_types from legacy config JSON into tag pool (one-time transition)
    if raw and "clause_types" in raw:
        from services.tag_pool import TagPool, PoolTag, TagPoolError
        from datetime import datetime, timezone
        pool = TagPool(db_path)
        now = datetime.now(timezone.utc).isoformat()
        for ct in raw["clause_types"]:
            try:
                pool.add(PoolTag(tag=ct["name"], description=ct.get("description", ""), source="manual", created_at=now, kind="clause_type"))
            except TagPoolError:
                pass  # already exists — skip
    async with aiosqlite.connect(db_path) as db:
        await db.execute("CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)")
        await db.execute(
            "INSERT OR REPLACE INTO config (key, value) VALUES ('workspace', ?)",
            (config.model_dump_json(),)
        )
        await db.commit()


@router.get("")
async def get_workspace_config(workspace_path: str = Query(...)) -> WorkspaceConfig:
    db_path = workspace_db_path(workspace_path)
    await apply_schema(db_path)
    return await _read_config(db_path) or WorkspaceConfig()


@router.put("")
async def save_workspace_config(request: Request, workspace_path: str = Query(...)) -> WorkspaceConfig:
    raw = await request.json()
    config = WorkspaceConfig(**{k: v for k, v in raw.items() if k != "clause_types"})
    db_path = workspace_db_path(workspace_path)
    await apply_schema(db_path)
    await _write_config(db_path, config, raw=raw)
    return config


@router.delete("/data")
async def delete_workspace_data(workspace_path: str = Query(...)) -> dict:
    db_path = workspace_db_path(workspace_path)
    if not os.path.exists(db_path):
        return {"deleted": False, "reason": "no data found"}
    os.remove(db_path)
    await apply_schema(db_path)
    return {"deleted": True}


@router.delete("/settings")
async def reset_workspace_settings(workspace_path: str = Query(...)) -> WorkspaceConfig:
    db_path = workspace_db_path(workspace_path)
    await apply_schema(db_path)
    defaults = WorkspaceConfig()
    await _write_config(db_path, defaults)
    return defaults
