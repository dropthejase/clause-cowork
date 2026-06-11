import { useState, useCallback, useEffect, useRef } from "react";
import { useAppStore } from "../../store";
import { useTheme } from "../../ThemeContext";
import { fetchFolderTree } from "../../api";
import { InfoTab } from "./InfoTab";
import type { FolderTreeEntry, FolderTreeFile } from "../../types";
import { flattenFiles } from "../../utils";
import type { ThemeShape } from "@word-graph/shared";
import { useDocNodes } from "../../hooks/useDocNodes";
import { DocTabs } from "./DocTabs";
import { ChatPanel } from "../ChatPanel/ChatPanel";
import { PreviewPanel, clearPreviewCache, isPreviewSupported } from "../PreviewPanel/PreviewPanel";
import { ErrorBoundary } from "../ErrorBoundary";
import { ContractMap } from "@word-graph/shared";
import { ClauseDetails } from "@word-graph/shared";
import type { GraphNode } from "@word-graph/shared";
import { ThemeContext as AddinThemeContext } from "@word-graph/shared";
import { THEMES as AddinTHEMES } from "@word-graph/shared";
import { listTags } from "@word-graph/shared";
import type { PoolTag } from "@word-graph/shared";
import { FONT } from "@word-graph/shared";

export function DocView({ refreshKey, tree = [] }: { refreshKey?: number; tree?: FolderTreeEntry[] }) {
  const {
    openDocs,
    activeDocPath,
    activeWorkspace,
    selectedNodeId,
    panelNodeId,
    setSelectedNode,
    setPanelNode,
    setActiveDoc,
    closeDoc,
    chatPanelOpen,
    toggleChatPanel,
    previewPanelOpen,
    togglePreviewPanel,
    activeDocTab,
    setDocTab,
  } = useAppStore();

  const { theme, themeKey } = useTheme();
  const { nodes: fetchedNodes, loading, error } = useDocNodes(activeDocPath, activeWorkspace);
  const [localNodes, setLocalNodes] = useState<GraphNode[]>([]);
  const [poolTags, setPoolTags] = useState<PoolTag[]>([]);
  const [nodeTypes, setNodeTypes] = useState<string[]>([]);
  const [previewOpenedDocs, setPreviewOpenedDocs] = useState<Set<string>>(new Set());
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [unparsedFileStat, setUnparsedFileStat] = useState<{ file_size: number | null; file_mtime: number | null; doc_id?: string | null } | null>(null);
  const [modifiedNodeCount, setModifiedNodeCount] = useState(0);

  useEffect(() => { setLocalNodes(fetchedNodes as unknown as GraphNode[]); }, [fetchedNodes]);

  useEffect(() => {
    if (!refreshKey || !activeDocPath || !activeWorkspace) return;
    (async () => {
      const { fetchClauses } = await import("../../api");
      clearPreviewCache(activeDocPath);
      setPreviewRefreshKey((k) => k + 1);
      const { tree: freshTree } = await fetchFolderTree(activeWorkspace);
      const allFiles = flattenFiles(freshTree);
      const found = allFiles.find((f) => f.path === activeDocPath);
      if (found?.doc_id && found.doc_id !== (openDocs.find((d) => d.path === activeDocPath)?.docId ?? "")) {
        useAppStore.getState().openDoc(activeDocPath, found.doc_id);
      }
      const result = await fetchClauses(activeDocPath, activeWorkspace);
      setLocalNodes(result.clauses as unknown as GraphNode[]);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Re-fetch nodes when background extraction updates needs_reclassification_count for the active doc
  const prevReclassCountRef = useRef<number>(0);
  useEffect(() => {
    if (!activeDocPath || !activeWorkspace) return;
    const entry = flattenFiles(tree).find((f) => f.path === activeDocPath);
    const count = entry?.needs_reclassification_count ?? 0;
    if (count > 0 && count !== prevReclassCountRef.current) {
      prevReclassCountRef.current = count;
      import("../../api").then(({ fetchClauses }) =>
        fetchClauses(activeDocPath, activeWorkspace!).then((result) =>
          setLocalNodes(result.clauses as unknown as GraphNode[])
        ).catch(() => {})
      );
    } else if (count === 0) {
      prevReclassCountRef.current = 0;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, activeDocPath]);

  useEffect(() => {
    if (previewPanelOpen && activeDocPath && !previewOpenedDocs.has(activeDocPath)) {
      setPreviewOpenedDocs((prev) => new Set([...prev, activeDocPath]));
    }
  }, [previewPanelOpen, activeDocPath]);

  // Auto-close preview panel when switching to a file with no preview support
  useEffect(() => {
    if (previewPanelOpen && activeDocPath && !isPreviewSupported(activeDocPath)) {
      togglePreviewPanel();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDocPath]);

  const tagDocPath = activeWorkspace ?? null;

  useEffect(() => {
    if (!tagDocPath) return;
    listTags(tagDocPath).then(setPoolTags).catch(() => {});
  }, [tagDocPath]);

  useEffect(() => {
    if (!activeDocPath) return;
    listTags(activeWorkspace ?? activeDocPath, "clause_type").then((tags) => setNodeTypes(tags.map((t) => t.tag))).catch(() => {});
  }, [activeDocPath]);

  const activeDoc = openDocs.find((d) => d.path === activeDocPath);
  const primaryDocId = activeDoc?.docId ?? "";

  useEffect(() => {
    if (!activeDocPath || !activeWorkspace) { setUnparsedFileStat(null); setModifiedNodeCount(0); return; }
    const entry = flattenFiles(tree).find((f) => f.path === activeDocPath);
    if (!primaryDocId) {
      setUnparsedFileStat(entry ? { file_size: entry.file_size ?? null, file_mtime: entry.file_mtime ?? null, doc_id: entry.doc_id ?? null } : null);
    } else {
      setUnparsedFileStat(null);
    }
    setModifiedNodeCount(entry?.needs_reclassification_count ?? 0);
  }, [tree, activeDocPath, primaryDocId, activeWorkspace]);

  const noDocOpen = !activeDocPath || openDocs.length === 0;
  const fileDeleted = !noDocOpen && tree.length > 0 && !flattenFiles(tree).some((f) => f.path === activeDocPath);

  const handleTogglePreview = useCallback(() => {
    if (noDocOpen) return; // DocTabs handles the popup
    togglePreviewPanel();
  }, [noDocOpen, togglePreviewPanel]);

  const handleToggleChat = useCallback(() => {
    toggleChatPanel();
  }, [toggleChatPanel]);

  const handleBulkUpdate = useCallback((patch: Partial<GraphNode>, ids: string[]) => {
    setLocalNodes((prev) => prev.map((n) => ids.includes(n.stable_id) ? { ...n, ...patch } : n));
  }, []);

  const handleRefreshNodes = useCallback(async () => {
    if (!activeDocPath || !activeWorkspace) return;
    const { fetchClauses } = await import("../../api");
    const result = await fetchClauses(activeDocPath, activeWorkspace);
    setLocalNodes(result.clauses as unknown as GraphNode[]);
  }, [activeDocPath, activeWorkspace]);

  const handleRefreshDoc = useCallback(async () => {
    if (!activeDocPath || !activeWorkspace) return;
    clearPreviewCache(activeDocPath);
    setPreviewOpenedDocs((prev) => { const next = new Set(prev); next.delete(activeDocPath); return next; });
    const { parseDocument, fetchFolderTree: fetchTree, fetchClauses } = await import("../../api");
    await parseDocument(activeDocPath);
    const { tree: freshTree } = await fetchTree(activeWorkspace);
    const allFiles = flattenFiles(freshTree);
    const found = allFiles.find((f) => f.path === activeDocPath);
    if (found?.doc_id && found.doc_id !== (activeDoc?.docId ?? "")) {
      useAppStore.getState().openDoc(activeDocPath, found.doc_id);
    }
    if (found?.doc_id || primaryDocId) {
      const result = await fetchClauses(activeDocPath, activeWorkspace);
      setLocalNodes(result.clauses as unknown as GraphNode[]);
    }
  }, [activeDocPath, activeWorkspace, activeDoc, primaryDocId]);


  const selectedNode = localNodes.find((n) => n.stable_id === panelNodeId) ?? null;
  const addinTheme = AddinTHEMES[themeKey as keyof typeof AddinTHEMES] ?? AddinTHEMES.warm;

  let graphContent: React.ReactNode;
  if (noDocOpen) {
    graphContent = (
      <div style={{ flex: 1, height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: theme.muted, fontSize: FONT.md, background: theme.graphBg }}>
        Select a document from the explorer to get started.
      </div>
    );
  } else if (!primaryDocId) {
    const isDocxDetail = activeDocPath?.toLowerCase().endsWith(".docx") ?? false;
    graphContent = (
      <div style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: theme.graphBg }}>
        <div style={{ fontSize: FONT.title, color: theme.charcoal, fontWeight: 600 }}>{activeDocPath.split("/").pop()}</div>
        {isDocxDetail ? (
          <div style={{ fontSize: FONT.md, color: theme.muted, textAlign: "center", maxWidth: 360 }}>
            We haven&apos;t analysed the clauses yet. Ask your chat agent:{" "}
            <span
              style={{ color: theme.terracotta, cursor: "pointer", fontStyle: "italic" }}
              onClick={() => { if (!chatPanelOpen) toggleChatPanel(); }}
            >
              &ldquo;use the /analyse skill to analyse Word documents in this workspace&rdquo;
            </span>
          </div>
        ) : (
          <div style={{ fontSize: FONT.md, color: theme.muted }}>Clause analysis is not supported for this file type.</div>
        )}
      </div>
    );
  } else if (loading) {
    graphContent = (
      <div style={{ flex: 1, height: "100%", background: theme.graphBg, padding: 20, fontSize: FONT.sm, color: theme.muted }}>Loading…</div>
    );
  } else if (error) {
    graphContent = (
      <div style={{ flex: 1, height: "100%", background: theme.graphBg, padding: 20, fontSize: FONT.sm, color: "#c0392b" }}>{error}</div>
    );
  } else {
    graphContent = (
      <AddinThemeContext.Provider value={{ theme: addinTheme, themeKey: themeKey as keyof typeof AddinTHEMES }}>
        <ContractMap
          nodes={localNodes}
          primaryDocId={primaryDocId}
          nodeTypes={nodeTypes}
          docPath={activeDocPath ?? ""}
          workspacePath={activeWorkspace ?? ""}
          poolTags={poolTags}
          selectedNodeId={selectedNodeId}
          panelNodeId={panelNodeId}
          detailsPanel={
            selectedNode ? (onFilterByTag) => (
              <ClauseDetails
                node={selectedNode}
                allNodes={localNodes}
                poolTags={poolTags}
                docPath={activeDocPath ?? ""}
                workspacePath={activeWorkspace ?? ""}
                onNavigateTo={(id) => { setSelectedNode(id); setPanelNode(id); }}
                onNodeUpdate={(updated) => {
                  setLocalNodes((prev) => prev.map((n) => n.stable_id === updated.stable_id ? updated : n));
                }}
                onPoolChange={async () => {
                  if (tagDocPath) setPoolTags(await listTags(tagDocPath));
                }}
                onFilterByTag={onFilterByTag}
                onClose={() => { setSelectedNode(null); setPanelNode(null); }}
              />
            ) : undefined
          }
          onNodeFocus={(id) => setSelectedNode(id)}
          onNodeSelect={(id) => { setSelectedNode(id); setPanelNode(id); }}
          onScrollTo={() => {}}
          onDeselect={() => { setSelectedNode(null); setPanelNode(null); }}
          onBulkUpdate={handleBulkUpdate}
          onRefreshNodes={handleRefreshNodes}
          onParse={handleRefreshDoc}
        />
      </AddinThemeContext.Provider>
    );
  }

  const activeFileStatus = flattenFiles(tree).find((f) => f.path === activeDocPath)?.status;
  const detailAvailable = activeFileStatus !== "viewable";
  const previewSupported = activeDocPath ? isPreviewSupported(activeDocPath) : false;

  useEffect(() => {
    if (!detailAvailable && activeDocTab === "detail") setDocTab("info");
  }, [activeDocPath, detailAvailable]);

  const previewItems = openDocs.map((doc) => {
    const isActive = doc.path === activeDocPath;
    const everOpened = previewOpenedDocs.has(doc.path);
    const visible = previewPanelOpen && isActive;
    const docNodes = isActive ? localNodes : [];
    const docPanelNode = isActive ? panelNodeId : null;
    const itemRefreshKey = isActive ? previewRefreshKey : 0;
    return { key: doc.path, visible, everOpened, docPath: doc.path, docPanelNode, docNodes, refreshKey: itemRefreshKey };
  });

  return (
    <div style={{ display: "flex", height: "100%", minWidth: 0, overflow: "hidden" }}>
      {/* Main content + preview row */}
      <ContentAndPreview
        theme={theme}
        previewPanelOpen={previewPanelOpen && !noDocOpen}
        previewItems={previewItems}
        leftContent={
          <div style={{ display: "flex", flexDirection: "column", height: "100%", minWidth: 0 }}>
            <DocTabs
              docs={openDocs}
              activeDocPath={activeDocPath}
              onSelect={setActiveDoc}
              onClose={closeDoc}
              chatOpen={chatPanelOpen}
              onToggleChat={handleToggleChat}
              previewOpen={previewPanelOpen}
              onTogglePreview={handleTogglePreview}
              noDocOpen={noDocOpen}
              previewDisabledMessage={!noDocOpen && !previewSupported ? "Preview not supported for this file type" : undefined}
            />

            {/* Info / Detail tab switcher */}
            {!noDocOpen && (
              <DocViewTabBar
                activeTab={activeDocTab}
                detailAvailable={detailAvailable}
                onSelect={setDocTab}
              />
            )}

            {/* Info tab */}
            {!noDocOpen && activeDocTab === "info" && activeWorkspace && activeDocPath && (() => {
              const infoDocId = primaryDocId || unparsedFileStat?.doc_id || null;
              if (!infoDocId) return null;
              return (
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                  <InfoTab workspacePath={activeWorkspace} docId={infoDocId} docPath={activeDocPath} />
                </div>
              );
            })()}

            {/* Detail tab */}
            <div style={{ display: noDocOpen || activeDocTab === "detail" ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0 }}>
              {fileDeleted && (
                <div style={{
                  background: "#5a1a1a", color: "#ffcdd2", fontSize: FONT.sm,
                  padding: "6px 14px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
                }}>
                  <span style={{ flex: 1 }}>This file has been deleted or moved.</span>
                  <button
                    onClick={() => closeDoc(activeDocPath!)}
                    style={{ background: "none", border: "1px solid #ffcdd2", color: "#ffcdd2", borderRadius: 4, padding: "2px 10px", cursor: "pointer", fontSize: FONT.sm }}
                  >
                    Close tab
                  </button>
                </div>
              )}
              {modifiedNodeCount > 0 && primaryDocId && (
                <div style={{
                  background: "#7a4a00", color: "#ffe0a0", fontSize: FONT.sm,
                  padding: "6px 14px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
                }}>
                  <span>{modifiedNodeCount} clause{modifiedNodeCount > 1 ? "s have" : " has"} changed — ask the Agent to re-analyse.</span>
                </div>
              )}
              <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                {graphContent}
              </div>
            </div>
          </div>
        }
      />

      {/* Chat column — always rendered so it's accessible from any tab */}
      <ChatColumn theme={theme} chatPanelOpen={chatPanelOpen} />
    </div>
  );
}

function DocViewTabBar({ activeTab, detailAvailable, onSelect }: {
  activeTab: "info" | "detail";
  detailAvailable: boolean;
  onSelect: (tab: "info" | "detail") => void;
}) {
  const { theme } = useTheme();
  const tabStyle = (active: boolean, disabled: boolean): React.CSSProperties => ({
    padding: "4px 14px",
    fontSize: FONT.sm,
    fontWeight: active ? 700 : 400,
    color: disabled ? theme.edgeBorder : active ? theme.terracotta : theme.muted,
    background: "none",
    border: "none",
    borderBottom: active ? `2px solid ${theme.terracotta}` : "2px solid transparent",
    cursor: disabled ? "default" : "pointer",
    userSelect: "none",
    flexShrink: 0,
  });
  return (
    <div style={{ display: "flex", borderBottom: `1px solid ${theme.edgeBorder}`, background: theme.base, flexShrink: 0 }}>
      <button style={tabStyle(activeTab === "info", false)} onClick={() => onSelect("info")}>Info</button>
      <button style={tabStyle(activeTab === "detail", !detailAvailable)} onClick={() => { if (detailAvailable) onSelect("detail"); }}>Detail</button>
    </div>
  );
}

const PANEL_WIDTHS_KEY = "cc-panel-widths";
const CHAT_WIDTH_KEY = "cc-chat-width";
const MIN = { graph: 280, preview: 320, chat: 260 };

interface PreviewItem {
  key: string; visible: boolean; everOpened: boolean;
  docPath: string; docPanelNode: string | null; docNodes: GraphNode[];
  refreshKey?: number;
}

function ContentAndPreview({ theme, previewPanelOpen, previewItems, leftContent }: {
  theme: ThemeShape;
  previewPanelOpen: boolean;
  previewItems: PreviewItem[];
  leftContent: React.ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  const [pct, setPct] = useState<[number, number]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(PANEL_WIDTHS_KEY) ?? "null");
      if (Array.isArray(stored) && stored.length >= 2) return [stored[0], stored[1]];
      return [62, 38];
    }
    catch { return [62, 38]; }
  });

  const [containerW, setContainerW] = useState(0);
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    setContainerW(el.offsetWidth);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerW(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { localStorage.setItem(PANEL_WIDTHS_KEY, JSON.stringify(pct)); }, [pct]);

  const drag = useRef<{ startX: number; startPct: [number, number] } | null>(null);

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    drag.current = { startX: e.clientX, startPct: [...pct] as [number, number] };
  }, [pct]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!drag.current || !rowRef.current) return;
      const totalW = rowRef.current.offsetWidth;
      if (totalW === 0) return;
      const deltaPct = ((e.clientX - drag.current.startX) / totalW) * 100;
      const [g, p] = drag.current.startPct;
      const newG = Math.max((MIN.graph / totalW) * 100, g + deltaPct);
      const newP = Math.max((MIN.preview / totalW) * 100, p - deltaPct);
      const sum = newG + newP;
      setPct([newG / sum * 100, newP / sum * 100]);
    }
    function onUp() { drag.current = null; }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const HANDLE_W = 5;
  const visibleSum = pct[0] + (previewPanelOpen ? pct[1] : 0);

  const flexVal = (normPct: number, minPx: number): string => {
    if (containerW === 0) return `0 0 ${normPct.toFixed(4)}%`;
    const usableW = containerW - (previewPanelOpen ? HANDLE_W : 0);
    const px = Math.max(minPx, (normPct / 100) * usableW);
    return `0 0 ${px}px`;
  };

  const normPct = {
    left: visibleSum > 0 ? (pct[0] / visibleSum) * 100 : 100,
    preview: visibleSum > 0 ? (pct[1] / visibleSum) * 100 : 0,
  };

  return (
    <div ref={rowRef} style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden", display: "flex" }}>
      {/* Left column: tabs + Info/Detail */}
      <div style={{ flex: flexVal(normPct.left, MIN.graph), minWidth: MIN.graph, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {leftContent}
      </div>

      {/* Handle: left ↔ preview */}
      {previewPanelOpen && (
        <div onMouseDown={startDrag} style={{
          width: HANDLE_W, flexShrink: 0, cursor: "col-resize", zIndex: 1,
          borderLeft: `1px solid ${theme.edgeBorder}`,
          background: "transparent",
        }} />
      )}

      {/* Preview panel — rendered at this level so it's visible on both Info and Detail tabs */}
      {previewItems.map(({ key, visible, everOpened, docPath, docPanelNode, docNodes, refreshKey }) => (
        <div key={key} style={{
          flex: previewPanelOpen ? flexVal(normPct.preview, MIN.preview) : "0 0 0px",
          minWidth: previewPanelOpen ? MIN.preview : 0,
          overflow: "hidden",
          display: visible ? "flex" : "none",
          flexDirection: "column", position: "relative",
        }}>
          {everOpened
            ? <ErrorBoundary label="PreviewPanel" fallback={<div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#b91c1c", fontSize: 13 }}>Preview unavailable for this file.</div>}><PreviewPanel docPath={docPath} selectedNodeId={docPanelNode} nodes={docNodes} refreshKey={refreshKey} /></ErrorBoundary>
            : <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: theme.graphBg }}><PreviewSpinner color={theme.terracotta} /></div>
          }
        </div>
      ))}
    </div>
  );
}

