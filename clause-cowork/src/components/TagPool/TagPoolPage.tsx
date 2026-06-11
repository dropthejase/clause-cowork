import { useState, useCallback, useRef } from "react";
import { useTheme } from "../../ThemeContext";
import { useAppStore } from "../../store";
import {
  listTags, addTag, updateTag, deleteTag, importTags, exportTags, Section,
} from "@word-graph/shared";
import type { PoolTag, TagKind } from "@word-graph/shared";
import { FONT } from "@word-graph/shared";

function basename(p: string): string {
  return p.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? p;
}

export function TagPoolPage({ onBack, hideHeader, strict = false, onStrictChange, kind: kindProp }: { onBack: () => void; hideHeader?: boolean; strict?: boolean; onStrictChange?: (v: boolean) => void; kind?: TagKind }) {
  const kind: TagKind = kindProp ?? "clause_tag";
  const { theme } = useTheme();
  const { activeWorkspace } = useAppStore();
  const docPath = activeWorkspace ?? "";

  const [tags, setTags] = useState<PoolTag[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [newTag, setNewTag] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadTags = useCallback(async () => {
    if (!docPath) return;
    setSyncing(true);
    try {
      const data = await listTags(docPath, kind);
      setTags(data);
      setLastSyncedAt(new Date());
      setLoaded(true);
    } catch {
      setError("Failed to load tags.");
    } finally {
      setSyncing(false);
    }
  }, [docPath, kind]);

  // Load on first render
  if (!loaded && !syncing) loadTags();

  const sortedTags = [...tags].sort((a, b) => a.tag.localeCompare(b.tag));
  const allSelected = sortedTags.length > 0 && selectedTags.size === sortedTags.length;

  function toggleEditMode() {
    setEditMode((v) => !v);
    setSelectedTags(new Set());
    setConfirmBulkDelete(false);
    setEditingTag(null);
  }

  function toggleTagSelect(tag: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  }

  async function handleAdd() {
    const tagVal = newTag.trim().toLowerCase().replace(/\s+/g, "-");
    const descVal = newDesc.trim();
    if (!tagVal || !descVal) return;
    setError(null);
    try {
      await addTag(docPath, tagVal, descVal, "manual", kind);
      setNewTag(""); setNewDesc("");
      await loadTags();
    } catch {
      setError("Failed to add tag.");
    }
  }

  async function handleSaveEdit(tag: string) {
    if (!editDesc.trim()) return;
    setError(null);
    try {
      await updateTag(docPath, tag, editDesc.trim());
      setEditingTag(null); setEditDesc("");
      await loadTags();
    } catch {
      setError("Failed to update tag.");
    }
  }

  async function handleBulkDelete() {
    setError(null);
    try {
      await Promise.all(Array.from(selectedTags).map((tag) => deleteTag(docPath, tag)));
      setSelectedTags(new Set());
      setConfirmBulkDelete(false);
      setEditMode(false);
      await loadTags();
    } catch {
      setError("Failed to delete some tags.");
    }
  }

  async function handleExport() {
    setError(null);
    try {
      const { path } = await exportTags(docPath, kind);
      setExportPath(path);
    } catch (e) {
      setError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function handleFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    if (file.size > 1_000_000) {
      setError("File too large — CSV must be under 1 MB.");
      e.target.value = "";
      return;
    }
    try {
      const csv = await file.text();
      const r = await importTags(docPath, csv, kind);
      if (r.errors.length > 0) setError(r.errors.join(" | "));
      await loadTags();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail ?? "Import failed — check backend logs.");
    } finally {
      e.target.value = "";
    }
  }

  const inputStyle: React.CSSProperties = {
    fontSize: FONT.md, color: theme.black, background: theme.base,
    border: `1px solid ${theme.edgeBorder}`, borderRadius: 6,
    padding: "5px 9px", width: "100%", outline: "none",
  };

  const btnSecondary: React.CSSProperties = {
    fontSize: FONT.md, padding: "4px 10px", borderRadius: 6,
    border: `1px solid ${theme.edgeBorder}`, background: theme.white,
    cursor: "pointer", color: theme.charcoal,
  };

  const btnPrimary: React.CSSProperties = {
    fontSize: FONT.md, fontWeight: 600, padding: "4px 10px", borderRadius: 6,
    border: "none", background: theme.terracotta, color: "#fff", cursor: "pointer",
  };

  const syncLabel = lastSyncedAt
    ? `Last synced ${lastSyncedAt.toLocaleTimeString()}`
    : "Not yet synced";

  return (
    <div style={hideHeader ? undefined : { background: theme.graphBg, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Toolbar — hidden when embedded inside TagPoolShell */}
      {!hideHeader && (
        <div style={{ background: theme.base, borderBottom: `1px solid ${theme.edgeBorder}`, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button
            onClick={onBack}
            style={{ display: "flex", alignItems: "center", gap: 5, fontSize: FONT.md, color: theme.muted, background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M19 12H5M12 5l-7 7 7 7"/>
            </svg>
            Back
          </button>
          <span style={{ fontSize: FONT.md, fontWeight: 600, color: theme.black }}>
            Tag Pool — {basename(docPath)}
          </span>
        </div>
      )}

      <div style={hideHeader ? undefined : { flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 680, margin: "0 auto", padding: hideHeader ? "20px 32px 0" : "28px 32px 80px" }}>
          <Section label={kind === "doc_tag" ? "Document Tags" : "Clause Tags"} badge={<span style={{ fontSize: FONT.md, color: theme.muted }}>{tags.length}/100</span>}>

            {/* Description */}
            <div style={{ padding: "8px 13px", borderBottom: `1px solid ${theme.edgeBorder}`, background: theme.white }}>
              <p style={{ margin: 0, fontSize: FONT.sm, color: theme.muted, lineHeight: 1.5 }}>
                {kind === "doc_tag"
                  ? "Topic labels applied to whole documents. The agent assigns these during analysis. You can also add, edit, or remove tags manually."
                  : "Topic labels applied to individual clauses. The agent assigns these during analysis and may propose new ones. You can also add, edit, or remove tags manually."
                }
              </p>
            </div>

            {/* Strict mode toggle */}
            {onStrictChange && (
              <div style={{ padding: "8px 13px", borderBottom: `1px solid ${theme.edgeBorder}`, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: FONT.md, color: theme.muted, flex: 1 }}>Lock tags — agent may only use tags from this list</span>
                <button
                  onClick={() => onStrictChange(!strict)}
                  style={{ width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer", padding: 0, background: strict ? theme.terracotta : theme.edgeBorder, position: "relative", flexShrink: 0, transition: "background 0.2s" }}
                >
                  <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: strict ? 19 : 3, transition: "left 0.2s" }} />
                </button>
              </div>
            )}

            {/* Toolbar */}
            <div style={{ padding: "6px 13px", borderBottom: `1px solid ${theme.base}`, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: FONT.md, color: theme.muted, flex: 1 }}>{syncLabel}</span>
              <button onClick={loadTags} disabled={syncing} style={btnSecondary}>
                {syncing ? "Syncing…" : "Sync now"}
              </button>
              <input ref={fileInputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={handleFileImport} />
              <button onClick={() => fileInputRef.current?.click()} title="CSV must have 'tag' and 'description' columns. Tag names truncated to 64 chars, descriptions to 256. Max 100 tags." style={btnSecondary}>Import CSV</button>
              <button onClick={handleExport} style={btnSecondary}>Export CSV</button>
              {tags.length > 0 && (
                <button
                  onClick={toggleEditMode}
                  style={{
                    fontSize: FONT.md, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                    border: editMode ? "none" : `1px solid ${theme.edgeBorder}`,
                    background: editMode ? theme.terracotta : theme.base,
                    color: editMode ? "#fff" : theme.muted, fontWeight: editMode ? 700 : 400,
                  }}
                >
                  {editMode ? "Done" : "Edit"}
                </button>
              )}
            </div>

            {/* Edit mode action bar */}
            {editMode && (
              <div style={{ padding: "6px 13px", borderBottom: `1px solid ${theme.base}`, display: "flex", alignItems: "center", gap: 8, background: theme.graphBg }}>
                <button
                  onClick={() => setSelectedTags(allSelected ? new Set() : new Set(sortedTags.map((t) => t.tag)))}
                  style={{ fontSize: FONT.md, padding: "3px 8px", borderRadius: 6, border: `1px solid ${theme.edgeBorder}`, background: theme.white, cursor: "pointer", color: theme.charcoal }}
                >
                  {allSelected ? "Deselect all" : "Select all"}
                </button>
                <span style={{ fontSize: FONT.md, color: theme.muted, flex: 1 }}>{selectedTags.size} selected</span>
                {selectedTags.size > 0 && !confirmBulkDelete && (
                  <button
                    onClick={() => setConfirmBulkDelete(true)}
                    style={{ fontSize: FONT.md, fontWeight: 600, padding: "4px 10px", borderRadius: 6, border: "1px solid #fecaca", background: "#fff0f0", color: "#b91c1c", cursor: "pointer" }}
                  >
                    Delete selected
                  </button>
                )}
                {confirmBulkDelete && (
                  <>
                    <span style={{ fontSize: FONT.md, color: "#b91c1c", fontWeight: 600 }}>Sure?</span>
                    <button onClick={handleBulkDelete} style={{ fontSize: FONT.md, fontWeight: 700, background: "#b91c1c", color: "#fff", border: "none", borderRadius: 6, padding: "4px 9px", cursor: "pointer" }}>Yes</button>
                    <button onClick={() => setConfirmBulkDelete(false)} style={{ ...btnSecondary, fontSize: FONT.md }}>No</button>
                  </>
                )}
              </div>
            )}

            {error && <div style={{ padding: "4px 13px", fontSize: FONT.md, color: "#b91c1c", background: "#fff0f0" }}>{error}</div>}
            {exportPath && (
              <div style={{ padding: "6px 13px", fontSize: FONT.md, color: theme.charcoal, background: theme.base, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Saved to <code style={{ fontSize: FONT.md }}>{exportPath}</code></span>
                <button onClick={() => setExportPath(null)} style={{ background: "none", border: "none", cursor: "pointer", color: theme.muted, fontSize: FONT.title }}>×</button>
              </div>
            )}

            {/* Tag list */}
            <div style={{ padding: "6px 13px", display: "flex", flexDirection: "column", gap: 6 }}>
              {tags.length === 0 && !syncing && (
                <div style={{ fontSize: FONT.md, color: theme.muted, padding: "4px 0" }}>
                  No tags yet. Import a CSV or add manually below.
                </div>
              )}
              {sortedTags.map((t) => (
                <div key={t.tag} style={{ borderBottom: `1px solid ${theme.base}`, paddingBottom: 6 }}>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 6, cursor: editMode ? "pointer" : "default" }}
                    onClick={() => { if (!editMode || editingTag === t.tag) return; toggleTagSelect(t.tag); }}
                  >
                    {editMode && (
                      <div style={{
                        width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                        border: `2px solid ${selectedTags.has(t.tag) ? theme.charcoal : theme.edgeBorder}`,
                        background: selectedTags.has(t.tag) ? theme.charcoal : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {selectedTags.has(t.tag) && <svg width="9" height="9" viewBox="0 0 9 9"><polyline points="1.5,4.5 3.5,6.5 7.5,2.5" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </div>
                    )}
                    <span style={{ fontSize: FONT.md, fontWeight: 600, color: theme.black, flex: 1 }}>{t.tag}</span>
                    <span style={{ fontSize: FONT.md, padding: "1px 5px", borderRadius: 9999, background: theme.taupe, color: theme.muted }}>{t.source}</span>
                  </div>
                  {editingTag === t.tag ? (
                    <div style={{ marginTop: 4, display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                      <input style={{ ...inputStyle, flex: 1 }} value={editDesc} maxLength={256} onChange={(e) => setEditDesc(e.target.value)} autoFocus />
                      <button onClick={() => handleSaveEdit(t.tag)} style={btnPrimary}>Save</button>
                      <button onClick={() => { setEditingTag(null); setEditDesc(""); }} style={btnSecondary}>Cancel</button>
                    </div>
                  ) : (
                    <div
                      style={{ fontSize: FONT.md, color: theme.muted, marginTop: 2, cursor: editMode ? "text" : "default" }}
                      onClick={(e) => {
                        if (!editMode) return;
                        e.stopPropagation();
                        setEditingTag(t.tag);
                        setEditDesc(t.description);
                      }}
                    >
                      {t.description}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Add tag */}
            <div style={{ padding: "8px 13px", borderTop: `1px solid ${theme.edgeBorder}`, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: FONT.sm, color: theme.muted }}>
                Tag name: lowercase kebab-case, max 64 characters (including spaces). Description: max 256 characters.
              </div>
              <div style={{ position: "relative" }}>
                <input
                  style={inputStyle}
                  placeholder={kind === "doc_tag" ? "Tag name (e.g. Executed)" : "Tag name (e.g. auto-renewal)"}
                  value={newTag}
                  maxLength={64}
                  onChange={(e) => setNewTag(e.target.value)}
                />
                {newTag.length > 48 && (
                  <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: FONT.sm, color: newTag.length >= 64 ? "#b91c1c" : theme.muted }}>
                    {newTag.length}/64
                  </span>
                )}
              </div>
              <div>
                <textarea
                  style={{ ...inputStyle, resize: "vertical", minHeight: 56, lineHeight: 1.4, fontFamily: "inherit" }}
                  placeholder="Description — used by the agent to match clauses"
                  value={newDesc}
                  maxLength={256}
                  rows={2}
                  onChange={(e) => setNewDesc(e.target.value)}
                />
                {newDesc.length > 200 && (
                  <div style={{ textAlign: "right", fontSize: FONT.sm, color: newDesc.length >= 256 ? "#b91c1c" : theme.muted, marginTop: 2 }}>
                    {newDesc.length}/256
                  </div>
                )}
              </div>
              <button
                onClick={handleAdd}
                disabled={!newTag.trim() || !newDesc.trim() || tags.length >= 100}
                style={{ ...btnPrimary, opacity: (!newTag.trim() || !newDesc.trim() || tags.length >= 100) ? 0.4 : 1, alignSelf: "flex-start" }}
              >
                Add tag
              </button>
              {tags.length >= 100 && (
                <div style={{ fontSize: FONT.md, color: "#b91c1c" }}>Tag pool is at the 100-tag limit. Remove unused tags to add more.</div>
              )}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
