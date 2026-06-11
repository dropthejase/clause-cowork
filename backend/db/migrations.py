"""Schema application and one-shot data migrations.

apply_schema() is called on every startup — it is idempotent (schema.sql uses IF NOT EXISTS).
One-shot ALTER TABLE migrations are tracked in the _migrations table so they never re-run.
Do NOT add new entries here; this file exists only to patch two legacy columns that pre-date
the current schema-first approach. All future schema changes go in schema.sql only.
"""
import os
import aiosqlite

_SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "schema.sql")

_DEFAULT_CONFIG_KEY = "workspace"

_DEFAULT_DOC_TYPES = [
    ("Employment",              "Employment contracts, offer letters, HR agreements"),
    ("Data Processing",         "Data processing agreements, DPAs, GDPR-related"),
    ("NDA / Confidentiality",   "Non-disclosure and confidentiality agreements"),
    ("Services Agreement",      "Service contracts, SOWs, consulting agreements"),
    ("IP / Licensing",          "IP assignments, software licences, IP licensing"),
    ("Finance / Loan",          "Loan agreements, facility letters, financial instruments"),
    ("Real Estate",             "Leases, property sale, real estate agreements"),
    ("M&A",                     "Mergers, acquisitions, share purchase agreements"),
    ("Shareholder / Corporate", "Shareholder agreements, articles, corporate resolutions"),
    ("Regulatory / Compliance", "Regulatory filings, compliance policies, consent orders"),
]

_DEFAULT_CLAUSE_TYPES = [
    ("Section Title",   "A top-level section heading e.g. '1. Definitions', '2. Scope of Services', or the document title. Structural only — not a substantive clause."),
    ("Subsection Title","A subordinate heading below a top-level section e.g. '1.1', '2A', 'Schedule 1'. Structural only — not a substantive clause."),
    ("Definition",      "A clause that defines a term used elsewhere in the document."),
    ("Obligation",      "A clause that imposes a duty or requirement on a party."),
    ("Exclusion",       "A clause that limits or excludes liability or scope."),
    ("Indemnity",       "A clause where one party agrees to compensate another for losses."),
    ("Recital",         "Background or context clause, typically in the preamble."),
    ("Condition",       "A clause that makes obligations or rights contingent on an event."),
    ("Governing Law",   "A clause specifying the legal jurisdiction governing the contract."),
    ("Liability Cap",   "A clause limiting the maximum liability of a party."),
    ("Other",           "A substantive clause that doesn't fit any other type — use sparingly."),
    ("N/A",             "Non-substantive content: page numbers, TOC entries, cover page fragments, headers, footers. Not a clause."),
]


async def apply_schema(db_path: str) -> None:
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    with open(_SCHEMA_PATH) as f:
        schema = f.read()
    async with aiosqlite.connect(db_path) as db:
        await db.executescript(schema)
        await _seed_defaults(db)
        await _migrate_tags_connections(db)
        await db.commit()


async def _migrate_tags_connections(db: aiosqlite.Connection) -> None:
    """One-shot migrations tracked via _migrations table."""
    done = {r[0] for r in await (await db.execute("SELECT name FROM _migrations")).fetchall()}

    if "tags_doc_id" not in done:
        await db.execute("ALTER TABLE tags ADD COLUMN doc_id TEXT NOT NULL DEFAULT ''")
        await db.execute("""
            UPDATE tags SET doc_id = (
                SELECT doc_id FROM clauses WHERE clauses.stable_id = tags.clause_id LIMIT 1
            ) WHERE doc_id = ''
        """)
        await db.execute("DELETE FROM tags WHERE doc_id = ''")
        await db.execute("INSERT INTO _migrations (name) VALUES ('tags_doc_id')")

    if "connections_doc_ids" not in done:
        await db.execute("ALTER TABLE connections ADD COLUMN source_doc_id TEXT NOT NULL DEFAULT ''")
        await db.execute("ALTER TABLE connections ADD COLUMN target_doc_id TEXT NOT NULL DEFAULT ''")
        await db.execute("""
            UPDATE connections SET source_doc_id = (
                SELECT doc_id FROM clauses WHERE clauses.stable_id = connections.source_id LIMIT 1
            ) WHERE source_doc_id = ''
        """)
        await db.execute("""
            UPDATE connections SET target_doc_id = (
                SELECT doc_id FROM clauses WHERE clauses.stable_id = connections.target_id LIMIT 1
            ) WHERE target_doc_id = ''
        """)
        await db.execute("DELETE FROM connections WHERE source_doc_id = '' OR target_doc_id = ''")
        await db.execute("INSERT INTO _migrations (name) VALUES ('connections_doc_ids')")

    if "document_links_broken_at" not in done:
        cols = {row[1] for row in await (await db.execute("PRAGMA table_info(document_links)")).fetchall()}
        if "broken_at" not in cols:
            await db.execute("ALTER TABLE document_links ADD COLUMN broken_at TEXT")
        await db.execute("INSERT INTO _migrations (name) VALUES ('document_links_broken_at')")


