# Clause CoWork — User Guide

> **Experimental project.** Clause CoWork is a personal research tool exploring what a UI layer on top of ACP (Agent Client Protocol) can look like for document-heavy workflows. It is not production software — expect rough edges, breaking changes, and missing features. It is not a substitute for legal advice or professional document review tooling.

## What it does

Clause CoWork is a local AI workspace for legal document analysis. It builds a UI layer on top of ACP-compatible AI agents (Claude Code, Kiro, Codex) — the agent does the heavy lifting; the app provides structure, persistence, and a visual interface on top. You point it at a folder of contracts, the agent reads and classifies them, and you get a searchable clause graph, cross-document links, and a persistent knowledge base — all stored locally.

Two apps share one backend:

- **Clause CoWork** (browser/Electron) — the primary workspace. Manage documents, run the agent, explore clause graphs.
- **Clause CoWork Add-in** (Word task pane) — a read-only viewer. Once a document is analysed in Clause CoWork, open it in Word and the add-in shows the clause graph synced to your cursor.

---

## Core workflow

### 1. Open a workspace

Click **+ Add workspace** and select a folder containing your documents. The file explorer shows all files. Documents are tracked in the workspace database as stubs until the agent reads them.

### 2. Connect your agent

Go to **Settings → Agent Server**, paste your agent launch command, and click **Connect**:

| Agent | Command |
|---|---|
| Claude Code | `npx @agentclientprotocol/claude-agent-acp` |
| Kiro | `kiro-cli acp` |
| Codex | `npx @zed-industries/codex-acp` |

Clicking Connect tests the connection, saves it, and automatically installs the Clause CoWork skills (`/discover` and `/analyse`) into your workspace.

### 3. Run `/index`

In the chat panel, type:

```
/index
```

The agent will:
- Read every document in the workspace (`.docx` via SuperDoc, `.pdf` via pymupdf, plain text directly)
- Write a summary note for each file at `.clause-cowork/notes/wiki/<filename>.md`
- Update `.clause-cowork/notes/workspace.md` with a one-line index of every document
- Record any explicit cross-document references it finds (e.g. "subject to the Master Services Agreement")

Re-run `/index` whenever documents are added or modified. `/index` does not classify — it only reads and writes notes.

### 4. Run `/analyse`

In the chat panel, type:

```
/analyse
```

or target a specific file:

```
/analyse path/to/contract.docx
```

The agent will:
- Parse `.docx` files into clause nodes and classify each one (Obligation, Definition, Indemnity, etc.)
- Assign tags and record cross-clause connections
- Apply document-level tags to any file type
- Store everything in the workspace SQLite database

After analysis, clause nodes appear as tiles and a force-directed graph in the document view. Modified tiles show a ⚠ pill — ask the agent to re-analyse when that appears.

### 5. Explore

- **Tiles view** — scan all clauses; filter by type or tag
- **Graph view** — force-directed layout; drag nodes to pin them; filter dims non-matching nodes
- **Clause details** — click any tile or node for full text, tags, and connections
- **Workspace graph** — click the network icon in the icon rail to see cross-document relationships coloured by type (`subject_to` → terracotta, `references` → line colour, `contradicts` → cross-doc colour)
- **Info tab** — file metadata, document tags, document links, and notes for any file type

---

## Word Add-in

The add-in is a read-only viewer — it shows what the agent has already written and does not parse or classify.

Open a `.docx` that has been analysed in Clause CoWork. The add-in shows clause tiles immediately, synced to the Word cursor. Click a tile to scroll Word to that paragraph; click a paragraph in Word to highlight the matching tile.

> If the add-in shows a stale name in the ribbon, re-sideload it: remove the old add-in via **Word → Insert → Add-ins → My Add-ins**, then run `npm run start` from the `addin/` folder.

---

## Document support

