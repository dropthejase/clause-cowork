import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch, AsyncMock
from main import app


@pytest.mark.asyncio
async def test_add_connection_invalid_edge_type_rejected():
    """Edge types outside the allowed set are rejected with 422."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/connections", json={
            "source_id": "node-1",
            "target_id": "node-2",
            "edge_type": "other",       # removed from vocabulary
            "doc_path": "/tmp/test.docx",
        })
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_add_connection_references_succeeds():
    with patch("routers.connections.get_db") as mock_get_db:
        mock_cache = AsyncMock()
        mock_cache.upsert_connection = AsyncMock()
        mock_get_db.return_value = mock_cache

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/connections", json={
                "source_id": "node-1",
                "source_doc_id": "doc1",
                "target_id": "node-2",
                "target_doc_id": "doc1",
                "edge_type": "references",
                "doc_path": "/tmp/test.docx",
            })
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_add_connection_subject_to_succeeds():
    with patch("routers.connections.get_db") as mock_get_db:
        mock_cache = AsyncMock()
        mock_cache.upsert_connection = AsyncMock()
        mock_get_db.return_value = mock_cache

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/connections", json={
                "source_id": "node-1",
                "source_doc_id": "doc1",
                "target_id": "node-2",
                "target_doc_id": "doc1",
                "edge_type": "subject_to",
                "doc_path": "/tmp/test.docx",
            })
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_add_connection_contradicts_with_note_succeeds():
    with patch("routers.connections.get_db") as mock_get_db:
        mock_cache = AsyncMock()
        mock_cache.upsert_connection = AsyncMock()
        mock_get_db.return_value = mock_cache

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/connections", json={
                "source_id": "node-1",
                "source_doc_id": "doc1",
                "target_id": "node-2",
                "target_doc_id": "doc1",
                "edge_type": "contradicts",
                "note": "Clause 8.1 cap conflicts with clause 12 indemnity obligation",
                "doc_path": "/tmp/test.docx",
            })
    assert resp.status_code == 200
