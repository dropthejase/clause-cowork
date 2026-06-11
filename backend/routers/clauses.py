"""Clause CRUD router — get, patch, bulk-action, and hide individual clauses.

PATCH /{clause_id}   — update clause_type and/or user tags for a single clause.
POST  /bulk          — apply reclassify/set_type/clear_type/add_tag/remove_tag/clear_tags to many.
POST  /{clause_id}/hide — tombstone a clause so it no longer appears in the graph.
"""
from __future__ import annotations
import logging
import os
from fastapi import APIRouter, HTTPException, Query
from typing import Literal, Optional
from pydantic import BaseModel
from models.clause import ClausePatch, Tag
from services.db import get_or_register_doc_id
from services.db import DBService
from services.db_path import workspace_db_path

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/clauses", tags=["clauses"])


def _resolve_workspace(workspace_path: Optional[str], doc_path: str) -> str:
    """Use explicit workspace_path if provided, else fall back to doc's parent directory."""
    return workspace_path if workspace_path else os.path.dirname(os.path.abspath(doc_path))


async def get_db_for_clause(workspace_path: str) -> DBService:
    db = DBService(workspace_db_path(workspace_path))
    await db.init()
    return db


@router.get("")
async def get_clauses(doc_path: str = Query(...), workspace_path: Optional[str] = Query(None)):
    """Return cached clauses from DB without re-parsing the document."""
    db = await get_db_for_clause(_resolve_workspace(workspace_path, doc_path))
    doc_id = await get_or_register_doc_id(doc_path, db.db_path)
    clauses = await db.get_clauses_for_doc(doc_id)
    return {"doc_id": doc_id, "clauses": clauses}


class ClausePatchRequest(ClausePatch):
    doc_path: str
    workspace_path: Optional[str] = None


class HideClauseRequest(BaseModel):
    doc_path: str
    workspace_path: Optional[str] = None


@router.patch("/{clause_id}")
async def patch_clause(clause_id: str, req: ClausePatchRequest):
    db = await get_db_for_clause(_resolve_workspace(req.workspace_path, req.doc_path))
    doc_id = await get_or_register_doc_id(req.doc_path, db.db_path)
    clause = await db.get_clause(clause_id, doc_id)
    if not clause:
        raise HTTPException(status_code=404, detail="Clause not found")

    if req.clause_type is not None:
        logger.info("patch clause %s type=%r doc=%s", clause_id, req.clause_type, doc_id)
        clause.clause_type = req.clause_type
        await db.upsert_clause(clause)

    for tag in req.add_tags:
        logger.info("add user tag %r to clause %s doc=%s", tag.value, clause_id, doc_id)
        await db.add_user_tag(clause_id, doc_id, Tag(value=tag.value, user_defined=True))

    for tag_value in req.remove_tags:
        logger.info("remove tag %r from clause %s doc=%s", tag_value, clause_id, doc_id)
        await db.remove_tag(clause_id, doc_id, tag_value)

    return await db.get_clause(clause_id, doc_id)


class BulkActionRequest(BaseModel):
    doc_path: str
    workspace_path: Optional[str] = None
    clause_ids: list[str]
    action: Literal["reclassify", "set_type", "clear_type", "add_tag", "remove_tag", "clear_tags"]
    clause_type: Optional[str] = None   # set_type
    tag: Optional[str] = None           # add_tag / remove_tag


@router.post("/bulk")
async def bulk_action(req: BulkActionRequest):
    db = await get_db_for_clause(_resolve_workspace(req.workspace_path, req.doc_path))
    doc_id = await get_or_register_doc_id(req.doc_path, db.db_path)
    logger.info("bulk action=%r on %d clauses doc=%s", req.action, len(req.clause_ids), doc_id)
    updated = 0
    for clause_id in req.clause_ids:
        clause = await db.get_clause(clause_id, doc_id)
        if not clause:
            continue
        if req.action == "reclassify":
            clause.needs_reclassification = True
            await db.upsert_clause(clause)
        elif req.action == "set_type" and req.clause_type is not None:
            clause.clause_type = req.clause_type
            clause.needs_reclassification = False
            await db.upsert_clause(clause)
        elif req.action == "clear_type":
            clause.clause_type = None
            clause.needs_reclassification = False
            await db.upsert_clause(clause, force_type=True)
        elif req.action == "add_tag" and req.tag is not None:
            await db.add_user_tag(clause_id, doc_id, Tag(value=req.tag, user_defined=True))
        elif req.action == "remove_tag" and req.tag is not None:
            await db.remove_tag(clause_id, doc_id, req.tag)
        elif req.action == "clear_tags":
            await db.clear_all_tags(clause_id, doc_id)
        updated += 1
    return {"updated": updated}


@router.post("/{clause_id}/hide")
async def hide_clause(clause_id: str, req: HideClauseRequest):
    db = await get_db_for_clause(_resolve_workspace(req.workspace_path, req.doc_path))
    doc_id = await get_or_register_doc_id(req.doc_path, db.db_path)
    clause = await db.get_clause(clause_id, doc_id)
    if not clause:
        raise HTTPException(status_code=404, detail="Clause not found")
    logger.info("hiding clause %s doc=%s", clause_id, doc_id)
    clause.tombstoned = True
    await db.upsert_clause(clause)
    return {"hidden": True}
