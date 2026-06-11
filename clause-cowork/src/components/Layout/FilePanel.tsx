import { useState, useRef, useEffect } from "react";
import {
  ChevronDown, ChevronRight,
  FileText, FileSpreadsheet, FileImage, FileCode, File, Search, X, Tag, Filter,
} from "lucide-react";
import { useTheme } from "../../ThemeContext";
import type { FolderTreeEntry, FolderTreeFolder, FolderTreeFile } from "../../types";
import { FONT } from "@word-graph/shared";
import { flattenFiles } from "../../utils";

interface FilePanelProps {
  tree: FolderTreeEntry[];
  onOpenDoc: (path: string, docId: string) => void;
  onOpenUnparsed: (path: string) => void;
  loading: boolean;
}

function FileTypeIcon({ name, muted }: { name: string; muted: string }) {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const s = { flexShrink: 0 } as const;
  if (ext === "docx" || ext === "doc") return <FileText size={12} color="#4f81bd" style={s} />;
  if (ext === "xlsx" || ext === "xls") return <FileSpreadsheet size={12} color="#1e7e45" style={s} />;
  if (ext === "csv") return <FileSpreadsheet size={12} color="#1e7e45" style={s} />;
  if (ext === "pdf") return <File size={12} color="#d93025" style={s} />;
  if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "gif" || ext === "svg" || ext === "webp") return <FileImage size={12} color={muted} style={s} />;
  if (ext === "md" || ext === "txt" || ext === "json" || ext === "yaml" || ext === "yml" || ext === "toml") return <FileCode size={12} color={muted} style={s} />;
  return <File size={12} color={muted} style={s} />;
}

function StatusDot({ status }: { status: "analysed" | "pending" | "viewable" }) {
  if (status === "viewable") return null;
  const color = status === "analysed" ? "#4caf72" : "#e0a040";
  return (
    <span style={{
      width: 6, height: 6, borderRadius: "50%",
      background: color, flexShrink: 0, display: "inline-block",
    }} />
  );
}

function FileRow({
  file,
  onOpenDoc,
  onOpenUnparsed,
  indent,
}: {
  file: FolderTreeFile;
  onOpenDoc: FilePanelProps["onOpenDoc"];
  onOpenUnparsed: FilePanelProps["onOpenUnparsed"];
  indent: number;
}) {
  const { theme } = useTheme();
  const parsed = file.doc_id != null;
  return (
    <div
      onClick={() => {
        if (parsed) onOpenDoc(file.path, file.doc_id!);
        else onOpenUnparsed(file.path);
      }}
      title={file.path}
      style={{
        paddingTop: 3, paddingBottom: 3, paddingRight: 10,
        paddingLeft: 10 + indent * 10,
        fontSize: FONT.sm,
        color: parsed ? theme.black : theme.muted,
        display: "flex", alignItems: "center", gap: 5,
        cursor: "pointer",
      }}
    >
      <FileTypeIcon name={file.name} muted={theme.muted} />
      <StatusDot status={file.status} />
      {file.name}
    </div>
  );
}

