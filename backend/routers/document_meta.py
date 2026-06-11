"""Document metadata router — doc_type, doc_tags, notes, and document-level links.

GET/PATCH /document-meta          — read or update a document's type, tags, and notes.
GET/POST  /document-meta/links    — list or create document-level links (cross-doc relationships).
GET       /document-meta/links/all — all links in the workspace (for workspace graph view).
DELETE    /document-meta/links/{id} — remove a document link.
"""
from __future__ import annotations
import json
import logging
import os
import uuid
from datetime import datetime, timezone

import aiosqlite
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from services.db_path import workspace_db_path
from services.tag_pool import normalize_tag

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/document-meta", tags=["document-meta"])

# Default document tag vocabulary surfaced in the Info tab picker.
DEFAULT_DOC_TAGS = [
    "Employment",
    "Data Processing",
    "NDA / Confidentiality",
    "Services Agreement",
    "IP / Licensing",
    "Finance / Loan",
    "Real Estate",
    "M&A",
    "Shareholder / Corporate",
    "Regulatory / Compliance",
]


@router.get("")
async def get_document_meta(
    workspace_path: str = Query(...),
    doc_id: str = Query(...),
    doc_path: str = Query(None),
):
    """Return metadata for a single document: tags, notes, file stats.

    If the document is not yet registered in the DB, returns a minimal response
    built from doc_path (filesystem stats only, empty tags/notes).
    """
    db = workspace_db_path(workspace_path)
    row = None

    clause_tags: list[str] = []

    if os.path.exists(db):
        async with aiosqlite.connect(db) as conn:
            conn.row_factory = aiosqlite.Row
            row = await (await conn.execute(
                "SELECT path, last_analysed_at, doc_type, doc_tags, notes FROM documents WHERE id=?", (doc_id,)
            )).fetchone()
            tag_rows = await (await conn.execute(
                """SELECT DISTINCT t.value FROM tags t
                   WHERE t.doc_id = ?
                   ORDER BY t.value""",
                (doc_id,)
            )).fetchall()
            clause_tags = [r["value"] for r in tag_rows]

    path = row["path"] if row else doc_path
    file_size: int | None = None
    file_mtime: float | None = None
    if path and os.path.exists(path):
        stat = os.stat(path)
        file_size = stat.st_size
        file_mtime = stat.st_mtime

    doc_type: str | None = row["doc_type"] if row else None
    doc_tags = json.loads(row["doc_tags"] or "[]") if row else []

    return {
        "doc_id": doc_id,
        "path": path or "",
        "filename": os.path.basename(path) if path else "",
        "extension": os.path.splitext(path)[1].lstrip(".").lower() if path else "",
        "file_size": file_size,
        "file_mtime": file_mtime,
        "last_analysed_at": row["last_analysed_at"] if row else None,
        "doc_type": doc_type,
        "doc_tags": doc_tags,
        "notes": row["notes"] or "" if row else "",
        "default_tag_vocabulary": DEFAULT_DOC_TAGS,
        "clause_tags": clause_tags,
    }


class DocumentMetaPatch(BaseModel):
    doc_type: str | None = None
    doc_tags: list[str] | None = None
    notes: str | None = None


@router.patch("")
async def patch_document_meta(
    workspace_path: str = Query(...),
    doc_id: str = Query(...),
    body: DocumentMetaPatch = ...,
):
    """Update doc_type, doc_tags, and/or notes for a document."""
    db = workspace_db_path(workspace_path)
    if not os.path.exists(db):
        raise HTTPException(status_code=404, detail="Workspace not initialised")

    async with aiosqlite.connect(db) as conn:
        exists = await (await conn.execute(
            "SELECT 1 FROM documents WHERE id=?", (doc_id,)
        )).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Document not found")

        if body.doc_type is not None:
            safe_type = normalize_tag(body.doc_type) or None
            logger.info("patch doc_type=%r doc=%s", safe_type, doc_id)
            await conn.execute(
                "UPDATE documents SET doc_type=? WHERE id=?",
                (safe_type, doc_id)
            )
        if body.doc_tags is not None:
            safe_tags = [t for t in (normalize_tag(v) for v in body.doc_tags) if t]
            logger.info("patch doc_tags=%r doc=%s", safe_tags, doc_id)
            await conn.execute(
                "UPDATE documents SET doc_tags=? WHERE id=?",
                (json.dumps(safe_tags), doc_id)
            )
        if body.notes is not None:
            logger.info("patch notes doc=%s (%d chars)", doc_id, len(body.notes))
            await conn.execute(
                "UPDATE documents SET notes=? WHERE id=?",
                (body.notes, doc_id)
            )
        await conn.commit()

    return {"ok": True}


