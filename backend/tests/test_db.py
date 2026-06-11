import pytest
import pytest_asyncio
import aiosqlite
import tempfile
import os
from db.migrations import apply_schema
from models.clause import Clause, Connection, Tag
from services.db import DBService

@pytest.mark.asyncio
async def test_schema_creates_all_tables():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "test.db")
        await apply_schema(db_path)
        async with aiosqlite.connect(db_path) as db:
            cursor = await db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
            tables = {row[0] for row in await cursor.fetchall()}
        assert "clauses" in tables
        assert "connections" in tables
        assert "documents" in tables
        assert "config" in tables

def test_clause_default_stable_id():
    clause = Clause(doc_id="doc1", paragraph_hash="abc", position=0, raw_text="text")
    assert len(clause.stable_id) == 36  # UUID format

def test_connection_note_is_optional():
    conn = Connection(target_id="x", edge_type="references")
    assert conn.note is None

@pytest_asyncio.fixture
async def cache(tmp_path):
    svc = DBService(str(tmp_path / ".clause-cowork" / "db" / "test.db"))
    await svc.init()
    return svc

@pytest.mark.asyncio
async def test_upsert_and_get_clause(cache):
    clause = Clause(
        doc_id="doc1",
        paragraph_hash="abc123",
        position=0,
        raw_text="The Agreement means...",
        clause_type="Definition",
        clause_tags=[Tag(value="Agreement")],
    )
    await cache.upsert_clause(clause)
    result = await cache.get_clause(clause.stable_id, clause.doc_id)
    assert result is not None
    assert result.clause_type == "Definition"
    assert result.clause_tags[0].value == "Agreement"

@pytest.mark.asyncio
async def test_user_data_not_overwritten(cache):
    clause = Clause(
        doc_id="doc1",
        paragraph_hash="abc123",
        position=0,
        raw_text="The Agreement means...",
        clause_type="Definition",
        clause_tags=[Tag(value="Agreement", user_defined=False)],
    )
    await cache.upsert_clause(clause)

    # User adds a tag
    await cache.add_user_tag(clause.stable_id, clause.doc_id, Tag(value="key-term", user_defined=True))

    # Re-parse upserts with new AI-suggested data
    clause.clause_tags = [Tag(value="MSA", user_defined=False)]
    await cache.upsert_clause(clause)

    result = await cache.get_clause(clause.stable_id, clause.doc_id)
    tag_values = {t.value for t in result.clause_tags}
    assert "key-term" in tag_values   # user tag preserved
    assert "MSA" in tag_values        # new AI tag added
    assert "Agreement" not in tag_values  # old AI tag replaced by re-parse

@pytest.mark.asyncio
async def test_get_clauses_for_doc(cache):
    for i in range(3):
        await cache.upsert_clause(Clause(
            doc_id="doc1", paragraph_hash=f"h{i}",
            position=i, raw_text=f"Para {i}."
        ))
    clauses = await cache.get_clauses_for_doc("doc1")
    assert len(clauses) == 3

@pytest.mark.asyncio
async def test_upsert_connection(cache):
    c1 = Clause(doc_id="doc1", paragraph_hash="h1", position=0, raw_text="Para 1.")
    c2 = Clause(doc_id="doc1", paragraph_hash="h2", position=1, raw_text="Para 2.")
    await cache.upsert_clause(c1)
    await cache.upsert_clause(c2)
    conn = Connection(target_id=c2.stable_id, target_doc_id=c2.doc_id, edge_type="references")
    await cache.upsert_connection(c1.stable_id, c1.doc_id, conn)
    result = await cache.get_clause(c1.stable_id, c1.doc_id)
    assert len(result.connections) == 1
    assert result.connections[0].edge_type == "references"

@pytest.mark.asyncio
async def test_get_old_clause_texts(cache):
    await cache.upsert_clause(Clause(doc_id="doc1", paragraph_hash="ph1", position=0, raw_text="Clause one."))
    await cache.upsert_clause(Clause(doc_id="doc1", paragraph_hash="ph2", position=1, raw_text="Clause two."))
    texts, positions = await cache.get_old_clause_texts("doc1")
    assert "ph1" in texts
    assert texts["ph1"] == "Clause one."
    assert "ph2" in texts

@pytest.mark.asyncio
async def test_section_persisted_and_hydrated(tmp_path):
    db_path = str(tmp_path / "test.db")
    cache = DBService(db_path)
    await cache.init()
    clause = Clause(
        stable_id="test-section-001",
        doc_id="doc1",
        paragraph_hash="abc123",
        position=0,
        raw_text="Agreement means the MSA.",
        parent="1. Definitions",
    )
    await cache.upsert_clause(clause)
    loaded = await cache.get_clause("test-section-001", "doc1")
    assert loaded is not None
    assert loaded.parent == "1. Definitions"

@pytest.mark.asyncio
async def test_tombstone_missing_clauses(cache):
    clauses = []
    for i in range(3):
        c = Clause(doc_id="doc1", paragraph_hash=f"ph{i}", position=i, raw_text=f"Para {i}.")
        await cache.upsert_clause(c)
        clauses.append(c)
    # Simulate re-parse that only sees clauses 0 and 2
    seen = {clauses[0].stable_id, clauses[2].stable_id}
    count = await cache.tombstone_missing_clauses("doc1", seen)
    assert count == 1
    # Clause 1 should be tombstoned (not returned by get_clauses_for_doc)
    active = await cache.get_clauses_for_doc("doc1")
    active_ids = {c.stable_id for c in active}
    assert clauses[1].stable_id not in active_ids
    assert clauses[0].stable_id in active_ids
