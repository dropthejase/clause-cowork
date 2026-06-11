"""Parse router — extracts blocks from a document and reconciles them with the DB.

POST /parse  — accepts a doc_path (or inline base64 content for the add-in) and returns the
               full clause graph. Triggers background extraction for .docx files whose content
               hash has changed since last extraction. Reconciliation handles stable_id matching,
               fuzzy migration, and needs_reclassification flagging.
"""
from __future__ import annotations
import base64
import json
import logging
import os
import tempfile
import aiosqlite
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from services.extractor import extract_blocks
from services.db import DBService, get_or_register_doc_id
from models.clause import GraphResponse
from models.config import WorkspaceConfig
from services.clause_reconciler import reconcile_blocks
from services.db_path import workspace_db_path

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/parse", tags=["parse"])

_db_instances: dict[str, DBService] = {}


def get_db(doc_path: str) -> DBService:
    db_path = workspace_db_path(os.path.dirname(doc_path))
    if db_path not in _db_instances:
        _db_instances[db_path] = DBService(db_path)
    return _db_instances[db_path]




class ParseRequest(BaseModel):
    doc_path: str
    file_content: Optional[str] = None  # base64-encoded docx bytes from getFileAsync


@router.post("", response_model=GraphResponse)
async def parse_document(req: ParseRequest):
    """Extract, hash, and store clauses. Returns base graph immediately.

    file_content: optional base64 docx bytes from Office.js getFileAsync.
    When provided, written to a temp file so the backend never needs the saved file.
    Falls back to doc_path when not provided.
    """
    tmp_path: Optional[str] = None
    try:
        if req.file_content:
            docx_bytes = base64.b64decode(req.file_content)
            suffix = os.path.splitext(req.doc_path)[1] or ".docx"
            fd, tmp_path = tempfile.mkstemp(suffix=suffix)
            with os.fdopen(fd, "wb") as f:
                f.write(docx_bytes)
            parse_path = tmp_path
        else:
            if not os.path.exists(req.doc_path):
                raise HTTPException(status_code=404, detail="Document not found")
            parse_path = req.doc_path

        db = get_db(req.doc_path)
        await db.init()
        doc_id = await get_or_register_doc_id(req.doc_path, db.db_path)

        async with aiosqlite.connect(db.db_path) as conn:
            cursor = await conn.execute("SELECT value FROM config WHERE key='workspace'")
            row = await cursor.fetchone()
            # mtime skip: if file unchanged since last extraction, return current clauses immediately
            if not req.file_content:
                doc_cursor = await conn.execute(
                    "SELECT last_extracted_at FROM documents WHERE id=?", (doc_id,)
                )
                doc_row = await doc_cursor.fetchone()
                if doc_row and doc_row[0] is not None:
                    try:
                        current_mtime = os.path.getmtime(os.path.abspath(req.doc_path))
                        if current_mtime <= doc_row[0]:
                            logger.info("parse: mtime unchanged, skipping extraction for %s", req.doc_path)
                            clauses = await db.get_clauses_for_doc(doc_id)
                            return GraphResponse(doc_id=doc_id, clauses=clauses, new_paragraph_count=0, tombstoned_count=0)
                    except OSError:
                        pass
        if row:
            config = WorkspaceConfig(**json.loads(row[0]))
        else:
            config = WorkspaceConfig()

        blocks = await extract_blocks(parse_path)

        all_clauses = await db.get_all_clauses_for_doc(doc_id)
        clauses_to_upsert, new_count = await reconcile_blocks(
            blocks, all_clauses, doc_id, threshold=config.re_enrich_threshold
        )
        seen_ids = {c.stable_id for c in clauses_to_upsert}
        for clause in clauses_to_upsert:
            await db.upsert_clause(clause)

        tombstoned = await db.tombstone_missing_clauses(doc_id, seen_ids)
        try:
            mtime = os.path.getmtime(os.path.abspath(req.doc_path))
        except OSError:
            mtime = 0.0
        await db.update_extracted_at(doc_id, mtime)
        clauses = await db.get_clauses_for_doc(doc_id)

        return GraphResponse(
            doc_id=doc_id,
            clauses=clauses,
            new_paragraph_count=new_count,
            tombstoned_count=tombstoned,
        )
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
