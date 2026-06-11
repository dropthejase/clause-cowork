from __future__ import annotations
import os
import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from models.clause import Clause
from models.config import WorkspaceConfig
from services.workspace import WorkspaceService


def make_clauses(doc_id="doc1", sections=("1. Definitions", "2. Services")) -> list[Clause]:
    clauses = []
    for i, sec in enumerate(sections):
        c = Clause(
            doc_id=doc_id,
            paragraph_hash=f"hash{i}",
            position=i,
            raw_text=f"This is section {i} content here.",
            parent=sec,
        )
        clauses.append(c)
    return clauses


@pytest.mark.asyncio
async def test_fresh_workspace_creates_file(tmp_path):
    doc = tmp_path / "msa-2024.docx"
    doc.write_bytes(b"fake")
    clauses = make_clauses()
    config = WorkspaceConfig()

    with patch("services.workspace._generate_summary", new_callable=AsyncMock) as mock_sum:
        mock_sum.return_value = "A master services agreement."
        await WorkspaceService().update(str(doc), clauses, config)

    md_path = tmp_path / ".clause-cowork" / "workspace.md"
    assert md_path.exists()
    content = md_path.read_text()
    assert "# Workspace" in content
    assert "## Documents" in content
    assert "### msa-2024.docx" in content
    assert f"- Path: {doc}" in content
    assert "- Sections: 2 | Clauses: 2 | Connections: 0" in content
    assert "A master services agreement." in content


@pytest.mark.asyncio
async def test_second_parse_same_doc_reuses_cached_summary_if_mtime_unchanged(tmp_path):
    doc = tmp_path / "msa.docx"
    doc.write_bytes(b"fake")
    clauses = make_clauses()
    config = WorkspaceConfig()

    call_count = 0

    async def fake_summary(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        return "Cached summary text."

    with patch("services.workspace._generate_summary", side_effect=fake_summary):
        await WorkspaceService().update(str(doc), clauses, config)

    assert call_count == 1

    # Second parse — mtime unchanged, should reuse summary
    with patch("services.workspace._generate_summary", side_effect=fake_summary):
        await WorkspaceService().update(str(doc), clauses, config)

    # Only called once total (second call skipped)
    assert call_count == 1

    md_path = tmp_path / ".clause-cowork" / "workspace.md"
    content = md_path.read_text()
    assert "Cached summary text." in content


@pytest.mark.asyncio
async def test_two_docs_both_entries_present(tmp_path):
    doc1 = tmp_path / "msa.docx"
    doc2 = tmp_path / "sow.docx"
    doc1.write_bytes(b"fake1")
    doc2.write_bytes(b"fake2")
    clauses1 = make_clauses(doc_id="doc1", sections=("1. Definitions",))
    clauses2 = make_clauses(doc_id="doc2", sections=("1. Scope", "2. Deliverables"))
    config = WorkspaceConfig()

    with patch("services.workspace._generate_summary", new_callable=AsyncMock) as mock_sum:
        mock_sum.side_effect = ["Summary for msa.", "Summary for sow."]
        await WorkspaceService().update(str(doc1), clauses1, config)
        await WorkspaceService().update(str(doc2), clauses2, config)

    md_path = tmp_path / ".clause-cowork" / "workspace.md"
    content = md_path.read_text()
    assert "### msa.docx" in content
    assert "### sow.docx" in content
    assert "Summary for msa." in content
    assert "Summary for sow." in content


@pytest.mark.asyncio
async def test_llm_failure_writes_entry_without_summary(tmp_path):
    doc = tmp_path / "contract.docx"
    doc.write_bytes(b"fake")
    clauses = make_clauses()
    config = WorkspaceConfig()

    async def failing_summary(*args, **kwargs):
        raise RuntimeError("LLM unavailable")

    with patch("services.workspace._generate_summary", side_effect=failing_summary):
        await WorkspaceService().update(str(doc), clauses, config)

    md_path = tmp_path / ".clause-cowork" / "workspace.md"
    assert md_path.exists()
    content = md_path.read_text()
    assert "### contract.docx" in content
    assert "- Sections:" in content


@pytest.mark.asyncio
async def test_llm_returns_empty_no_summary_line(tmp_path):
    """If LLM returns empty string, entry is written without a summary block."""
    doc = tmp_path / "draft.docx"
    doc.write_bytes(b"fake")
    clauses = make_clauses()
    config = WorkspaceConfig()

    with patch("services.workspace._generate_summary", new_callable=AsyncMock) as mock_sum:
        mock_sum.return_value = ""
        await WorkspaceService().update(str(doc), clauses, config)

    md_path = tmp_path / ".clause-cowork" / "workspace.md"
    content = md_path.read_text()
    assert "### draft.docx" in content
    assert "- Path:" in content
