#!/usr/bin/env python3
"""List all documents in the workspace database with parse stats.

Usage: python3 get_docs.py
Run from the workspace root or any subdirectory — locates workspace.db automatically.

Output: JSON array of {doc_id, path, name, clause_count, connection_count, last_analysed_at, needs_reclassification_count}
"""
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from _common import find_db


def main() -> None:
    db_path = find_db(os.getcwd())
    if not db_path:
        print(json.dumps({"error": "workspace.db not found — has a document been parsed yet?"}))
        sys.exit(1)

    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    rows = con.execute("""
        SELECT
            d.id AS doc_id,
            d.path,
            d.file_mtime,
            d.last_analysed_at,
            COALESCE(d.doc_tags, '[]') AS doc_tags,
            COUNT(DISTINCT n.stable_id) FILTER (WHERE n.tombstoned = 0) AS clause_count,
            COUNT(DISTINCT n.stable_id) FILTER (WHERE n.tombstoned = 0 AND n.needs_reclassification = 1) AS needs_reclassification_count,
            COUNT(DISTINCT c.id) AS connection_count
        FROM documents d
        LEFT JOIN clauses n ON n.doc_id = d.id
        LEFT JOIN connections c ON c.source_id IN (
            SELECT stable_id FROM clauses WHERE doc_id = d.id AND tombstoned = 0
        )
        WHERE d.tombstoned = 0
        GROUP BY d.id
        ORDER BY d.last_analysed_at DESC NULLS LAST
    """).fetchall()
    con.close()

    result = []
    for r in rows:
        path = r["path"]
        try:
            doc_tags = json.loads(r["doc_tags"] or "[]")
        except (json.JSONDecodeError, TypeError):
            doc_tags = []
        file_mtime = r["file_mtime"]
        if file_mtime is None and path and os.path.exists(path):
            file_mtime = os.path.getmtime(path)
        file_mtime_iso = datetime.fromtimestamp(file_mtime, tz=timezone.utc).isoformat() if file_mtime is not None else None
        result.append({
            "doc_id": r["doc_id"],
            "path": path,
            "name": os.path.basename(path),
            "file_mtime": file_mtime_iso,
            "node_count": r["clause_count"],  # kept as node_count for backwards compat with existing SKILL.md references
            "needs_reclassification_count": r["needs_reclassification_count"],
            "connection_count": r["connection_count"],
            "last_analysed_at": r["last_analysed_at"],
            "doc_tags": doc_tags,
        })
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
