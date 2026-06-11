#!/usr/bin/env python3
"""Trigger backend parsing for a document.

Usage: python3 parse_doc.py <doc_path>

Calls POST http://localhost:8765/parse and waits for completion.
Output: JSON {ok: true, doc_id: str, node_count: int} or {error: str}
"""
import json
import os
import sys
import urllib.request
import urllib.error


BACKEND_URL = os.environ.get("CLAUSE_COWORK_URL", "http://localhost:8765")


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: parse_doc.py <doc_path>", file=sys.stderr)
        sys.exit(1)

    doc_path = os.path.abspath(sys.argv[1])
    if not os.path.exists(doc_path):
        print(json.dumps({"error": f"file not found: {doc_path}"}))
        sys.exit(1)

    payload = json.dumps({"doc_path": doc_path}).encode()
    req = urllib.request.Request(
        f"{BACKEND_URL}/parse",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.loads(resp.read().decode())
    except urllib.error.URLError as e:
        print(json.dumps({"error": f"backend unavailable ({e}): is the app running on {BACKEND_URL}?"}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

    node_count = len(body.get("clauses", []))
    doc_id = body.get("doc_id", "")
    print(json.dumps({"ok": True, "doc_id": doc_id, "node_count": node_count}))


if __name__ == "__main__":
    main()
