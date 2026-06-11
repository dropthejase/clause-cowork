import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch, AsyncMock
from main import app
from services.extractor import ExtractedBlock

SAMPLE_BLOCKS = [
    ExtractedBlock(node_id="AAA111", text="The Agreement means the MSA dated 1 Jan 2025.", position=0, is_table=False, parent="1. Definitions"),
    ExtractedBlock(node_id="BBB222", text="The Supplier shall deliver services within 30 days.", position=1, is_table=False, parent="2. Obligations"),
]


@pytest.mark.asyncio
async def test_parse_returns_clauses(tmp_path):
    docx = tmp_path / "contract.docx"
    docx.write_bytes(b"fake")

    with patch("routers.parse.extract_blocks", new_callable=AsyncMock) as mock_extract, \
         patch("routers.parse.get_db") as mock_get_db, \
         patch("routers.parse.aiosqlite") as mock_aiosqlite:

        mock_extract.return_value = SAMPLE_BLOCKS
        mock_cache = AsyncMock()
        mock_cache.db_path = str(tmp_path / "test.db")
        mock_cache.get_all_clauses_for_doc.return_value = []
        mock_cache.tombstone_missing_clauses.return_value = 0
        mock_cache.get_clauses_for_doc.return_value = []
        mock_get_db.return_value = mock_cache

        mock_conn = AsyncMock()
        mock_cursor = AsyncMock()
        mock_cursor.fetchone.return_value = None
        mock_conn.execute.return_value = mock_cursor
        mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_conn.__aexit__ = AsyncMock(return_value=False)
        mock_aiosqlite.connect.return_value = mock_conn

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/parse", json={"doc_path": str(docx)})

    assert resp.status_code == 200
    data = resp.json()
    assert "doc_id" in data
    assert "clauses" in data


@pytest.mark.asyncio
async def test_parse_nonexistent_file_returns_404():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/parse", json={"doc_path": "/nonexistent/path.docx"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_parse_does_not_inject_sequence_links(tmp_path):
    docx = tmp_path / "contract.docx"
    docx.write_bytes(b"fake")

    from models.clause import Clause
    fake_clauses = [
        Clause(stable_id=f"ID{i}", doc_id="doc1", paragraph_hash=f"h{i}", position=i, raw_text=f"Para {i}.")
        for i in range(3)
    ]

    with patch("routers.parse.extract_blocks", new_callable=AsyncMock) as mock_extract, \
         patch("routers.parse.get_db") as mock_get_db, \
         patch("routers.parse.aiosqlite") as mock_aiosqlite:

        mock_extract.return_value = SAMPLE_BLOCKS
        mock_cache = AsyncMock()
        mock_cache.db_path = str(tmp_path / "test.db")
        mock_cache.get_all_clauses_for_doc.return_value = fake_clauses
        mock_cache.tombstone_missing_clauses.return_value = 0
        mock_cache.get_clauses_for_doc.return_value = fake_clauses
        mock_get_db.return_value = mock_cache

        mock_conn = AsyncMock()
        mock_cursor = AsyncMock()
        mock_cursor.fetchone.return_value = None
        mock_conn.execute.return_value = mock_cursor
        mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_conn.__aexit__ = AsyncMock(return_value=False)
        mock_aiosqlite.connect.return_value = mock_conn

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/parse", json={"doc_path": str(docx)})

    assert resp.status_code == 200
    clauses = resp.json()["clauses"]
    all_connections = [c for n in clauses for c in n.get("connections", [])]
    sequential = [c for c in all_connections if c.get("note") == "Sequential clause in same section"]
    assert len(sequential) == 0


def test_get_db_uses_workspace_db(tmp_path):
    from routers.parse import get_db
    doc = tmp_path / "some-contract.docx"
    doc.write_bytes(b"fake")
    db = get_db(str(doc))
    assert db.db_path == str(tmp_path / ".clause-cowork" / "db" / "workspace.db")


