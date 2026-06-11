#!/usr/bin/env python3
"""Record a document-level link between two documents.

Usage: python3 set_document_link.py <source_doc_path> <target_doc_path> <relationship> [note]

Looks up doc_id by path for both documents. Registers stub rows if not found.
relationship: references | subject_to | contradicts

Output: JSON {ok: true, id: str} or {error: str}
"""
import hashlib
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from _common import find_db, get_or_register

VALID_RELATIONSHIPS = {"references", "subject_to", "contradicts"}


def main() -> None:
    if len(sys.argv) < 4:
        print(
            "Usage: set_document_link.py <source_doc_path> <target_doc_path> <relationship> [note]",
            file=sys.stderr,
        )
        sys.exit(1)

    source_path = os.path.abspath(sys.argv[1])
    target_path = os.path.abspath(sys.argv[2])
    relationship = sys.argv[3]
    note = sys.argv[4] if len(sys.argv) > 4 else None

    if relationship not in VALID_RELATIONSHIPS:
        print(json.dumps({"error": f"invalid relationship '{relationship}'; must be one of {sorted(VALID_RELATIONSHIPS)}"}))
        sys.exit(1)

    db_path = find_db(os.getcwd())
    if not db_path:
        print(json.dumps({"error": "workspace.db not found"}))
        sys.exit(1)

    con = sqlite3.connect(db_path)
    try:
        source_id = get_or_register(con, source_path)
        target_id = get_or_register(con, target_path)

        link_id = hashlib.sha256(f"{source_id}:{target_id}:{relationship}".encode()).hexdigest()[:16]
        now = datetime.now(timezone.utc).isoformat()
        con.execute("""
            INSERT INTO document_links (id, source_doc_id, target_doc_id, relationship, note, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, 'agent', ?)
            ON CONFLICT(id) DO UPDATE SET note = excluded.note
        """, (link_id, source_id, target_id, relationship, note, now))
        con.commit()
    finally:
        con.close()

    print(json.dumps({"ok": True, "id": link_id}))


if __name__ == "__main__":
    main()
