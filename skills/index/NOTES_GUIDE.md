# Notes Guide

Per-document notes live at `.clause-cowork/notes/wiki/<filename>.md`. They are the **primary retrieval layer** — written so a future agent or human can answer questions without re-opening the source file.

## General format

```markdown
<!-- last_updated: <ISO timestamp e.g. 2026-06-02T15:30:00Z> -->
# <filename> — <Document Type>
<Key identifiers — parties, date, jurisdiction, or whatever is most relevant for this document type>

## Summary
2-3 sentences: what this document is, why it matters, overall assessment.

## Content
The substance of the document, organised by section. 1-2 lines per section or subsection if available — capture thresholds, obligations, decisions, or facts that matter. This should provide detail to the point where an AI agent reading this can navigate to the clause section or article before doing a deeper read of the source material.

## Flags
Anything unusual, one-sided, missing, or worth flagging — one line each.

## Related Documents
Only if other docs in this workspace relate to this one:
- `<other-filename>`: <how they relate>
```

## Rules

- Write substance, not headings.
- No `stable_id` values. Refer to sections by heading text.
- No raw verbatim text — paraphrase the effect or decision.
- Flags must be actionable: the reader should know what to do with them.
- Update notes incrementally — do not rewrite the whole file if only one section changed.
- **Index phase**: write Summary, Key Content, Flags from reading the document.
- **Analyse phase**: add or refine Related Documents once connections are recorded in the DB.

---

## Document type: Contracts

For contracts, use this format:

```markdown
<!-- last_updated: <ISO timestamp e.g. 2026-06-02T15:30:00Z> -->
# <filename> — <Contract Type e.g. MSA, SOW, NDA, Merger Agreement>
Parties: <Party A> / <Party B> | Dated: <date> | Governing Law: <jurisdiction>

## Summary
2-3 sentences: what this contract does, key commercial terms, overall risk profile.

## Content
1-2 lines per section and subsection capturing the legal substance: e.g.
-**Article I**: ...
-**Article II**: ...
- **Liability**: Capped at 2× fees paid in prior 12 months; mutual exclusion of consequential loss.
  - *Liability — Exceptions*: IP indemnity and fraud are uncapped.
- **Termination**: Either party on 30 days notice; immediate for material breach uncured after 14 days.
- **IP Ownership**: Work-for-hire; contractor retains background IP with licence grant to customer.
- **Payment**: Net-30; interest at 1.5%/month on overdue amounts; suspension right after 60 days.

## Risk Flags
Anything unusual, one-sided, missing, or deviating from market standard — one line each:
- No cap on customer's termination for convenience — asymmetric exit rights.
- Indemnity covers third-party IP claims but carves out gross negligence.

## Related Documents
Only if other docs in this workspace relate to this one:
- `<other-filename>`: <how they relate>
```

Contract-specific rules:
- Risk Flags must be actionable: a lawyer reading this should know what to negotiate.
- Focus on thresholds, obligations, and carve-outs — not recitals or boilerplate definitions.

---

## log.md — activity log

`.clause-cowork/notes/log.md` is an append-only activity log. One entry per event per document, never edited.

**Format:**
```
YYYY-MM-DD HH:MM:SS | indexed  | <relative_path_from_workspace_root>
YYYY-MM-DD HH:MM:SS | analysed | <relative_path_from_workspace_root>
```

**Events:**
- `indexed` — written by `/index` after reading a document and writing/updating its wiki note
- `analysed` — written by `/analyse` after completing clause classification for a document

**Rules:**
- Paths are relative to workspace root (e.g. `contracts/employment.docx`)
- Never edit or delete existing entries — append only
- Greppable: `grep "| indexed  |" .clause-cowork/notes/log.md | grep "employment.docx" | tail -1`

---

## Navigation Hierarchy

When answering questions about a document, stop as soon as you have enough:

1. **Notes** — check `.clause-cowork/notes/wiki/<filename>.md` first
2. **DB search** — `python3 .clause-cowork/scripts/get_clauses.py <doc_id> --search "keyword"`
3. **Section navigation** — get headings first, then fetch clauses under the relevant section:
   ```bash
   python3 .clause-cowork/scripts/get_clauses.py <doc_id> --type "Section Title"
   python3 .clause-cowork/scripts/get_clauses.py <doc_id> --parent "7. REGULATORY APPROVALS"
   ```
4. **SuperDoc fallback** — last resort when DB is incomplete or notes are missing:
   ```python
   from superdoc import AsyncSuperDocClient
   async with AsyncSuperDocClient() as client:
       doc = await client.open({"doc": "<doc_path>"})
       text = await doc.get_text()      # quick scan
       md   = await doc.get_markdown()  # structure-aware navigation
       await doc.close({})
   ```