def test_get_db_same_path_returns_same_instance(tmp_path):
    from routers.parse import get_db
    doc = tmp_path / "contract.docx"
    doc.write_bytes(b"fake")
    db1 = get_db(str(doc))
    db2 = get_db(str(doc))
    assert db1 is db2


@pytest.mark.asyncio
async def test_parse_calls_upsert_document(tmp_path):
    docx = tmp_path / "my-contract.docx"
    docx.write_bytes(b"fake")

    with patch("routers.parse.extract_blocks", new_callable=AsyncMock) as mock_extract, \
         patch("routers.parse.get_db") as mock_get_db, \
         patch("routers.parse.aiosqlite") as mock_aiosqlite:

        mock_extract.return_value = SAMPLE_BLOCKS
        mock_cache = AsyncMock()
        mock_cache.db_path = str(tmp_path / ".clause-cowork" / "db" / "workspace.db")
        mock_cache.get_all_clauses_for_doc.return_value = []
        mock_cache.tombstone_missing_clauses.return_value = 0
        mock_cache.get_clauses_for_doc.return_value = []
        mock_get_db.return_value = mock_cache

        mock_conn = AsyncMock()
        mock_cursor = AsyncMock()
        mock_cursor.fetchone.return_value = None
        mock_conn.execute.return_value = mock_cursor
        mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_conn.__aexit__ = AsyncMock(return_value=False)
        mock_aiosqlite.connect.return_value = mock_conn

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/parse", json={"doc_path": str(docx)})

    assert resp.status_code == 200
    mock_cache.update_extracted_at.assert_called_once()


@pytest.mark.asyncio
async def test_parse_uses_superdoc_node_id_as_stable_id(tmp_path):
    docx = tmp_path / "contract.docx"
    docx.write_bytes(b"fake")

    upserted_clauses = []

    async def capture_upsert(clause, **kwargs):
        upserted_clauses.append(clause)

    with patch("routers.parse.extract_blocks", new_callable=AsyncMock) as mock_extract, \
         patch("routers.parse.get_db") as mock_get_db, \
         patch("routers.parse.aiosqlite") as mock_aiosqlite:

        mock_extract.return_value = SAMPLE_BLOCKS
        mock_cache = AsyncMock()
        mock_cache.db_path = str(tmp_path / "test.db")
        mock_cache.get_all_clauses_for_doc.return_value = []
        mock_cache.tombstone_missing_clauses.return_value = 0
        mock_cache.get_clauses_for_doc.return_value = []
        mock_cache.upsert_clause.side_effect = capture_upsert
        mock_get_db.return_value = mock_cache

        mock_conn = AsyncMock()
        mock_cursor = AsyncMock()
        mock_cursor.fetchone.return_value = None
        mock_conn.execute.return_value = mock_cursor
        mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_conn.__aexit__ = AsyncMock(return_value=False)
        mock_aiosqlite.connect.return_value = mock_conn

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            await client.post("/parse", json={"doc_path": str(docx)})

    assert len(upserted_clauses) == 2
    assert upserted_clauses[0].stable_id == "AAA111"
    assert upserted_clauses[1].stable_id == "BBB222"


