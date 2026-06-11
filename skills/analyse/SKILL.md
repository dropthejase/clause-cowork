---
name: analyse
description: Classify documents and clauses, assign types and tags, record connections, and build the clause graph for documents in this workspace. Run after /index. Can be targeted at a single document or run across all unclassified documents.
---

# Analyse

Parses documents into the DB, classifies all unclassified clauses, assigns parent sections, applies tags, records connections, and updates `notes/workspace.md` with graph stats.

Before starting, run `/index` to check for new or modified documents. If any are found, update their notes first before proceeding with analysis.

## Available scripts

Scripts live at `{{SKILLS_ROOT}}/skills/analyse/scripts/`. Always use the full path.

- **`{{SKILLS_ROOT}}/skills/analyse/scripts/get_docs.py`** — List all registered documents with parse state, clause count, and modification status
- **`{{SKILLS_ROOT}}/skills/analyse/scripts/parse_doc.py`** — Parse a document file into the DB
- **`{{SKILLS_ROOT}}/skills/analyse/scripts/get_workspace_config.py`** — Get vocabulary and settings for this workspace (`--level doc` or `--level clause`)
- **`{{SKILLS_ROOT}}/skills/analyse/scripts/get_clauses.py`** — Get clauses for a document (supports `--unclassified`, `--modified`, `--limit`, `--offset`, `--search`)
- **`{{SKILLS_ROOT}}/skills/analyse/scripts/set_doc_classification.py`** — Assign doc_type and doc_tags to a document
- **`{{SKILLS_ROOT}}/skills/analyse/scripts/set_clause_classification.py`** — Batch assign clause_type, clause_tags, and parent to clauses
- **`{{SKILLS_ROOT}}/skills/analyse/scripts/set_clause_connection.py`** — Record a connection between two clauses
- **`{{SKILLS_ROOT}}/skills/analyse/scripts/set_document_link.py`** — Record a cross-document link
- **`{{SKILLS_ROOT}}/skills/analyse/scripts/add_to_pool.py`** — Add a new entry to any pool when strict mode is off

## Classification model

Every workspace uses four classification layers. Understand the distinction before classifying anything.

| Layer | Field | Scope | What it answers |
|---|---|---|---|
| **Document type** | `doc_type` | Whole document | What *kind* of document is this? (e.g. `Master Services Agreement`, `Employment Agreement`) |
| **Document tags** | `doc_tags` | Whole document | What *topics* does this document cover? (e.g. `ip`, `confidentiality`) |
| **Clause type** | `clause_type` | Single clause | What *role* does this clause play structurally? (e.g. `Obligation`, `Definition`, `Indemnity`) |
| **Clause tags** | `clause_tags` | Single clause | What *concepts* does this clause touch? (e.g. `payment-terms`, `auto-renewal`, `liability-cap`) |

**Type vs tag — the key distinction:**
- A **type** is a structural role. Each clause has exactly one. Chosen from a fixed vocabulary. The agent sets it with `clause_type` in `set_clause_classification.py`.
- A **tag** is a topic label. A clause can have many. Lowercase, hyphenated. The agent sets them with `clause_tags` in `set_clause_classification.py`.
- **Never use a clause type name as a clause tag.** If the right answer is `clause_type: "Indemnity"`, do not also add `"indemnity"` as a tag — that is redundant and pollutes the tag pool. Tags should add information the type does not already capture.

**Supported formats:** `.docx`, `.pdf`, `.txt`, `.md`, `.csv`. Clauses are extracted automatically in the background — `parse_doc.py` forces an immediate re-extract. `.docx` files get full structural parsing (section hierarchy, parent assignment, connections); other formats get flat line/row blocks (type and tag classification applies, but section hierarchy and connections are not meaningful). Spreadsheets and images cannot be parsed into clauses. Document classification (`set_doc_classification.py`) can be applied to any file type.

**PDF caveat:** extraction relies on the PDF's text layer. Scanned or image-only PDFs will produce zero or near-zero clauses. If `get_clauses.py` returns an unexpectedly empty result for a PDF, tell the user: the file appears to be a scanned image — it needs OCR processing before it can be analysed.

