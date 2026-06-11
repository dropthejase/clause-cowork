#!/usr/bin/env python3
"""Record a connection between two clauses in the workspace database.

Usage: python3 set_clause_connection.py <source_id> <target_id> <edge_type> [note]

edge_type: references | subject_to | contradicts

  references  — one clause cites or cross-references another
  subject_to  — source clause is conditioned or overridden by target (e.g. carve-outs)
  contradicts — source clause conflicts with target

Examples:
  python3 set_clause_connection.py abc12345 def67890 references
  python3 set_clause_connection.py abc12345 def67890 subject_to
  python3 set_clause_connection.py abc12345 def67890 contradicts

Output: JSON {ok: true, id: str} or {error: str}
"""
import hashlib
import json
import os
import sqlite3
import sys
from _common import find_db

VALID_EDGE_TYPES = {"references", "subject_to", "contradicts"}


def resolve_id(con: sqlite3.Connection, sid: str) -> tuple[str, str] | None:
    """Returns (stable_id, doc_id) or None."""
    row = con.execute("SELECT stable_id, doc_id FROM clauses WHERE stable_id = ? AND tombstoned=0 LIMIT 1", (sid,)).fetchone()
    if row:
        return row[0], row[1]
    row = con.execute("SELECT stable_id, doc_id FROM clauses WHERE stable_id LIKE ? AND tombstoned=0 LIMIT 1", (sid + "%",)).fetchone()
    return (row[0], row[1]) if row else None


def main() -> None:
    if len(sys.argv) < 4:
        print("Usage: set_clause_connection.py <source_id> <target_id> <edge_type> [note]",
              file=sys.stderr)
        sys.exit(1)

    source_id = sys.argv[1]
    target_id = sys.argv[2]
    edge_type = sys.argv[3]
    note = sys.argv[4] if len(sys.argv) > 4 else None

    if edge_type not in VALID_EDGE_TYPES:
        print(json.dumps({"error": f"invalid edge_type '{edge_type}'; must be one of {sorted(VALID_EDGE_TYPES)}"}))
        sys.exit(1)

    db_path = find_db(os.getcwd())
    if not db_path:
        print(json.dumps({"error": "workspace.db not found"}))
        sys.exit(1)

    con = sqlite3.connect(db_path)
    try:
        src = resolve_id(con, source_id)
        tgt = resolve_id(con, target_id)
        if not src:
            print(json.dumps({"error": f"source_id {source_id!r} not found"}))
            sys.exit(1)
        if not tgt:
            print(json.dumps({"error": f"target_id {target_id!r} not found"}))
            sys.exit(1)

        src_id, src_doc_id = src
        tgt_id, tgt_doc_id = tgt
        conn_id = hashlib.sha256(f"{src_id}:{src_doc_id}:{tgt_id}:{tgt_doc_id}:{edge_type}".encode()).hexdigest()[:16]
        con.execute("""
            INSERT INTO connections (id, source_id, source_doc_id, target_id, target_doc_id, edge_type, note, user_created)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0)
            ON CONFLICT(id) DO UPDATE SET note = excluded.note
        """, (conn_id, src_id, src_doc_id, tgt_id, tgt_doc_id, edge_type, note))
        con.commit()
    finally:
        con.close()

    print(json.dumps({"ok": True, "id": conn_id}))


if __name__ == "__main__":
    main()
