"""Shared helpers for skill scripts. Imported by scripts in the same directory."""
import os
import sqlite3
import uuid


def find_db(start: str) -> str | None:
    """Walk up from start looking for .clause-cowork/db/workspace.db."""
    path = os.path.abspath(start)
    while True:
        candidate = os.path.join(path, ".clause-cowork", "db", "workspace.db")
        if os.path.exists(candidate):
            return candidate
        parent = os.path.dirname(path)
        if parent == path:
            return None
        path = parent


def get_or_register(con: sqlite3.Connection, doc_path: str) -> str:
    """Return doc_id for doc_path, inserting a stub row if not found."""
    row = con.execute(
        "SELECT id FROM documents WHERE path=? AND tombstoned=0", (doc_path,)
    ).fetchone()
    if row:
        return row[0]
    doc_id = str(uuid.uuid4())[:16]
    con.execute("INSERT OR IGNORE INTO documents (id, path) VALUES (?,?)", (doc_id, doc_path))
    return doc_id
