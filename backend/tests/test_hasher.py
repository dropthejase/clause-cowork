import pytest
from services.hasher import hash_paragraph, fuzzy_match, MatchResult


def test_hash_is_deterministic():
    assert hash_paragraph("Hello world.") == hash_paragraph("Hello world.")


def test_hash_differs_for_different_text():
    assert hash_paragraph("Hello world.") != hash_paragraph("Hello earth.")


def test_hash_normalises_whitespace():
    assert hash_paragraph("foo  bar") == hash_paragraph("foo bar")


def test_hash_returns_16_char_hex():
    result = hash_paragraph("Some contract text.")
    assert len(result) == 16
    assert all(c in "0123456789abcdef" for c in result)


def test_fuzzy_exact_match():
    old = {hash_paragraph("The Agreement means the MSA."): "The Agreement means the MSA."}
    result = fuzzy_match("The Agreement means the MSA.", old)
    assert result.score == 1.0
    assert result.is_new is False


def test_fuzzy_match_minor_edit():
    original = "Customer shall pay all fees within thirty (30) days of receipt of invoice."
    edited = "Customer shall pay all fees within thirty (30) days of receipt of each invoice."
    old = {hash_paragraph(original): original}
    result = fuzzy_match(edited, old, threshold=0.85)
    assert result.is_new is False
    assert result.score > 0.85


def test_fuzzy_no_match_different_clause():
    old = {hash_paragraph("Customer shall pay all fees within thirty (30) days."): "Customer shall pay all fees within thirty (30) days."}
    result = fuzzy_match("Supplier shall provide services in a professional manner.", old, threshold=0.85)
    assert result.is_new is True


@pytest.mark.asyncio
async def test_fuzzy_match_used_in_parse_preserves_classification(tmp_path):
    """Re-parsing a doc after a minor edit preserves classification on the changed clause."""
    import sqlite3
    import os
    from unittest.mock import AsyncMock, patch
    from services.hasher import hash_paragraph

    db_dir = tmp_path / ".clause-cowork" / "db"
    db_dir.mkdir(parents=True)
    db_path = str(db_dir / "workspace.db")

    # Seed DB with a parsed clause that has a classification
    conn = sqlite3.connect(db_path)
    conn.executescript("""
        CREATE TABLE documents (id TEXT PRIMARY KEY, path TEXT UNIQUE, last_analysed_at REAL, last_extracted_at REAL, file_mtime REAL,
            doc_tags TEXT DEFAULT '[]', notes TEXT DEFAULT '', content_hash TEXT, path_hash TEXT, tombstoned INTEGER DEFAULT 0);
        CREATE TABLE clauses (stable_id TEXT NOT NULL, doc_id TEXT NOT NULL, paragraph_hash TEXT,
            position INTEGER, raw_text TEXT, clause_type TEXT, is_table INTEGER DEFAULT 0,
            tombstoned INTEGER DEFAULT 0, parent TEXT, needs_reclassification INTEGER DEFAULT 0,
            updated_at REAL,
            PRIMARY KEY (stable_id, doc_id));
        CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, clause_id TEXT, doc_id TEXT NOT NULL DEFAULT '', value TEXT,
            user_defined INTEGER DEFAULT 0, UNIQUE(clause_id, doc_id, value));
        CREATE TABLE connections (id TEXT PRIMARY KEY, source_id TEXT, source_doc_id TEXT NOT NULL DEFAULT '',
            target_id TEXT, target_doc_id TEXT NOT NULL DEFAULT '',
            edge_type TEXT, note TEXT, user_created INTEGER DEFAULT 0, user_rejected INTEGER DEFAULT 0);
        CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE tag_pool (tag TEXT PRIMARY KEY, description TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'manual', created_at TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'clause_tag');
        CREATE TABLE _migrations (name TEXT PRIMARY KEY);
    """)
    original_text = "Customer shall pay all fees within thirty (30) days of receipt of invoice."
    conn.execute("INSERT INTO documents (id, path, last_analysed_at) VALUES ('doc1', ?, 1000.0)",
                 (str(tmp_path / "test.docx"),))
    conn.execute("INSERT INTO clauses (stable_id, doc_id, paragraph_hash, position, raw_text, clause_type) VALUES (?,?,?,?,?,?)",
                 ("00000001", "doc1", hash_paragraph(original_text), 0, original_text, "Obligation"))
    conn.execute("INSERT INTO config (key, value) VALUES ('workspace', '{\"clause_types\": [], \"re_enrich_threshold\": 0.85}')")
    conn.commit()
    conn.close()

    # Minor edit — one word changed
    edited_text = "Customer shall pay all fees within thirty (30) days of receipt of each invoice."

    from services.extractor import ExtractedBlock

    mock_blocks = [ExtractedBlock(node_id="00000001", text=edited_text, position=0, is_table=False, parent=None)]

    doc_path = str(tmp_path / "test.docx")
    open(doc_path, "w").close()

    from httpx import AsyncClient, ASGITransport
    from main import app
    with patch("routers.parse.extract_blocks", new=AsyncMock(return_value=mock_blocks)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/parse", json={"doc_path": doc_path})
            assert resp.status_code == 200
            clauses = resp.json()["clauses"]
            assert len(clauses) == 1
            assert clauses[0]["clause_type"] == "Obligation"
            assert clauses[0]["needs_reclassification"] is False  # minor edit — above re_enrich_threshold