@pytest.mark.asyncio
async def test_parse_detects_content_change(tmp_path):
    """Major rewrite of a clause (below re_enrich_threshold) sets needs_reclassification."""
    docx = tmp_path / "contract.docx"
    docx.write_bytes(b"fake")

    from models.clause import Clause
    from services.hasher import hash_paragraph

    original_text = "The Supplier shall deliver services within 30 days of the order date."
    changed_block = ExtractedBlock(
        node_id="BBB222",
        text="All payments are due within 14 days of invoice receipt and are non-refundable.",
        position=1,
        is_table=False,
        parent="2. Obligations",
    )
    existing_clause = Clause(
        stable_id="BBB222",
        doc_id="d1",
        paragraph_hash=hash_paragraph(original_text),
        classified_hash=hash_paragraph(original_text),
        position=1,
        classified_text=original_text,
        raw_text=original_text,
        clause_type="Obligation",
    )

    upserted_clauses = []

    async def capture_upsert(clause, **kwargs):
        upserted_clauses.append(clause)

    with patch("routers.parse.extract_blocks", new_callable=AsyncMock) as mock_extract, \
         patch("routers.parse.get_db") as mock_get_db, \
         patch("routers.parse.aiosqlite") as mock_aiosqlite:

        mock_extract.return_value = [changed_block]
        mock_cache = AsyncMock()
        mock_cache.db_path = str(tmp_path / "test.db")
        mock_cache.get_all_clauses_for_doc.return_value = [existing_clause]
        mock_cache.tombstone_missing_clauses.return_value = 0
        mock_cache.get_clauses_for_doc.return_value = []
        mock_cache.upsert_clause.side_effect = capture_upsert
        mock_get_db.return_value = mock_cache

        mock_conn = AsyncMock()
        mock_cursor = AsyncMock()
        mock_cursor.fetchone.return_value = None
        mock_conn.execute.return_value = mock_cursor
        mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_conn.__aexit__ = AsyncMock(return_value=False)
        mock_aiosqlite.connect.return_value = mock_conn

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/parse", json={"doc_path": str(docx)})

    assert resp.status_code == 200
    assert len(upserted_clauses) == 1
    assert upserted_clauses[0].stable_id == "BBB222"
    assert upserted_clauses[0].needs_reclassification is True


@pytest.mark.asyncio
async def test_parse_minor_edit_does_not_set_reclassification(tmp_path):
    """Minor edit to a clause (above re_enrich_threshold) does not set needs_reclassification."""
    docx = tmp_path / "contract.docx"
    docx.write_bytes(b"fake")

    from models.clause import Clause
    from services.hasher import hash_paragraph

    original_text = "The Supplier shall deliver services within 30 days of the order date."
    changed_block = ExtractedBlock(
        node_id="BBB222",
        text="The Supplier shall deliver services within 60 days of the order date.",
        position=1,
        is_table=False,
        parent="2. Obligations",
    )
    existing_clause = Clause(
        stable_id="BBB222",
        doc_id="d1",
        paragraph_hash=hash_paragraph(original_text),
        classified_hash=hash_paragraph(original_text),
        position=1,
        classified_text=original_text,
        raw_text=original_text,
        clause_type="Obligation",
    )

    upserted_clauses = []

    async def capture_upsert(clause, **kwargs):
        upserted_clauses.append(clause)

    with patch("routers.parse.extract_blocks", new_callable=AsyncMock) as mock_extract, \
         patch("routers.parse.get_db") as mock_get_db, \
         patch("routers.parse.aiosqlite") as mock_aiosqlite:

        mock_extract.return_value = [changed_block]
        mock_cache = AsyncMock()
        mock_cache.db_path = str(tmp_path / "test.db")
        mock_cache.get_all_clauses_for_doc.return_value = [existing_clause]
        mock_cache.tombstone_missing_clauses.return_value = 0
        mock_cache.get_clauses_for_doc.return_value = []
        mock_cache.upsert_clause.side_effect = capture_upsert
        mock_get_db.return_value = mock_cache

        mock_conn = AsyncMock()
        mock_cursor = AsyncMock()
        mock_cursor.fetchone.return_value = None
        mock_conn.execute.return_value = mock_cursor
        mock_conn.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_conn.__aexit__ = AsyncMock(return_value=False)
        mock_aiosqlite.connect.return_value = mock_conn

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/parse", json={"doc_path": str(docx)})

    assert resp.status_code == 200
    assert len(upserted_clauses) == 1
    assert upserted_clauses[0].stable_id == "BBB222"
    assert upserted_clauses[0].needs_reclassification is False
