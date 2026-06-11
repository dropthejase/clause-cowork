import pytest
from httpx import AsyncClient, ASGITransport
from main import app


def _workspace_path(tmp_path) -> str:
    (tmp_path / ".clause-cowork" / "db").mkdir(parents=True)
    return str(tmp_path)


@pytest.mark.asyncio
async def test_get_workspace_config_returns_defaults(tmp_path):
    ws = _workspace_path(tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/config", params={"workspace_path": ws})
    assert resp.status_code == 200
    data = resp.json()
    assert "re_enrich_threshold" in data
    assert "strict_doc_tags" in data


@pytest.mark.asyncio
async def test_save_and_get_workspace_config(tmp_path):
    ws = _workspace_path(tmp_path)
    payload = {"re_enrich_threshold": 0.9, "strict_clause_tags": True}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        put_resp = await client.put("/config", json=payload, params={"workspace_path": ws})
        assert put_resp.status_code == 200
        get_resp = await client.get("/config", params={"workspace_path": ws})
    assert get_resp.json()["re_enrich_threshold"] == 0.9
    assert get_resp.json()["strict_clause_tags"] is True


@pytest.mark.asyncio
async def test_reset_workspace_settings(tmp_path):
    ws = _workspace_path(tmp_path)
    payload = {"re_enrich_threshold": 0.5}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.put("/config", json=payload, params={"workspace_path": ws})
        reset_resp = await client.delete("/config/settings", params={"workspace_path": ws})
        assert reset_resp.status_code == 200
        data = reset_resp.json()
        assert data["re_enrich_threshold"] == 0.85  # default restored


@pytest.mark.asyncio
async def test_delete_workspace_data_wipes_everything(tmp_path):
    import aiosqlite
    ws = _workspace_path(tmp_path)
    db_path = tmp_path / ".clause-cowork" / "db" / "workspace.db"
    payload = {"re_enrich_threshold": 0.85}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.put("/config", json=payload, params={"workspace_path": ws})
        async with aiosqlite.connect(str(db_path)) as db:
            await db.execute(
                "INSERT INTO clauses (stable_id, doc_id, paragraph_hash, position, raw_text) VALUES (?,?,?,?,?)",
                ("n1", "doc1", "h1", 1, "text")
            )
            await db.commit()
        del_resp = await client.delete("/config/data", params={"workspace_path": ws})
        assert del_resp.status_code == 200
        assert del_resp.json()["deleted"] is True
        # Clauses gone
        async with aiosqlite.connect(str(db_path)) as db:
            row = await (await db.execute("SELECT COUNT(*) FROM clauses")).fetchone()
        assert row[0] == 0


@pytest.mark.asyncio
async def test_delete_workspace_data_no_db(tmp_path):
    ws = _workspace_path(tmp_path)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.delete("/config/data", params={"workspace_path": ws})
    assert resp.status_code == 200
    assert resp.json()["deleted"] is False


@pytest.mark.asyncio
async def test_strict_doc_tags_persists(tmp_path):
    ws = _workspace_path(tmp_path)
    payload = {"strict_doc_tags": True}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.put("/config", json=payload, params={"workspace_path": ws})
        resp = await client.get("/config", params={"workspace_path": ws})
    assert resp.json()["strict_doc_tags"] is True
