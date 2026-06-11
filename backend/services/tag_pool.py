"""Vocabulary pool management for clause types, clause tags, doc types, and doc tags.

TagPool is the single point of truth for CRUD on tag_pool entries. It enforces MAX_POOL_SIZE (100)
per kind and validates input via normalize_tag(). Used by the /tags router and config router.
kind values: 'clause_type' | 'clause_tag' | 'doc_type' | 'doc_tag'.
"""
from __future__ import annotations
import csv
import io
import json
import logging
import os
import re
import sqlite3
from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel

logger = logging.getLogger(__name__)

TAG_MAX_LEN = 64
_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def normalize_tag(value: str) -> str:
    """Strip control characters, null bytes, collapse whitespace, enforce max length."""
    value = _CONTROL_RE.sub("", value)   # remove control chars (keeps \t \n for strip below)
    value = value.replace("\x00", "")    # explicit null byte
    value = " ".join(value.split())      # collapse all whitespace including \n \t
    return value[:TAG_MAX_LEN]


class PoolTag(BaseModel):
    tag: str
    description: str
    source: Literal["import", "agent", "manual", "default"]
    created_at: str = ""
    kind: Literal["clause_type", "clause_tag", "doc_type", "doc_tag"] = "clause_tag"

    def model_post_init(self, __context: object) -> None:
        if not self.created_at:
            self.created_at = datetime.now(timezone.utc).isoformat()


class TagPoolError(Exception):
    pass


