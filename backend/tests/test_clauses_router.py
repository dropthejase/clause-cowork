import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch, AsyncMock
from main import app
from models.clause import Clause, Tag

def _make_mock_db(tmp_path):
    db_dir = tmp_path / ".clause-cowork" / "db"
    db_dir.mkdir(parents=True)
    mock_cache = AsyncMock()
    mock_cache.db_path = str(db_dir / "workspace.db")
    return mock_cache


@pytest.mark.asyncio
async def test_patch_clause_type(tmp_path):
    clause = Clause(doc_id="d1", paragraph_hash="h1", position=0, raw_text="text", clause_type="Definition")

    with patch("routers.clauses.get_db_for_clause", new_callable=AsyncMock) as mock_cache_fn, \
         patch("routers.clauses.get_or_register_doc_id", new_callable=AsyncMock, return_value="d1"):
        mock_cache = _make_mock_db(tmp_path)
        mock_cache.get_clause.return_value = clause
        mock_cache_fn.return_value = mock_cache

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.patch(
                f"/clauses/{clause.stable_id}",
                json={"clause_type": "Exclusion", "add_tags": [], "remove_tags": [], "doc_path": str(tmp_path / "test.docx")}
            )

    assert resp.status_code == 200

@pytest.mark.asyncio
async def test_patch_clause_not_found(tmp_path):
    with patch("routers.clauses.get_db_for_clause", new_callable=AsyncMock) as mock_cache_fn, \
         patch("routers.clauses.get_or_register_doc_id", new_callable=AsyncMock, return_value="d1"):
        mock_cache = _make_mock_db(tmp_path)
        mock_cache.get_clause.return_value = None
        mock_cache_fn.return_value = mock_cache

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.patch(
                "/clauses/nonexistent-id",
                json={"clause_type": "Exclusion", "add_tags": [], "remove_tags": [], "doc_path": str(tmp_path / "test.docx")}
            )

    assert resp.status_code == 404

@pytest.mark.asyncio
async def test_hide_clause(tmp_path):
    clause = Clause(doc_id="d1", paragraph_hash="h1", position=0, raw_text="text")

    with patch("routers.clauses.get_db_for_clause", new_callable=AsyncMock) as mock_cache_fn, \
         patch("routers.clauses.get_or_register_doc_id", new_callable=AsyncMock, return_value="d1"):
        mock_cache = _make_mock_db(tmp_path)
        mock_cache.get_clause.return_value = clause
        mock_cache_fn.return_value = mock_cache

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post(
                f"/clauses/{clause.stable_id}/hide",
                json={"doc_path": str(tmp_path / "test.docx")}
            )

    assert resp.status_code == 200
    assert resp.json()["hidden"] is True