## Steps

### 1. Check what needs work

```bash
find . -not -path "*/.clause-cowork/*" -type f
python3 {{SKILLS_ROOT}}/skills/analyse/scripts/get_docs.py
```

`find` is ground truth — what exists on disk. `get_docs.py` is the DB's view — what has been parsed and when, with clause count, connection count, and whether the file has changed since last parse.

Cross-reference the two:
- On disk but not in DB → new file, needs parsing
- In DB with `clause_count == 0` → parse failed previously, retry
- `modified_clause_count > 0` → clauses changed since last analysis; agent should re-classify modified clauses via `get_clauses.py --modified`

Check the log for last analysed time:
```bash
grep "| analysed |" .clause-cowork/notes/log.md | grep "<filename>" | tail -1
```

### 2. Classify document type

Load the document classification vocabulary first:

```bash
python3 {{SKILLS_ROOT}}/skills/analyse/scripts/get_workspace_config.py --level doc
```

Then assign doc_type and doc_tags:

```bash
python3 {{SKILLS_ROOT}}/skills/analyse/scripts/set_doc_classification.py <doc_path> '{"doc_type": "Employment Agreement", "doc_tags": []}'
```

If strict_doc_types is on and the type is not in the pool, either pick the closest match or stop and ask the user.

### 3. Record cross-document links

After classifying the document type, check whether its notes reference other workspace documents explicitly:

```bash
python3 {{SKILLS_ROOT}}/skills/analyse/scripts/set_document_link.py <source_doc_path> <target_doc_path> <relationship> [note]
# relationship: references | subject_to | contradicts
```

### 4. Parse unparsed documents

Before parsing, check size with `doc.info` — use it to plan your approach (subagents, batching).

```python
from superdoc import AsyncSuperDocClient
async with AsyncSuperDocClient() as client:
    doc = await client.open({"doc": "<doc_path>"})
    info = await doc.info()
    await doc.close({})
# info["counts"] → {words, paragraphs, headings, ...}
# info["outline"] → [{level, text, nodeId}, ...] — section structure
```

```bash
python3 {{SKILLS_ROOT}}/skills/analyse/scripts/parse_doc.py <doc_path>
```

Wait for completion before proceeding.

### 5. Load clause-level config

Always load before classifying — these reflect the user's current settings:

```bash
python3 {{SKILLS_ROOT}}/skills/analyse/scripts/get_workspace_config.py --level clause
```

### 6. Get unclassified clauses

```bash
python3 {{SKILLS_ROOT}}/skills/analyse/scripts/get_clauses.py <doc_id> --unclassified
python3 {{SKILLS_ROOT}}/skills/analyse/scripts/get_clauses.py <doc_id> --unclassified --limit 50 --offset 0   # paginated
python3 {{SKILLS_ROOT}}/skills/analyse/scripts/get_clauses.py <doc_id> --modified    # text changed since last classify
```

`get_clauses.py` returns `{total, clauses}`. Up to ~300 clauses can be loaded at once; paginate in batches of 50 for larger docs. Use subagents per document for large workspaces.

### 7. Classify clauses

**Pass clauses in position order** — `get_clauses.py` returns clauses sorted by position, so pass them in that order. Section Title and Subsection Title clauses will naturally precede their clause nodes, which is required: a clause's parent is validated against section titles already seen in the batch. Parent must be the exact `raw_text` of the nearest title clause above the clause. No paraphrasing.

```bash
python3 {{SKILLS_ROOT}}/skills/analyse/scripts/set_clause_classification.py <doc_id> '<clauses_json>'
# clauses_json: array of {stable_id, clause_type, clause_tags, parent}
# parent: exact raw_text of nearest Section/Subsection Title, or null for title clauses themselves
# clause_tags example: ["indemnity","liability-cap"]
```

