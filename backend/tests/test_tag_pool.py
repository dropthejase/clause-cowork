import json
import pytest
import pytest_asyncio
import asyncio
from pathlib import Path
from services.tag_pool import TagPool, PoolTag, TagPoolError
from db.migrations import apply_schema, restore_default_doc_types, _DEFAULT_DOC_TYPES

def test_load_empty_when_no_file(tmp_path):
    pool = TagPool(tmp_path / "workspace.db")
    assert pool.list() == []

def test_add_tag(tmp_path):
    pool = TagPool(tmp_path / "workspace.db")
    pool.add(PoolTag(tag="auto-renewal", description="Clauses that automatically renew.", source="manual"))
    tags = pool.list()
    assert len(tags) == 1
    assert tags[0].tag == "auto-renewal"

def test_add_duplicate_raises(tmp_path):
    pool = TagPool(tmp_path / "workspace.db")
    pool.add(PoolTag(tag="auto-renewal", description="First.", source="manual"))
    with pytest.raises(TagPoolError, match="already exists"):
        pool.add(PoolTag(tag="auto-renewal", description="Second.", source="manual"))

def test_500_tag_limit(tmp_path):
    pool = TagPool(tmp_path / "workspace.db")
    pool.MAX_TAGS = 5
    for i in range(5):
        pool.add(PoolTag(tag=f"tag-{i}", description=f"Description {i}.", source="manual"))
    with pytest.raises(TagPoolError, match="limited to 5"):
        pool.add(PoolTag(tag="one-too-many", description="Over limit.", source="manual"))

def test_delete_tag(tmp_path):
    pool = TagPool(tmp_path / "workspace.db")
    pool.add(PoolTag(tag="auto-renewal", description="Desc.", source="manual"))
    pool.delete("auto-renewal")
    assert pool.list() == []

def test_delete_nonexistent_raises(tmp_path):
    pool = TagPool(tmp_path / "workspace.db")
    with pytest.raises(TagPoolError, match="not found"):
        pool.delete("ghost-tag")

def test_update_description(tmp_path):
    pool = TagPool(tmp_path / "workspace.db")
    pool.add(PoolTag(tag="auto-renewal", description="Old.", source="manual"))
    pool.update("auto-renewal", description="New updated description.")
    assert pool.list()[0].description == "New updated description."

def test_update_nonexistent_raises(tmp_path):
    pool = TagPool(tmp_path / "workspace.db")
    with pytest.raises(TagPoolError, match="not found"):
        pool.update("ghost", description="whatever")

def test_persists_to_disk(tmp_path):
    path = tmp_path / "workspace.db"
    pool = TagPool(path)
    pool.add(PoolTag(tag="auto-renewal", description="Desc.", source="manual"))
    # Re-load from same file
    pool2 = TagPool(path)
    assert pool2.list()[0].tag == "auto-renewal"

def test_import_csv(tmp_path):
    pool = TagPool(tmp_path / "workspace.db")
    csv_content = "tag,description\nauto-renewal,Clauses that automatically renew.\nuncapped-liability,No financial ceiling.\n"
    result = pool.import_csv(csv_content, source="import")
    assert result["imported"] == 2
    assert result["errors"] == []
    assert len(pool.list()) == 2

def test_import_csv_rejects_empty_description(tmp_path):
    pool = TagPool(tmp_path / "workspace.db")
    csv_content = "tag,description\nauto-renewal,\n"
    with pytest.raises(TagPoolError) as exc:
        pool.import_csv(csv_content, source="import")
    assert "auto-renewal" in str(exc.value)

def test_import_csv_missing_header_raises(tmp_path):
    pool = TagPool(tmp_path / "workspace.db")
    with pytest.raises(TagPoolError, match="header"):
        pool.import_csv("auto-renewal,Some desc\n", source="import")

