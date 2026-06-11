#!/usr/bin/env python3
"""Register a document and set its doc_type and doc_tags.

Usage: python3 set_doc_classification.py <doc_path> '<json>'

json: {"doc_type": "Employment Agreement", "doc_tags": ["Party A", "Executed"]}
      doc_type is required (pass null to clear). doc_tags defaults to [].

Looks up doc_id by path in the DB. If not found, registers a stub row.
Does not touch last_parsed_at, file_mtime, or content_hash.

Output: JSON {ok: true, doc_id: str} or {error: str}
Enforces: strict_doc_types, strict_doc_tags
"""
import json
import os
import sqlite3
import sys
from _common import find_db, get_or_register


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: set_doc_classification.py <doc_path> '<json>'", file=sys.stderr)
        sys.exit(1)

    doc_path = os.path.abspath(sys.argv[1])
    try:
        payload = json.loads(sys.argv[2])
        if not isinstance(payload, dict):
            raise ValueError
    except (json.JSONDecodeError, ValueError):
        print(json.dumps({"error": "argument must be a JSON object with doc_type and/or doc_tags"}))
        sys.exit(1)

    doc_type = payload.get("doc_type")
    doc_tags = payload.get("doc_tags", [])

    if not isinstance(doc_tags, list):
        print(json.dumps({"error": "doc_tags must be a JSON array"}))
        sys.exit(1)

    db_path = find_db(os.getcwd())
    if not db_path:
        print(json.dumps({"error": "workspace.db not found"}))
        sys.exit(1)

    con = sqlite3.connect(db_path)
    try:
        con.execute("BEGIN IMMEDIATE")

        config: dict = {}
        cfg_row = con.execute("SELECT value FROM config WHERE key = 'workspace'").fetchone()
        if cfg_row:
            config = json.loads(cfg_row[0])

        strict_doc_types: bool = config.get("strict_doc_types", True)
        strict_doc_tags: bool = config.get("strict_doc_tags", False)

        if doc_type is not None and strict_doc_types:
            valid_types = {r[0] for r in con.execute("SELECT tag FROM tag_pool WHERE kind='doc_type'").fetchall()}
            if valid_types and doc_type not in valid_types:
                print(json.dumps({
                    "error": f"strict_doc_types is enabled — unknown type rejected: {doc_type!r}. Valid types: {sorted(valid_types)}"
                }))
                sys.exit(1)

        if doc_tags and strict_doc_tags:
            valid_tags = {r[0] for r in con.execute("SELECT tag FROM tag_pool WHERE kind='doc_tag'").fetchall()}
            if valid_tags:
                unknown = [t for t in doc_tags if t not in valid_tags]
                if unknown:
                    print(json.dumps({
                        "error": f"strict_doc_tags is enabled — unknown tags rejected: {unknown}. Valid tags: {sorted(valid_tags)}"
                    }))
                    sys.exit(1)

        doc_id = get_or_register(con, doc_path)
        con.execute(
            "UPDATE documents SET doc_type=?, doc_tags=? WHERE id=?",
            (doc_type, json.dumps(doc_tags), doc_id)
        )
        con.commit()
    finally:
        con.close()

    print(json.dumps({"ok": True, "doc_id": doc_id}))


if __name__ == "__main__":
    main()
