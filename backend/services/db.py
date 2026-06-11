"""Async database access layer for clause, tag, connection, and document records.

DBService wraps aiosqlite and is instantiated per-request with a workspace db_path.
get_or_register_doc_id() is the lightweight entry point used by routers that only need a doc_id.
_hydrate_clauses() bulk-loads tags and connections in two queries to avoid N+1 fetches.
"""
from __future__ import annotations
import os
import uuid
import aiosqlite
from models.clause import Clause, Tag, Connection
from db.migrations import apply_schema


async def get_or_register_doc_id(doc_path: str, db_path: str) -> str:
    """Return the DB-assigned doc_id for a path, registering a stub if not yet present."""
    abs_path = os.path.abspath(doc_path)
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    await apply_schema(db_path)
    async with aiosqlite.connect(db_path) as conn:
        row = await (await conn.execute(
            "SELECT id FROM documents WHERE path=? AND tombstoned=0", (abs_path,)
        )).fetchone()
        if row:
            return row[0]
        doc_id = str(uuid.uuid4())[:16]
        await conn.execute(
            "INSERT OR IGNORE INTO documents (id, path) VALUES (?,?)", (doc_id, abs_path)
        )
        await conn.commit()
        return doc_id


class DBService:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._initialized = False

    async def init(self) -> None:
        if self._initialized:
            return
        dir_name = os.path.dirname(self.db_path)
        if dir_name:
            os.makedirs(dir_name, exist_ok=True)
        await apply_schema(self.db_path)
        self._initialized = True

    async def upsert_clause(self, clause: Clause, force_type: bool = False) -> None:
        import time
        async with aiosqlite.connect(self.db_path) as db:
            type_expr = "excluded.clause_type" if force_type else "COALESCE(excluded.clause_type, clause_type)"
            updated_at_expr = f"CASE WHEN excluded.clause_type IS NOT NULL AND excluded.needs_reclassification = 0 THEN {time.time()} ELSE updated_at END"
            now = time.time() if (clause.clause_type is not None and not clause.needs_reclassification) else None
            await db.execute(
                f"""INSERT INTO clauses (stable_id, doc_id, paragraph_hash, position,
                   raw_text, clause_type, is_table, tombstoned, parent, needs_reclassification, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(stable_id, doc_id) DO UPDATE SET
                     paragraph_hash=excluded.paragraph_hash,
                     position=excluded.position,
                     raw_text=excluded.raw_text,
                     clause_type={type_expr},
                     is_table=excluded.is_table,
                     tombstoned=excluded.tombstoned,
                     parent=COALESCE(excluded.parent, parent),
                     needs_reclassification=excluded.needs_reclassification,
                     updated_at={updated_at_expr}""",
                (clause.stable_id, clause.doc_id, clause.paragraph_hash, clause.position,
                 clause.raw_text, clause.clause_type,
                 int(clause.is_table), int(clause.tombstoned), clause.parent,
                 int(clause.needs_reclassification), now)
            )
            # classified_hash is never set by extraction — only by set_clause_classification
            await db.execute(
                "DELETE FROM tags WHERE clause_id=? AND doc_id=? AND user_defined=0",
                (clause.stable_id, clause.doc_id)
            )
            for tag in clause.clause_tags:
                if not tag.user_defined:
                    await db.execute(
                        "INSERT OR IGNORE INTO tags (clause_id, doc_id, value, user_defined) VALUES (?,?,?,0)",
                        (clause.stable_id, clause.doc_id, tag.value)
                    )
            await db.commit()

    async def add_user_tag(self, clause_id: str, doc_id: str, tag: Tag) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "INSERT OR IGNORE INTO tags (clause_id, doc_id, value, user_defined) VALUES (?,?,?,1)",
                (clause_id, doc_id, tag.value)
            )
            await db.commit()

    async def remove_tag(self, clause_id: str, doc_id: str, value: str) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "DELETE FROM tags WHERE clause_id=? AND doc_id=? AND value=?",
                (clause_id, doc_id, value)
            )
            await db.commit()

    async def clear_all_tags(self, clause_id: str, doc_id: str) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("DELETE FROM tags WHERE clause_id=? AND doc_id=?", (clause_id, doc_id))
            await db.commit()

    async def upsert_connection(self, source_id: str, source_doc_id: str, conn: Connection) -> None:
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """INSERT INTO connections
                   (id, source_id, source_doc_id, target_id, target_doc_id, edge_type, note, user_created, user_rejected)
                   VALUES (?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(id) DO UPDATE SET
                     note=excluded.note""",
                (conn.id, source_id, source_doc_id, conn.target_id, conn.target_doc_id,
                 conn.edge_type, conn.note, int(conn.user_created), int(conn.user_rejected))
            )
            await db.commit()

    async def get_clause(self, stable_id: str, doc_id: str) -> Clause | None:
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM clauses WHERE stable_id=? AND doc_id=?", (stable_id, doc_id)
            )
            row = await cursor.fetchone()
            if not row:
                return None
            clauses = await self._hydrate_clauses(db, [dict(row)])
            return clauses[0]

    async def get_clauses_for_doc(self, doc_id: str) -> list[Clause]:
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM clauses WHERE doc_id=? AND tombstoned=0 ORDER BY position",
                (doc_id,)
            )
            rows = [dict(r) for r in await cursor.fetchall()]
            return await self._hydrate_clauses(db, rows)

    async def get_all_clauses_for_doc(self, doc_id: str) -> list[Clause]:
        """Returns all clauses including tombstoned — used by parse/extraction."""
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT * FROM clauses WHERE doc_id=? ORDER BY position",
                (doc_id,)
            )
            rows = [dict(r) for r in await cursor.fetchall()]
            return await self._hydrate_clauses(db, rows)

    async def get_old_clause_texts(self, doc_id: str) -> tuple[dict[str, str], dict[str, int]]:
        """Returns ({paragraph_hash: raw_text}, {paragraph_hash: position}) for all clauses including tombstoned."""
        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute(
                "SELECT paragraph_hash, raw_text, position FROM clauses WHERE doc_id=?",
                (doc_id,)
            )
            rows = await cursor.fetchall()
            texts = {row[0]: row[1] for row in rows}
            positions = {row[0]: row[2] for row in rows}
            return texts, positions

    async def tombstone_missing_clauses(self, doc_id: str, seen_ids: set[str]) -> int:
        """Tombstone clauses not present in current parse. Returns count tombstoned."""
        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute(
                "SELECT stable_id FROM clauses WHERE doc_id=? AND tombstoned=0",
                (doc_id,)
            )
            existing = {row[0] for row in await cursor.fetchall()}
            missing = existing - seen_ids
            for sid in missing:
                await db.execute(
                    "UPDATE clauses SET tombstoned=1 WHERE stable_id=? AND doc_id=?", (sid, doc_id)
                )
            await db.commit()
            return len(missing)

    async def upsert_document(self, doc_path: str, doc_id: str) -> None:
        """Called by agent after analysis — updates last_analysed_at."""
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc).timestamp()
        try:
            file_mtime = os.path.getmtime(os.path.abspath(doc_path))
        except OSError:
            file_mtime = None
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                """INSERT INTO documents (id, path, last_analysed_at, file_mtime)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET
                     path=excluded.path,
                     last_analysed_at=excluded.last_analysed_at,
                     file_mtime=excluded.file_mtime""",
                (doc_id, os.path.abspath(doc_path), now, file_mtime)
            )
            await db.commit()

    async def update_extracted_at(self, doc_id: str, mtime: float) -> None:
        """Called after background extraction — records when file was last extracted."""
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "UPDATE documents SET last_extracted_at=? WHERE id=?",
                (mtime, doc_id)
            )
            await db.commit()

    async def _hydrate_clauses(self, db: aiosqlite.Connection, rows: list[dict]) -> list[Clause]:
        if not rows:
            return []
        doc_id = rows[0]["doc_id"]

        tag_cursor = await db.execute(
            "SELECT clause_id, value, user_defined FROM tags WHERE doc_id=?", (doc_id,)
        )
        tags_by_clause: dict[str, list[Tag]] = {}
        for r in await tag_cursor.fetchall():
            tags_by_clause.setdefault(r[0], []).append(Tag(value=r[1], user_defined=bool(r[2])))

        conn_cursor = await db.execute(
            """SELECT source_id, id, target_id, target_doc_id, edge_type, note, user_created, user_rejected
               FROM connections WHERE source_doc_id=? AND user_rejected=0""",
            (doc_id,)
        )
        conns_by_clause: dict[str, list[Connection]] = {}
        for r in await conn_cursor.fetchall():
            conns_by_clause.setdefault(r[0], []).append(Connection(
                id=r[1], target_id=r[2], target_doc_id=r[3], edge_type=r[4],
                note=r[5], user_created=bool(r[6]), user_rejected=bool(r[7])
            ))

        return [
            Clause(
                stable_id=row["stable_id"],
                doc_id=row["doc_id"],
                paragraph_hash=row["paragraph_hash"],
                position=row["position"],
                raw_text=row["raw_text"],
                clause_type=row["clause_type"],
                clause_tags=tags_by_clause.get(row["stable_id"], []),
                connections=conns_by_clause.get(row["stable_id"], []),
                is_table=bool(row["is_table"]),
                tombstoned=bool(row["tombstoned"]),
                parent=row.get("parent"),
                needs_reclassification=bool(row.get("needs_reclassification", 0)),
                classified_hash=row.get("classified_hash"),
                classified_text=row.get("classified_text"),
            )
            for row in rows
        ]
