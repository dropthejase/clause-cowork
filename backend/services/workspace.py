"""Maintains .clause-cowork/workspace.md — a human/agent-readable summary of all parsed documents.

WorkspaceService.update() is called after every parse. It merges the current document's entry
into the existing file, preserving summaries for documents whose mtime hasn't changed.
"""
from __future__ import annotations
import logging
import os
import re
from datetime import datetime
from models.clause import Clause
from models.config import WorkspaceConfig

logger = logging.getLogger(__name__)


_ENTRY_RE = re.compile(
    r"### (?P<name>[^\n]+)\n(?P<body>(?:.|\n)*?)(?=\n### |\Z)",
    re.MULTILINE,
)
_MTIME_RE = re.compile(r"- Last modified: (?P<mtime>[^\n]+)")

def _fmt_dt(ts: float) -> str:
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")


def _parse_entries(content: str) -> dict[str, dict]:
    """Return {filename: {body, mtime_str, summary}} from existing workspace.md."""
    entries: dict[str, dict] = {}
    docs_match = re.search(r"## Documents\n(.*)", content, re.DOTALL)
    if not docs_match:
        return entries
    docs_section = docs_match.group(1)
    for m in _ENTRY_RE.finditer(docs_section):
        name = m.group("name").strip()
        body = m.group("body").rstrip()
        mtime_m = _MTIME_RE.search(body)
        mtime_str = mtime_m.group("mtime").strip() if mtime_m else ""
        # Summary is the indented block at the end (after last bullet)
        last_bullet = max(body.rfind("\n- "), body.rfind("\n  "))
        summary = ""
        after = body[body.rfind("\n- "):]
        lines_after = [
            l[2:] for l in after.split("\n")[1:] if l.startswith("  ") and l.strip()
        ]
        if lines_after:
            summary = " ".join(lines_after)
        entries[name] = {"body": body, "mtime_str": mtime_str, "summary": summary}
    return entries


def _build_entry(
    doc_path: str,
    clauses: list[Clause],
    summary: str,
) -> str:
    filename = os.path.basename(doc_path)
    mtime_ts = os.path.getmtime(doc_path)
    mtime_str = _fmt_dt(mtime_ts)
    last_parsed = _fmt_dt(datetime.now().timestamp())

    # Stats
    active_clauses = [c for c in clauses if not c.tombstoned]
    sections = list(dict.fromkeys(
        c.parent for c in active_clauses if c.parent
    ))
    section_count = len(sections)
    clause_count = len(active_clauses)
    connection_count = sum(len(c.connections) for c in active_clauses)

    # Infer doc type from first section name or fall back to generic
    doc_type = sections[0] if sections else "Document"

    lines = [
        f"### {filename}",
        f"- Path: {doc_path}",
        f"- Last parsed: {last_parsed}",
        f"- Last modified: {mtime_str}",
        f"- Type: {doc_type}",
        f"- Sections: {section_count} | Clauses: {clause_count} | Connections: {connection_count}",
    ]
    if summary:
        lines.append("")
        for line in summary.splitlines():
            lines.append(f"  {line}")
    return "\n".join(lines)


async def _generate_summary(
    doc_path: str,
    clauses: list[Clause],
    config: WorkspaceConfig,
) -> str:
    return ""


class WorkspaceService:
    async def update(
        self,
        doc_path: str,
        clauses: list[Clause],
        config: WorkspaceConfig,
    ) -> None:
        workspace_folder = os.path.join(os.path.dirname(doc_path), ".clause-cowork")
        os.makedirs(workspace_folder, exist_ok=True)
        md_path = os.path.join(workspace_folder, "workspace.md")

        # Read existing entries
        existing: dict[str, dict] = {}
        if os.path.exists(md_path):
            with open(md_path, "r", encoding="utf-8") as f:
                existing = _parse_entries(f.read())

        filename = os.path.basename(doc_path)
        mtime_ts = os.path.getmtime(doc_path)
        mtime_str = _fmt_dt(mtime_ts)

        # Decide whether to reuse cached summary
        prev = existing.get(filename, {})
        if prev.get("mtime_str") == mtime_str and prev.get("summary"):
            summary = prev["summary"]
        else:
            try:
                summary = await _generate_summary(doc_path, clauses, config)
            except Exception:
                summary = ""

        # Build updated entry for the current doc
        entry = _build_entry(doc_path, clauses, summary)

        # Merge: update current doc, preserve others
        all_names = list(existing.keys())
        if filename not in all_names:
            all_names.append(filename)

        sections_out = []
        for name in all_names:
            if name == filename:
                sections_out.append(entry)
            else:
                sections_out.append(f"### {name}\n{existing[name]['body']}")

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
        content = (
            f"# Workspace\n\nLast updated: {now_str}\n\n"
            "## Documents\n\n"
            + "\n\n".join(sections_out)
            + "\n"
        )

        with open(md_path, "w", encoding="utf-8") as f:
            f.write(content)
        logger.info("updated workspace.md for %s (%d active clauses)", os.path.basename(doc_path), len([c for c in clauses if not c.tombstoned]))