Example — classify a full document in one call:
```bash
python3 {{SKILLS_ROOT}}/skills/analyse/scripts/set_clause_classification.py <doc_id> '[
  {"stable_id":"00000001","clause_type":"Section Title","clause_tags":[],"parent":null},
  {"stable_id":"00000002","clause_type":"Obligation","clause_tags":["payment","due-date"],"parent":"1. Definitions"}
]'
```

**`set_clause_classification` is a full override** — not additive:
- `clause_type` and `parent` unconditionally replace whatever was stored. Pass `null` to clear either field.
- `clause_tags` replaces all AI tags wholesale. Pass `[]` to remove all AI tags; pass the complete desired list to replace them. Do not read existing tags and merge — just pass the full intended set.
- User tags (applied via the UI) are separate and are never affected by `set_clause_classification`.
- All clauses are validated then written atomically. If any clause fails validation, nothing is written.

**For clauses with `needs_reclassification: true`** — always include them in the batch even if the classification is unchanged. This clears the flag.

**Structural clauses:**
- `Section Title`: short top-level heading, typically numbered or all-caps (`1. DEFINITIONS`, `RECITALS`). No sentence structure.
- `Subsection Title`: subordinate heading (`6.A Background IP`). Short, no verb.
- Everything else with substantive text is a clause — even if it starts with a number.

### 8. Record clause connections

Only when confident — do not guess. Re-read notes or use `get_clauses.py` to verify clause text before recording.

```bash
python3 {{SKILLS_ROOT}}/skills/analyse/scripts/set_clause_connection.py <source_id> <target_id> <edge_type> [note]
# edge_type: references | subject_to | contradicts
```

- `references` — one clause cites or cross-references another
- `subject_to` — source clause is conditioned or overridden by target (carve-outs, exceptions)
- `contradicts` — source clause conflicts with target

Only record cross-section connections — same-section links are not meaningful.
Section/subsection title clauses get no connections.

### 9. Apply and propose clause tags

Clause tags are short, lowercase, hyphenated topic labels that describe what a clause is *about* — not its structural role. Examples: `payment-terms`, `auto-renewal`, `ip-ownership`, `data-retention`, `termination-for-cause`, `governing-law`. Do not use clause type names (`obligation`, `indemnity`, `definition`, etc.) as tags — the type field already captures that.

Always apply relevant tags when classifying. Pass them in `clause_tags` — you do not need the tag to exist in the pool first (unless strict_clause_tags is on).

Check existing tags for consistency — they were returned by `get_workspace_config.py --level clause`.

If you coin a genuinely new concept, register it so future agents can reuse it (when strict mode is off):
```bash
python3 {{SKILLS_ROOT}}/skills/analyse/scripts/add_to_pool.py auto-renewal "Clauses that automatically renew a contract term" --kind clause_tag
```

### 10. Update notes and append log entry

Update the Related Documents section of `.clause-cowork/notes/wiki/<filename>.md`.

Update `.clause-cowork/notes/workspace.md` to reflect current graph stats (clause count, connection count, unclassified count).

Append an `analysed` log entry:
```
YYYY-MM-DD HH:MM:SS | analysed | <relative_path_from_workspace_root>
```
Append to `.clause-cowork/notes/log.md`. Never edit existing entries.

### 11. Confirm

One line: how many clauses classified, how many connections recorded. Tell the user to hit **↻ Refresh** in the app to see the updated graph.

## Guidelines

- Never modify source files.
- Trust `get_workspace_config.py --level clause` for clause types — do not invent types not in the list.
- Use tags from `get_workspace_config.py --level clause` — only propose genuinely new concepts.
- Use `Other` for clauses that don't fit any type; use `N/A` for non-substantive content (page numbers, TOC entries, headers).
- **Never use a clause type name as a clause tag** — e.g. do not tag a clause `"obligation"` or `"indemnity"` if you have already set `clause_type` to that value. Tags must add information the type does not already capture. See Classification model above.
- If mid-task, warn the user: **do not refresh the browser** — the ↻ Refresh button is safe; browser reload is not.
- Refer to clauses as **clauses** when talking to the user — never "nodes".
- Never mention `stable_id` values to the user.
