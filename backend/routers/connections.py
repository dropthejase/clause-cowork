"""Clause-level connection router — create and soft-delete connections between clauses.

POST   /connections  — record a new agent- or user-created connection.
DELETE /connections  — mark a connection as user_rejected (soft delete, never hard-deleted).
"""
from __future__ import annotations
import logging
import aiosqlite
from fastapi import APIRouter
from pydantic import BaseModel, model_validator
from typing import Optional
from models.clause import Connection, EdgeType
from routers.parse import get_db
import uuid

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/connections", tags=["connections"])


class AddConnectionRequest(BaseModel):
    source_id: str
    source_doc_id: str
    target_id: str
    target_doc_id: str
    edge_type: EdgeType
    note: Optional[str] = None
    doc_path: str

    @model_validator(mode="after")
    def note_required_for_other(self) -> "AddConnectionRequest":
        if self.edge_type == "other" and not self.note:
            raise ValueError("note is required when edge_type is 'other'")
        return self


class DeleteConnectionRequest(BaseModel):
    source_id: str
    source_doc_id: str
    connection_id: str
    doc_path: str


@router.post("")
async def add_connection(req: AddConnectionRequest):
    db = get_db(req.doc_path)
    await db.init()
    conn = Connection(
        id=str(uuid.uuid4()),
        target_id=req.target_id,
        target_doc_id=req.target_doc_id,
        edge_type=req.edge_type,
        note=req.note,
        user_created=True,
    )
    logger.info("add connection %s→%s edge=%r source_doc=%s", req.source_id, req.target_id, req.edge_type, req.source_doc_id)
    await db.upsert_connection(req.source_id, req.source_doc_id, conn)
    return {"connection_id": conn.id}


@router.delete("")
async def reject_connection(req: DeleteConnectionRequest):
    db = get_db(req.doc_path)
    await db.init()
    logger.info("reject connection %s source=%s source_doc=%s", req.connection_id, req.source_id, req.source_doc_id)
    async with aiosqlite.connect(db.db_path) as conn:
        await conn.execute(
            "UPDATE connections SET user_rejected=1 WHERE id=? AND source_id=? AND source_doc_id=?",
            (req.connection_id, req.source_id, req.source_doc_id)
        )
        await conn.commit()
    # Returns True even if not found — silent no-op by design
    return {"rejected": True}
