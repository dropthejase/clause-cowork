"""Integration tests for schema structure."""
from __future__ import annotations
import sqlite3
import pytest
from db.migrations import apply_schema


@pytest.mark.asyncio
async def test_strength_column_not_added(tmp_path):
    """strength column must not be present in new databases."""
    db_path = str(tmp_path / "workspace.db")
    await apply_schema(db_path)

    conn = sqlite3.connect(db_path)
    cols = [row[1] for row in conn.execute("PRAGMA table_info(connections)").fetchall()]
    conn.close()
    assert "strength" not in cols


@pytest.mark.asyncio
async def test_document_meta_columns_added(tmp_path):
    """doc_tags and notes columns exist on the documents table after migration."""
    db_path = str(tmp_path / "workspace.db")
    await apply_schema(db_path)

    conn = sqlite3.connect(db_path)
    cols = [row[1] for row in conn.execute("PRAGMA table_info(documents)").fetchall()]
    conn.close()
    assert "doc_tags" in cols
    assert "notes" in cols


@pytest.mark.asyncio
async def test_document_links_table_created(tmp_path):
    """document_links table is created by apply_schema."""
    db_path = str(tmp_path / "workspace.db")
    await apply_schema(db_path)

    conn = sqlite3.connect(db_path)
    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    conn.close()
    assert "document_links" in tables
