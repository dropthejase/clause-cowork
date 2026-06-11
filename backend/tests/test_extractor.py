import os
import tempfile
import pytest
from unittest.mock import patch, AsyncMock
from services.extractor import extract_blocks, ExtractedBlock, EXTRACTABLE_EXTENSIONS


@pytest.mark.asyncio
async def test_extract_blocks_basic():
    fake_blocks = [
        {"nodeId": "AAA", "type": "paragraph", "text": "1. Definitions"},
        {"nodeId": "BBB", "type": "paragraph", "text": "Party A means Acme Corp."},
        {"nodeId": "CCC", "type": "paragraph", "text": "2. Payment"},
        {"nodeId": "DDD", "type": "paragraph", "text": "Party A shall pay within 30 days."},
        {"nodeId": "EEE", "type": "paragraph", "text": ""},  # empty, skipped
    ]

    mock_doc = AsyncMock()
    mock_doc.extract = AsyncMock(return_value={"blocks": fake_blocks})
    mock_doc.close = AsyncMock()

    mock_client = AsyncMock()
    mock_client.open = AsyncMock(return_value=mock_doc)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("services.extractor.AsyncSuperDocClient", return_value=mock_client):
        result = await extract_blocks("/fake/doc.docx")

    assert len(result) == 4  # all non-empty blocks, no heading filtering
    assert result[0].node_id == "AAA"
    assert result[0].parent is None
    assert result[1].node_id == "BBB"
    assert result[1].parent is None
    assert result[2].position == 2
    assert result[3].node_id == "DDD"


@pytest.mark.asyncio
async def test_extract_blocks_section_always_none():
    fake_blocks = [
        {"nodeId": "AAA", "type": "paragraph", "text": "1. Definitions"},
        {"nodeId": "BBB", "type": "paragraph", "text": "Party A means Acme Corp."},
    ]

    mock_doc = AsyncMock()
    mock_doc.extract = AsyncMock(return_value={"blocks": fake_blocks})
    mock_doc.close = AsyncMock()

    mock_client = AsyncMock()
    mock_client.open = AsyncMock(return_value=mock_doc)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("services.extractor.AsyncSuperDocClient", return_value=mock_client):
        result = await extract_blocks("/fake/doc.docx")

    for block in result:
        assert block.parent is None


@pytest.mark.asyncio
async def test_extract_blocks_table_reconstructed():
    fake_blocks = [
        {"nodeId": "T1", "type": "paragraph", "text": "Service Provider", "tableContext": {"tableOrdinal": 0, "rowIndex": 0, "columnIndex": 0, "rowspan": 1, "colspan": 1}},
        {"nodeId": "T2", "type": "paragraph", "text": "Client", "tableContext": {"tableOrdinal": 0, "rowIndex": 0, "columnIndex": 1, "rowspan": 1, "colspan": 1}},
        {"nodeId": "T3", "type": "paragraph", "text": "Nexus Digital Ltd", "tableContext": {"tableOrdinal": 0, "rowIndex": 1, "columnIndex": 0, "rowspan": 1, "colspan": 1}},
        {"nodeId": "T4", "type": "paragraph", "text": "Horizon Ventures Inc.", "tableContext": {"tableOrdinal": 0, "rowIndex": 1, "columnIndex": 1, "rowspan": 1, "colspan": 1}},
    ]

    mock_doc = AsyncMock()
    mock_doc.extract = AsyncMock(return_value={"blocks": fake_blocks})
    mock_doc.close = AsyncMock()

    mock_client = AsyncMock()
    mock_client.open = AsyncMock(return_value=mock_client)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.open = AsyncMock(return_value=mock_doc)

    with patch("services.extractor.AsyncSuperDocClient", return_value=mock_client):
        result = await extract_blocks("/fake/doc.docx")

    assert len(result) == 1
    assert result[0].is_table is True
    assert result[0].node_id == "T1"
    assert result[0].parent is None
    assert "Service Provider" in result[0].text
    assert "Client" in result[0].text
    assert "Nexus Digital Ltd" in result[0].text
    assert "Horizon Ventures Inc." in result[0].text


