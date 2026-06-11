"""Tests for skill scripts — run from any directory, use a temp workspace DB."""
from __future__ import annotations
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import aiosqlite
import pytest
import pytest_asyncio

SKILLS_DIR = Path(__file__).parent.parent.parent / "skills"
SHARED_SCRIPTS_DIR = SKILLS_DIR / "shared" / "scripts"
SCHEMA_SQL = Path(__file__).parent.parent / "db" / "schema.sql"

PYTHON = sys.executable


# ── fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture()
def workspace(tmp_path: Path) -> Path:
    """Workspace with a populated workspace.db."""
    db_dir = tmp_path / ".clause-cowork" / "db"
    db_dir.mkdir(parents=True)
    return tmp_path


@pytest_asyncio.fixture()
async def populated_db(workspace: Path) -> Path:
    """workspace.db with one document, two clauses, one tag, one connection, config, tag_pool."""
    db_path = workspace / ".clause-cowork" / "db" / "workspace.db"
    schema = SCHEMA_SQL.read_text()
    async with aiosqlite.connect(str(db_path)) as db:
        await db.executescript(schema)
        await db.execute(
            "INSERT INTO documents (id, path, last_analysed_at) VALUES (?,?,?)",
            ("doc1", str(workspace / "test.docx"), 1780000000.0),
        )
        await db.execute(
            """INSERT INTO clauses (stable_id, doc_id, paragraph_hash, position, raw_text, clause_type, parent, needs_reclassification)
               VALUES (?,?,?,?,?,?,?,?)""",
            ("node_sec", "doc1", "hash0", 0, "4. Payment", "Section Title", None, 0),
        )
        await db.execute(
            """INSERT INTO clauses (stable_id, doc_id, paragraph_hash, position, raw_text, clause_type, parent, needs_reclassification)
               VALUES (?,?,?,?,?,?,?,?)""",
            ("node_aaa", "doc1", "hash1", 1, "Party A shall pay...", "Obligation", "4. Payment", 0),
        )
        await db.execute(
            """INSERT INTO clauses (stable_id, doc_id, paragraph_hash, position, raw_text, clause_type, parent, needs_reclassification)
               VALUES (?,?,?,?,?,?,?,?)""",
            ("node_bbb", "doc1", "hash2", 2, "In the event of breach...", None, None, 0),
        )
        await db.execute(
            "INSERT INTO tags (clause_id, doc_id, value, user_defined) VALUES (?,?,?,0)",
            ("node_aaa", "doc1", "payment"),
        )
        await db.execute(
            """INSERT INTO connections (id, source_id, source_doc_id, target_id, target_doc_id, edge_type, user_created)
               VALUES (?,?,?,?,?,?,0)""",
            ("conn1", "node_aaa", "doc1", "node_bbb", "doc1", "references"),
        )
        await db.execute(
            "INSERT INTO config (key, value) VALUES (?,?)",
            ("workspace", json.dumps({
                "connection_threshold_prompt": "Record clear legal relationships.",
            })),
        )
        for clause_type in ("Obligation", "Definition"):
            await db.execute(
                "INSERT OR IGNORE INTO tag_pool (tag, description, source, created_at, kind) VALUES (?,?,?,?,?)",
                (clause_type, clause_type, "default", "2026-01-01T00:00:00Z", "clause_type"),
            )
        await db.execute(
            "INSERT INTO tag_pool (tag, description, source, created_at) VALUES (?,?,?,?)",
            ("payment", "Payment-related clauses", "manual", "2026-01-01T00:00:00Z"),
        )
        await db.commit()
    return db_path


