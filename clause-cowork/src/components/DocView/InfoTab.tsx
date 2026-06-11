import { useEffect, useState, useCallback, useRef } from "react";
import { X, Plus, Link, Unlink } from "lucide-react";
import { useTheme } from "../../ThemeContext";
import type { ThemeShape } from "@word-graph/shared";
import { FONT, listTags } from "@word-graph/shared";
import {
  getDocumentMeta, patchDocumentMeta,
  getDocumentLinks, createDocumentLink, deleteDocumentLink,
  fetchFolderTree,
} from "../../api";
import type { DocumentMeta, DocumentLink } from "../../api";
import type { FolderTreeEntry, FolderTreeFile } from "../../types";
import { flattenFiles } from "../../utils";

interface Props {
  workspacePath: string;
  docId: string;
  docPath: string;
}

const CLAUSE_TAG_COLLAPSE_AT = 5;

function ClauseTagList({ tags, theme }: { tags: string[]; theme: ThemeShape }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? tags : tags.slice(0, CLAUSE_TAG_COLLAPSE_AT);
  const hidden = tags.length - CLAUSE_TAG_COLLAPSE_AT;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
      {visible.map((tag) => (
        <span key={tag} style={{
          padding: "2px 8px", borderRadius: 9999,
          background: theme.taupe, color: theme.charcoal,
          fontSize: FONT.sm, fontWeight: 500,
        }}>{tag}</span>
      ))}
      {!expanded && hidden > 0 && (
        <button onClick={() => setExpanded(true)} style={{
          background: "none", border: "none", cursor: "pointer",
          fontSize: FONT.sm, color: theme.muted, padding: "2px 4px",
        }}>+{hidden} more</button>
      )}
      {expanded && tags.length > CLAUSE_TAG_COLLAPSE_AT && (
        <button onClick={() => setExpanded(false)} style={{
          background: "none", border: "none", cursor: "pointer",
          fontSize: FONT.sm, color: theme.muted, padding: "2px 4px",
        }}>show less</button>
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function InfoTab({ workspacePath, docId, docPath }: Props) {
  const { theme } = useTheme();
  const [meta, setMeta] = useState<DocumentMeta | null>(null);
  const [links, setLinks] = useState<DocumentLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [tagInput, setTagInput] = useState("");
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const notesSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [allFiles, setAllFiles] = useState<FolderTreeFile[]>([]);
  const [docTypePool, setDocTypePool] = useState<string[]>([]);
  const [docTagPool, setDocTagPool] = useState<string[]>([]);
  const [showDocTypePicker, setShowDocTypePicker] = useState(false);
  const pendingNotes = useRef<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [m, l] = await Promise.all([
        getDocumentMeta(workspacePath, docId, docPath),
        getDocumentLinks(workspacePath, docId),
      ]);
      setMeta(m);
      setNotesValue(m.notes);
      setLinks(l);
    } finally {
      setLoading(false);
    }
  }, [workspacePath, docId, docPath]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    fetchFolderTree(workspacePath).then((r) => setAllFiles(flattenFiles(r.tree))).catch(() => {});
    listTags(workspacePath, "doc_type").then((tags) => setDocTypePool(tags.map((t) => t.tag))).catch(() => {});
    listTags(workspacePath, "doc_tag").then((tags) => setDocTagPool(tags.map((t) => t.tag))).catch(() => {});
  }, [workspacePath]);

  // Flush any pending debounced notes save on unmount
  useEffect(() => {
    return () => {
      if (notesSaveTimer.current) {
        clearTimeout(notesSaveTimer.current);
        if (pendingNotes.current !== null) {
          patchDocumentMeta(workspacePath, docId, { notes: pendingNotes.current }).catch(() => {});
        }
      }
    };
  }, [workspacePath, docId]);

  async function setDocType(docType: string | null) {
    if (!meta) return;
    setMeta({ ...meta, doc_type: docType });
    await patchDocumentMeta(workspacePath, docId, { doc_type: docType });
  }

  async function addTag(tag: string) {
    if (!meta || !tag.trim()) return;
    const trimmed = tag.trim();
    if (meta.doc_tags.includes(trimmed)) return;
    const next = [...meta.doc_tags, trimmed];
    setMeta({ ...meta, doc_tags: next });
    await patchDocumentMeta(workspacePath, docId, { doc_tags: next });
  }

  async function removeTag(tag: string) {
    if (!meta) return;
    const next = meta.doc_tags.filter((t) => t !== tag);
    setMeta({ ...meta, doc_tags: next });
    await patchDocumentMeta(workspacePath, docId, { doc_tags: next });
  }

  function handleNotesChange(val: string) {
    setNotesValue(val);
    pendingNotes.current = val;
    if (notesSaveTimer.current) clearTimeout(notesSaveTimer.current);
    notesSaveTimer.current = setTimeout(() => {
      pendingNotes.current = null;
      patchDocumentMeta(workspacePath, docId, { notes: val }).catch(() => {});
    }, 800);
  }

  async function handleAddLink(file: FolderTreeFile) {
    await createDocumentLink(workspacePath, {
      source_doc_id: docId,
      target_doc_id: file.doc_id ?? "",
      // Pass path so backend can register a stub if doc_id not yet available
      target_file_path: file.doc_id ? undefined : file.path,
    });
    setLinkPickerOpen(false);
    reload();
  }

  async function handleRemoveLink(linkId: string) {
    await deleteDocumentLink(workspacePath, linkId);
    setLinks((prev) => prev.filter((l) => l.id !== linkId));
  }

  const labelStyle: React.CSSProperties = {
    fontSize: FONT.label, fontWeight: 700, textTransform: "uppercase",
    letterSpacing: "0.06em", color: theme.muted, marginBottom: 6,
  };

  const sectionStyle: React.CSSProperties = {
    marginBottom: 20,
  };

  if (loading) {
    return <div style={{ padding: 16, fontSize: FONT.sm, color: theme.muted }}>Loading…</div>;
  }

  if (!meta) {
    return <div style={{ padding: 16, fontSize: FONT.sm, color: theme.muted }}>Not found</div>;
  }

  const linkedPaths = new Set(links.map((l) => l.other_filename));
  const linkableFiles = allFiles.filter((f) => {
    if (f.path === meta?.path) return false; // exclude self
    if (f.doc_id === docId) return false;
    // Exclude already-linked by path match
    return !linkedPaths.has(f.name);
  });

  return (
    <div style={{ padding: "16px 16px", overflowY: "auto", height: "100%", background: theme.base }}>

      {/* File metadata */}
      <div style={sectionStyle}>
        <div style={labelStyle}>File</div>
        <table style={{ fontSize: FONT.sm, color: theme.black, borderCollapse: "collapse", width: "100%" }}>
          <tbody>
            {[
              ["Name", meta.filename],
              ["Type", meta.extension ? meta.extension.toUpperCase() : "—"],
              ["Size", meta.file_size != null ? formatBytes(meta.file_size) : "—"],
              ["Modified", formatDate(meta.file_mtime)],
              ["Last analysed", meta.last_analysed_at ? new Date(meta.last_analysed_at).toLocaleDateString() : "Not analysed"],
            ].map(([k, v]) => (
              <tr key={k}>
                <td style={{ color: theme.muted, paddingRight: 12, paddingBottom: 4, whiteSpace: "nowrap" }}>{k}</td>
                <td style={{ paddingBottom: 4 }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Document type */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Document type</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, position: "relative" }}>
          {meta.doc_type ? (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "2px 8px", borderRadius: 9999,
              background: theme.terracotta, color: "#fff",
              fontSize: FONT.sm, fontWeight: 500,
            }}>
              {meta.doc_type}
              <button onClick={() => setDocType(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#fff", padding: 0, display: "flex", alignItems: "center" }}>
                <X size={10} />
              </button>
            </span>
          ) : (
            <button
              onClick={() => setShowDocTypePicker((v) => !v)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 3,
                padding: "2px 8px", borderRadius: 9999,
                background: "none", border: `1px dashed ${theme.edgeBorder}`,
                color: theme.muted, fontSize: FONT.sm, cursor: "pointer",
              }}
            >
              <Plus size={10} /> Set type
            </button>
          )}
          {showDocTypePicker && !meta.doc_type && (
            <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 10, marginTop: 4, border: `1px solid ${theme.edgeBorder}`, borderRadius: 8, padding: 8, background: theme.base, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: 200 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {docTypePool.map((t) => (
                  <button key={t} onClick={() => { setDocType(t); setShowDocTypePicker(false); }} style={{
                    fontSize: FONT.sm, padding: "5px 10px", borderRadius: 5, textAlign: "left",
                    border: "none", background: "none", color: theme.charcoal, cursor: "pointer",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = theme.graphBg)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                  >{t}</button>
                ))}
                {docTypePool.length === 0 && (
                  <span style={{ fontSize: FONT.sm, color: theme.muted, padding: "4px 10px" }}>No types in pool yet</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Document tags */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Document tags</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
          {meta.doc_tags.map((tag) => (
            <span key={tag} style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              padding: "2px 8px", borderRadius: 9999,
              background: theme.terracotta, color: "#fff",
              fontSize: FONT.sm, fontWeight: 500,
            }}>
              {tag}
              <button onClick={() => removeTag(tag)} style={{ background: "none", border: "none", cursor: "pointer", color: "#fff", padding: 0, display: "flex", alignItems: "center" }}>
                <X size={10} />
              </button>
            </span>
          ))}
          <button
            onClick={() => setShowTagPicker((v) => !v)}
            style={{
              display: "inline-flex", alignItems: "center", gap: 3,
              padding: "2px 8px", borderRadius: 9999,
              background: "none", border: `1px dashed ${theme.edgeBorder}`,
              color: theme.muted, fontSize: FONT.sm, cursor: "pointer",
            }}
          >
            <Plus size={10} /> Add tag
          </button>
        </div>

        {showTagPicker && (
          <div style={{ border: `1px solid ${theme.edgeBorder}`, borderRadius: 8, padding: 10, background: theme.graphBg }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { addTag(tagInput); setTagInput(""); setShowTagPicker(false); } }}
                placeholder="Custom tag…"
                autoFocus
                maxLength={64}
                style={{ flex: 1, fontSize: FONT.sm, padding: "4px 8px", border: `1px solid ${theme.edgeBorder}`, borderRadius: 5, background: theme.base, outline: "none" }}
              />
              <button
                onClick={() => { addTag(tagInput); setTagInput(""); setShowTagPicker(false); }}
                style={{ fontSize: FONT.sm, padding: "4px 10px", borderRadius: 5, border: "none", background: theme.terracotta, color: "#fff", cursor: "pointer" }}
              >Add</button>
            </div>
            <div style={{ fontSize: FONT.label, color: theme.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Suggested</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {docTagPool
                .filter((t) => !meta.doc_tags.includes(t))
                .map((t) => (
                  <button key={t} onClick={() => { addTag(t); setShowTagPicker(false); }} style={{
                    fontSize: FONT.sm, padding: "2px 8px", borderRadius: 9999,
                    border: `1px solid ${theme.edgeBorder}`, background: theme.base,
                    color: theme.charcoal, cursor: "pointer",
                  }}>{t}</button>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Clause tags */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Clause tags</div>
        {meta.extension !== "docx" ? (
          <div style={{ fontSize: FONT.sm, color: theme.muted }}>Not available for this file type.</div>
        ) : meta.clause_tags.length === 0 ? (
          <div style={{ fontSize: FONT.sm, color: theme.muted }}>
            {meta.last_analysed_at ? "No clause tags assigned yet." : "Analyse this document to see clause tags."}
          </div>
        ) : (
          <ClauseTagList tags={meta.clause_tags} theme={theme} />
        )}
      </div>

      {/* Related documents */}
      <div style={sectionStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={labelStyle}>Related documents</div>
          <button
            onClick={() => setLinkPickerOpen((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: 3, fontSize: FONT.sm, color: theme.muted, background: "none", border: "none", cursor: "pointer" }}
          >
            <Link size={12} /> Link doc
          </button>
        </div>

        {linkPickerOpen && linkableFiles.length > 0 && (
          <div style={{ border: `1px solid ${theme.edgeBorder}`, borderRadius: 8, marginBottom: 8, overflow: "hidden", background: theme.graphBg }}>
            {linkableFiles.map((f) => (
              <button key={f.path} onClick={() => handleAddLink(f)} style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "6px 10px", fontSize: FONT.sm,
                background: "none", border: "none", borderBottom: `1px solid ${theme.edgeBorder}`,
                cursor: "pointer", color: theme.black,
                opacity: f.status === "viewable" ? 0.65 : 1,
              }}>
                {f.name}
                {f.status === "viewable" && (
                  <span style={{ color: theme.muted, fontSize: FONT.label, marginLeft: 6 }}>not parsed</span>
                )}
              </button>
            ))}
          </div>
        )}
        {linkPickerOpen && linkableFiles.length === 0 && (
          <div style={{ fontSize: FONT.sm, color: theme.muted, marginBottom: 8 }}>No other files to link.</div>
        )}

        {links.length === 0 && !linkPickerOpen && (
          <div style={{ fontSize: FONT.sm, color: theme.muted }}>No related documents.</div>
        )}
        {links.map((link) => (
          <div key={link.id} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "6px 0", borderBottom: `1px solid ${theme.edgeBorder}`,
            fontSize: FONT.sm,
            opacity: link.broken_at ? 0.6 : 1,
          }}>
            <div>
              <span style={{ color: link.broken_at ? theme.muted : theme.black }}>{link.other_filename}</span>
              {link.broken_at && (
                <span title="This file has been deleted" style={{ marginLeft: 6, fontSize: FONT.label, color: "#c0392b" }}>⚠ deleted</span>
              )}
              <span style={{ color: theme.muted, marginLeft: 8, fontSize: FONT.label }}>
                {link.relationship}
              </span>
              {link.note && <div style={{ color: theme.muted, fontSize: FONT.label, marginTop: 2 }}>{link.note}</div>}
            </div>
            <button onClick={() => handleRemoveLink(link.id)} style={{ background: "none", border: "none", cursor: "pointer", color: theme.muted, display: "flex", alignItems: "center" }}>
              <Unlink size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Notes */}
      <div style={sectionStyle}>
        <div style={{ ...labelStyle, display: "flex", justifyContent: "space-between" }}>
          <span>Notes</span>
          {notesValue.length > 1600 && (
            <span style={{ fontSize: FONT.sm, fontWeight: 400, color: notesValue.length >= 2048 ? "#b91c1c" : theme.muted }}>
              {notesValue.length}/2048
            </span>
          )}
        </div>
        <textarea
          value={notesValue}
          onChange={(e) => handleNotesChange(e.target.value)}
          placeholder="Add notes about this document…"
          maxLength={2048}
          style={{
            width: "100%", minHeight: 100, resize: "vertical",
            fontSize: FONT.sm, padding: "8px 10px",
            border: `1px solid ${theme.edgeBorder}`, borderRadius: 6,
            background: theme.graphBg, color: theme.black,
            outline: "none", fontFamily: "inherit", boxSizing: "border-box",
          }}
        />
      </div>
    </div>
  );
}
