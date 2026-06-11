import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch, MagicMock
from main import app
from services.tag_pool import PoolTag, TagPoolError, normalize_tag


def make_pool_mock(tags=None):
    mock = MagicMock()
    mock.list.return_value = tags or []
    return mock


@pytest.mark.asyncio
async def test_get_tags_empty(tmp_path):
    with patch("routers.tags.get_tag_pool") as mock_get:
        mock_get.return_value = make_pool_mock()
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get(f"/tags/{tmp_path}/test.docx")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_get_tags_returns_list(tmp_path):
    tag = PoolTag(tag="auto-renewal", description="Desc.", source="manual")
    with patch("routers.tags.get_tag_pool") as mock_get:
        mock_get.return_value = make_pool_mock([tag])
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get(f"/tags/{tmp_path}/test.docx")
    assert resp.status_code == 200
    assert resp.json()[0]["tag"] == "auto-renewal"


@pytest.mark.asyncio
async def test_post_tag(tmp_path):
    with patch("routers.tags.get_tag_pool") as mock_get:
        mock_pool = make_pool_mock()
        mock_get.return_value = mock_pool
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post(
                f"/tags/{tmp_path}/test.docx",
                json={"tag": "auto-renewal", "description": "Automatically renews.", "source": "manual"}
            )
    assert resp.status_code == 201
    mock_pool.add.assert_called_once()


@pytest.mark.asyncio
async def test_post_tag_duplicate_returns_409(tmp_path):
    with patch("routers.tags.get_tag_pool") as mock_get:
        mock_pool = make_pool_mock()
        mock_pool.add.side_effect = TagPoolError("already exists")
        mock_get.return_value = mock_pool
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post(
                f"/tags/{tmp_path}/test.docx",
                json={"tag": "auto-renewal", "description": "Desc.", "source": "manual"}
            )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_patch_tag_description(tmp_path):
    with patch("routers.tags.get_tag_pool") as mock_get:
        mock_pool = make_pool_mock()
        mock_get.return_value = mock_pool
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.patch(
                f"/tags/{tmp_path}/test.docx",
                json={"tag": "auto-renewal", "description": "Updated description."}
            )
    assert resp.status_code == 200
    mock_pool.update.assert_called_once_with("auto-renewal", "Updated description.")


@pytest.mark.asyncio
async def test_delete_tag(tmp_path):
    with patch("routers.tags.get_tag_pool") as mock_get:
        mock_pool = make_pool_mock()
        mock_get.return_value = mock_pool
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.request("DELETE", f"/tags/{tmp_path}/test.docx", json={"tag": "auto-renewal"})
    assert resp.status_code == 200
    mock_pool.delete.assert_called_once_with("auto-renewal")


@pytest.mark.asyncio
async def test_patch_tag_not_found_returns_404(tmp_path):
    with patch("routers.tags.get_tag_pool") as mock_get:
        mock_pool = make_pool_mock()
        mock_pool.update.side_effect = TagPoolError("not found")
        mock_get.return_value = mock_pool
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.patch(
                f"/tags/{tmp_path}/test.docx",
                json={"tag": "ghost-tag", "description": "whatever"}
            )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_tag_not_found_returns_404(tmp_path):
    with patch("routers.tags.get_tag_pool") as mock_get:
        mock_pool = make_pool_mock()
        mock_pool.delete.side_effect = TagPoolError("not found")
        mock_get.return_value = mock_pool
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.request("DELETE", f"/tags/{tmp_path}/test.docx", json={"tag": "ghost-tag"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_import_csv(tmp_path):
    with patch("routers.tags.get_tag_pool") as mock_get:
        mock_pool = make_pool_mock()
        mock_pool.import_csv.return_value = {"imported": 2, "errors": []}
        mock_get.return_value = mock_pool
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post(
                f"/tags/{tmp_path}/test.docx/import",
                json={"csv_content": "tag,description\nauto-renewal,Desc.\n"}
            )
    assert resp.status_code == 200
    assert resp.json()["imported"] == 2


@pytest.mark.asyncio
async def test_export_csv(tmp_path):
    with patch("routers.tags.get_tag_pool") as mock_get:
        mock_pool = make_pool_mock()
        mock_pool.export_csv.return_value = "tag,description\nauto-renewal,Desc.\n"
        mock_get.return_value = mock_pool
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get(f"/tags/{tmp_path}/test.docx/export")
    assert resp.status_code == 200
    assert "path" in resp.json()


# --- normalize_tag unit tests ---

def test_normalize_tag_strips_control_chars():
    assert normalize_tag("tag\x00name") == "tagname"
    assert normalize_tag("tag\nnewline") == "tag newline"
    assert normalize_tag("tag\ttab") == "tag tab"

def test_normalize_tag_collapses_whitespace():
    assert normalize_tag("  hello   world  ") == "hello world"

def test_normalize_tag_enforces_max_length():
    assert len(normalize_tag("a" * 100)) == 64

def test_normalize_tag_empty_after_strip():
    assert normalize_tag("\x00\n\t") == ""

def test_normalize_tag_normal_passthrough():
    assert normalize_tag("auto-renewal") == "auto-renewal"
    assert normalize_tag("Governing Law") == "Governing Law"


# --- PATCH/DELETE with tag in body ---

@pytest.mark.asyncio
async def test_patch_tag_normalises_tag_name(tmp_path):
    with patch("routers.tags.get_tag_pool") as mock_get:
        mock_pool = make_pool_mock()
        mock_get.return_value = mock_pool
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.patch(
                f"/tags/{tmp_path}/test.docx",
                json={"tag": "auto\x00renewal", "description": "desc"}
            )
    assert resp.status_code == 200
    mock_pool.update.assert_called_once_with("autorenewal", "desc")


@pytest.mark.asyncio
async def test_patch_tag_empty_after_normalise_returns_400(tmp_path):
    with patch("routers.tags.get_tag_pool") as mock_get:
        mock_get.return_value = make_pool_mock()
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.patch(
                f"/tags/{tmp_path}/test.docx",
                json={"tag": "\x00\n", "description": "desc"}
            )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_delete_tag_empty_after_normalise_returns_400(tmp_path):
    with patch("routers.tags.get_tag_pool") as mock_get:
        mock_get.return_value = make_pool_mock()
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.request("DELETE", f"/tags/{tmp_path}/test.docx", json={"tag": "   "})
    assert resp.status_code == 400
