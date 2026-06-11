"""Document extraction service — converts supported file types into ExtractedBlock sequences.

Supported: .docx (SuperDoc SDK), .pdf (pymupdf), .txt/.md (line-split), .csv (row-per-block).
Entry point: extract_blocks(path) — async for .docx, sync-wrapped for all others.
Tables are collapsed to a single pipe-delimited block keyed on the first cell's nodeId.
"""
from __future__ import annotations
import csv
import io
import logging
import os
from collections import defaultdict
from dataclasses import dataclass
from superdoc import AsyncSuperDocClient

logger = logging.getLogger(__name__)


EXTRACTABLE_EXTENSIONS = {".docx", ".pdf", ".txt", ".md", ".csv"}


@dataclass
class ExtractedBlock:
    node_id: str        # SuperDoc stable nodeId for .docx; synthetic for other formats
    text: str
    position: int
    is_table: bool
    parent: str | None  # assigned by agent during classification, always None from extractor


def _clean(text: str) -> str:
    return text.replace(" ", " ").replace("\xa0", " ").strip()


def _render_table(cells: list[dict]) -> str:
    cells = sorted(cells, key=lambda c: (c["tableContext"]["rowIndex"], c["tableContext"]["columnIndex"]))
    rows: dict[int, list[str]] = defaultdict(list)
    for c in cells:
        rows[c["tableContext"]["rowIndex"]].append(_clean((c.get("text") or "").replace("\n", " ")))
    lines = []
    for row_idx in sorted(rows):
        lines.append("| " + " | ".join(rows[row_idx]) + " |")
    return "\n".join(lines)


async def _extract_docx(path: str) -> list[ExtractedBlock]:
    logger.debug("extracting docx: %s", path)
    async with AsyncSuperDocClient() as client:
        doc = await client.open({"doc": path})
        try:
            result = await doc.extract()
        finally:
            await doc.close({})

    raw_blocks: list[dict] = result.get("blocks", [])

    table_cells: dict[int, list[dict]] = defaultdict(list)
    for block in raw_blocks:
        tc = block.get("tableContext")
        if tc:
            table_cells[tc["tableOrdinal"]].append(block)

    extracted: list[ExtractedBlock] = []
    position = 0
    seen_tables: set[int] = set()

    for block in raw_blocks:
        tc = block.get("tableContext")

        if tc:
            tord = tc["tableOrdinal"]
            if tord in seen_tables:
                continue
            seen_tables.add(tord)
            table_text = _render_table(table_cells[tord])
            if table_text:
                first_cell = min(table_cells[tord], key=lambda c: (c["tableContext"]["rowIndex"], c["tableContext"]["columnIndex"]))
                extracted.append(ExtractedBlock(
                    node_id=first_cell.get("nodeId", f"table-{tord}"),
                    text=table_text,
                    position=position,
                    is_table=True,
                    parent=None,
                ))
                position += 1
            continue

        text = _clean(block.get("text") or "")
        if not text:
            continue

        extracted.append(ExtractedBlock(
            node_id=block.get("nodeId", ""),
            text=text,
            position=position,
            is_table=False,
            parent=None,
        ))
        position += 1

    return extracted


def _extract_pdf(path: str) -> list[ExtractedBlock]:
    import fitz  # pymupdf
    extracted: list[ExtractedBlock] = []
    position = 0
    with fitz.open(path) as doc:
        for page_num, page in enumerate(doc):
            for block in page.get_text("blocks"):
                # blocks: (x0, y0, x1, y1, text, block_no, block_type)
                # block_type: 0=text, 1=image
                if block[6] != 0:
                    continue
                for line_idx, raw_line in enumerate(block[4].split("\n")):
                    text = _clean(raw_line)
                    if not text:
                        continue
                    extracted.append(ExtractedBlock(
                        node_id=f"pdf-{page_num}-{block[5]}-{line_idx}",
                        text=text,
                        position=position,
                        is_table=False,
                        parent=None,
                    ))
                    position += 1
    return extracted


def _extract_text(path: str, prefix: str = "txt") -> list[ExtractedBlock]:
    with open(path, encoding="utf-8", errors="replace") as f:
        lines = f.readlines()
    extracted: list[ExtractedBlock] = []
    position = 0
    for i, line in enumerate(lines):
        text = _clean(line)
        if not text:
            continue
        extracted.append(ExtractedBlock(
            node_id=f"{prefix}-{i}",
            text=text,
            position=position,
            is_table=False,
            parent=None,
        ))
        position += 1
    return extracted


def _extract_csv(path: str) -> list[ExtractedBlock]:
    extracted: list[ExtractedBlock] = []
    position = 0
    with open(path, encoding="utf-8", errors="replace", newline="") as f:
        reader = csv.reader(f)
        for i, row in enumerate(reader):
            text = "| " + " | ".join(_clean(cell) for cell in row) + " |"
            if not any(_clean(cell) for cell in row):
                continue
            extracted.append(ExtractedBlock(
                node_id=f"csv-{i}",
                text=text,
                position=position,
                is_table=True,
                parent=None,
            ))
            position += 1
    return extracted


async def extract_blocks(path: str) -> list[ExtractedBlock]:
    """Extract blocks from a supported file type.

    .docx uses the SuperDoc SDK; .pdf uses pymupdf; .txt/.md split on lines; .csv one row per block.
    """
    ext = os.path.splitext(path)[1].lower()
    logger.info("extracting %s blocks from %s", ext, path)
    if ext == ".docx":
        blocks = await _extract_docx(path)
    elif ext == ".pdf":
        blocks = _extract_pdf(path)
    elif ext == ".txt":
        blocks = _extract_text(path, prefix="txt")
    elif ext == ".md":
        blocks = _extract_text(path, prefix="md")
    elif ext == ".csv":
        blocks = _extract_csv(path)
    else:
        raise ValueError(f"Unsupported file type: {ext}")
    logger.info("extracted %d blocks from %s", len(blocks), path)
    return blocks
