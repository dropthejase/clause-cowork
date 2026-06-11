"""Tag pool router — CRUD for the workspace vocabulary (clause types, clause tags, doc types, doc tags).

GET    /tags          — list pool entries, optionally filtered by kind.
POST   /tags          — add a new entry (or update description if it already exists).
PATCH  /tags/{name}   — update description of an existing entry.
DELETE /tags/{name}   — remove an entry from the pool.
POST   /tags/restore-defaults — re-insert any missing default clause types or doc types.
"""
from __future__ import annotations
import logging
import os
from typing import Literal
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from services.tag_pool import TagPool, PoolTag, TagPoolError, normalize_tag
from services.db_path import workspace_db_path

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tags", tags=["tags"])


def get_tag_pool(doc_path: str) -> TagPool:
    workspace_root = doc_path if os.path.isdir(doc_path) else os.path.dirname(doc_path)
    return TagPool(workspace_db_path(workspace_root))


class AddTagRequest(BaseModel):
    tag: str
    description: str
    source: Literal["import", "agent", "manual"] = "manual"
    kind: Literal["clause_type", "clause_tag", "doc_type", "doc_tag"] = "clause_tag"


class PatchTagRequest(BaseModel):
    tag: str
    description: str


class ImportRequest(BaseModel):
    csv_content: str
    kind: Literal["clause_type", "clause_tag", "doc_type", "doc_tag"] = "clause_tag"


# Import/export routes must be registered before the catch-all path routes
# to prevent {doc_path:path} from consuming "import"/"export" as part of the path.

@router.post("/{doc_path:path}/import")
async def import_tags(doc_path: str, req: ImportRequest):
    pool = get_tag_pool(doc_path)
    try:
        result = pool.import_csv(req.csv_content, source="import", kind=req.kind)
    except TagPoolError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result


@router.get("/{doc_path:path}/export")
async def export_tags(doc_path: str, kind: Literal["clause_type", "clause_tag", "doc_type", "doc_tag"] = Query("clause_tag")):
    pool = get_tag_pool(doc_path)
    from datetime import datetime
    csv = pool.export_csv(kind=kind)
    workspace_root = doc_path if os.path.isdir(doc_path) else os.path.dirname(doc_path)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    suffix = f"doc-tags-{stamp}" if kind == "doc" else f"clause-tags-{stamp}"
    out_path = os.path.join(workspace_root, ".clause-cowork", f"{suffix}.csv")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(csv)
    return {"path": out_path}


@router.patch("/{doc_path:path}")
async def update_tag(doc_path: str, req: PatchTagRequest):
    tag = normalize_tag(req.tag)
    if not tag:
        raise HTTPException(status_code=400, detail="Tag name cannot be empty.")
    pool = get_tag_pool(doc_path)
    try:
        pool.update(tag, req.description)
    except TagPoolError as e:
        raise HTTPException(status_code=404, detail=str(e))
    logger.info("tags: update tag=%r doc_path=%s", tag, doc_path)
    return {"ok": True}


class DeleteTagRequest(BaseModel):
    tag: str


@router.delete("/{doc_path:path}")
async def delete_tag(doc_path: str, req: DeleteTagRequest):
    tag = normalize_tag(req.tag)
    if not tag:
        raise HTTPException(status_code=400, detail="Tag name cannot be empty.")
    pool = get_tag_pool(doc_path)
    try:
        pool.delete(tag)
    except TagPoolError as e:
        raise HTTPException(status_code=404, detail=str(e))
    logger.info("tags: delete tag=%r doc_path=%s", tag, doc_path)
    return {"ok": True}


@router.get("/{doc_path:path}")
async def list_tags(doc_path: str, kind: Literal["clause_type", "clause_tag", "doc_type", "doc_tag"] = Query("clause_tag")) -> list[PoolTag]:
    return get_tag_pool(doc_path).list(kind=kind)


# NOTE: must be registered before POST /{doc_path:path} to avoid the catch-all consuming "restore-defaults"
@router.post("/{doc_path:path}/restore-defaults", status_code=200)
async def restore_defaults(doc_path: str, kind: Literal["clause_type", "clause_tag", "doc_type", "doc_tag"] = Query("doc_type")):
    """Re-insert any missing defaults for the given kind. Does not delete user-added entries."""
    workspace_root = doc_path if os.path.isdir(doc_path) else os.path.dirname(doc_path)
    db_path = workspace_db_path(workspace_root)
    if kind == "doc_type":
        from db.migrations import restore_default_doc_types as _restore
        restored = await _restore(db_path)
    elif kind == "clause_type":
        from db.migrations import restore_default_clause_types as _restore
        restored = await _restore(db_path)
    else:
        restored = 0
    return {"ok": True, "restored": restored}


@router.post("/{doc_path:path}", status_code=201)
async def add_tag(doc_path: str, req: AddTagRequest) -> PoolTag:
    tag_val = normalize_tag(req.tag)
    if not tag_val:
        raise HTTPException(status_code=400, detail="Tag name cannot be empty.")
    pool = get_tag_pool(doc_path)
    tag = PoolTag(tag=tag_val, description=req.description, source=req.source, kind=req.kind)
    try:
        pool.add(tag)
    except TagPoolError as e:
        status = 409 if "already exists" in str(e) else 400
        raise HTTPException(status_code=status, detail=str(e))
    logger.info("tags: add tag=%r kind=%s source=%s doc_path=%s", tag_val, req.kind, req.source, doc_path)
    return tag