def test_import_csv_updates_description_on_duplicate(tmp_path):
    pool = TagPool(tmp_path / "workspace.db")
    pool.add(PoolTag(tag="auto-renewal", description="Old.", source="manual"))
    csv_content = "tag,description\nauto-renewal,Updated description.\n"
    result = pool.import_csv(csv_content, source="import")
    assert result["imported"] == 1
    assert pool.list()[0].description == "Updated description."

def test_import_csv_rejects_empty_tag(tmp_path):
    pool = TagPool(tmp_path / "workspace.db")
    with pytest.raises(TagPoolError):
        pool.import_csv("tag,description\n,some description\n", source="import")

# ── restore_default_doc_types ──────────────────────────────────────────────────

def test_restore_default_doc_types_seeds_missing(tmp_path):
    db_path = str(tmp_path / "workspace.db")
    asyncio.run(apply_schema(db_path))
    # Delete one default tag
    pool = TagPool(db_path)
    pool.delete("Employment")
    assert all(t.tag != "Employment" for t in pool.list(kind="doc_type"))

    # Restore — should bring it back
    restored = asyncio.run(restore_default_doc_types(db_path))
    assert restored == 1
    assert any(t.tag == "Employment" for t in pool.list(kind="doc_type"))


def test_restore_default_doc_types_no_op_when_all_present(tmp_path):
    db_path = str(tmp_path / "workspace.db")
    asyncio.run(apply_schema(db_path))
    restored = asyncio.run(restore_default_doc_types(db_path))
    assert restored == 0


def test_restore_does_not_delete_user_tags(tmp_path):
    db_path = str(tmp_path / "workspace.db")
    asyncio.run(apply_schema(db_path))
    pool = TagPool(db_path)
    pool.add(PoolTag(tag="Joint Venture", description="JV agreements", source="manual", kind="doc_type"))
    pool.delete("Employment")

    asyncio.run(restore_default_doc_types(db_path))

    tags = {t.tag for t in pool.list(kind="doc_type")}
    assert "Employment" in tags       # restored
    assert "Joint Venture" in tags    # user tag preserved


def test_restore_seeds_all_defaults_on_empty_pool(tmp_path):
    db_path = str(tmp_path / "workspace.db")
    asyncio.run(apply_schema(db_path))
    pool = TagPool(db_path)
    # Delete all default tags
    for tag, _ in _DEFAULT_DOC_TYPES:
        pool.delete(tag)
    assert pool.list(kind="doc_type") == []

    restored = asyncio.run(restore_default_doc_types(db_path))
    assert restored == len(_DEFAULT_DOC_TYPES)
    assert len(pool.list(kind="doc_type")) == len(_DEFAULT_DOC_TYPES)


def test_export_csv(tmp_path):
    pool = TagPool(tmp_path / "workspace.db")
    pool.add(PoolTag(tag="auto-renewal", description="Automatically renews.", source="manual"))
    csv_out = pool.export_csv()
    lines = csv_out.strip().split("\n")
    assert lines[0] == "tag,description"
    assert "auto-renewal" in lines[1]


def test_add_clause_type(tmp_path):
    db_path = str(tmp_path / ".clause-cowork" / "db" / "workspace.db")
    pool = TagPool(db_path)
    from db.migrations import apply_schema
    import asyncio
    asyncio.run(apply_schema(db_path))
    pool.add(PoolTag(tag="Custom-Type", description="A custom clause type", source="manual", kind="clause_type"))
    types = pool.list(kind="clause_type")
    assert any(t.tag == "Custom-Type" for t in types)


def test_list_clause_type_only_returns_clause_types(tmp_path):
    db_path = str(tmp_path / ".clause-cowork" / "db" / "workspace.db")
    pool = TagPool(db_path)
    import asyncio
    from db.migrations import apply_schema
    asyncio.run(apply_schema(db_path))
    pool.add(PoolTag(tag="Custom-Type", description="Clause type", source="manual", kind="clause_type"))
    pool.add(PoolTag(tag="payment", description="Clause tag", source="manual", kind="clause_tag"))
    types = pool.list(kind="clause_type")
    tags = pool.list(kind="clause_tag")
    assert any(t.tag == "Custom-Type" for t in types)
    assert not any(t.tag == "Custom-Type" for t in tags)
    assert any(t.tag == "payment" for t in tags)
    assert not any(t.tag == "payment" for t in types)