function ChatColumn({ theme, chatPanelOpen }: { theme: ThemeShape; chatPanelOpen: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);

  const [pct, setPct] = useState<number>(() => {
    try { return JSON.parse(localStorage.getItem(CHAT_WIDTH_KEY) ?? "null") ?? 25; }
    catch { return 25; }
  });

  useEffect(() => {
    const el = containerRef.current?.parentElement;
    if (!el) return;
    setContainerW(el.offsetWidth);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerW(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { localStorage.setItem(CHAT_WIDTH_KEY, JSON.stringify(pct)); }, [pct]);

  const drag = useRef<{ startX: number; startPct: number } | null>(null);

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    drag.current = { startX: e.clientX, startPct: pct };
  }, [pct]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!drag.current || containerW === 0) return;
      const deltaPct = ((drag.current.startX - e.clientX) / containerW) * 100;
      const next = Math.max((MIN.chat / containerW) * 100, Math.min(50, drag.current.startPct + deltaPct));
      setPct(next);
    }
    function onUp() { drag.current = null; }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [containerW]);

  const HANDLE_W = 5;
  const widthPx = containerW > 0 ? Math.max(MIN.chat, (pct / 100) * containerW) : undefined;

  return (
    <>
      {/* Handle: content ↔ chat */}
      <div onMouseDown={startDrag} style={{
        width: HANDLE_W, flexShrink: 0, cursor: "col-resize", zIndex: 1,
        borderLeft: `1px solid ${theme.edgeBorder}`,
        background: "transparent",
      }} />
      <div
        ref={containerRef}
        style={{
          width: widthPx ?? `${pct}%`,
          minWidth: MIN.chat,
          flexShrink: 0,
          display: chatPanelOpen ? "flex" : "none",
          flexDirection: "column",
          overflow: "hidden",
          background: theme.base,
          backgroundImage: "linear-gradient(rgba(255,255,255,0.06), rgba(255,255,255,0.06))",
        }}
      >
        <div style={{
          height: 32, display: "flex", alignItems: "center", padding: "0 12px",
          fontSize: FONT.sm, fontWeight: 700, color: theme.terracotta,
          textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0,
        }}>Chat</div>
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          <ChatPanel />
        </div>
      </div>
    </>
  );
}

function PreviewSpinner({ color }: { color: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" style={{ animation: "spin 0.8s linear infinite" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="12" cy="12" r="9" fill="none" stroke={color} strokeWidth="2.5" strokeOpacity="0.2" />
      <path d="M12 3 a9 9 0 0 1 9 9" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