def _parse_output(stdout: str) -> dict | list:
    """Parse script output: pure JSON first, then JSON inside XML tags, else raw."""
    try:
        return json.loads(stdout)
    except Exception:
        pass
    import re
    m = re.search(r"<[^/][^>]*>\s*(\[.*?\]|\{.*?\})\s*</[^>]+>", stdout, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    return {"raw": stdout}


def run_shared_script(script: str, args: list[str], cwd: str) -> tuple[int, dict | list]:
    result = subprocess.run(
        [PYTHON, str(SHARED_SCRIPTS_DIR / script)] + args,
        capture_output=True, text=True, cwd=cwd,
    )
    return result.returncode, _parse_output(result.stdout)


def run_shared_script_raw(script: str, args: list[str], cwd: str) -> tuple[int, str]:
    result = subprocess.run(
        [PYTHON, str(SHARED_SCRIPTS_DIR / script)] + args,
        capture_output=True, text=True, cwd=cwd,
    )
    return result.returncode, result.stdout


# ── get_docs ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_docs_returns_document(populated_db: Path, workspace: Path):
    rc, data = run_shared_script("get_docs.py", [], str(workspace))
    assert rc == 0
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["doc_id"] == "doc1"
    assert data[0]["node_count"] == 3
    assert data[0]["connection_count"] == 1


@pytest.mark.asyncio
async def test_get_docs_no_db(tmp_path: Path):
    rc, data = run_shared_script("get_docs.py", [], str(tmp_path))
    assert rc == 1
    assert "error" in data


# ── get_clauses ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_clauses_all(populated_db: Path, workspace: Path):
    rc, data = run_shared_script("get_clauses.py", ["doc1"], str(workspace))
    assert rc == 0
    assert data["total"] == 3
    ids = {n["stable_id"] for n in data["clauses"]}
    assert "node_sec" in ids and "node_aaa" in ids and "node_bbb" in ids


@pytest.mark.asyncio
async def test_get_clauses_unclassified(populated_db: Path, workspace: Path):
    rc, data = run_shared_script("get_clauses.py", ["doc1", "--unclassified"], str(workspace))
    assert rc == 0
    assert data["total"] == 1
    assert data["clauses"][0]["stable_id"] == "node_bbb"


@pytest.mark.asyncio
async def test_get_clauses_limit_offset(populated_db: Path, workspace: Path):
    rc, data = run_shared_script("get_clauses.py", ["doc1", "--limit", "1", "--offset", "0"], str(workspace))
    assert rc == 0
    assert data["total"] == 3
    assert len(data["clauses"]) == 1


@pytest.mark.asyncio
async def test_get_clauses_tags_included(populated_db: Path, workspace: Path):
    rc, data = run_shared_script("get_clauses.py", ["doc1"], str(workspace))
    assert rc == 0
    node = next(n for n in data["clauses"] if n["stable_id"] == "node_aaa")
    assert "payment" in node["clause_tags"]


# ── get_workspace_config ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_workspace_config_clause(populated_db: Path, workspace: Path):
    rc, stdout = run_shared_script_raw("get_workspace_config.py", ["--level", "clause"], str(workspace))
    assert rc == 0
    import re as _re
    m = _re.search(r"<clause_types>(.*?)</clause_types>", stdout, _re.DOTALL)
    assert m, "clause_types block not found"
    clause_types = json.loads(m.group(1))
    assert isinstance(clause_types, list)
    assert any(t["name"] == "Obligation" for t in clause_types)
    assert "<connection_guidance>" in stdout
    assert "re_enrich_threshold:" in stdout


@pytest.mark.asyncio
async def test_get_workspace_config_clause_tags(populated_db: Path, workspace: Path):
    rc, stdout = run_shared_script_raw("get_workspace_config.py", ["--level", "clause"], str(workspace))
    assert rc == 0
    import re as _re
    m = _re.search(r"<clause_tags>(.*?)</clause_tags>", stdout, _re.DOTALL)
    assert m, "clause_tags block not found"
    clause_tags = json.loads(m.group(1))
    assert isinstance(clause_tags, list)
    assert any(t["tag"] == "payment" for t in clause_tags)


@pytest.mark.asyncio
async def test_get_workspace_config_doc(populated_db: Path, workspace: Path):
    rc, stdout = run_shared_script_raw("get_workspace_config.py", ["--level", "doc"], str(workspace))
    assert rc == 0
    import re as _re
    m = _re.search(r"<doc_types>(.*?)</doc_types>", stdout, _re.DOTALL)
    assert m, "doc_types block not found"
    doc_types = json.loads(m.group(1))
    assert isinstance(doc_types, list)
    m2 = _re.search(r"<doc_tags>(.*?)</doc_tags>", stdout, _re.DOTALL)
    assert m2, "doc_tags block not found"


@pytest.mark.asyncio
async def test_get_workspace_config_missing_level(workspace: Path):
    db_path = workspace / ".clause-cowork" / "db" / "workspace.db"
    schema = SCHEMA_SQL.read_text()
    async with aiosqlite.connect(str(db_path)) as db:
        await db.executescript(schema)
        await db.commit()
    result = subprocess.run(
        [PYTHON, str(SHARED_SCRIPTS_DIR / "get_workspace_config.py")],
        capture_output=True, text=True, cwd=str(workspace),
    )
    assert result.returncode == 1


# ── set_clause_classification ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_set_clause_classification_batch(populated_db: Path, workspace: Path):
    clauses = json.dumps([
        {"stable_id": "node_sec", "clause_type": "Section Title", "clause_tags": [], "parent": None},
        {"stable_id": "node_bbb", "clause_type": "Definition", "clause_tags": ["breach"], "parent": "4. Payment"},
    ])
    rc, data = run_shared_script("set_clause_classification.py", ["doc1", clauses], str(workspace))
    assert rc == 0
    assert data["ok"] is True
    assert data["updated"] == 2

    async with aiosqlite.connect(str(populated_db)) as db:
        row = await (await db.execute(
            "SELECT clause_type, parent FROM clauses WHERE stable_id = ?", ("node_bbb",)
        )).fetchone()
        assert row[0] == "Definition"
        assert row[1] == "4. Payment"
        tags = await (await db.execute(
            "SELECT value FROM tags WHERE clause_id = ? AND doc_id = ?", ("node_bbb", "doc1")
        )).fetchall()
        assert any(t[0] == "breach" for t in tags)


@pytest.mark.asyncio
async def test_set_clause_classification_prefix_match(populated_db: Path, workspace: Path):
    clauses = json.dumps([{"stable_id": "node_aa", "clause_type": "Obligation", "clause_tags": [], "parent": "4. Payment"}])
    rc, data = run_shared_script("set_clause_classification.py", ["doc1", clauses], str(workspace))
    assert rc == 0
    assert data["ok"] is True
    assert data["updated"] == 1


@pytest.mark.asyncio
async def test_set_clause_classification_not_found(populated_db: Path, workspace: Path):
    clauses = json.dumps([{"stable_id": "zzz99999", "clause_type": "Obligation", "clause_tags": [], "parent": None}])
    rc, data = run_shared_script("set_clause_classification.py", ["doc1", clauses], str(workspace))
    assert rc == 1
    assert "error" in data


@pytest.mark.asyncio
async def test_set_clause_classification_invalid_parent_rejected(populated_db: Path, workspace: Path):
    clauses = json.dumps([{"stable_id": "node_bbb", "clause_type": "Obligation", "clause_tags": [], "parent": "Nonexistent Section"}])
    rc, data = run_shared_script("set_clause_classification.py", ["doc1", clauses], str(workspace))
    assert rc == 1
    assert "error" in data


@pytest.mark.asyncio
async def test_set_clause_classification_batch_atomic_on_error(populated_db: Path, workspace: Path):
    clauses = json.dumps([
        {"stable_id": "node_aaa", "clause_type": "Obligation", "clause_tags": [], "parent": "4. Payment"},
        {"stable_id": "node_bbb", "clause_type": "Obligation", "clause_tags": [], "parent": "Nonexistent Section"},
    ])
    rc, data = run_shared_script("set_clause_classification.py", ["doc1", clauses], str(workspace))
    assert rc == 1
    assert "error" in data

    async with aiosqlite.connect(str(populated_db)) as db:
        row = await (await db.execute(
            "SELECT clause_type FROM clauses WHERE stable_id = ?", ("node_aaa",)
        )).fetchone()
        assert row[0] == "Obligation"  # unchanged from fixture


@pytest.mark.asyncio
async def test_set_clause_classification_strict_clause_tags_rejects_unknown(workspace: Path):
    """strict_clause_tags=True — clause_tags not in pool are rejected."""
    db_path = workspace / ".clause-cowork" / "db" / "workspace.db"
    schema = SCHEMA_SQL.read_text()
    async with aiosqlite.connect(str(db_path)) as db:
        await db.executescript(schema)
        await db.execute("INSERT INTO documents (id, path) VALUES (?,?)", ("doc1", str(workspace / "test.docx")))
        await db.execute(
            "INSERT INTO clauses (stable_id, doc_id, paragraph_hash, position, raw_text, needs_reclassification) VALUES (?,?,?,?,?,0)",
            ("node_aaa", "doc1", "hash1", 0, "Party A shall pay...",),
        )
        await db.execute(
            "INSERT INTO config (key, value) VALUES (?,?)",
            ("workspace", json.dumps({"strict_clause_tags": True})),
        )
        await db.execute(
            "INSERT OR IGNORE INTO tag_pool (tag, description, source, created_at, kind) VALUES (?,?,?,?,?)",
            ("Obligation", "Obligation", "default", "2026-01-01T00:00:00Z", "clause_type"),
        )
        await db.execute(
            "INSERT INTO tag_pool (tag, description, source, created_at, kind) VALUES (?,?,?,?,?)",
            ("payment", "Payment clauses", "manual", "2026-01-01T00:00:00Z", "clause_tag"),
        )
        await db.commit()
    clauses = json.dumps([{"stable_id": "node_aaa", "clause_type": "Obligation", "clause_tags": ["payment", "unknown-tag"], "parent": None}])
    rc, data = run_shared_script("set_clause_classification.py", ["doc1", clauses], str(workspace))
    assert rc == 1
    assert "error" in data
    assert "unknown-tag" in data["error"]


@pytest.mark.asyncio
async def test_set_clause_classification_strict_clause_tags_allows_pool_tags(workspace: Path):
    """strict_clause_tags=True — clause_tags all in pool are accepted."""
    db_path = workspace / ".clause-cowork" / "db" / "workspace.db"
    schema = SCHEMA_SQL.read_text()
    async with aiosqlite.connect(str(db_path)) as db:
        await db.executescript(schema)
        await db.execute("INSERT INTO documents (id, path) VALUES (?,?)", ("doc1", str(workspace / "test.docx")))
        await db.execute(
            "INSERT INTO clauses (stable_id, doc_id, paragraph_hash, position, raw_text, needs_reclassification) VALUES (?,?,?,?,?,0)",
            ("node_aaa", "doc1", "hash1", 0, "Party A shall pay...",),
        )
        await db.execute(
            "INSERT INTO config (key, value) VALUES (?,?)",
            ("workspace", json.dumps({"strict_clause_tags": True})),
        )
        await db.execute(
            "INSERT OR IGNORE INTO tag_pool (tag, description, source, created_at, kind) VALUES (?,?,?,?,?)",
            ("Obligation", "Obligation", "default", "2026-01-01T00:00:00Z", "clause_type"),
        )
        await db.execute(
            "INSERT INTO tag_pool (tag, description, source, created_at, kind) VALUES (?,?,?,?,?)",
            ("payment", "Payment clauses", "manual", "2026-01-01T00:00:00Z", "clause_tag"),
        )
        await db.commit()
    clauses = json.dumps([{"stable_id": "node_aaa", "clause_type": "Obligation", "clause_tags": ["payment"], "parent": None}])
    rc, data = run_shared_script("set_clause_classification.py", ["doc1", clauses], str(workspace))
    assert rc == 0
    assert data["ok"] is True


# ── set_clause_connection ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_set_clause_connection(populated_db: Path, workspace: Path):
    rc, data = run_shared_script(
        "set_clause_connection.py",
        ["node_aaa", "node_bbb", "subject_to"],
        str(workspace),
    )
    assert rc == 0
    assert data["ok"] is True

    async with aiosqlite.connect(str(populated_db)) as db:
        row = await (await db.execute(
            "SELECT edge_type FROM connections WHERE id = ?", (data["id"],)
        )).fetchone()
        assert row[0] == "subject_to"


@pytest.mark.asyncio
async def test_set_clause_connection_other_invalid(populated_db: Path, workspace: Path):
    rc, data = run_shared_script(
        "set_clause_connection.py",
        ["node_aaa", "node_bbb", "other"],
        str(workspace),
    )
    assert rc == 1
    assert "error" in data


@pytest.mark.asyncio
async def test_set_clause_connection_invalid_edge_type(populated_db: Path, workspace: Path):
    rc, data = run_shared_script(
        "set_clause_connection.py",
        ["node_aaa", "node_bbb", "depends_on"],
        str(workspace),
    )
    assert rc == 1
    assert "error" in data


# ── add_to_pool ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_add_to_pool_new_entry(populated_db: Path, workspace: Path):
    rc, data = run_shared_script(
        "add_to_pool.py",
        ["auto-renewal", "Clauses that auto-renew a term", "--kind", "clause_tag"],
        str(workspace),
    )
    assert rc == 0
    assert data["ok"] is True
    assert data["name"] == "auto-renewal"

    async with aiosqlite.connect(str(populated_db)) as db:
        row = await (await db.execute(
            "SELECT description, kind FROM tag_pool WHERE tag = ?", ("auto-renewal",)
        )).fetchone()
        assert row is not None
        assert row[1] == "clause_tag"


@pytest.mark.asyncio
async def test_add_to_pool_updates_existing(populated_db: Path, workspace: Path):
    rc, data = run_shared_script(
        "add_to_pool.py",
        ["payment", "Updated payment description", "--kind", "clause_tag"],
        str(workspace),
    )
    assert rc == 0
    async with aiosqlite.connect(str(populated_db)) as db:
        row = await (await db.execute(
            "SELECT description FROM tag_pool WHERE tag = ?", ("payment",)
        )).fetchone()
        assert row[0] == "Updated payment description"


@pytest.mark.asyncio
async def test_add_to_pool_invalid_kind(populated_db: Path, workspace: Path):
    rc, data = run_shared_script(
        "add_to_pool.py",
        ["some-tag", "Some description", "--kind", "doc"],
        str(workspace),
    )
    assert rc == 1
    assert "error" in data


@pytest.mark.asyncio
async def test_add_to_pool_pool_limit_enforced(workspace: Path):
    """Adding beyond 100 entries per kind returns an error."""
    db_path = workspace / ".clause-cowork" / "db" / "workspace.db"
    schema = SCHEMA_SQL.read_text()
    async with aiosqlite.connect(str(db_path)) as db:
        await db.executescript(schema)
        for i in range(100):
            await db.execute(
                "INSERT INTO tag_pool (tag, description, source, created_at, kind) VALUES (?,?,?,?,?)",
                (f"tag-{i}", "desc", "manual", "2026-01-01T00:00:00Z", "clause_tag"),
            )
        await db.commit()
    rc, data = run_shared_script(
        "add_to_pool.py",
        ["overflow-tag", "One too many", "--kind", "clause_tag"],
        str(workspace),
    )
    assert rc == 1
    assert "error" in data
    assert "full" in data["error"]


@pytest.mark.asyncio
async def test_add_to_pool_doc_type_kind(populated_db: Path, workspace: Path):
    rc, data = run_shared_script(
        "add_to_pool.py",
        ["Joint Venture", "Joint venture agreements", "--kind", "doc_type"],
        str(workspace),
    )
    assert rc == 0
    assert data["ok"] is True
    async with aiosqlite.connect(str(populated_db)) as db:
        row = await (await db.execute(
            "SELECT kind FROM tag_pool WHERE tag = ?", ("Joint Venture",)
        )).fetchone()
        assert row[0] == "doc_type"


# ── set_doc_classification ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_set_doc_classification_registers_new_doc(workspace: Path):
    doc_path = str(workspace / "new-contract.docx")
    db_path = workspace / ".clause-cowork" / "db" / "workspace.db"
    schema = SCHEMA_SQL.read_text()
    async with aiosqlite.connect(str(db_path)) as db:
        await db.executescript(schema)
        await db.commit()

    payload = json.dumps({"doc_type": None, "doc_tags": []})
    rc, data = run_shared_script(
        "set_doc_classification.py",
        [doc_path, payload],
        str(workspace),
    )
    assert rc == 0
    assert data["ok"] is True

    async with aiosqlite.connect(str(db_path)) as db:
        row = await (await db.execute(
            "SELECT id FROM documents WHERE id = ?", (data["doc_id"],)
        )).fetchone()
        assert row is not None


@pytest.mark.asyncio
async def test_set_doc_classification_sets_doc_type_and_tags(workspace: Path):
    db_path = workspace / ".clause-cowork" / "db" / "workspace.db"
    schema = SCHEMA_SQL.read_text()
    async with aiosqlite.connect(str(db_path)) as db:
        await db.executescript(schema)
        await db.execute(
            "INSERT INTO tag_pool (tag, description, source, created_at, kind) VALUES (?,?,?,?,?)",
            ("Employment", "Employment contracts", "default", "2026-01-01T00:00:00Z", "doc_type"),
        )
        await db.execute(
            "INSERT INTO config (key, value) VALUES (?,?)",
            ("workspace", json.dumps({"strict_doc_types": False})),
        )
        await db.commit()

    doc_path = str(workspace / "contract.docx")
    payload = json.dumps({"doc_type": "Employment", "doc_tags": ["Executed"]})
    rc, data = run_shared_script(
        "set_doc_classification.py",
        [doc_path, payload],
        str(workspace),
    )
    assert rc == 0
    assert data["ok"] is True

    async with aiosqlite.connect(str(db_path)) as db:
        row = await (await db.execute(
            "SELECT doc_type, doc_tags FROM documents WHERE id = ?", (data["doc_id"],)
        )).fetchone()
        assert row[0] == "Employment"
        assert json.loads(row[1]) == ["Executed"]


@pytest.mark.asyncio
async def test_set_doc_classification_strict_doc_type_rejects_unknown(workspace: Path):
    """strict_doc_types=True (default) — unknown type rejected with error."""
    db_path = workspace / ".clause-cowork" / "db" / "workspace.db"
    schema = SCHEMA_SQL.read_text()
    async with aiosqlite.connect(str(db_path)) as db:
        await db.executescript(schema)
        await db.execute(
            "INSERT INTO tag_pool (tag, description, source, created_at, kind) VALUES (?,?,?,?,?)",
            ("Employment", "Employment contracts", "default", "2026-01-01T00:00:00Z", "doc_type"),
        )
        await db.commit()

    doc_path = str(workspace / "contract.docx")
    payload = json.dumps({"doc_type": "Unknown Type", "doc_tags": []})
    rc, data = run_shared_script(
        "set_doc_classification.py",
        [doc_path, payload],
        str(workspace),
    )
    assert rc == 1
    assert "error" in data


@pytest.mark.asyncio
async def test_set_doc_classification_strict_doc_tags_rejects_unknown(workspace: Path):
    """strict_doc_tags=True — unknown doc_tags rejected with error."""
    db_path = workspace / ".clause-cowork" / "db" / "workspace.db"
    schema = SCHEMA_SQL.read_text()
    async with aiosqlite.connect(str(db_path)) as db:
        await db.executescript(schema)
        await db.execute(
            "INSERT INTO tag_pool (tag, description, source, created_at, kind) VALUES (?,?,?,?,?)",
            ("Executed", "Executed contracts", "default", "2026-01-01T00:00:00Z", "doc_tag"),
        )
        await db.execute(
            "INSERT INTO config (key, value) VALUES (?,?)",
            ("workspace", json.dumps({"strict_doc_types": False, "strict_doc_tags": True})),
        )
        await db.commit()

    doc_path = str(workspace / "contract.docx")
    payload = json.dumps({"doc_type": None, "doc_tags": ["Executed", "Unknown Tag"]})
    rc, data = run_shared_script(
        "set_doc_classification.py",
        [doc_path, payload],
        str(workspace),
    )
    assert rc == 1
    assert "error" in data


@pytest.mark.asyncio
async def test_set_doc_classification_invalid_json(workspace: Path):
    doc_path = str(workspace / "test.docx")
    db_path = workspace / ".clause-cowork" / "db" / "workspace.db"
    schema = SCHEMA_SQL.read_text()
    async with aiosqlite.connect(str(db_path)) as db:
        await db.executescript(schema)
        await db.commit()

    rc, data = run_shared_script(
        "set_doc_classification.py",
        [doc_path, "not-json"],
        str(workspace),
    )
    assert rc == 1
    assert "error" in data


# ── set_document_link ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_set_document_link_creates_link(workspace: Path):
    db_path = workspace / ".clause-cowork" / "db" / "workspace.db"
    schema = SCHEMA_SQL.read_text()
    async with aiosqlite.connect(str(db_path)) as db:
        await db.executescript(schema)
        await db.commit()

    source = str(workspace / "contract-a.docx")
    target = str(workspace / "contract-b.docx")
    rc, data = run_shared_script(
        "set_document_link.py",
        [source, target, "references", "Exhibit A refers to contract-b"],
        str(workspace),
    )
    assert rc == 0
    assert data["ok"] is True

    async with aiosqlite.connect(str(db_path)) as db:
        row = await (await db.execute(
            "SELECT relationship, note FROM document_links WHERE id = ?", (data["id"],)
        )).fetchone()
        assert row[0] == "references"
        assert row[1] == "Exhibit A refers to contract-b"


@pytest.mark.asyncio
async def test_set_document_link_registers_stubs(workspace: Path):
    db_path = workspace / ".clause-cowork" / "db" / "workspace.db"
    schema = SCHEMA_SQL.read_text()
    async with aiosqlite.connect(str(db_path)) as db:
        await db.executescript(schema)
        await db.commit()

    source = str(workspace / "a.docx")
    target = str(workspace / "b.docx")
    rc, data = run_shared_script(
        "set_document_link.py",
        [source, target, "subject_to"],
        str(workspace),
    )
    assert rc == 0

    async with aiosqlite.connect(str(db_path)) as db:
        docs = await (await db.execute("SELECT COUNT(*) FROM documents")).fetchone()
        assert docs[0] == 2


@pytest.mark.asyncio
async def test_set_document_link_invalid_relationship(workspace: Path):
    db_path = workspace / ".clause-cowork" / "db" / "workspace.db"
    schema = SCHEMA_SQL.read_text()
    async with aiosqlite.connect(str(db_path)) as db:
        await db.executescript(schema)
        await db.commit()

    rc, data = run_shared_script(
        "set_document_link.py",
        [str(workspace / "a.docx"), str(workspace / "b.docx"), "depends_on"],
        str(workspace),
    )
    assert rc == 1
    assert "error" in data


# ── tag_pool CSV import ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_import_csv_clause_kind(populated_db: Path, workspace: Path):
    valid_csv = "tag,description\nnew-tag,A new clause tag\nanother-tag,Another one\n"
    from services.tag_pool import TagPool
    pool = TagPool(str(populated_db))
    result = pool.import_csv(valid_csv, source="import", kind="clause_tag")
    assert result["imported"] == 2
    assert result["errors"] == []
    tags = {t.tag for t in pool.list(kind="clause_tag")}
    assert "new-tag" in tags
    assert "another-tag" in tags


@pytest.mark.asyncio
async def test_import_csv_doc_kind(populated_db: Path, workspace: Path):
    valid_csv = "tag,description\nEmployment,Employment contracts\nM&A,Mergers and acquisitions\n"
    from services.tag_pool import TagPool
    pool = TagPool(str(populated_db))
    result = pool.import_csv(valid_csv, source="import", kind="doc_type")
    assert result["imported"] == 2
    assert result["errors"] == []
    tags = {t.tag for t in pool.list(kind="doc_type")}
    assert "Employment" in tags
    assert "M&A" in tags


@pytest.mark.asyncio
async def test_import_csv_bad_headers(populated_db: Path, workspace: Path):
    bad_csv = "name,desc\nfoo,bar\n"
    from services.tag_pool import TagPool, TagPoolError
    pool = TagPool(str(populated_db))
    try:
        pool.import_csv(bad_csv, source="import")
        assert False, "Should have raised"
    except TagPoolError as e:
        assert "tag" in str(e).lower()


@pytest.mark.asyncio
async def test_import_csv_empty_tag_name(populated_db: Path, workspace: Path):
    csv = "tag,description\n,Missing tag name\nvalid-tag,Valid\n"
    from services.tag_pool import TagPool, TagPoolError
    pool = TagPool(str(populated_db))
    with pytest.raises(TagPoolError):
        pool.import_csv(csv, source="import")


# ── get_docs includes doc_tags ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_docs_includes_doc_tags(populated_db: Path, workspace: Path):
    rc, data = run_shared_script("get_docs.py", [], str(workspace))
    assert rc == 0
    assert isinstance(data, list)
    assert "doc_tags" in data[0]


# ── deploy.py ────────────────────────────────────────────────────────────────

import importlib.util as _ilu

def _load_deploy():
    spec = _ilu.spec_from_file_location("deploy", SKILLS_DIR / "deploy.py")
    mod = _ilu.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_deploy_substitutes_skills_root(tmp_path: Path):
    deploy = _load_deploy()
    deploy.deploy(str(tmp_path), "claude")
    skill_md = (tmp_path / ".claude" / "skills" / "analyse" / "SKILL.md").read_text()
    assert "{{SKILLS_ROOT}}" not in skill_md
    assert ".claude/skills/" in skill_md


def test_deploy_kiro_uses_kiro_root(tmp_path: Path):
    deploy = _load_deploy()
    deploy.deploy(str(tmp_path), "kiro")
    skill_md = (tmp_path / ".kiro" / "skills" / "analyse" / "SKILL.md").read_text()
    assert ".kiro/skills/" in skill_md
    assert ".claude" not in skill_md


def test_deploy_unknown_agent_falls_back_to_agents(tmp_path: Path):
    deploy = _load_deploy()
    deploy.deploy(str(tmp_path), "someunknownagent")
    assert (tmp_path / ".agents" / "skills" / "analyse" / "SKILL.md").exists()


def test_deploy_scripts_present(tmp_path: Path):
    deploy = _load_deploy()
    deploy.deploy(str(tmp_path), "claude")
    scripts = list((tmp_path / ".claude" / "skills" / "analyse" / "scripts").iterdir())
    names = {f.name for f in scripts}
    assert "set_clause_classification.py" in names
    assert "get_clauses.py" in names
    assert "get_workspace_config.py" in names
    assert "set_doc_classification.py" in names
    assert "add_to_pool.py" in names
    assert "set_clause_connection.py" in names
    assert "set_document_link.py" in names
    assert "get_docs.py" in names  # shared script


def test_deploy_index_skill_md_substituted(tmp_path: Path):
    deploy = _load_deploy()
    deploy.deploy(str(tmp_path), "gemini")
    skill_md = (tmp_path / ".gemini" / "skills" / "index" / "SKILL.md").read_text()
    assert "{{SKILLS_ROOT}}" not in skill_md
    assert ".gemini/skills/" in skill_md
