import React, { useRef, useEffect, useState, useCallback } from "react";
import { SuperDocEditor, type SuperDocRef } from "@superdoc-dev/react";
import "@superdoc-dev/react/style.css";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { fetchDocxBlob, fetchFileText, filePreviewUrl } from "../../api";
import { useTheme } from "../../ThemeContext";
import type { GraphNode } from "@word-graph/shared";
import { FONT } from "@word-graph/shared";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

// ── file-kind helpers ────────────────────────────────────────────────────────

const PDF_EXTS = [".pdf"];
const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"];
const TEXT_EXTS = [".txt", ".md", ".csv", ".json", ".yaml", ".yml", ".toml", ".py", ".ts", ".tsx", ".js", ".jsx"];

function ext(p: string) { return p.slice(p.lastIndexOf(".")).toLowerCase(); }

type PreviewKind = "docx" | "pdf" | "image" | "text" | "unsupported";

function previewKind(docPath: string): PreviewKind {
  const e = ext(docPath);
  if (e === ".docx") return "docx";
  if (PDF_EXTS.includes(e)) return "pdf";
  if (IMAGE_EXTS.includes(e)) return "image";
  if (TEXT_EXTS.includes(e)) return "text";
  return "unsupported";
}

export function isPreviewSupported(docPath: string): boolean {
  return previewKind(docPath) !== "unsupported";
}

// ── module-level caches (survive hide/show) ──────────────────────────────────

const blobCache = new Map<string, Blob>();
const readyCache = new Set<string>();

export function clearPreviewCache(docPath: string) {
  blobCache.delete(docPath);
  readyCache.delete(docPath);
}

// ── public component ─────────────────────────────────────────────────────────

interface PreviewPanelProps {
  docPath: string | null;
  selectedNodeId: string | null;
  nodes?: GraphNode[];
  refreshKey?: number;
}

export const PreviewPanel = React.memo(function PreviewPanel({ docPath, selectedNodeId, nodes = [], refreshKey }: PreviewPanelProps) {
  const { theme } = useTheme();

  if (!docPath) {
    return <Placeholder theme={theme} message="No document open" />;
  }

  const kind = previewKind(docPath);

  if (kind === "unsupported") {
    return <Placeholder theme={theme} message="Preview not supported for this file type." />;
  }
  if (kind === "pdf") {
    return <PdfPreview docPath={docPath} selectedNodeId={selectedNodeId} nodes={nodes} />;
  }
  if (kind === "image") {
    return <ImagePreview docPath={docPath} />;
  }
  if (kind === "text") {
    return <TextPreview docPath={docPath} selectedNodeId={selectedNodeId} nodes={nodes} refreshKey={refreshKey} />;
  }
  // docx
  return <DocxPreview docPath={docPath} selectedNodeId={selectedNodeId} nodes={nodes} refreshKey={refreshKey} />;
}, (prev, next) =>
  prev.docPath === next.docPath &&
  prev.selectedNodeId === next.selectedNodeId &&
  prev.refreshKey === next.refreshKey
);

// ── Placeholder ───────────────────────────────────────────────────────────────

function Placeholder({ theme, message }: { theme: ReturnType<typeof useTheme>["theme"]; message: string }) {
  return (
    <div style={{ padding: 16, fontSize: FONT.sm, color: theme.muted, textAlign: "center" }}>
      {message}
    </div>
  );
}

// ── PDF preview ───────────────────────────────────────────────────────────────

