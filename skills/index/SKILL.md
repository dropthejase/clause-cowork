---
name: index
description: Read and summarise documents in this workspace, maintaining notes/workspace.md and per-document notes/wiki/ notes as a persistent knowledge base. Run when documents are new, modified, or notes are missing or outdated. Does not classify clauses — run /analyse for that.
---

# Index

Your job is to maintain `.clause-cowork/notes/workspace.md` and `.clause-cowork/notes/wiki/<filename>.md` as a living knowledge base. These files are the primary retrieval layer — future agents and humans answer questions from them without re-opening source documents.

## Available scripts

Scripts live at `{{SKILLS_ROOT}}/skills/index/scripts/`. Always use the full path.

- **`{{SKILLS_ROOT}}/skills/index/scripts/get_docs.py`** — List all registered documents with parse state and modification status

## Steps

1. Read `.clause-cowork/notes/workspace.md` if it exists. This tells you what documents are already known and summarised.

2. Run `get_docs.py` to enumerate all registered documents and their state:
   ```bash
   python3 {{SKILLS_ROOT}}/skills/index/scripts/get_docs.py
   ```
   For each document, check its log entry in `.clause-cowork/notes/log.md`:
   ```bash
   grep "| indexed  |" .clause-cowork/notes/log.md | grep "<filename>" | tail -1
   ```
   A document needs re-noting if:
   - No `indexed` log entry exists for it, or
   - `file_mtime` from `get_docs.py` is greater than the timestamp of its last `indexed` log entry

   Also run `find` to catch any files not yet registered in the DB:
   ```bash
   find . -not -path "*/.clause-cowork/*" -type f
   ```

3. For each new or modified document, **read the file itself** and update `.clause-cowork/notes/wiki/<filename>.md`. See `NOTES_GUIDE.md` for format. Be concise — a future agent reading this should be able to navigate the workspace easily through `notes/workspace.md` and `notes/wiki/<filename>.md`. Never infer content from filename, file size, or similarity to another document — always read the source.

   **How to read each file type:**
   - **`.docx`** — use SuperDoc (do not attempt to read the raw binary):
     ```python
     from superdoc import AsyncSuperDocClient
     async with AsyncSuperDocClient() as client:
         doc = await client.open({"doc": "<doc_path>"})
         text = await doc.get_text()      # plain text scan
         md   = await doc.get_markdown()  # structure-aware (headings, tables)
         await doc.close({})
     ```
   - **`.pdf`** — use `pymupdf` (`import fitz`):
     ```python
     import fitz
     with fitz.open("<doc_path>") as pdf:
         text = "\n".join(page.get_text() for page in pdf)
     ```
   - **`.xlsx` / `.xls`** — use `openpyxl`:
     ```python
     import openpyxl
     wb = openpyxl.load_workbook("<doc_path>", read_only=True, data_only=True)
     for sheet in wb.worksheets:
         for row in sheet.iter_rows(values_only=True):
             print(row)
     ```
   - **Plain text (`.txt`, `.md`, `.csv`, `.json`, `.yaml`)** — read directly with the Read tool or `open()`.
   - **Images** — describe visible content if the agent is multimodal; otherwise note "image file, content not readable".

4. Record explicit cross-references between documents.

   After reading each document, check whether its text **explicitly names** another document in the workspace by title or filename. Common patterns:
   - "This agreement is subject to the Master Services Agreement" → `subject_to`
   - "As defined in Schedule A / Exhibit B / Annex 1" → `references`
   - "This clause supersedes / replaces clause X in [document name]" → `contradicts`

   Cross-reference against the list of known documents from `get_docs.py`. Only record a link when the match is unambiguous.

   ```bash
   python3 {{SKILLS_ROOT}}/skills/index/scripts/set_document_link.py <source_doc_path> <target_doc_path> <relationship> [note]
   ```

   `relationship` must be one of: `references` | `subject_to` | `contradicts`

   The `note` argument is optional — use it to quote the verbatim sentence that triggered the link (max ~120 chars).

   **Do not infer links from document similarity, tags, or topic overlap.** If the text does not name another document explicitly, skip it. When uncertain, skip.

5. Append an `indexed` log entry for each document processed:
   ```
   YYYY-MM-DD HH:MM:SS | indexed  | <relative_path_from_workspace_root>
   ```
   Append to `.clause-cowork/notes/log.md`. Never edit existing entries.

6. Update `.clause-cowork/notes/workspace.md` to reflect a 1-2 line summary of what each document is about.

## Guidelines

- Never modify source files.
- Notes are cumulative — update only what changed, don't rewrite from scratch.
- Prefer substance over completeness. A short accurate note beats a long one with filler.
- If the user asks a question about a document, answer from notes if you can. Only open the source file if the notes are insufficient.
- Do not touch `last_parsed_at` or `file_mtime` on document rows — those belong to `/analyse`.
- Tell the user to run `/analyse` when they want document classification (doc_type, doc_tags), clause-level analysis, or the clause graph.
