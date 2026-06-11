from __future__ import annotations
import os
import pytest
import sqlite3
from httpx import AsyncClient, ASGITransport
from main import app


def _make_workspace_db(tmp_path) -> str:
    db_dir = tmp_path / ".clause-cowork" / "db"
    db_dir.mkdir(parents=True)
    db_path = str(db_dir / "workspace.db")
    conn = sqlite3.connect(db_path)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS clauses (
            stable_id TEXT NOT NULL, doc_id TEXT NOT NULL, paragraph_hash TEXT,
            position INTEGER, raw_text TEXT, clause_type TEXT, is_table INTEGER DEFAULT 0,
            tombstoned INTEGER DEFAULT 0, section TEXT, needs_reclassification INTEGER DEFAULT 0,
            updated_at REAL,
            PRIMARY KEY (stable_id, doc_id)
        );
        CREATE TABLE IF NOT EXISTS connections (
            id TEXT PRIMARY KEY, source_id TEXT, source_doc_id TEXT NOT NULL DEFAULT '',
            target_id TEXT, target_doc_id TEXT NOT NULL DEFAULT '',
            edge_type TEXT, note TEXT, user_created INTEGER DEFAULT 0, user_rejected INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY, path TEXT,
            last_analysed_at REAL, last_extracted_at REAL, file_mtime REAL,
            doc_type TEXT, doc_tags TEXT DEFAULT '[]', tombstoned INTEGER DEFAULT 0
        );
    """)
    conn.execute("INSERT INTO documents (id, path) VALUES ('docA', '/ws/a.docx')")
    for i in range(3):
        conn.execute("INSERT INTO clauses (stable_id, doc_id, paragraph_hash, position, raw_text, clause_type, updated_at) "
                     "VALUES (?,?,?,?,?,?,?)",
                     (f"docA-{i}", "docA", f"h{i}", i, "text",
                      "Obligation" if i < 2 else None,
                      1780536540.0 if i < 2 else None))
    conn.execute("INSERT INTO connections (id, source_id, source_doc_id, target_id, target_doc_id, edge_type) "
                 "VALUES ('c1', 'docA-0', 'docA', 'docA-1', 'docA', 'references')")
    conn.execute("INSERT INTO documents (id, path) VALUES ('docB', '/ws/b.docx')")
    for i in range(2):
        conn.execute("INSERT INTO clauses (stable_id, doc_id, paragraph_hash, position, raw_text) "
                     "VALUES (?,?,?,?,?)",
                     (f"docB-{i}", "docB", f"hb{i}", i, "text"))
    conn.commit()
    conn.close()
    return str(tmp_path)


@pytest.mark.asyncio
async def test_workspace_returns_documents(tmp_path):
    ws_path = _make_workspace_db(tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/workspace", params={"workspace_path": ws_path})
    assert resp.status_code == 200
    data = resp.json()
    assert data["workspace_path"] == ws_path
    docs = {d["doc_id"]: d for d in data["documents"]}
    assert "docA" in docs
    assert docs["docA"]["clause_count"] == 3
    assert docs["docA"]["classified_count"] == 2
    assert docs["docA"]["connection_count"] == 1
    assert docs["docA"]["name"] == "a.docx"
    assert docs["docA"]["last_analysed_at"] == 1780536540.0
    assert isinstance(docs["docA"]["doc_tags"], list)
    assert "docB" in docs
    assert docs["docB"]["clause_count"] == 2
    assert docs["docB"]["classified_count"] == 0
    assert docs["docB"]["last_analysed_at"] is None


@pytest.mark.asyncio
async def test_workspace_missing_db_returns_empty(tmp_path):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/workspace", params={"workspace_path": str(tmp_path)})
    assert resp.status_code == 200
    assert resp.json()["documents"] == []


@pytest.mark.asyncio
async def test_workspace_missing_param_returns_422():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/workspace")
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_folder_tree_returns_docx_files(tmp_path):
    deal_dir = tmp_path / "Cisco-Splunk Deal"
    deal_dir.mkdir()
    (deal_dir / "merger-agreement.docx").write_bytes(b"fake")
    (deal_dir / "disclosure-schedule.docx").write_bytes(b"fake")
    (deal_dir / "not-a-docx.txt").write_text("ignore me")

    db_dir = tmp_path / ".clause-cowork" / "db"
    db_dir.mkdir(parents=True)
    conn = sqlite3.connect(str(db_dir / "workspace.db"))
    conn.execute("CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, path TEXT, "
                 "last_analysed_at REAL, last_extracted_at REAL, file_mtime REAL, content_hash TEXT, path_hash TEXT, tombstoned INTEGER DEFAULT 0, doc_type TEXT, doc_tags TEXT DEFAULT '[]', notes TEXT DEFAULT '')")
    conn.execute("CREATE TABLE IF NOT EXISTS clauses (stable_id TEXT NOT NULL, doc_id TEXT NOT NULL, "
                 "paragraph_hash TEXT, position INTEGER, raw_text TEXT, clause_type TEXT, is_table INTEGER DEFAULT 0, "
                 "tombstoned INTEGER DEFAULT 0, parent TEXT, needs_reclassification INTEGER DEFAULT 0, updated_at REAL, "
                 "PRIMARY KEY (stable_id, doc_id))")
    conn.execute("INSERT INTO documents (id, path) VALUES ('docA', ?)",
                 (str(deal_dir / "merger-agreement.docx"),))
    conn.execute("INSERT INTO clauses (stable_id, doc_id, paragraph_hash, position, raw_text, clause_type, updated_at) "
                 "VALUES ('n1', 'docA', 'h1', 0, 'text', 'Obligation', 1780536540.0)")
    conn.commit()
    conn.close()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/workspace/folder-tree",
                                params={"workspace_path": str(tmp_path)})

    assert resp.status_code == 200
    tree = resp.json()["tree"]
    assert len(tree) == 1
    folder = tree[0]
    assert folder["name"] == "Cisco-Splunk Deal"
    assert folder["type"] == "folder"

    children = {c["name"]: c for c in folder["children"]}
    assert "merger-agreement.docx" in children
    assert children["merger-agreement.docx"]["status"] == "analysed"
    assert children["merger-agreement.docx"]["doc_id"] == "docA"
    assert "disclosure-schedule.docx" in children
    assert children["disclosure-schedule.docx"]["status"] == "pending"
    assert children["disclosure-schedule.docx"]["doc_id"] is not None  # stub registered by reconciliation
    # .txt is extractable — shown as "pending" until agent runs
    assert "not-a-docx.txt" in children
    assert children["not-a-docx.txt"]["status"] == "pending"
    assert children["not-a-docx.txt"]["doc_id"] is not None  # stub registered by reconciliation


@pytest.mark.asyncio
async def test_folder_tree_docx_includes_file_stat(tmp_path):
    """Parsed and pending .docx entries include file_size and file_mtime; non-docx entries do not."""
    import time
    before = time.time()
    content = b"fake docx content"
    parsed_file = tmp_path / "parsed.docx"
    pending_file = tmp_path / "pending.docx"
    other_file = tmp_path / "readme.txt"
    parsed_file.write_bytes(content)
    pending_file.write_bytes(content)
    other_file.write_text("ignore")

    db_dir = tmp_path / ".clause-cowork" / "db"
    db_dir.mkdir(parents=True)
    conn = sqlite3.connect(str(db_dir / "workspace.db"))
    conn.execute("CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, path TEXT, "
                 "last_analysed_at REAL, last_extracted_at REAL, file_mtime REAL, content_hash TEXT, path_hash TEXT, tombstoned INTEGER DEFAULT 0, doc_type TEXT, doc_tags TEXT DEFAULT '[]', notes TEXT DEFAULT '')")
    conn.execute("INSERT INTO documents (id, path) VALUES ('docA', ?)", (str(parsed_file),))
    conn.commit()
    conn.close()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/workspace/folder-tree", params={"workspace_path": str(tmp_path)})

    assert resp.status_code == 200
    entries = {e["name"]: e for e in resp.json()["tree"]}

    # Both parsed and pending .docx entries carry file_size and file_mtime
    for name in ("parsed.docx", "pending.docx"):
        entry = entries[name]
        assert entry["file_size"] == len(content), f"{name}: wrong file_size"
        assert entry["file_mtime"] is not None, f"{name}: file_mtime missing"
        assert entry["file_mtime"] >= before, f"{name}: file_mtime in the past"

    # .txt is extractable — "pending" until agent runs, carries file stat fields
    assert entries["readme.txt"]["status"] == "pending"
    assert entries["readme.txt"]["file_size"] == len("ignore".encode())
    assert entries["readme.txt"]["file_mtime"] is not None


@pytest.mark.asyncio
async def test_folder_tree_empty_folder(tmp_path):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/workspace/folder-tree",
                                params={"workspace_path": str(tmp_path)})
    assert resp.status_code == 200
    assert resp.json()["tree"] == []


@pytest.mark.asyncio
async def test_folder_tree_nested_subfolder(tmp_path):
    """Files inside nested subfolders are returned at the correct depth."""
    # workspace/
    #   top.docx
    #   sub/
    #     sub.docx
    #     deep/
    #       deep.docx
    (tmp_path / "sub" / "deep").mkdir(parents=True)
    (tmp_path / "top.docx").write_bytes(b"")
    (tmp_path / "sub" / "sub.docx").write_bytes(b"")
    (tmp_path / "sub" / "deep" / "deep.docx").write_bytes(b"")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/workspace/folder-tree",
                                params={"workspace_path": str(tmp_path)})
    assert resp.status_code == 200
    tree = resp.json()["tree"]

    names = {e["name"]: e for e in tree}
    assert "top.docx" in names
    assert "sub" in names

    sub_children = {e["name"]: e for e in names["sub"]["children"]}
    assert "sub.docx" in sub_children
    assert "deep" in sub_children

    deep_children = {e["name"]: e for e in sub_children["deep"]["children"]}
    assert "deep.docx" in deep_children


@pytest.mark.asyncio
async def test_clausecoworkignore_seeds_and_hides_files(tmp_path):
    """AGENTS.md/CLAUDE.md/GEMINI.md are hidden; .clausecoworkignore is seeded on first call."""
    (tmp_path / "contract.docx").write_bytes(b"")
    (tmp_path / "CLAUDE.md").write_bytes(b"")
    (tmp_path / "AGENTS.md").write_bytes(b"")
    (tmp_path / "readme.txt").write_bytes(b"")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/workspace/folder-tree",
                                params={"workspace_path": str(tmp_path)})
    assert resp.status_code == 200
    tree = resp.json()["tree"]
    names = {e["name"] for e in tree}

    assert "contract.docx" in names
    assert "readme.txt" in names
    assert "CLAUDE.md" not in names
    assert "AGENTS.md" not in names
    # .clausecoworkignore itself is hidden (dot-file)
    assert ".clausecoworkignore" not in names
    # Verify the seed file was created
    assert (tmp_path / ".clausecoworkignore").exists()