@router.get("/links")
async def get_document_links(workspace_path: str = Query(...), doc_id: str = Query(...)):
    """Return all document links where this doc is source or target."""
    db = workspace_db_path(workspace_path)
    if not os.path.exists(db):
        return {"links": []}

    async with aiosqlite.connect(db) as conn:
        conn.row_factory = aiosqlite.Row
        rows = await (await conn.execute(
            """SELECT dl.id, dl.source_doc_id, dl.target_doc_id, dl.relationship,
                      dl.note, dl.created_by, dl.created_at, dl.broken_at,
                      d_src.path as source_path, d_tgt.path as target_path
               FROM document_links dl
               JOIN documents d_src ON dl.source_doc_id = d_src.id
               JOIN documents d_tgt ON dl.target_doc_id = d_tgt.id
               WHERE dl.source_doc_id=? OR dl.target_doc_id=?""",
            (doc_id, doc_id)
        )).fetchall()

    links = []
    for r in rows:
        other_doc_id = r["target_doc_id"] if r["source_doc_id"] == doc_id else r["source_doc_id"]
        other_path = r["target_path"] if r["source_doc_id"] == doc_id else r["source_path"]
        links.append({
            "id": r["id"],
            "source_doc_id": r["source_doc_id"],
            "target_doc_id": r["target_doc_id"],
            "other_doc_id": other_doc_id,
            "other_filename": os.path.basename(other_path) if other_path else "",
            "relationship": r["relationship"],
            "note": r["note"],
            "created_by": r["created_by"],
            "created_at": r["created_at"],
            "broken_at": r["broken_at"],
            "direction": "outbound" if r["source_doc_id"] == doc_id else "inbound",
        })

    return {"links": links}


class DocumentLinkCreate(BaseModel):
    source_doc_id: str
    target_doc_id: str
    target_file_path: str | None = None  # provided when target is not yet in documents table
    relationship: str = "references"
    note: str | None = None
    created_by: str = "user"


@router.post("/links")
async def create_document_link(workspace_path: str = Query(...), body: DocumentLinkCreate = ...):
    """Create a document-level link between two documents.

    If target_doc_id is not yet registered in the documents table and target_file_path
    is provided, a stub row is inserted so the link foreign key is satisfied.
    """
    db = workspace_db_path(workspace_path)
    if not os.path.exists(db):
        raise HTTPException(status_code=404, detail="Workspace not initialised")

    link_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    async with aiosqlite.connect(db) as conn:
        # Ensure source exists
        if not await (await conn.execute(
            "SELECT 1 FROM documents WHERE id=?", (body.source_doc_id,)
        )).fetchone():
            raise HTTPException(status_code=404, detail=f"Document {body.source_doc_id} not found")

        # Ensure target exists — register stub if path provided
        if not await (await conn.execute(
            "SELECT 1 FROM documents WHERE id=?", (body.target_doc_id,)
        )).fetchone():
            if body.target_file_path:
                await conn.execute(
                    "INSERT INTO documents (id, path) VALUES (?,?)",
                    (body.target_doc_id, body.target_file_path),
                )
            else:
                raise HTTPException(status_code=404, detail=f"Document {body.target_doc_id} not found")

        logger.info("create document link %s→%s relationship=%r", body.source_doc_id, body.target_doc_id, body.relationship)
        await conn.execute(
            """INSERT INTO document_links
               (id, source_doc_id, target_doc_id, relationship, note, created_by, created_at)
               VALUES (?,?,?,?,?,?,?)""",
            (link_id, body.source_doc_id, body.target_doc_id,
             body.relationship, body.note, body.created_by, now)
        )
        await conn.commit()

    return {"id": link_id}


@router.get("/links/all")
async def get_all_document_links(workspace_path: str = Query(...)):
    """Return all document links in the workspace (for workspace graph view)."""
    db = workspace_db_path(workspace_path)
    if not os.path.exists(db):
        return {"links": []}

    async with aiosqlite.connect(db) as conn:
        conn.row_factory = aiosqlite.Row
        rows = await (await conn.execute(
            """SELECT dl.id, dl.source_doc_id, dl.target_doc_id,
                      dl.relationship, dl.note, dl.broken_at,
                      d_src.path as source_path, d_tgt.path as target_path
               FROM document_links dl
               JOIN documents d_src ON dl.source_doc_id = d_src.id
               JOIN documents d_tgt ON dl.target_doc_id = d_tgt.id""",
        )).fetchall()

    return {"links": [
        {
            "id": r["id"],
            "source_doc_id": r["source_doc_id"],
            "target_doc_id": r["target_doc_id"],
            "source_filename": os.path.basename(r["source_path"]) if r["source_path"] else "",
            "target_filename": os.path.basename(r["target_path"]) if r["target_path"] else "",
            "relationship": r["relationship"],
            "note": r["note"],
            "broken_at": r["broken_at"],
        }
        for r in rows
    ]}


@router.delete("/links/{link_id}")
async def delete_document_link(link_id: str, workspace_path: str = Query(...)):
    """Remove a document link."""
    db = workspace_db_path(workspace_path)
    if not os.path.exists(db):
        raise HTTPException(status_code=404, detail="Workspace not initialised")

    async with aiosqlite.connect(db) as conn:
        result = await conn.execute(
            "DELETE FROM document_links WHERE id=?", (link_id,)
        )
        await conn.commit()
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Link not found")

    logger.info("deleted document link %s", link_id)
    return {"ok": True}