class TagPool:
    MAX_TAGS = 100

    def __init__(self, db_path: str):
        self._db_path = db_path
        self._ensure_table()
        self._migrate_json()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_table(self) -> None:
        os.makedirs(os.path.dirname(self._db_path), exist_ok=True)
        with self._conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS tag_pool (
                    tag TEXT PRIMARY KEY,
                    description TEXT NOT NULL,
                    source TEXT NOT NULL DEFAULT 'manual',
                    created_at TEXT NOT NULL,
                    kind TEXT NOT NULL DEFAULT 'clause_tag'
                )
            """)
            try:
                conn.execute("ALTER TABLE tag_pool ADD COLUMN kind TEXT NOT NULL DEFAULT 'clause_tag'")
            except Exception:
                pass

    def _migrate_json(self) -> None:
        """One-time migration: import tags from legacy tags.json if it exists."""
        json_path = os.path.join(os.path.dirname(os.path.dirname(self._db_path)), "tags.json")
        if not os.path.exists(json_path):
            return
        try:
            with open(json_path) as f:
                data = json.load(f)
            tags = [PoolTag(**t) for t in data.get("tags", [])]
            with self._conn() as conn:
                conn.executemany(
                    "INSERT OR IGNORE INTO tag_pool (tag, description, source, created_at) VALUES (?,?,?,?)",
                    [(t.tag, t.description, t.source, t.created_at) for t in tags],
                )
            os.rename(json_path, json_path + ".migrated")
        except Exception:
            pass

    def list(self, kind: Literal["clause_type", "clause_tag", "doc_type", "doc_tag"] = "clause_tag") -> list[PoolTag]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT tag, description, source, created_at, kind FROM tag_pool WHERE kind=? ORDER BY tag",
                (kind,),
            ).fetchall()
        return [PoolTag(tag=r["tag"], description=r["description"], source=r["source"], created_at=r["created_at"], kind=r["kind"]) for r in rows]

    def add(self, tag: PoolTag) -> None:
        tag_val = normalize_tag(tag.tag)
        if not tag_val:
            raise TagPoolError("Tag name cannot be empty.")
        with self._conn() as conn:
            count = conn.execute("SELECT COUNT(*) FROM tag_pool WHERE kind=?", (tag.kind,)).fetchone()[0]
            if count >= self.MAX_TAGS:
                raise TagPoolError(f"Tag pool is limited to {self.MAX_TAGS} tags.")
            try:
                conn.execute(
                    "INSERT INTO tag_pool (tag, description, source, created_at, kind) VALUES (?,?,?,?,?)",
                    (tag_val, tag.description, tag.source, tag.created_at, tag.kind),
                )
            except sqlite3.IntegrityError:
                raise TagPoolError(f"Tag '{tag_val}' already exists in pool.")

    def delete(self, tag: str) -> None:
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM tag_pool WHERE tag=?", (tag,))
            if cur.rowcount == 0:
                raise TagPoolError(f"Tag '{tag}' not found in pool.")

    def update(self, tag: str, description: str) -> None:
        with self._conn() as conn:
            cur = conn.execute(
                "UPDATE tag_pool SET description=? WHERE tag=?", (description, tag)
            )
            if cur.rowcount == 0:
                raise TagPoolError(f"Tag '{tag}' not found in pool.")

    def import_csv(self, csv_content: str, source: Literal["import", "agent", "manual"], kind: Literal["clause_type", "clause_tag", "doc_type", "doc_tag"] = "clause_tag") -> dict:
        reader = csv.DictReader(io.StringIO(csv_content))
        _ = reader.fieldnames
        if not reader.fieldnames or not {"tag", "description"}.issubset(set(reader.fieldnames)):
            raise TagPoolError("Invalid CSV format — your file must have a header row with 'tag' and 'description' columns.")
        rows = list(reader)
        if not rows:
            raise TagPoolError("The CSV file has no data rows — add at least one tag below the header.")

        # Validate all rows before writing anything
        errors = []
        valid_rows = []
        for row in rows:
            raw_tag = row.get("tag", "")
            tag_val = normalize_tag(raw_tag)
            raw_desc = row.get("description", "")
            desc_val = " ".join(raw_desc.split())
            if not tag_val:
                errors.append("Row with empty or invalid tag name — skipped.")
                continue
            if not desc_val:
                errors.append(f"Row '{tag_val}': description is required.")
                continue
            full_tag = " ".join(_CONTROL_RE.sub("", raw_tag).replace("\x00", "").split())
            if len(full_tag) > TAG_MAX_LEN:
                errors.append(f"Row '{tag_val}': tag name exceeds {TAG_MAX_LEN} characters.")
                continue
            if len(desc_val) > 256:
                errors.append(f"Row '{tag_val}': description exceeds 256 characters ({len(desc_val)}).")
                continue
            valid_rows.append((tag_val, desc_val))

        if errors:
            raise TagPoolError(" | ".join(errors))

        with self._conn() as conn:
            current_count = conn.execute("SELECT COUNT(*) FROM tag_pool WHERE kind=?", (kind,)).fetchone()[0]
            if current_count + len(valid_rows) > self.MAX_TAGS:
                space = self.MAX_TAGS - current_count
                raise TagPoolError(
                    f"Too many tags — your CSV has {len(valid_rows)} tags but only {space} "
                    f"slot{'s' if space != 1 else ''} remain{'s' if space == 1 else ''} "
                    f"(limit is {self.MAX_TAGS}). Remove existing tags first or reduce your CSV."
                )
            for tag_val, desc_val in valid_rows:
                conn.execute(
                    "INSERT INTO tag_pool (tag, description, source, created_at, kind) VALUES (?,?,?,?,?) "
                    "ON CONFLICT(tag) DO UPDATE SET description=excluded.description",
                    (tag_val, desc_val, source, datetime.now(timezone.utc).isoformat(), kind),
                )

        imported = len(valid_rows)
        logger.info("tag_pool: import_csv imported=%d kind=%s source=%s", imported, kind, source)
        return {"imported": imported, "errors": []}

    def export_csv(self, kind: Literal["clause_type", "clause_tag", "doc_type", "doc_tag"] = "clause_tag") -> str:
        out = io.StringIO()
        writer = csv.writer(out, lineterminator="\n")
        writer.writerow(["tag", "description"])
        for t in self.list(kind=kind):
            writer.writerow([t.tag, t.description])
        return out.getvalue()
