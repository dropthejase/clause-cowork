#!/usr/bin/env python3
"""Classify one or more clauses in the workspace database.

Usage: python3 set_clause_classification.py <doc_id> '<clauses_json>'

clauses_json is a JSON array of objects:
  [{"stable_id": str, "clause_type": str|null, "clause_tags": [...], "parent": str|null}]

Examples:
  python3 set_clause_classification.py abc123 '[{"stable_id":"def456","clause_type":"Obligation","clause_tags":["payment","due-date"],"parent":"4. Payment Terms"}]'
  python3 set_clause_classification.py abc123 '[{"stable_id":"def456","clause_type":null,"clause_tags":[],"parent":null}]'

All clauses are validated and written atomically under a single transaction.
If any clause fails validation the entire batch is rejected — nothing is written.

Output: JSON {ok: true, updated: int} or {error: str, stable_id: str}
"""
import json
import os
import re
import sqlite3
import sys
from _common import find_db

_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")


def _safe_tag(value: str) -> str:
    value = _CONTROL_RE.sub("", value)
    return " ".join(value.split())[:64].lower()


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: set_clause_classification.py <doc_id> '<clauses_json>'", file=sys.stderr)
        sys.exit(1)

    doc_id = sys.argv[1]
    try:
        clauses = json.loads(sys.argv[2])
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"invalid clauses JSON: {e}"}))
        sys.exit(1)

    if not isinstance(clauses, list) or not clauses:
        print(json.dumps({"error": "clauses_json must be a non-empty array"}))
        sys.exit(1)

    db_path = find_db(os.getcwd())
    if not db_path:
        print(json.dumps({"error": "workspace.db not found"}))
        sys.exit(1)

    con = sqlite3.connect(db_path)
    try:
        # BEGIN IMMEDIATE acquires a write lock upfront so validation and write are atomic —
        # concurrent processes wait rather than racing on the same read window.
        con.execute("BEGIN IMMEDIATE")

        # Load config once for the whole batch
        valid_types: list[str] = []
        strict_clause_types: bool = True
        strict_clause_tags: bool = False
        valid_clause_tags: list[str] = []
        row = con.execute("SELECT value FROM config WHERE key = 'workspace'").fetchone()
        if row:
            config = json.loads(row[0])
            strict_clause_types = config.get("strict_clause_types", True)
            strict_clause_tags = config.get("strict_clause_tags", False)

        if strict_clause_types:
            type_rows = con.execute("SELECT tag FROM tag_pool WHERE kind='clause_type'").fetchall()
            valid_types = [r[0] for r in type_rows]

        if strict_clause_tags:
            tag_rows = con.execute("SELECT tag FROM tag_pool WHERE kind='clause_tag'").fetchall()
            valid_clause_tags = [r[0] for r in tag_rows]

        valid_sections = [r[0] for r in con.execute(
            "SELECT raw_text FROM clauses WHERE doc_id = ? AND clause_type IN ('Section Title', 'Subsection Title') AND tombstoned = 0",
            (doc_id,)
        ).fetchall()]

        # Pass 1: validate all clauses
        resolved: list[tuple] = []  # (stable_id, clause_type, parent, clause_tags)
        for item in clauses:
            stable_id = item.get("stable_id", "")
            clause_type = item.get("clause_type") or None
            parent = item.get("parent") or None
            clause_tags = item.get("clause_tags", [])

            if not stable_id:
                print(json.dumps({"error": "missing stable_id in clause", "stable_id": ""}))
                sys.exit(1)

            if strict_clause_types and clause_type is not None and clause_type not in ("Section Title", "Subsection Title") and valid_types and clause_type not in valid_types:
                print(json.dumps({"error": f"invalid clause_type {clause_type!r} — valid types: {valid_types}", "stable_id": stable_id}))
                sys.exit(1)

            if strict_clause_tags and valid_clause_tags:
                invalid_tags = [t for t in clause_tags if t not in valid_clause_tags]
                if invalid_tags:
                    print(json.dumps({"error": f"invalid clause_tags {invalid_tags!r} — valid tags: {valid_clause_tags}", "stable_id": stable_id}))
                    sys.exit(1)

            if parent is not None and clause_type not in ("Section Title", "Subsection Title"):
                if parent not in valid_sections:
                    print(json.dumps({"error": f"invalid parent {parent!r} — section title not yet classified. Pass clauses in position order so Section Title clauses appear before their clause nodes. Valid classified sections: {valid_sections}", "stable_id": stable_id}))
                    sys.exit(1)

            db_row = con.execute(
                "SELECT stable_id FROM clauses WHERE stable_id = ? AND doc_id = ?",
                (stable_id, doc_id)
            ).fetchone()
            if not db_row:
                db_row = con.execute(
                    "SELECT stable_id FROM clauses WHERE stable_id LIKE ? AND doc_id = ?",
                    (stable_id + "%", doc_id)
                ).fetchone()
            if not db_row:
                print(json.dumps({"error": f"clause {stable_id!r} not found in doc {doc_id!r}", "stable_id": stable_id}))
                sys.exit(1)

            resolved.append((db_row[0], clause_type, parent, clause_tags))

            if clause_type in ("Section Title", "Subsection Title"):
                clause_text_row = con.execute(
                    "SELECT raw_text FROM clauses WHERE stable_id = ? AND doc_id = ?",
                    (db_row[0], doc_id)
                ).fetchone()
                if clause_text_row and clause_text_row[0] not in valid_sections:
                    valid_sections.append(clause_text_row[0])

        # Pass 2: write all clauses
        for stable_id, clause_type, parent, clause_tags in resolved:
            con.execute("""
                UPDATE clauses SET clause_type = ?, parent = ?, needs_reclassification = 0,
                    classified_hash = paragraph_hash,
                    classified_text = raw_text,
                    updated_at = unixepoch('now', 'subsec')
                WHERE stable_id = ? AND doc_id = ?
            """, (clause_type, parent, stable_id, doc_id))

            con.execute(
                "DELETE FROM tags WHERE clause_id = ? AND doc_id = ? AND user_defined = 0",
                (stable_id, doc_id)
            )
            for topic in clause_tags:
                if isinstance(topic, str):
                    safe = _safe_tag(topic)
                    if safe:
                        con.execute(
                            "INSERT OR IGNORE INTO tags (clause_id, doc_id, value, user_defined) VALUES (?, ?, ?, 0)",
                            (stable_id, doc_id, safe)
                        )

        con.commit()
    finally:
        con.close()

    print(json.dumps({"ok": True, "updated": len(resolved)}))


if __name__ == "__main__":
    main()