| File type | Parsed into clauses | Agent can read | Preview |
|---|---|---|---|
| `.docx` | Yes — full structure (SuperDoc): section hierarchy, stable node IDs, parent assignment | Yes | Yes (SuperDoc renderer) |
| `.pdf` | Yes — flat blocks (pymupdf). No section hierarchy; text-layer PDFs only. Scanned/image PDFs produce zero clauses. | Yes | Yes (iframe) |
| `.txt`, `.md` | Yes — one clause per non-empty line | Yes | Yes (text) |
| `.csv` | Yes — one clause per row, rendered as a pipe-table | Yes | Yes (text) |
| `.xlsx` / `.xls` | No (tracked as stub) | Yes (openpyxl) | No |
| Images | No | Yes (if multimodal) | Yes |

---

## Data storage

Everything lives in `.clause-cowork/` next to your documents:

```
my-workspace/
  contract.docx
  .clause-cowork/
    db/workspace.db         ← SQLite: nodes, connections, tags, config
    acp-session.json        ← per-agent session history
    notes/
      workspace.md          ← agent-maintained document index
      wiki/<filename>.md    ← per-document notes
      log.md                ← timestamped index/analyse history
```

To reset a workspace completely, delete `.clause-cowork/`.

---

## Settings

Open Settings from the gear icon at the bottom of the icon rail.

### Agent Server

This is where you tell Clause CoWork which AI agent to use. Paste the launch command for your agent and click **Connect**. On connect, Clause CoWork:

1. Tests the command by spawning a short-lived agent process
2. Saves it to the workspace config
3. Automatically installs the `/index` and `/analyse` skills into the workspace

The agent runs as a subprocess — it is not a cloud service. Your documents and prompts go to your configured LLM provider directly from the agent process, not through Clause CoWork's backend.

**Why you might change this:** if you want to switch between Claude Code, Kiro, or Codex; or if you've updated the agent CLI and need to re-connect to pick up the new version.

### Data & Settings

Two destructive actions, both require confirmation:

| Action | What it does | When to use |
|---|---|---|
| **Reset to defaults** | Resets strict mode flags, classification thresholds, connection guidance, and other workspace config. Tag pool vocabulary is not affected. | Agent is misclassifying and you want to start fresh with default settings. |
| **Delete document data** | Removes all parsed clause nodes, connections, and tags for the current workspace from the database. Documents themselves are untouched. | You want to re-run `/analyse` from scratch, or you're cleaning up a test workspace. |

---

## Tag Pools

Click the tag icon in the icon rail to open the Tag Pool. There are four pools per workspace, split across two tabs:

### Document tab

- **Document Type Pool** — the taxonomy of document types (e.g. `Employment Agreement`, `NDA`, `Service Agreement`). The agent assigns a single type to each document during `/analyse`.
- **Document Tag Pool** — high-level topic labels applied to whole documents (e.g. `Executed`, `Confidential`, `Party A`). The agent assigns these during `/analyse`. They appear in the Info tab.

### Clause tab

- **Clause Type Pool** — the taxonomy of clause types (e.g. `Obligation`, `Definition`, `Exclusion`). The agent assigns a single type to each clause during `/analyse`.
- **Clause Tag Pool** — fine-grained topic labels applied to individual clauses (e.g. `Limitation of Liability`, `Auto-Renewal`, `IP Assignment`). The agent assigns these during `/analyse`. They appear on tiles, in the graph, and in clause details.

Each pool can be set to **strict mode** — when on, the agent must pick from the existing pool and cannot coin new values. Use this once your vocabulary is stable.

Default tags are pre-loaded when you first open each pool. You can add, edit, or delete entries, or import/export as CSV. Deleting an entry from the pool does not remove it from documents or clauses that already have it — it just removes it as an option for future assignments.

**Import/export:** both pools support CSV with `tag` and `description` columns. Export is a good way to share a tag vocabulary across workspaces or back it up before editing.

---

## Tips

- **Run `/index` before `/analyse`** — the agent uses notes from `/index` as context during classification.
- **Document tags** are workspace-level labels (Employment, NDA, etc.) managed in the Tag Pool. Clause tags are paragraph-level.
- **Cross-document links** appear in the Workspace Graph and in each document's Info tab. The agent only records them when it finds an explicit named reference in the text — not inferred from similarity.
- **Switching agents** does not lose session history — sessions are keyed by agent binary and stored separately.
- **The add-in reflects what the agent last wrote.** After re-analysing a document, close and reopen the task pane to reload.