async def _seed_defaults(db: aiosqlite.Connection) -> None:
    """Seed config and vocabulary pools on first run only."""
    # Mark schema-native migrations as done so they don't re-run on fresh DBs
    await db.execute("INSERT OR IGNORE INTO _migrations (name) VALUES ('tags_doc_id')")
    await db.execute("INSERT OR IGNORE INTO _migrations (name) VALUES ('connections_doc_ids')")

    cursor = await db.execute("SELECT 1 FROM config WHERE key = ?", (_DEFAULT_CONFIG_KEY,))
    if await cursor.fetchone() is None:
        from models.config import WorkspaceConfig
        defaults = WorkspaceConfig()
        await db.execute(
            "INSERT INTO config (key, value) VALUES (?, ?)",
            (_DEFAULT_CONFIG_KEY, defaults.model_dump_json()),
        )

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()

    # Seed default doc types (kind=doc_type) only if none exist yet
    cursor = await db.execute("SELECT COUNT(*) FROM tag_pool WHERE kind='doc_type'")
    if (await cursor.fetchone())[0] == 0:
        for tag, description in _DEFAULT_DOC_TYPES:
            await db.execute(
                "INSERT OR IGNORE INTO tag_pool (tag, description, source, created_at, kind) VALUES (?,?,?,?,?)",
                (tag, description, "default", now, "doc_type"),
            )

    # Seed default clause types (kind=clause_type) only if none exist yet
    cursor = await db.execute("SELECT COUNT(*) FROM tag_pool WHERE kind='clause_type'")
    if (await cursor.fetchone())[0] == 0:
        for tag, description in _DEFAULT_CLAUSE_TYPES:
            await db.execute(
                "INSERT OR IGNORE INTO tag_pool (tag, description, source, created_at, kind) VALUES (?,?,?,?,?)",
                (tag, description, "default", now, "clause_type"),
            )


async def restore_default_doc_types(db_path: str) -> int:
    """Re-insert any missing default doc types. Returns count restored."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    restored = 0
    async with aiosqlite.connect(db_path) as db:
        for tag, description in _DEFAULT_DOC_TYPES:
            cur = await db.execute(
                "INSERT OR IGNORE INTO tag_pool (tag, description, source, created_at, kind) VALUES (?,?,?,?,?)",
                (tag, description, "default", now, "doc_type"),
            )
            if cur.rowcount:
                restored += 1
        await db.commit()
    return restored


async def restore_default_clause_types(db_path: str) -> int:
    """Re-insert any missing default clause types. Returns count restored."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    restored = 0
    async with aiosqlite.connect(db_path) as db:
        for tag, description in _DEFAULT_CLAUSE_TYPES:
            cur = await db.execute(
                "INSERT OR IGNORE INTO tag_pool (tag, description, source, created_at, kind) VALUES (?,?,?,?,?)",
                (tag, description, "default", now, "clause_type"),
            )
            if cur.rowcount:
                restored += 1
        await db.commit()
    return restored
