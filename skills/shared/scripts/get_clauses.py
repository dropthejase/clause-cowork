#!/usr/bin/env python3
"""Fetch clauses for a document from the workspace database.

Usage:
  python3 get_clauses.py <doc_id>                                    # all clauses
  python3 get_clauses.py <doc_id> --unclassified                     # only unclassified (clause_type IS NULL)
  python3 get_clauses.py <doc_id> --modified                         # only modified since last classify
  python3 get_clauses.py <doc_id> --type "Section Title"             # by clause type
  python3 get_clauses.py <doc_id> --parent "7. REGULATORY APPROVALS" # by parent section
  python3 get_clauses.py <doc_id> --search "regulatory"              # full-text search in raw_text
  python3 get_clauses.py <doc_id> --unclassified --limit 50          # first 50 unclassified
  python3 get_clauses.py <doc_id> --unclassified --limit 50 --offset 50  # next 50

Output: JSON {total: int, clauses: [{stable_id, position, raw_text, clause_type, parent, clause_tags, needs_reclassification}]}
"""
import json
import os
import sqlite3
import sys
from _common import find_db


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: get_clauses.py <doc_id> [--unclassified] [--modified] [--type TYPE] [--parent PARENT] [--search TEXT] [--limit N] [--offset N]", file=sys.stderr)
        sys.exit(1)

    doc_id = sys.argv[1]
    args = sys.argv[2:]
    unclassified_only = "--unclassified" in args
    modified_only = "--modified" in args

    limit: int | None = None
    offset: int = 0
    type_filter: str | None = None
    parent_filter: str | None = None
    search_filter: str | None = None

    for i, arg in enumerate(args):
        if arg == "--limit" and i + 1 < len(args):
            limit = int(args[i + 1])
        if arg == "--offset" and i + 1 < len(args):
            offset = int(args[i + 1])
        if arg == "--type" and i + 1 < len(args):
            type_filter = args[i + 1]
        if arg == "--parent" and i + 1 < len(args):
            parent_filter = args[i + 1]
        if arg == "--search" and i + 1 < len(args):
            search_filter = args[i + 1]

    db_path = find_db(os.getcwd())
    if not db_path:
        print(json.dumps({"error": "workspace.db not found"}))
        sys.exit(1)

    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row

    where = "n.doc_id = ? AND n.tombstoned = 0"
    params: list = [doc_id]

    if unclassified_only:
        where += " AND n.clause_type IS NULL"
    if modified_only:
        where += " AND n.needs_reclassification = 1"
    if type_filter is not None:
        where += " AND n.clause_type = ?"
        params.append(type_filter)
    if parent_filter is not None:
        where += " AND n.parent = ?"
        params.append(parent_filter)
    if search_filter is not None:
        where += " AND n.raw_text LIKE ?"
        params.append(f"%{search_filter}%")

    total = con.execute(f"SELECT COUNT(*) FROM clauses n WHERE {where}", params).fetchone()[0]

    pagination = ""
    if limit is not None:
        pagination = f" LIMIT {limit} OFFSET {offset}"

    rows = con.execute(f"""
        SELECT n.stable_id, n.position, n.raw_text, n.clause_type, n.parent, n.needs_reclassification,
               GROUP_CONCAT(t.value, ',') AS tags
        FROM clauses n
        LEFT JOIN tags t ON t.clause_id = n.stable_id AND t.doc_id = n.doc_id
        WHERE {where}
        GROUP BY n.stable_id
        ORDER BY n.position{pagination}
    """, params).fetchall()
    con.close()

    clauses = [
        {
            "stable_id": r["stable_id"],
            "position": r["position"],
            "raw_text": r["raw_text"],
            "clause_type": r["clause_type"],
            "parent": r["parent"],
            "clause_tags": r["tags"].split(",") if r["tags"] else [],
            "needs_reclassification": bool(r["needs_reclassification"]),
        }
        for r in rows
    ]
    print(json.dumps({"total": total, "clauses": clauses}, indent=2))


if __name__ == "__main__":
    main()
