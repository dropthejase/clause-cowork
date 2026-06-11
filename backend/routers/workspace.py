from __future__ import annotations
import asyncio
import fnmatch
import hashlib
import logging
import os
import uuid
from datetime import datetime, timezone
import aiosqlite
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from services.extractor import EXTRACTABLE_EXTENSIONS
from services.db_path import workspace_db_path


def _is_extractable(path: str) -> bool:
    return os.path.splitext(path)[1].lower() in EXTRACTABLE_EXTENSIONS

logger = logging.getLogger(__name__)

# Tracks in-flight background extraction tasks so they can be cancelled on shutdown
_background_tasks: set[asyncio.Task] = set()

_IGNORE_FILENAME = ".clausecoworkignore"
_IGNORE_SEED = """\
# .clausecoworkignore — works like .gitignore for the Clause CoWork explorer.
# Glob patterns supported (e.g. *.tmp, draft-*, archive/).
# Note: hidden folders/files (starting with .) are always excluded automatically.

# Agent context files
CLAUDE.md
AGENTS.md
GEMINI.md
KIRO.md

# Common noise
*.tmp
*.log
Thumbs.db
"""


def _load_ignore(workspace_path: str) -> list[str]:
    """Return list of ignore patterns from .clausecoworkignore, seeding the file if absent."""
    ignore_path = os.path.join(workspace_path, _IGNORE_FILENAME)
    if not os.path.exists(ignore_path):
        try:
            with open(ignore_path, "w") as f:
                f.write(_IGNORE_SEED)
        except OSError:
            pass
        return ["CLAUDE.md", "AGENTS.md", "GEMINI.md", "KIRO.md", "*.tmp", "*.log", "Thumbs.db"]
    patterns: list[str] = []
    with open(ignore_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                patterns.append(line)
    return patterns


def _is_ignored(name: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(name, p) for p in patterns)

router = APIRouter(prefix="/workspace", tags=["workspace"])


@router.get("/resolve")
async def resolve_folder(name: str = Query(...)):
    """Given a folder name from webkitdirectory, find its absolute path by searching the home directory."""
    import pathlib
    home = pathlib.Path.home()
    for candidate in home.rglob(name):
        if candidate.is_dir() and candidate.name == name:
            return {"path": str(candidate)}
    raise HTTPException(status_code=404, detail=f"Could not find folder '{name}' anywhere under {home}.")


@router.get("")
async def get_workspace(workspace_path: str = Query(...)):
    """Return all documents in the workspace DB with parse stats."""
    db_path = workspace_db_path(workspace_path)
    if not os.path.exists(db_path):
        return {"workspace_path": workspace_path, "documents": []}

    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row

        # Backfill documents table from clauses if empty (legacy DBs)
        count_cur = await db.execute("SELECT COUNT(*) FROM documents")
        if (await count_cur.fetchone())[0] == 0:
            # Build a map of doc_id -> path by matching per-doc .db filenames to .docx files
            db_dir = os.path.dirname(db_path)
            # Map stem (e.g. "cisco-splunk-merger-agreement") -> full docx path
            docx_map: dict[str, str] = {}
            for root, _, files in os.walk(workspace_path):
                for f in files:
                    if f.endswith(".docx") and not f.startswith("~$"):
                        stem = f[:-5]  # strip .docx
                        docx_map[stem] = os.path.join(root, f)

            orphan_cur = await db.execute("SELECT DISTINCT doc_id FROM clauses")
            orphan_ids = [r[0] for r in await orphan_cur.fetchall()]
            for doc_id in orphan_ids:
                # Match per-doc db filename stem to docx file
                path = ""
                for fname in os.listdir(db_dir):
                    if fname.endswith(".db") and fname != "workspace.db":
                        stem = fname[:-3]
                        if stem in docx_map:
                            # Verify this db contains this doc_id
                            try:
                                async with aiosqlite.connect(os.path.join(db_dir, fname)) as doc_db:
                                    r = await doc_db.execute(
                                        "SELECT 1 FROM clauses WHERE doc_id=? LIMIT 1", (doc_id,)
                                    )
                                    if await r.fetchone():
                                        path = docx_map[stem]
                                        break
                            except Exception:
                                pass
                await db.execute(
                    "INSERT OR IGNORE INTO documents (id, path, last_analysed_at) VALUES (?, ?, ?)",
                    (doc_id, path, "")
                )
            await db.commit()

        doc_cursor = await db.execute("SELECT id, path, doc_type, COALESCE(doc_tags, '[]') as doc_tags FROM documents")
        doc_rows = await doc_cursor.fetchall()

        # Derive last_analysed_at from MAX(clauses.updated_at) for classified clauses
        analysed_rows = await (await db.execute(
            "SELECT doc_id, MAX(updated_at) as last_analysed_at FROM clauses WHERE clause_type IS NOT NULL AND tombstoned=0 GROUP BY doc_id"
        )).fetchall()
        analysed_by_doc: dict[str, float] = {r["doc_id"]: r["last_analysed_at"] for r in analysed_rows}

        documents = []
        for row in doc_rows:
            doc_id = row["id"]
            path = row["path"]

            clause_cur = await db.execute(
                "SELECT COUNT(*) FROM clauses WHERE doc_id=? AND tombstoned=0", (doc_id,)
            )
            clause_count = (await clause_cur.fetchone())[0]

            classified_cur = await db.execute(
                "SELECT COUNT(*) FROM clauses WHERE doc_id=? AND tombstoned=0 AND clause_type IS NOT NULL",
                (doc_id,)
            )
            classified_count = (await classified_cur.fetchone())[0]

            conn_cur = await db.execute(
                "SELECT COUNT(*) FROM connections WHERE source_doc_id=? AND user_rejected=0",
                (doc_id,)
            )
            connection_count = (await conn_cur.fetchone())[0]

            documents.append({
                "doc_id": doc_id,
                "path": path,
                "name": os.path.basename(path),
                "clause_count": clause_count,
                "classified_count": classified_count,
                "connection_count": connection_count,
                "last_analysed_at": analysed_by_doc.get(doc_id),
                "doc_type": row["doc_type"],
                "doc_tags": _parse_doc_tags(row["doc_tags"]),
            })

    return {"workspace_path": workspace_path, "documents": documents}


def _content_hash(path: str) -> str:
    """SHA-256 of full file content."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _path_hash(path: str) -> str:
    """SHA-256 of absolute path — fast lookup key."""
    return hashlib.sha256(os.path.abspath(path).encode()).hexdigest()[:16]


def _parse_doc_tags(raw: str | None) -> list:
    import json as _json
    try:
        return _json.loads(raw or "[]")
    except Exception:
        return []


async def _reconcile(workspace_path: str, db_path: str, all_files: list[tuple[str, float]]) -> dict[str, tuple[str, str | None, list]]:
    """Reconcile files on disk against the documents table.

    Detects: new files, moved files, copied files, modified files, deleted files.
    Returns {absolute_path -> (doc_id, last_analysed_at)} for all live files.
    """
    from db.migrations import apply_schema
    await apply_schema(db_path)

    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row

        rows = await (await db.execute(
            "SELECT id, path, file_mtime, content_hash, path_hash, tombstoned, last_analysed_at, last_extracted_at, doc_type, COALESCE(doc_tags, '[]') as doc_tags FROM documents"
        )).fetchall()

        by_path: dict[str, dict] = {os.path.abspath(r["path"]): dict(r) for r in rows if r["path"] and not r["tombstoned"]}
        by_tombstoned_path: dict[str, dict] = {os.path.abspath(r["path"]): dict(r) for r in rows if r["path"] and r["tombstoned"]}
        by_content: dict[str, dict] = {r["content_hash"]: dict(r) for r in rows if r["content_hash"] and not r["tombstoned"]}

        result: dict[str, tuple[str, str | None, list, str | None]] = {}  # abs_path -> (doc_id, last_analysed_at, doc_tags, doc_type)
        disk_paths: set[str] = set()

        for abs_path, mtime in all_files:
            disk_paths.add(abs_path)
            existing = by_path.get(abs_path)

            if existing:
                # Known live path — check if content changed
                _existing_tags = _parse_doc_tags(existing.get("doc_tags"))
                _existing_doc_type = existing.get("doc_type")
                never_extracted = existing["last_extracted_at"] is None
                mtime_unchanged = existing["file_mtime"] is not None and abs(existing["file_mtime"] - mtime) < 0.01 and existing["content_hash"]
                if mtime_unchanged and not never_extracted:
                    result[abs_path] = (existing["id"], existing["last_analysed_at"], _existing_tags, _existing_doc_type)
                    continue
                if mtime_unchanged and never_extracted and _is_extractable(abs_path) and not os.getenv("TESTING"):
                    # File unchanged but never extracted (e.g. backend restarted before task completed)
                    task = asyncio.create_task(_extract_and_update_clauses(abs_path, existing["id"], db_path, mtime))
                    _background_tasks.add(task)
                    task.add_done_callback(_background_tasks.discard)
                    result[abs_path] = (existing["id"], existing["last_analysed_at"], _existing_tags, _existing_doc_type)
                    continue
                try:
                    chash = _content_hash(abs_path)
                except OSError:
                    result[abs_path] = (existing["id"], existing["last_analysed_at"], _existing_tags, _existing_doc_type)
                    continue
                if chash != existing["content_hash"]:
                    await db.execute(
                        "UPDATE documents SET content_hash=?, file_mtime=? WHERE id=?",
                        (chash, mtime, existing["id"])
                    )
                else:
                    await db.execute(
                        "UPDATE documents SET file_mtime=? WHERE id=?",
                        (mtime, existing["id"])
                    )
                by_content[chash] = {**existing, "content_hash": chash}
                result[abs_path] = (existing["id"], existing["last_analysed_at"], _existing_tags, _existing_doc_type)
                # Fire background extraction when content changed
                if _is_extractable(abs_path) and not os.getenv("TESTING"):
                    task = asyncio.create_task(_extract_and_update_clauses(abs_path, existing["id"], db_path, mtime))
                    _background_tasks.add(task)
                    task.add_done_callback(_background_tasks.discard)

            else:
                # Path not live — compute content hash to detect move, restore, copy, or new
                try:
                    chash = _content_hash(abs_path)
                except OSError:
                    continue
                phash = _path_hash(abs_path)

                tombstoned = by_tombstoned_path.get(abs_path)
                if tombstoned:
                    # File reappeared at same path — un-tombstone, clear broken links
                    await db.execute(
                        "UPDATE documents SET tombstoned=0, path_hash=?, file_mtime=?, content_hash=? WHERE id=?",
                        (phash, mtime, chash, tombstoned["id"])
                    )
                    await db.execute(
                        "UPDATE document_links SET broken_at=NULL WHERE source_doc_id=? OR target_doc_id=?",
                        (tombstoned["id"], tombstoned["id"])
                    )
                    by_path[abs_path] = {**tombstoned, "tombstoned": 0, "content_hash": chash}
                    by_content[chash] = by_path[abs_path]
                    result[abs_path] = (tombstoned["id"], None, _parse_doc_tags(tombstoned.get("doc_tags")), tombstoned.get("doc_type"))
                    continue

                move_match = by_content.get(chash)
                if move_match and not os.path.exists(move_match["path"]):
                    # Original path gone — it's a move, update path
                    await db.execute(
                        "UPDATE documents SET path=?, path_hash=?, file_mtime=?, tombstoned=0 WHERE id=?",
                        (abs_path, phash, mtime, move_match["id"])
                    )
                    by_path[abs_path] = {**move_match, "path": abs_path, "path_hash": phash}
                    del by_path[os.path.abspath(move_match["path"])]
                    result[abs_path] = (move_match["id"], None, _parse_doc_tags(move_match.get("doc_tags")), move_match.get("doc_type"))
                else:
                    # New file or copy — find source doc with classified nodes (same content hash)
                    src_row = await (await db.execute(
                        """SELECT d.id, d.doc_type, d.doc_tags FROM documents d
                           WHERE d.content_hash=? AND d.tombstoned=0 AND d.path!=?
                           AND EXISTS (SELECT 1 FROM clauses c WHERE c.doc_id=d.id AND c.clause_type IS NOT NULL AND c.tombstoned=0)
                           LIMIT 1""",
                        (chash, abs_path)
                    )).fetchone()
                    doc_id = str(uuid.uuid4())[:16]
                    await db.execute(
                        "INSERT OR IGNORE INTO documents (id, path, path_hash, content_hash, file_mtime, tombstoned) VALUES (?,?,?,?,?,0)",
                        (doc_id, abs_path, phash, chash, mtime)
                    )
                    if src_row:
                        await _clone_clauses(db, src_row["id"], doc_id)
                    elif _is_extractable(abs_path) and not os.getenv("TESTING"):
                        # New file (not a copy) — fire extraction so tiles appear without explicit parse
                        await db.commit()
                        task = asyncio.create_task(_extract_and_update_clauses(abs_path, doc_id, db_path, mtime))
                        _background_tasks.add(task)
                        task.add_done_callback(_background_tasks.discard)
                    result[abs_path] = (doc_id, None, _parse_doc_tags(src_row["doc_tags"] if src_row else None), src_row["doc_type"] if src_row else None)

        # Tombstone documents whose paths are no longer on disk
        now = datetime.now(timezone.utc).isoformat()
        for abs_path, row in by_path.items():
            if abs_path not in disk_paths and not row["tombstoned"]:
                await db.execute(
                    "UPDATE documents SET tombstoned=1 WHERE id=?", (row["id"],)
                )
                await db.execute(
                    "UPDATE clauses SET tombstoned=1 WHERE doc_id=?", (row["id"],)
                )
                # Only mark links broken for real documents (content_hash IS NOT NULL),
                # not stubs registered by upsert_document_link.py
                if row.get("content_hash"):
                    await db.execute(
                        "UPDATE document_links SET broken_at=? WHERE (source_doc_id=? OR target_doc_id=?) AND broken_at IS NULL",
                        (now, row["id"], row["id"])
                    )

        await db.commit()

        # Derive last_analysed_at from MAX(clauses.updated_at) for classified clauses
        analysed_rows = await (await db.execute(
            "SELECT doc_id, MAX(updated_at) as last_analysed_at FROM clauses WHERE clause_type IS NOT NULL AND tombstoned=0 GROUP BY doc_id"
        )).fetchall()
        analysed_by_doc: dict[str, float] = {r["doc_id"]: r["last_analysed_at"] for r in analysed_rows}

        # Merge derived last_analysed_at into result
        result = {
            path: (doc_id, analysed_by_doc.get(doc_id), tags, doc_type)
            for path, (doc_id, _, tags, doc_type) in result.items()
        }

    return result


async def _extract_and_update_clauses(doc_path: str, doc_id: str, db_path: str, mtime: float) -> None:
    """Background task: extract blocks from a supported file, update clause text and needs_reclassification flag."""
    try:
        from services.extractor import extract_blocks
        from services.db import DBService
        import json as _json

        if not _is_extractable(doc_path) or not os.path.exists(doc_path):
            return

        db = DBService(db_path)
        await db.init()

        async with aiosqlite.connect(db_path) as conn:
            conn.row_factory = aiosqlite.Row
            config_row = await (await conn.execute("SELECT value FROM config WHERE key='workspace'")).fetchone()

        threshold = 0.85
        if config_row:
            try:
                from models.config import WorkspaceConfig
                cfg = WorkspaceConfig(**_json.loads(config_row["value"]))
                threshold = cfg.re_enrich_threshold
            except Exception:
                pass

        blocks = await extract_blocks(doc_path)
        all_clauses = await db.get_all_clauses_for_doc(doc_id)
        from services.clause_reconciler import reconcile_blocks
        clauses_to_upsert, new_count = await reconcile_blocks(blocks, all_clauses, doc_id, threshold)
        seen_ids = {c.stable_id for c in clauses_to_upsert}
        for clause in clauses_to_upsert:
            await db.upsert_clause(clause)

        await db.tombstone_missing_clauses(doc_id, seen_ids)
        await db.update_extracted_at(doc_id, mtime)
        logger.info("workspace: background extraction complete for %s (%d new)", doc_path, new_count)
    except Exception:
        logger.exception("workspace: background extraction failed for %s", doc_path)


async def _clone_clauses(db: aiosqlite.Connection, src_doc_id: str, dst_doc_id: str) -> None:
    """Clone all non-tombstoned clauses from src to dst, preserving stable_ids."""
    src_clauses = await (await db.execute(
        "SELECT * FROM clauses WHERE doc_id=? AND tombstoned=0", (src_doc_id,)
    )).fetchall()
    if not src_clauses:
        return

    src_stable_ids = {c["stable_id"] for c in src_clauses}

    import time as _time
    now = _time.time()
    for c in src_clauses:
        new_id = c["stable_id"]
        await db.execute(
            """INSERT OR IGNORE INTO clauses
               (stable_id, doc_id, paragraph_hash, position, raw_text, clause_type,
                is_table, tombstoned, parent, needs_reclassification, updated_at)
               VALUES (?,?,?,?,?,?,?,0,?,0,?)""",
            (new_id, dst_doc_id, c["paragraph_hash"], c["position"],
             c["raw_text"], c["clause_type"], c["is_table"], c["parent"],
             now if c["clause_type"] is not None else None)
        )
        # Clone tags
        tags = await (await db.execute(
            "SELECT value, user_defined FROM tags WHERE clause_id=? AND doc_id=?",
            (c["stable_id"], src_doc_id)
        )).fetchall()
        for t in tags:
            await db.execute(
                "INSERT OR IGNORE INTO tags (clause_id, doc_id, value, user_defined) VALUES (?,?,?,?)",
                (new_id, dst_doc_id, t["value"], t["user_defined"])
            )
        # Clone connections (only intra-doc connections)
        conns = await (await db.execute(
            "SELECT id, target_id, edge_type, note, user_created FROM connections WHERE source_id=? AND source_doc_id=? AND user_rejected=0",
            (c["stable_id"], src_doc_id)
        )).fetchall()
        for conn in conns:
            new_target = conn["target_id"] if conn["target_id"] in src_stable_ids else None
            if new_target:
                new_conn_id = str(uuid.uuid4())[:16]
                await db.execute(
                    """INSERT OR IGNORE INTO connections
                       (id, source_id, source_doc_id, target_id, target_doc_id, edge_type, note, user_created, user_rejected)
                       VALUES (?,?,?,?,?,?,?,?,0)""",
                    (new_conn_id, new_id, dst_doc_id, new_target, dst_doc_id, conn["edge_type"], conn["note"], conn["user_created"])
                )


@router.get("/folder-tree")
async def get_folder_tree(workspace_path: str = Query(...)):
    """Return filesystem tree. Reconciles DB against disk on every call."""
    db_path = workspace_db_path(workspace_path)
    ignore = _load_ignore(workspace_path)

    # Collect all files on disk first
    all_files: list[tuple[str, float]] = []  # (abs_path, mtime)

    def _collect(folder: str, depth: int = 0) -> None:
        if depth > 5:
            return
        try:
            for entry in sorted(os.scandir(folder), key=lambda e: e.name):
                if entry.name.startswith(".") or entry.name.startswith("~$"):
                    continue
                if _is_ignored(entry.name, ignore):
                    continue
                if entry.is_dir():
                    _collect(entry.path, depth + 1)
                elif entry.is_file():
                    try:
                        all_files.append((os.path.abspath(entry.path), entry.stat().st_mtime))
                    except OSError:
                        pass
        except PermissionError:
            pass

    _collect(workspace_path)

    # Reconcile DB
    path_to_doc_id: dict[str, tuple[str, str | None, list]] = {}
    needs_reclassification_counts: dict[str, int] = {}
    if all_files:
        os.makedirs(os.path.join(workspace_path, ".clause-cowork", "db"), exist_ok=True)
        path_to_doc_id = await _reconcile(workspace_path, db_path, all_files)
        if os.path.exists(db_path):
            async with aiosqlite.connect(db_path) as db:
                rows = await (await db.execute(
                    "SELECT doc_id, COUNT(*) as cnt FROM clauses WHERE needs_reclassification=1 AND tombstoned=0 GROUP BY doc_id"
                )).fetchall()
                needs_reclassification_counts = {r[0]: r[1] for r in rows}

    # Build tree from reconciled state
    def _build_tree(folder: str, depth: int = 0) -> list[dict]:
        if depth > 5:
            return []
        result = []
        try:
            entries = sorted(os.scandir(folder), key=lambda e: e.name)
        except PermissionError:
            return []
        for entry in entries:
            if entry.name.startswith(".") or entry.name.startswith("~$"):
                continue
            if _is_ignored(entry.name, ignore):
                continue
            if entry.is_dir():
                children = _build_tree(entry.path, depth + 1)
                if children:
                    result.append({
                        "name": entry.name, "type": "folder",
                        "path": entry.path, "children": children,
                    })
            elif entry.is_file():
                result.append(_file_entry(entry, path_to_doc_id, needs_reclassification_counts))
        return result

    return {"tree": _build_tree(workspace_path)}


@router.get("/file")
async def serve_file(path: str = Query(...)):
    """Serve any file by absolute path for the agent or preview panel."""
    abs_path = os.path.abspath(path)
    if not os.path.isfile(abs_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        abs_path,
        headers={"Cache-Control": "no-store"},
    )


def _file_entry(entry: os.DirEntry, parsed: dict[str, tuple[str, str | None, list, str | None]], modified_counts: dict[str, int] | None = None) -> dict:
    name = entry.name
    path = entry.path
    try:
        st = entry.stat()
        file_size: int | None = st.st_size
        file_mtime: float | None = st.st_mtime
    except OSError:
        file_size = None
        file_mtime = None
    entry_data = parsed.get(os.path.abspath(path))
    doc_id, last_analysed_at, doc_tags, doc_type = entry_data if entry_data else (None, None, [], None)
    needs_reclassification_count = (modified_counts or {}).get(doc_id, 0) if doc_id else 0
    if _is_extractable(path):
        return {
            "name": name, "type": "file", "path": path,
            "status": "analysed" if last_analysed_at else "pending",
            "doc_id": doc_id, "doc_type": doc_type, "doc_tags": doc_tags,
            "file_size": file_size, "file_mtime": file_mtime,
            "last_analysed_at": last_analysed_at,
            "needs_reclassification_count": needs_reclassification_count,
        }
    return {
        "name": name, "type": "file", "path": path,
        "status": "viewable", "doc_id": doc_id, "doc_type": doc_type, "doc_tags": doc_tags,
        "file_size": file_size, "file_mtime": file_mtime,
        "last_analysed_at": last_analysed_at,
        "needs_reclassification_count": 0,
    }