function FolderRow({
  folder,
  onOpenDoc,
  onOpenUnparsed,
  indent,
}: {
  folder: FolderTreeFolder;
  onOpenDoc: FilePanelProps["onOpenDoc"];
  onOpenUnparsed: FilePanelProps["onOpenUnparsed"];
  indent: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const { theme } = useTheme();

  return (
    <>
      <div
        onClick={() => setExpanded((v) => !v)}
        style={{
          paddingTop: 6, paddingBottom: 2, paddingRight: 10,
          paddingLeft: 10 + indent * 10,
          fontSize: FONT.sm, fontWeight: 600,
          color: theme.muted,
          display: "flex", alignItems: "center", gap: 4,
          cursor: "pointer", userSelect: "none",
        }}
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {folder.name}
      </div>
      {expanded && folder.children.map((entry) =>
        entry.type === "folder"
          ? <FolderRow key={entry.path} folder={entry} onOpenDoc={onOpenDoc} onOpenUnparsed={onOpenUnparsed} indent={indent + 1} />
          : <FileRow key={entry.path} file={entry} onOpenDoc={onOpenDoc} onOpenUnparsed={onOpenUnparsed} indent={indent + 1} />
      )}
    </>
  );
}


function collectDocTags(entries: FolderTreeEntry[]): string[] {
  const all = new Set<string>();
  for (const f of flattenFiles(entries)) {
    for (const t of f.doc_tags ?? []) all.add(t);
  }
  return [...all].sort();
}

function collectDocTypes(entries: FolderTreeEntry[]): string[] {
  const all = new Set<string>();
  for (const f of flattenFiles(entries)) {
    if (f.doc_type) all.add(f.doc_type);
  }
  return [...all].sort();
}

function collectFileExts(entries: FolderTreeEntry[]): string[] {
  const all = new Set<string>();
  for (const f of flattenFiles(entries)) {
    const dot = f.name.lastIndexOf(".");
    if (dot !== -1) all.add(f.name.slice(dot).toLowerCase());
  }
  return [...all].sort();
}

function FilterDropdown({ items, selected, onChange, placeholder, icon, theme }: {
  items: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  placeholder: string;
  icon: React.ReactNode;
  theme: any;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function toggle(item: string) {
    const next = new Set(selected);
    if (next.has(item)) next.delete(item); else next.add(item);
    onChange(next);
  }

  const label = selected.size === 0 ? placeholder : `${selected.size} selected`;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 4, width: "100%",
          fontSize: FONT.sm, padding: "3px 6px", borderRadius: 5, cursor: "pointer",
          border: `1px solid ${selected.size > 0 ? theme.terracotta : theme.edgeBorder}`,
          background: selected.size > 0 ? theme.terracotta + "18" : theme.graphBg,
          color: selected.size > 0 ? theme.terracotta : theme.muted,
        }}
      >
        {icon}
        <span style={{ flex: 1, textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        {selected.size > 0
          ? <X size={10} style={{ flexShrink: 0 }} onClick={(e) => { e.stopPropagation(); onChange(new Set()); }} />
          : <ChevronDown size={10} style={{ flexShrink: 0 }} />
        }
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 3px)", left: 0, right: 0, zIndex: 100,
          background: theme.base, border: `1px solid ${theme.edgeBorder}`, borderRadius: 6,
          boxShadow: "0 4px 12px rgba(0,0,0,0.12)", overflow: "hidden",
          maxHeight: 220, overflowY: "auto",
        }}>
          {selected.size > 0 && (
            <div
              onClick={() => onChange(new Set())}
              style={{
                padding: "5px 8px", cursor: "pointer", fontSize: FONT.sm,
                color: theme.terracotta, fontWeight: 600,
                borderBottom: `1px solid ${theme.edgeBorder}`,
              }}
            >
              Deselect all
            </div>
          )}
          {items.map((item) => (
            <div
              key={item}
              onClick={() => toggle(item)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "5px 8px", cursor: "pointer", fontSize: FONT.sm,
                color: theme.black,
                background: selected.has(item) ? theme.terracotta + "18" : "transparent",
              }}
            >
              <div style={{
                width: 13, height: 13, borderRadius: 3, flexShrink: 0,
                border: `1.5px solid ${selected.has(item) ? theme.terracotta : theme.edgeBorder}`,
                background: selected.has(item) ? theme.terracotta : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {selected.has(item) && <svg width="8" height="8" viewBox="0 0 8 8"><polyline points="1,4 3,6 7,2" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>
              {item}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function FilePanel({ tree, onOpenDoc, onOpenUnparsed, loading }: FilePanelProps) {
  const { theme } = useTheme();
  const [search, setSearch] = useState("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [selectedExts, setSelectedExts] = useState<Set<string>>(new Set());
  const [selectedDocType, setSelectedDocType] = useState<string | null>(null);

  const availableTags = collectDocTags(tree);
  const availableExts = collectFileExts(tree);
  const availableDocTypes = collectDocTypes(tree);
  const isFiltering = search.trim() !== "" || selectedTags.size > 0 || selectedExts.size > 0 || selectedDocType !== null;

  const filteredFiles = isFiltering
    ? flattenFiles(tree).filter((f) => {
        const matchesSearch = search.trim() === "" || f.name.toLowerCase().includes(search.trim().toLowerCase());
        const matchesTags = selectedTags.size === 0 || [...selectedTags].every((t) => (f.doc_tags ?? []).includes(t));
        const fileExt = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
        const matchesExt = selectedExts.size === 0 || selectedExts.has(fileExt);
        const matchesDocType = selectedDocType === null || f.doc_type === selectedDocType;
        return matchesSearch && matchesTags && matchesExt && matchesDocType;
      })
    : null;

  return (
    <div style={{
      width: 190, background: theme.base,
      borderRight: `1px solid ${theme.edgeBorder}`,
      display: "flex", flexDirection: "column",
      flexShrink: 0, height: "100%",
    }}>
      {/* Header */}
      <div style={{
        padding: "8px 12px",
        fontSize: FONT.sm, fontWeight: 700,
        color: theme.muted, textTransform: "uppercase",
        letterSpacing: "0.06em",
        borderBottom: `1px solid ${theme.edgeBorder}`,
        flexShrink: 0,
      }}>
        Explorer
      </div>

      {/* Search */}
      <div style={{ padding: "6px 8px", borderBottom: `1px solid ${theme.edgeBorder}`, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, background: theme.graphBg, border: `1px solid ${theme.edgeBorder}`, borderRadius: 5, padding: "3px 6px" }}>
          <Search size={11} color={theme.muted} style={{ flexShrink: 0 }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files…"
            style={{
              flex: 1, fontSize: FONT.sm, background: "transparent",
              border: "none", outline: "none", color: theme.black, minWidth: 0,
            }}
          />
          {search && (
            <button onClick={() => setSearch("")} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex" }}>
              <X size={10} color={theme.muted} />
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      {(availableDocTypes.length > 0 || availableTags.length > 0 || availableExts.length > 1) && (
        <div style={{ padding: "4px 8px", borderBottom: `1px solid ${theme.edgeBorder}`, flexShrink: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {availableDocTypes.length > 0 && (
            <FilterDropdown
              items={availableDocTypes}
              selected={selectedDocType ? new Set([selectedDocType]) : new Set()}
              onChange={(s) => setSelectedDocType(s.size > 0 ? [...s][0] : null)}
              placeholder="Filter by document type"
              icon={<Tag size={10} style={{ flexShrink: 0 }} />}
              theme={theme}
            />
          )}
          {availableTags.length > 0 && (
            <FilterDropdown
              items={availableTags}
              selected={selectedTags}
              onChange={setSelectedTags}
              placeholder="Filter by document tag"
              icon={<Tag size={10} style={{ flexShrink: 0 }} />}
              theme={theme}
            />
          )}
          {availableExts.length > 1 && (
            <FilterDropdown
              items={availableExts}
              selected={selectedExts}
              onChange={setSelectedExts}
              placeholder="Filter by file type"
              icon={<Filter size={10} style={{ flexShrink: 0 }} />}
              theme={theme}
            />
          )}
        </div>
      )}

      {/* File list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && (
          <div style={{ padding: 12, fontSize: FONT.sm, color: theme.muted }}>Loading…</div>
        )}

        {!loading && filteredFiles !== null && (
          filteredFiles.length === 0
            ? <div style={{ padding: "8px 12px", fontSize: FONT.sm, color: theme.muted }}>No matches</div>
            : filteredFiles.map((f) => (
                <FileRow key={f.path} file={f} onOpenDoc={onOpenDoc} onOpenUnparsed={onOpenUnparsed} indent={0} />
              ))
        )}

        {!loading && filteredFiles === null && tree.map((entry) =>
          entry.type === "folder"
            ? <FolderRow key={entry.path} folder={entry} onOpenDoc={onOpenDoc} onOpenUnparsed={onOpenUnparsed} indent={0} />
            : <FileRow key={entry.path} file={entry as FolderTreeFile} onOpenDoc={onOpenDoc} onOpenUnparsed={onOpenUnparsed} indent={0} />
        )}
      </div>
    </div>
  );
}
