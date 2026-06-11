"""Integration tests for /document-meta endpoints (metadata, tags, notes, document links)."""
from __future__ import annotations
import json
import sqlite3
import pytest
from httpx import AsyncClient, ASGITransport
from main import app


def _make_db(tmp_path) -> tuple[str, str]:
    """Create a minimal workspace with two documents. Returns (workspace_path, db_path)."""
    ws = str(tmp_path)
    db_dir = tmp_path / ".clause-cowork" / "db"
    db_dir.mkdir(parents=True)
    db_path = str(db_dir / "workspace.db")

    conn = sqlite3.connect(db_path)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY, path TEXT UNIQUE,
            last_analysed_at REAL, last_extracted_at REAL, file_mtime REAL,
            doc_type TEXT, doc_tags TEXT DEFAULT '[]', notes TEXT DEFAULT '',
            content_hash TEXT, path_hash TEXT, tombstoned INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS document_links (
            id TEXT PRIMARY KEY,
            source_doc_id TEXT NOT NULL, target_doc_id TEXT NOT NULL,
            relationship TEXT NOT NULL DEFAULT 'references',
            note TEXT, created_by TEXT NOT NULL DEFAULT 'agent', created_at TEXT NOT NULL,
            broken_at TEXT
        );
        CREATE TABLE IF NOT EXISTS clauses (
            stable_id TEXT NOT NULL, doc_id TEXT NOT NULL, paragraph_hash TEXT NOT NULL,
            position INTEGER NOT NULL, raw_text TEXT NOT NULL, clause_type TEXT,
            is_table INTEGER DEFAULT 0, tombstoned INTEGER DEFAULT 0,
            parent TEXT, needs_reclassification INTEGER DEFAULT 0,
            PRIMARY KEY (stable_id, doc_id)
        );
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clause_id TEXT NOT NULL, doc_id TEXT NOT NULL DEFAULT '', value TEXT NOT NULL,
            user_defined INTEGER DEFAULT 0,
            UNIQUE(clause_id, doc_id, value)
        );
    """)
    conn.execute(
        "INSERT INTO documents (id, path, last_analysed_at, doc_tags, notes) VALUES (?,?,?,?,?)",
        ("docA", str(tmp_path / "a.docx"), 1748736000.0, '["NDA / Confidentiality"]', "Initial notes."),
    )
    conn.execute(
        "INSERT INTO documents (id, path, last_analysed_at) VALUES (?,?,?)",
        ("docB", str(tmp_path / "b.docx"), 1748822400.0),
    )
    conn.commit()
    conn.close()
    return ws, db_path


@pytest.mark.asyncio
async def test_get_document_meta_returns_fields(tmp_path):
    ws, _ = _make_db(tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/document-meta", params={"workspace_path": ws, "doc_id": "docA"})
    assert r.status_code == 200
    data = r.json()
    assert data["doc_id"] == "docA"
    assert data["extension"] == "docx"
    assert data["doc_type"] is None  # not set in fixture
    assert data["doc_tags"] == ["NDA / Confidentiality"]
    assert data["notes"] == "Initial notes."
    assert "default_tag_vocabulary" in data
    assert len(data["default_tag_vocabulary"]) > 0


@pytest.mark.asyncio
async def test_get_document_meta_not_found(tmp_path):
    ws, _ = _make_db(tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/document-meta", params={"workspace_path": ws, "doc_id": "nonexistent"})
    assert r.status_code == 200  # graceful response — Info tab works for unparsed/unknown docs


@pytest.mark.asyncio
async def test_patch_doc_tags(tmp_path):
    ws, db_path = _make_db(tmp_path)
    new_tags = ["Employment", "M&A"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.patch(
            "/document-meta",
            params={"workspace_path": ws, "doc_id": "docA"},
            json={"doc_tags": new_tags},
        )
    assert r.status_code == 200

    conn = sqlite3.connect(db_path)
    row = conn.execute("SELECT doc_tags FROM documents WHERE id='docA'").fetchone()
    conn.close()
    assert json.loads(row[0]) == new_tags


@pytest.mark.asyncio
async def test_patch_notes(tmp_path):
    ws, db_path = _make_db(tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.patch(
            "/document-meta",
            params={"workspace_path": ws, "doc_id": "docA"},
            json={"notes": "Updated notes."},
        )
    assert r.status_code == 200

    conn = sqlite3.connect(db_path)
    row = conn.execute("SELECT notes FROM documents WHERE id='docA'").fetchone()
    conn.close()
    assert row[0] == "Updated notes."


@pytest.mark.asyncio
async def test_patch_unknown_doc_returns_404(tmp_path):
    ws, _ = _make_db(tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.patch(
            "/document-meta",
            params={"workspace_path": ws, "doc_id": "ghost"},
            json={"notes": "x"},
        )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_create_and_list_document_link(tmp_path):
    ws, _ = _make_db(tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Create link
        r = await client.post(
            "/document-meta/links",
            params={"workspace_path": ws},
            json={"source_doc_id": "docA", "target_doc_id": "docB", "relationship": "references"},
        )
        assert r.status_code == 200
        link_id = r.json()["id"]

        # List from docA perspective
        r = await client.get("/document-meta/links", params={"workspace_path": ws, "doc_id": "docA"})
        assert r.status_code == 200
        links = r.json()["links"]
        assert len(links) == 1
        assert links[0]["id"] == link_id
        assert links[0]["other_doc_id"] == "docB"
        assert links[0]["direction"] == "outbound"

        # Also visible from docB perspective as inbound
        r = await client.get("/document-meta/links", params={"workspace_path": ws, "doc_id": "docB"})
        links_b = r.json()["links"]
        assert len(links_b) == 1
        assert links_b[0]["direction"] == "inbound"
        assert links_b[0]["other_doc_id"] == "docA"


@pytest.mark.asyncio
async def test_delete_document_link(tmp_path):
    ws, _ = _make_db(tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Create then delete
        r = await client.post(
            "/document-meta/links",
            params={"workspace_path": ws},
            json={"source_doc_id": "docA", "target_doc_id": "docB"},
        )
        link_id = r.json()["id"]

        r = await client.delete(f"/document-meta/links/{link_id}", params={"workspace_path": ws})
        assert r.status_code == 200

        # Confirm gone
        r = await client.get("/document-meta/links", params={"workspace_path": ws, "doc_id": "docA"})
        assert r.json()["links"] == []


@pytest.mark.asyncio
async def test_create_link_unknown_doc_returns_404(tmp_path):
    ws, _ = _make_db(tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post(
            "/document-meta/links",
            params={"workspace_path": ws},
            json={"source_doc_id": "docA", "target_doc_id": "ghost"},
        )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_create_link_registers_stub_for_unregistered_file(tmp_path):
    """Linking a file not yet in documents table auto-registers a stub row."""
    ws, db_path = _make_db(tmp_path)
    fake_path = str(tmp_path / "unregistered.pdf")
    stub_id = "stub-unregistered"

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.post(
            "/document-meta/links",
            params={"workspace_path": ws},
            json={
                "source_doc_id": "docA",
                "target_doc_id": stub_id,
                "target_file_path": fake_path,
            },
        )
    assert r.status_code == 200

    conn = sqlite3.connect(db_path)
    stub = conn.execute("SELECT id, path FROM documents WHERE id=?", (stub_id,)).fetchone()
    conn.close()
    assert stub is not None
    assert stub[1] == fake_path


@pytest.mark.asyncio
async def test_patch_doc_type(tmp_path):
    ws, db_path = _make_db(tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.patch(
            "/document-meta",
            params={"workspace_path": ws, "doc_id": "docA"},
            json={"doc_type": "Employment"},
        )
    assert r.status_code == 200

    conn = sqlite3.connect(db_path)
    row = conn.execute("SELECT doc_type FROM documents WHERE id='docA'").fetchone()
    conn.close()
    assert row[0] == "Employment"


@pytest.mark.asyncio
async def test_patch_doc_type_and_tags_independently(tmp_path):
    ws, db_path = _make_db(tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Set doc_type
        await client.patch(
            "/document-meta",
            params={"workspace_path": ws, "doc_id": "docA"},
            json={"doc_type": "Services Agreement"},
        )
        # Set doc_tags separately — should not wipe doc_type
        await client.patch(
            "/document-meta",
            params={"workspace_path": ws, "doc_id": "docA"},
            json={"doc_tags": ["Confidential"]},
        )
        r = await client.get("/document-meta", params={"workspace_path": ws, "doc_id": "docA"})

    data = r.json()
    assert data["doc_type"] == "Services Agreement"
    assert data["doc_tags"] == ["Confidential"]
