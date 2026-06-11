CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    last_analysed_at REAL,
    last_extracted_at REAL,
    file_mtime REAL,
    doc_type TEXT,
    doc_tags TEXT DEFAULT '[]',
    notes TEXT DEFAULT '',
    content_hash TEXT,
    path_hash TEXT,
    tombstoned INTEGER DEFAULT 0
);


CREATE TABLE IF NOT EXISTS clauses (
    stable_id TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    paragraph_hash TEXT NOT NULL,
    position INTEGER NOT NULL,
    raw_text TEXT NOT NULL,
    clause_type TEXT,
    jurisdiction TEXT,
    owner TEXT,
    is_table INTEGER DEFAULT 0,
    tombstoned INTEGER DEFAULT 0,
    parent TEXT,
    needs_reclassification INTEGER DEFAULT 0,
    classified_hash TEXT,
    classified_text TEXT,
    updated_at REAL,
    PRIMARY KEY (stable_id, doc_id),
    FOREIGN KEY (doc_id) REFERENCES documents(id)
);

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clause_id TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    value TEXT NOT NULL,
    user_defined INTEGER DEFAULT 0,
    UNIQUE(clause_id, doc_id, value),
    FOREIGN KEY (clause_id, doc_id) REFERENCES clauses(stable_id, doc_id)
);

CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    source_doc_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    target_doc_id TEXT NOT NULL,
    edge_type TEXT NOT NULL,
    note TEXT,
    user_created INTEGER DEFAULT 0,
    user_rejected INTEGER DEFAULT 0,
    FOREIGN KEY (source_id, source_doc_id) REFERENCES clauses(stable_id, doc_id),
    FOREIGN KEY (target_id, target_doc_id) REFERENCES clauses(stable_id, doc_id)
);

CREATE TABLE IF NOT EXISTS document_links (
    id TEXT PRIMARY KEY,
    source_doc_id TEXT NOT NULL,
    target_doc_id TEXT NOT NULL,
    relationship TEXT NOT NULL DEFAULT 'references',
    note TEXT,
    created_by TEXT NOT NULL DEFAULT 'agent',
    created_at TEXT NOT NULL,
    broken_at TEXT,
    FOREIGN KEY (source_doc_id) REFERENCES documents(id),
    FOREIGN KEY (target_doc_id) REFERENCES documents(id)
);

CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tag_pool (
    tag TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'clause_tag'
);

CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY
);

CREATE INDEX IF NOT EXISTS idx_clauses_doc_id ON clauses(doc_id);
CREATE INDEX IF NOT EXISTS idx_clauses_hash ON clauses(paragraph_hash);
CREATE INDEX IF NOT EXISTS idx_connections_source ON connections(source_id, source_doc_id);
CREATE INDEX IF NOT EXISTS idx_connections_target ON connections(target_id, target_doc_id);
CREATE INDEX IF NOT EXISTS idx_tags_clause ON tags(clause_id, doc_id);
CREATE INDEX IF NOT EXISTS idx_tags_doc_id ON tags(doc_id);
CREATE INDEX IF NOT EXISTS idx_document_links_source ON document_links(source_doc_id);
CREATE INDEX IF NOT EXISTS idx_document_links_target ON document_links(target_doc_id);