def test_add_doc_tag(tmp_path):
    db_path = str(tmp_path / ".clause-cowork" / "db" / "workspace.db")
    pool = TagPool(db_path)
    pool.add(PoolTag(tag="Confidential", description="Confidential documents", source="manual", kind="doc_tag"))
    tags = pool.list(kind="doc_tag")
    assert any(t.tag == "Confidential" for t in tags)


def test_clause_type_and_doc_tag_are_separate_buckets(tmp_path):
    """Tags are unique by name; clause_type and doc_tag lists are filtered separately."""
    db_path = str(tmp_path / ".clause-cowork" / "db" / "workspace.db")
    pool = TagPool(db_path)
    pool.add(PoolTag(tag="Clause-X", description="A clause type", source="manual", kind="clause_type"))
    pool.add(PoolTag(tag="Doc-Y", description="A doc tag", source="manual", kind="doc_tag"))
    clause_types = {t.tag for t in pool.list(kind="clause_type")}
    doc_tags = {t.tag for t in pool.list(kind="doc_tag")}
    assert "Clause-X" in clause_types
    assert "Clause-X" not in doc_tags
    assert "Doc-Y" in doc_tags
    assert "Doc-Y" not in clause_types


@pytest.mark.asyncio
async def test_folder_tree_includes_doc_type(tmp_path):
    """Folder-tree response includes doc_type per file entry."""
    import sqlite3
    from httpx import AsyncClient, ASGITransport
    from main import app

    db_dir = tmp_path / ".clause-cowork" / "db"
    db_dir.mkdir(parents=True)
    conn = sqlite3.connect(str(db_dir / "workspace.db"))
    conn.execute("CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, path TEXT, "
                 "last_analysed_at REAL, last_extracted_at REAL, file_mtime REAL, content_hash TEXT, path_hash TEXT, "
                 "tombstoned INTEGER DEFAULT 0, doc_type TEXT, doc_tags TEXT DEFAULT '[]', notes TEXT DEFAULT '')")
    conn.execute("CREATE TABLE IF NOT EXISTS clauses (stable_id TEXT NOT NULL, doc_id TEXT NOT NULL, "
                 "paragraph_hash TEXT, position INTEGER, raw_text TEXT, clause_type TEXT, is_table INTEGER DEFAULT 0, "
                 "tombstoned INTEGER DEFAULT 0, parent TEXT, needs_reclassification INTEGER DEFAULT 0, updated_at REAL, "
                 "PRIMARY KEY (stable_id, doc_id))")
    conn.execute("CREATE TABLE IF NOT EXISTS tag_pool (tag TEXT PRIMARY KEY, description TEXT NOT NULL, "
                 "source TEXT NOT NULL DEFAULT 'manual', created_at TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'clause_tag')")
    conn.execute("CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    conn.execute("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)")
    deal_dir = tmp_path / "deal"
    deal_dir.mkdir()
    docx = deal_dir / "contract.docx"
    docx.write_bytes(b"fake")
    conn.execute("INSERT INTO documents (id, path, doc_type) VALUES ('d1', ?, 'NDA / Confidentiality')",
                 (str(docx),))
    conn.commit()
    conn.close()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/workspace/folder-tree", params={"workspace_path": str(tmp_path)})
    assert resp.status_code == 200
    files = [c for folder in resp.json()["tree"] for c in folder.get("children", [])]
    doc = next((f for f in files if f["name"] == "contract.docx"), None)
    assert doc is not None
    assert doc["doc_type"] == "NDA / Confidentiality"
