/// <reference path="../../node_modules/@microsoft/office-js/dist/office.d.ts" />
import { useState, useCallback, useEffect, useRef } from "react";
import { GraphNode } from "@word-graph/shared";
import { ThemeKey, THEMES } from "@word-graph/shared";
import { ThemeContext } from "@word-graph/shared";
import { useBackend } from "./useBackend";
import { useOfficeSync, scrollWordToNode } from "./useOfficeSync";
import { useTagPool } from "./hooks/useTagPool";
import {
  getClauses,
  listClauseTypes,
} from "./api";
import { ContractMap, ClauseDetails } from "./ContractMap";
import { useTheme } from "@word-graph/shared";
import { FONT } from "@word-graph/shared";


function getDocumentPath(): Promise<string> {
  return new Promise((resolve) => {
    if (typeof Office === "undefined" || !Office.context) {
      resolve("../test-data/test-contract.docx");
      return;
    }
    Office.context.document.getFilePropertiesAsync((result) => {
      const raw = result.value?.url || Office.context.document.url || "";
      const path = raw.startsWith("file://") ? decodeURIComponent(raw.slice(7)) : raw;
      resolve(path);
    });
  });
}

export function App() {
  const [docPath, setDocPath] = useState<string>("");
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [displayNodes, setDisplayNodes] = useState<GraphNode[]>([]);
  const [nodeTypes, setNodeTypes] = useState<string[]>(["Section Title", "Subsection Title", "Definition", "Obligation", "Exclusion", "Indemnity", "Recital", "Condition", "Governing Law", "Cap"]);
  const [primaryDocId, setPrimaryDocId] = useState<string>("");
  const [followEnabled] = useState(true);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [panelNodeId, setPanelNodeId] = useState<string | null>(null);
  const [appError, setAppError] = useState<string | null>(null);
  const [themeKey, setThemeKey] = useState<ThemeKey>("warm");

  const backend = useBackend(docPath);
  const { tags: tagPoolTags, sync: syncTagPool } = useTagPool(docPath);

  useEffect(() => {
    getDocumentPath().then(setDocPath);
  }, []);

  useEffect(() => {
    if (backend.status !== "ready" || !docPath) return;
    listClauseTypes(docPath).then(setNodeTypes).catch((err) => {
      console.error("[config] load failed", err);
    });

    getClauses(docPath).then((result) => {
      if (result.clauses.length === 0) return;
      setNodes(result.clauses);
      setDisplayNodes(result.clauses);
      setPrimaryDocId(result.doc_id);
    }).catch((err) => {
      console.error("[hydration] failed", err);
      setAppError("Failed to load document data — check backend is running.");
    });
  }, [backend.status, docPath]);

  const panelNodeIdRef = useRef(panelNodeId);
  useEffect(() => { panelNodeIdRef.current = panelNodeId; }, [panelNodeId]);

  const handleNodeFocus = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    if (nodeId) setPanelNodeId(nodeId);
  }, []);

  useOfficeSync({
    nodes,
    followEnabled,
    onNodeFocus: handleNodeFocus,
  });

  const handleNodeSelect = useCallback((nodeId: string) => {
    if (!nodeId) return;
    setSelectedNodeId(nodeId);
    setPanelNodeId(nodeId);
    const node = nodes.find((n) => n.stable_id === nodeId);
    if (node && followEnabled) scrollWordToNode(node);
  }, [nodes, followEnabled]);

  const handleScrollTo = useCallback((nodeId: string) => {
    const node = nodes.find((n) => n.stable_id === nodeId);
    if (node && followEnabled) scrollWordToNode(node);
  }, [nodes, followEnabled]);

  const handleDeselect = useCallback(() => {
    setSelectedNodeId(null);
    setPanelNodeId(null);
  }, []);

  const handleNodeUpdate = useCallback((updated: GraphNode) => {
    setNodes((prev) => prev.map((n) => n.stable_id === updated.stable_id ? updated : n));
    setDisplayNodes((prev) => prev.map((n) => n.stable_id === updated.stable_id ? updated : n));
  }, []);

  const handleBulkUpdate = useCallback((patch: Partial<GraphNode>, ids: string[]) => {
    const idSet = new Set(ids);
    setNodes((prev) => prev.map((n) => idSet.has(n.stable_id) ? { ...n, ...patch } : n));
    setDisplayNodes((prev) => prev.map((n) => idSet.has(n.stable_id) ? { ...n, ...patch } : n));
  }, []);

  const handleRefreshNodes = useCallback(async () => {
    if (!docPath) return;
    try {
      const result = await getClauses(docPath);
      setNodes(result.clauses);
      setDisplayNodes(result.clauses);
    } catch { /* silent */ }
  }, [docPath]);

  const visibleNodes = displayNodes.filter((n) => !n.tombstoned);
  const panelNode = panelNodeId ? visibleNodes.find((n) => n.stable_id === panelNodeId) : null;

  return (
    <ThemeContext.Provider value={{ theme: THEMES[themeKey], themeKey }}>
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", background: THEMES[themeKey].base }}>
        <AppHeader
          backendStatus={backend.status}
          themeKey={themeKey}
          onThemeChange={setThemeKey}
        />

        {appError && (
          <div style={{ background: "#fff0f0", color: "#b91c1c", padding: "6px 12px", fontSize: FONT.sm, borderBottom: "1px solid #fecaca", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{appError}</span>
            <button onClick={() => setAppError(null)} style={{ background: "none", border: "none", color: "#b91c1c", cursor: "pointer", fontSize: FONT.title, lineHeight: 1, padding: "0 2px" }}>×</button>
          </div>
        )}

        {backend.status === "starting" && (
          <div style={{ padding: "6px 12px", fontSize: FONT.sm, color: THEMES[themeKey].muted, borderBottom: `1px solid ${THEMES[themeKey].edgeBorder}`, background: THEMES[themeKey].base }}>
            ● Connecting to backend…
          </div>
        )}

        {backend.status === "error" && (
          <div style={{ background: "#fff0f0", color: "#b91c1c", padding: "6px 12px", fontSize: FONT.sm, borderBottom: "1px solid #fecaca" }}>
            Backend failed to start. Check Python environment.
          </div>
        )}

        <div style={{ flex: 1, overflow: "hidden" }}>
          <ContractMap
            nodes={visibleNodes}
            primaryDocId={primaryDocId}
            nodeTypes={nodeTypes}
            docPath={docPath}
            workspacePath=""
            selectedNodeId={selectedNodeId}
            panelNodeId={panelNodeId}
            isParsing={false}
            isReparsing={false}
            enrichStatus={null}
            detailsPanel={panelNode ? (onFilterByTag) => (
              <ClauseDetails
                node={panelNode}
                allNodes={visibleNodes}
                docPath={docPath}
                workspacePath=""
                poolTags={tagPoolTags}
                onNavigateTo={handleNodeSelect}
                onNodeUpdate={handleNodeUpdate}
                onPoolChange={syncTagPool}
                onFilterByTag={onFilterByTag}
                onClose={() => setPanelNodeId(null)}
              />
            ) : undefined}
            onNodeFocus={handleNodeFocus}
            onNodeSelect={handleNodeSelect}
            onScrollTo={handleScrollTo}
            onDeselect={handleDeselect}
            onBulkUpdate={handleBulkUpdate}
            onRefreshNodes={handleRefreshNodes}
            poolTags={tagPoolTags}
          />
        </div>
      </div>
    </ThemeContext.Provider>
  );
}

function AppHeader({
  backendStatus,
  themeKey, onThemeChange,
}: {
  backendStatus: "starting" | "ready" | "error" | "offline";
  themeKey: ThemeKey;
  onThemeChange: (k: ThemeKey) => void;
}) {
  const THEME = useTheme();
  const THEME_KEYS: ThemeKey[] = ["warm", "light", "dark", "alien", "halloween", "christmas"];

  const statusDot = backendStatus === "ready" ? null : (
    <span style={{ fontSize: FONT.sm, color: backendStatus === "error" ? "#b91c1c" : THEME.muted, marginLeft: 6 }}>
      {backendStatus === "starting" ? "●" : "✕"}
    </span>
  );

  return (
    <div style={{ borderBottom: `1px solid ${THEME.edgeBorder}`, background: THEME.base, flexShrink: 0, padding: "7px 12px", display: "flex", alignItems: "center" }}>
      <span style={{ fontSize: FONT.md, fontWeight: 700, color: THEME.black }}>Clause CoWork</span>
      {statusDot}
      <div style={{ flex: 1 }} />
      <ThemeDropdown value={themeKey} onChange={onThemeChange} options={THEME_KEYS} />
    </div>
  );
}

function ThemeDropdown({ value, onChange, options }: { value: ThemeKey; onChange: (k: ThemeKey) => void; options: ThemeKey[] }) {
  const THEME = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", marginLeft: 6, flexShrink: 0 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          fontSize: FONT.sm, fontWeight: 500,
          padding: "3px 22px 3px 10px",
          minWidth: 90,
          borderRadius: 6,
          border: `1px solid ${THEME.edgeBorder}`,
          background: THEME.white,
          color: THEME.black,
          cursor: "pointer",
          display: "flex", alignItems: "center", gap: 4,
          whiteSpace: "nowrap",
        }}
      >
        {value.charAt(0).toUpperCase() + value.slice(1)}
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          style={{ position: "absolute", right: 6, color: THEME.muted }}>
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 50,
          background: THEME.white, border: `1px solid ${THEME.edgeBorder}`,
          borderRadius: 7, boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          overflow: "hidden", minWidth: 80,
        }}>
          {options.map((k) => (
            <button
              key={k}
              onClick={() => { onChange(k); setOpen(false); }}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "6px 10px", fontSize: FONT.sm, fontWeight: k === value ? 700 : 400,
                background: k === value ? `${THEME.terracotta}18` : "none",
                color: k === value ? THEME.terracotta : THEME.black,
                border: "none", cursor: "pointer",
                borderBottom: `1px solid ${THEME.edgeBorder}`,
              }}
            >
              {k.charAt(0).toUpperCase() + k.slice(1)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