@pytest.mark.asyncio
async def test_extract_blocks_skips_empty():
    fake_blocks = [
        {"nodeId": "AAA", "type": "paragraph", "text": "Real clause."},
        {"nodeId": "BBB", "type": "paragraph", "text": ""},
        {"nodeId": "CCC", "type": "paragraph", "text": "   "},
    ]

    mock_doc = AsyncMock()
    mock_doc.extract = AsyncMock(return_value={"blocks": fake_blocks})
    mock_doc.close = AsyncMock()

    mock_client = AsyncMock()
    mock_client.open = AsyncMock(return_value=mock_doc)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("services.extractor.AsyncSuperDocClient", return_value=mock_client):
        result = await extract_blocks("/fake/doc.docx")

    assert len(result) == 1
    assert result[0].node_id == "AAA"


# ── txt ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_extract_txt_splits_on_lines():
    content = "First line\nSecond line\n\nFourth line\n"
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        f.write(content)
        path = f.name
    try:
        result = await extract_blocks(path)
    finally:
        os.unlink(path)
    assert len(result) == 3
    assert result[0].text == "First line"
    assert result[1].text == "Second line"
    assert result[2].text == "Fourth line"
    assert all(b.is_table is False for b in result)
    assert all(b.parent is None for b in result)
    assert [b.node_id for b in result] == ["txt-0", "txt-1", "txt-3"]


@pytest.mark.asyncio
async def test_extract_md_splits_on_lines():
    content = "# Heading\nSome paragraph\n\n## Section 2\nMore text\n"
    with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False) as f:
        f.write(content)
        path = f.name
    try:
        result = await extract_blocks(path)
    finally:
        os.unlink(path)
    assert len(result) == 4
    assert result[0].text == "# Heading"
    assert result[1].text == "Some paragraph"
    assert result[2].text == "## Section 2"
    assert result[3].text == "More text"
    assert all(b.node_id.startswith("md-") for b in result)


# ── csv ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_extract_csv_one_row_per_block():
    content = "Name,Role,Company\nAlice,Counsel,Acme\nBob,Advisor,Globex\n"
    with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as f:
        f.write(content)
        path = f.name
    try:
        result = await extract_blocks(path)
    finally:
        os.unlink(path)
    assert len(result) == 3
    assert result[0].text == "| Name | Role | Company |"
    assert result[1].text == "| Alice | Counsel | Acme |"
    assert result[2].text == "| Bob | Advisor | Globex |"
    assert all(b.is_table is True for b in result)
    assert all(b.parent is None for b in result)
    assert [b.node_id for b in result] == ["csv-0", "csv-1", "csv-2"]


@pytest.mark.asyncio
async def test_extract_csv_skips_empty_rows():
    content = "Col1,Col2\n,\nA,B\n"
    with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as f:
        f.write(content)
        path = f.name
    try:
        result = await extract_blocks(path)
    finally:
        os.unlink(path)
    assert len(result) == 2
    assert result[0].text == "| Col1 | Col2 |"
    assert result[1].text == "| A | B |"


# ── pdf ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_extract_pdf_returns_blocks():
    import fitz
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        path = f.name
    try:
        doc = fitz.open()
        page = doc.new_page()
        page.insert_text((72, 72), "First paragraph")
        page.insert_text((72, 120), "Second paragraph")
        doc.save(path)
        doc.close()

        result = await extract_blocks(path)
    finally:
        os.unlink(path)

    assert len(result) >= 1
    texts = [b.text for b in result]
    combined = " ".join(texts)
    assert "First paragraph" in combined or any("First" in t for t in texts)
    assert all(b.is_table is False for b in result)
    assert all(b.parent is None for b in result)
    assert all(b.node_id.startswith("pdf-") for b in result)


# ── dispatcher ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_extract_blocks_unsupported_extension_raises():
    with pytest.raises(ValueError, match="Unsupported file type"):
        await extract_blocks("/some/file.xyz")


def test_extractable_extensions_set():
    assert ".docx" in EXTRACTABLE_EXTENSIONS
    assert ".pdf" in EXTRACTABLE_EXTENSIONS
    assert ".txt" in EXTRACTABLE_EXTENSIONS
    assert ".md" in EXTRACTABLE_EXTENSIONS
    assert ".csv" in EXTRACTABLE_EXTENSIONS
