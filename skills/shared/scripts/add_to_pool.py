#!/usr/bin/env python3
"""Add a new entry to the workspace tag pool, or update its description if it already exists.

Usage: python3 add_to_pool.py <name> <description> --kind <kind>

--kind: required; one of clause_type | clause_tag | doc_type | doc_tag
        Must be fully qualified — 'doc' or 'clause' alone are not valid.

Examples:
  python3 add_to_pool.py "Employment Agreement" "Full-time employment contracts" --kind doc_type
  python3 add_to_pool.py auto-renewal "Clauses that automatically renew a contract term" --kind clause_tag

Output: JSON {ok: true, name: str} or {error: str}

Pool size is limited to 100 entries per kind. Attempting to add beyond this limit returns an error.
"""
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone
from _common import find_db

VALID_KINDS = {"clause_type", "clause_tag", "doc_type", "doc_tag"}
MAX_POOL_SIZE = 100


def main() -> None:
    args = sys.argv[1:]
    kind: str | None = None
    for i, a in enumerate(args):
        if a == "--kind" and i + 1 < len(args):
            kind = args[i + 1]

    positional = []
    skip_next = False
    for a in args:
        if skip_next:
            skip_next = False
            continue
        if a == "--kind":
            skip_next = True
            continue
        positional.append(a)

    if len(positional) < 2:
        print("Usage: add_to_pool.py <name> <description> --kind <kind>", file=sys.stderr)
        sys.exit(1)

    name = positional[0].strip()
    description = positional[1].strip()

    if not name:
        print(json.dumps({"error": "name must not be empty"}))
        sys.exit(1)

    if not description:
        print(json.dumps({"error": "description must not be empty"}))
        sys.exit(1)

    if kind not in VALID_KINDS:
        print(json.dumps({"error": f"invalid kind {kind!r}; must be one of {sorted(VALID_KINDS)}"}))
        sys.exit(1)

    db_path = find_db(os.getcwd())
    if not db_path:
        print(json.dumps({"error": "workspace.db not found"}))
        sys.exit(1)

    now = datetime.now(timezone.utc).isoformat()
    con = sqlite3.connect(db_path)
    try:
        # Check whether this is a new entry (upsert on existing doesn't consume a slot)
        existing = con.execute(
            "SELECT tag FROM tag_pool WHERE tag=?", (name,)
        ).fetchone()
        if not existing:
            count = con.execute(
                "SELECT COUNT(*) FROM tag_pool WHERE kind=?", (kind,)
            ).fetchone()[0]
            if count >= MAX_POOL_SIZE:
                print(json.dumps({
                    "error": f"pool for {kind!r} is full ({MAX_POOL_SIZE} entries). Remove an existing entry before adding new ones."
                }))
                sys.exit(1)
        con.execute("""
            INSERT INTO tag_pool (tag, description, source, created_at, kind)
            VALUES (?, ?, 'agent', ?, ?)
            ON CONFLICT(tag) DO UPDATE SET description = excluded.description
        """, (name, description, now, kind))
        con.commit()
    finally:
        con.close()

    print(json.dumps({"ok": True, "name": name}))


if __name__ == "__main__":
    main()