function PdfPreview({ docPath, selectedNodeId, nodes = [] }: { docPath: string; selectedNodeId?: string | null; nodes?: GraphNode[] }) {
  const { theme } = useTheme();
  const [numPages, setNumPages] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const src = filePreviewUrl(docPath);

  useEffect(() => {
    if (!selectedNodeId || !containerRef.current) return;
    const node = nodes.find((n) => n.stable_id === selectedNodeId);
    if (!node?.raw_text) return;
    const target = node.raw_text.trim();

    // Search text layer spans for a match and highlight
    const spans = Array.from(containerRef.current.querySelectorAll(".react-pdf__Page__textContent span")) as HTMLElement[];
    // Clear previous highlight
    spans.forEach((s) => { s.style.background = ""; });

    // Collect span text concatenated per "block" (spans are character-level in pdfjs)
    // Find the span whose text content contains the target
    let match: HTMLElement | null = null;
    for (const span of spans) {
      if (span.textContent?.trim() === target || span.textContent?.includes(target.slice(0, 40))) {
        match = span;
        break;
      }
    }
    if (match) {
      match.style.background = "rgba(251, 191, 36, 0.35)";
      match.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [selectedNodeId, nodes]);

  return (
    <div ref={containerRef} style={{ height: "100%", overflow: "auto", background: theme.graphBg, display: "flex", flexDirection: "column", alignItems: "center" }}>
      <Document
        file={src}
        onLoadSuccess={({ numPages }) => setNumPages(numPages)}
        loading={<div style={{ padding: 16, fontSize: FONT.sm, color: theme.muted }}>Loading…</div>}
        error={<div style={{ padding: 16, fontSize: FONT.sm, color: theme.muted }}>Failed to load PDF</div>}
      >
        {Array.from({ length: numPages }, (_, i) => (
          <div key={i + 1} style={{ marginBottom: 8 }}>
            <Page
              pageNumber={i + 1}
              renderTextLayer
              renderAnnotationLayer={false}
              width={600}
            />
          </div>
        ))}
      </Document>
    </div>
  );
}

// ── Image preview ─────────────────────────────────────────────────────────────

function ImagePreview({ docPath }: { docPath: string }) {
  const { theme } = useTheme();
  const src = filePreviewUrl(docPath);
  return (
    <div style={{ height: "100%", overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", background: theme.graphBg, padding: 16 }}>
      <img
        src={src}
        alt={docPath.split("/").pop()}
        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 4 }}
      />
    </div>
  );
}

// ── Text preview ──────────────────────────────────────────────────────────────

function TextPreview({ docPath, selectedNodeId, nodes = [], refreshKey }: {
  docPath: string;
  selectedNodeId?: string | null;
  nodes?: GraphNode[];
  refreshKey?: number;
}) {
  const { theme } = useTheme();
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isCsv = docPath.toLowerCase().endsWith(".csv");

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchFileText(docPath)
      .then(setText)
      .catch((e: Error) => setError(e.message ?? "Failed to load file"))
      .finally(() => setLoading(false));
  // refreshKey forces re-fetch
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docPath, refreshKey]);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current.querySelector("[data-highlighted]") as HTMLElement | null;
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedNodeId]);

  if (loading) return <Placeholder theme={theme} message="Loading…" />;
  if (error) return <Placeholder theme={theme} message={error} />;
  if (text === null) return null;

  const selectedNode = nodes.find((n) => n.stable_id === selectedNodeId);
  const targetText = selectedNode?.raw_text?.trim() ?? null;

  if (isCsv) {
    const rows = text.split("\n").filter((l) => l.trim());
    return (
      <div ref={containerRef} style={{ height: "100%", overflow: "auto", background: "#f5f4f0", padding: "12px 16px" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: FONT.sm, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
          <tbody>
            {rows.map((row, i) => {
              const cells = row.split(",");
              // raw_text is stored as "| a | b |" — reconstruct to match
              const rowAsText = "| " + cells.map((c) => c.trim()).join(" | ") + " |";
              const isHighlighted = !!targetText && rowAsText === targetText;
              return (
                <tr key={i} {...(isHighlighted ? { "data-highlighted": "1" } : {})} style={{
                  background: isHighlighted ? "rgba(251, 191, 36, 0.35)" : i % 2 === 0 ? "#f5f4f0" : "#eeede9",
                }}>
                  {cells.map((cell, j) => (
                    <td key={j} style={{ padding: "3px 8px", borderRight: "1px solid #d0cfc9", color: "#1a1a1a", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {cell}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const isMd = docPath.toLowerCase().endsWith(".md");

  if (isMd) {
    const normalizedTarget = targetText?.replace(/^#+\s*/, "") ?? null;
    const mdBlock = ({ children, tag }: { children: React.ReactNode; tag: string }) => {
      const lineText = typeof children === "string" ? children.trim()
        : Array.isArray(children) ? (children as any[]).map((c) => (typeof c === "string" ? c : "")).join("").trim()
        : "";
      const isHighlighted = !!normalizedTarget && (lineText === normalizedTarget || lineText.includes(normalizedTarget));
      return React.createElement(tag, {
        ...(isHighlighted ? { "data-highlighted": "1" } : {}),
        style: isHighlighted ? { background: "rgba(251, 191, 36, 0.35)", borderRadius: 2 } : undefined,
      }, children);
    };
    const mdComponents = {
      p: ({ children }: any) => mdBlock({ children, tag: "p" }),
      h1: ({ children }: any) => mdBlock({ children, tag: "h1" }),
      h2: ({ children }: any) => mdBlock({ children, tag: "h2" }),
      h3: ({ children }: any) => mdBlock({ children, tag: "h3" }),
      li: ({ children }: any) => mdBlock({ children, tag: "li" }),
    };
    return (
      <div ref={containerRef} style={{ height: "100%", overflow: "auto", background: "#f5f4f0", padding: "12px 24px" }}>
        <style>{`
          .md-preview h1,.md-preview h2,.md-preview h3 { margin: 1em 0 0.4em; font-weight: 600; }
          .md-preview h1 { font-size: 1.3em; } .md-preview h2 { font-size: 1.1em; } .md-preview h3 { font-size: 1em; }
          .md-preview p { margin: 0.4em 0; line-height: 1.6; }
          .md-preview ul,.md-preview ol { padding-left: 1.4em; margin: 0.4em 0; }
          .md-preview li { margin: 0.2em 0; line-height: 1.6; }
        `}</style>
        <div className="md-preview" style={{ fontSize: FONT.sm, color: "#1a1a1a", fontFamily: "system-ui, sans-serif" }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{text}</ReactMarkdown>
        </div>
      </div>
    );
  }

  const lines = text.split("\n");
  return (
    <div ref={containerRef} style={{ height: "100%", overflow: "auto", background: "#f5f4f0" }}>
      <pre style={{
        margin: 0, padding: "12px 16px",
        fontSize: FONT.sm, color: "#1a1a1a",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        whiteSpace: "pre-wrap", wordBreak: "break-word",
        lineHeight: 1.6,
      }}>
        {lines.map((line, i) => {
          const isHighlighted = !!targetText && line.trim() === targetText;
          return (
            <span key={i} {...(isHighlighted ? { "data-highlighted": "1" } : {})} style={{
              display: "block",
              background: isHighlighted ? "rgba(251, 191, 36, 0.35)" : "transparent",
              borderRadius: 2,
            }}>
              {line || " "}
            </span>
          );
        })}
      </pre>
    </div>
  );
}

// ── DOCX preview (SuperDoc) ──────────────────────────────────────────────────

const ZOOM_STEP = 10;
const ZOOM_MIN = 40;
const ZOOM_MAX = 200;

const SUPERDOC_VIEW_OPTIONS = { layout: 'web' } as any;
const SUPERDOC_MODULES = { trackChanges: { visible: true, mode: 'review' } } as any;

function DocxPreview({ docPath, selectedNodeId, nodes = [], refreshKey }: {
  docPath: string;
  selectedNodeId: string | null;
  nodes?: GraphNode[];
  refreshKey?: number;
}) {
  const { theme } = useTheme();
  const ref = useRef<SuperDocRef>(null);
  const [blob, setBlob] = useState<Blob | null>(blobCache.get(docPath) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [superdocReady, setSuperdocReady] = useState(() => readyCache.has(docPath));
  const handleReady = useCallback(() => {
    readyCache.add(docPath);
    setSuperdocReady(true);
  }, [docPath]);
  const [zoom, setZoom] = useState(100);
  const [findQuery, setFindQuery] = useState("");
  const [findResults, setFindResults] = useState<any[]>([]);
  const [findIndex, setFindIndex] = useState(0);

  useEffect(() => {
    setSuperdocReady(readyCache.has(docPath));
    const cached = blobCache.get(docPath);
    if (cached) { setBlob(cached); return; }
    setLoading(true);
    setError(null);
    fetchDocxBlob(docPath)
      .then((b) => { blobCache.set(docPath, b); setBlob(b); })
      .catch((e: Error) => setError(e.message ?? "Failed to load document"))
      .finally(() => setLoading(false));
  // refreshKey forces re-fetch
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docPath, refreshKey]);

  useEffect(() => {
    if (!selectedNodeId || !superdocReady) return;
    const superdoc = ref.current?.getInstance();
    if (!superdoc) return;
    const node = nodes.find((n) => n.stable_id === selectedNodeId);
    if (!node?.raw_text) return;
    const substantive = node.raw_text.replace(/^[\d.\s()]+/, "").trim();
    if (!substantive) return;
    let results = superdoc.search(substantive);
    const query = results?.length ? substantive : substantive.slice(0, 60);
    if (!results?.length) results = superdoc.search(query);
    if (!results?.length) return;
    const prefix = query.toLowerCase();
    const precedingMatches = nodes
      .filter((n) => n.position < node.position && n.raw_text.replace(/^[\d.\s()]+/, "").trim().toLowerCase().startsWith(prefix))
      .length;
    const match = results[Math.min(precedingMatches, results.length - 1)];
    superdoc.goToSearchResult(match);
  }, [selectedNodeId, nodes, superdocReady]);

  const handleZoom = (newZoom: number) => {
    const clamped = Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom)));
    ref.current?.getInstance()?.setZoom(clamped);
    setZoom(clamped);
  };

  const handleFind = (query: string) => {
    setFindQuery(query);
    if (!query.trim()) { setFindResults([]); setFindIndex(0); return; }
    const superdoc = ref.current?.getInstance();
    if (!superdoc) return;
    const results = superdoc.search(query) ?? [];
    setFindResults(results);
    setFindIndex(0);
    if (results.length > 0) superdoc.goToSearchResult(results[0]);
  };

  const handleFindNav = (dir: 1 | -1) => {
    if (!findResults.length) return;
    const next = (findIndex + dir + findResults.length) % findResults.length;
    setFindIndex(next);
    ref.current?.getInstance()?.goToSearchResult(findResults[next]);
  };

  const clearFind = () => { setFindQuery(""); setFindResults([]); setFindIndex(0); };

  return (
    <div style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column", position: "relative" }}>
      <style>{`.superdoc--web-layout .ProseMirror { padding: 8px 48px !important; }`}</style>

      {(loading || !blob) && (
        <div style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center", background: theme.graphBg, fontSize: FONT.sm, color: theme.muted }}>
          {loading ? "Loading…" : null}
        </div>
      )}
      {error && !loading && (
        <div style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", alignItems: "center", justifyContent: "center", background: theme.graphBg, fontSize: FONT.sm, color: theme.muted }}>
          {error}
        </div>
      )}

      {superdocReady && (
        <div style={{
          height: 30, flexShrink: 0, display: "flex", alignItems: "center",
          padding: "0 8px", gap: 4,
          borderBottom: `1px solid ${theme.edgeBorder}`,
          background: theme.base,
        }}>
          <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
            <input
              type="text"
              placeholder="Find…"
              value={findQuery}
              onChange={(e) => handleFind(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleFindNav(e.shiftKey ? -1 : 1);
                if (e.key === "Escape") clearFind();
              }}
              style={{
                flex: 1, minWidth: 0, height: 20, fontSize: FONT.sm, padding: "0 6px",
                border: `1px solid ${theme.edgeBorder}`, borderRadius: 4,
                background: theme.graphBg, color: theme.black, outline: "none",
              }}
            />
            {findQuery && (
              <>
                <span style={{ fontSize: FONT.sm, color: theme.muted, whiteSpace: "nowrap" }}>
                  {findResults.length > 0 ? `${findIndex + 1}/${findResults.length}` : "0/0"}
                </span>
                <button onClick={() => handleFindNav(-1)} disabled={!findResults.length}
                  style={{ width: 18, height: 18, border: `1px solid ${theme.edgeBorder}`, borderRadius: 3, background: "transparent", cursor: "pointer", fontSize: FONT.sm, color: theme.black, opacity: findResults.length ? 1 : 0.4, display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
                <button onClick={() => handleFindNav(1)} disabled={!findResults.length}
                  style={{ width: 18, height: 18, border: `1px solid ${theme.edgeBorder}`, borderRadius: 3, background: "transparent", cursor: "pointer", fontSize: FONT.sm, color: theme.black, opacity: findResults.length ? 1 : 0.4, display: "flex", alignItems: "center", justifyContent: "center" }}>›</button>
                <button onClick={clearFind}
                  style={{ width: 18, height: 18, border: `1px solid ${theme.edgeBorder}`, borderRadius: 3, background: "transparent", cursor: "pointer", fontSize: FONT.sm, color: theme.muted, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
              </>
            )}
          </div>
          <div style={{ width: 1, height: 16, background: theme.edgeBorder, flexShrink: 0 }} />
          <button onClick={() => handleZoom(zoom - ZOOM_STEP)} disabled={zoom <= ZOOM_MIN}
            style={{ width: 22, height: 22, borderRadius: 4, border: `1px solid ${theme.edgeBorder}`, background: "transparent", cursor: zoom <= ZOOM_MIN ? "not-allowed" : "pointer", color: theme.black, fontSize: FONT.lg, opacity: zoom <= ZOOM_MIN ? 0.4 : 1, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
          <span style={{ fontSize: FONT.sm, color: theme.muted, minWidth: 36, textAlign: "center" }}>{zoom}%</span>
          <button onClick={() => handleZoom(zoom + ZOOM_STEP)} disabled={zoom >= ZOOM_MAX}
            style={{ width: 22, height: 22, borderRadius: 4, border: `1px solid ${theme.edgeBorder}`, background: "transparent", cursor: zoom >= ZOOM_MAX ? "not-allowed" : "pointer", color: theme.black, fontSize: FONT.lg, opacity: zoom >= ZOOM_MAX ? 0.4 : 1, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
        </div>
      )}

      {blob && <SuperDocEditor
        key="superdoc-editor"
        ref={ref}
        document={blob}
        documentMode="viewing"
        hideToolbar
        contained
        viewOptions={SUPERDOC_VIEW_OPTIONS}
        modules={SUPERDOC_MODULES}
        style={{ flex: 1, minHeight: 0, visibility: superdocReady ? "visible" : "hidden", pointerEvents: superdocReady ? "auto" : "none" }}
        onReady={handleReady}
      />}
      {blob && !superdocReady && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 10,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: theme.graphBg, pointerEvents: "none",
        }}>
          <Spinner color={theme.terracotta} />
        </div>
      )}
    </div>
  );
}

function Spinner({ color }: { color: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" style={{ animation: "previewSpin 0.8s linear infinite" }}>
      <style>{`@keyframes previewSpin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeWidth="2.5" strokeOpacity="0.2" />
      <path d="M12 3 a9 9 0 0 1 9 9" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
