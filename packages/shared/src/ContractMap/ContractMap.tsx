import { useRef, useState, useEffect } from "react";
import { GraphNode } from "../components/WordGraphPanel/types";
import { useTheme } from "../components/WordGraphPanel/ThemeContext";
import { getTypeColour, typeTextColour, ThemeShape } from "../components/WordGraphPanel/theme";
import { FONT } from "../components/WordGraphPanel/fonts";
import { GraphCanvas, GraphCanvasHandle } from "../components/WordGraphPanel/Graph/GraphCanvas";
import { TilesView } from "./TilesView";
import { bulkAction, PoolTag } from "../api";

export interface ContractMapProps {
  nodes: GraphNode[];
  primaryDocId: string;
  nodeTypes: string[];
  docPath: string;
  workspacePath: string;
  poolTags: PoolTag[];
  selectedNodeId: string | null;  // graph highlight only
  panelNodeId: string | null;
  isParsing?: boolean;
  isReparsing?: boolean;
  enrichStatus?: string | null;
  detailsPanel?: (onFilterByTag: (tag: string) => void) => React.ReactNode;
  onNodeFocus: (nodeId: string | null) => void;
  onNodeSelect: (nodeId: string) => void;
  onScrollTo: (nodeId: string) => void;  // used by graph double-click
  onDeselect: () => void;
  onBulkUpdate: (patch: Partial<GraphNode>, ids: string[]) => void;
  onRefreshNodes: () => Promise<void>;
  onParse?: () => void;
}

type ViewMode = "graph" | "tiles";
type BulkActionKey = "reclassify" | "set_type" | "clear_type" | "add_tag" | "remove_tag" | "clear_tags";

const ACTION_LABELS: Record<BulkActionKey, string> = {
  reclassify: "Re-classify",
  set_type: "Change Clause Type",
  clear_type: "Clear Clause Type",
  add_tag: "Add Tag",
  remove_tag: "Remove Tag",
  clear_tags: "Clear All Tags",
};

function MenuItem({ label, onClick, destructive, theme }: { label: string; onClick: () => void; destructive?: boolean; theme: ThemeShape }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "block", width: "100%", textAlign: "left",
        padding: "7px 12px", border: "none", cursor: "pointer", fontSize: FONT.sm,
        background: hover ? (destructive ? `${theme.terracotta}18` : theme.base) : "transparent",
        color: destructive ? theme.terracotta : theme.black,
        fontWeight: destructive ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}

function Divider({ label, theme }: { label: string; theme: ThemeShape }) {
  return (
    <div style={{ padding: "5px 12px 3px", fontSize: FONT.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: theme.muted, borderTop: `1px solid ${theme.edgeBorder}`, marginTop: 2 }}>
      {label}
    </div>
  );
}

function ParamPicker({ options, value, onChange, placeholder = "Pick type…", theme }: { options: string[]; value: string | null; onChange: (v: string) => void; placeholder?: string; theme: ThemeShape }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div style={{ position: "relative", flex: 1 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ width: "100%", fontSize: FONT.sm, padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)", color: value ? "#fff" : "rgba(255,255,255,0.45)", cursor: "pointer", textAlign: "left", display: "flex", justifyContent: "space-between" }}
      >
        <span>{value ?? placeholder}</span>
        <span style={{ opacity: 0.5 }}>▾</span>
      </button>
      {open && (
        <div style={{ position: "absolute", bottom: "calc(100% + 4px)", left: 0, width: "100%", background: theme.white, borderRadius: 8, border: `1px solid ${theme.edgeBorder}`, boxShadow: "0 4px 16px rgba(0,0,0,0.2)", overflow: "hidden", zIndex: 40, maxHeight: 180, overflowY: "auto" }}>
          {options.length === 0 && (
            <div style={{ padding: "8px 12px", fontSize: FONT.sm, color: theme.muted }}>No options</div>
          )}
          {options.map((o) => (
            <button
              key={o}
              onClick={() => { onChange(o); setOpen(false); }}
              onMouseEnter={() => setHover(o)}
              onMouseLeave={() => setHover(null)}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "7px 12px", border: "none", cursor: "pointer", fontSize: FONT.sm, background: hover === o ? theme.base : "transparent", color: theme.black, fontWeight: value === o ? 700 : 400 }}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const VIEW_MODES: Array<{ key: ViewMode; label: string }> = [
  { key: "tiles", label: "List" },
  { key: "graph", label: "Graph" },
];

export function ContractMap({ nodes, primaryDocId, nodeTypes, docPath, workspacePath, poolTags, selectedNodeId, panelNodeId, isParsing, isReparsing, enrichStatus, detailsPanel, onNodeSelect, onScrollTo, onDeselect, onBulkUpdate, onRefreshNodes, onParse }: ContractMapProps) {
  const THEME = useTheme();
  const [viewMode, setViewMode] = useState<ViewMode>("tiles");
  const [activeTypes, setActiveTypes] = useState<string[]>([]);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [connectedOnly, setConnectedOnly] = useState(false);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const TAG_COLLAPSE_AT = 10;
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bubblesCollapsed, setBubblesCollapsed] = useState(true);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [chosenAction, setChosenAction] = useState<BulkActionKey | null>(null);
  const [chosenParam, setChosenParam] = useState<string | null>(null); // type or tag value
  const canvasRef = useRef<GraphCanvasHandle>(null);

  useEffect(() => {
    if (selectedNodeId) canvasRef.current?.focusNode(selectedNodeId);
  }, [selectedNodeId]);

  const allTypes = Array.from(new Set(nodes.map((n) => n.clause_type).filter((t): t is string => !!t)));
  const allTags = Array.from(new Set(nodes.flatMap((n) => n.clause_tags.map((t) => t.value)))).sort();

  const hasFilter = activeTypes.length > 0 || activeTags.length > 0 || connectedOnly;

  const connectedNodeIds = connectedOnly ? new Set(
    nodes.flatMap((n) => n.connections.length > 0 ? [n.stable_id, ...n.connections.map((c) => c.target_id)] : [])
  ) : null;

  const filtered = nodes.filter((n) => {
    if (activeTypes.length > 0 && !activeTypes.includes(n.clause_type ?? "Unclassified")) return false;
    if (activeTags.length > 0 && !activeTags.every((tag) => n.clause_tags.some((t) => t.value === tag))) return false;
    if (connectedOnly && !connectedNodeIds!.has(n.stable_id)) return false;
    return true;
  });

  function toggleType(type: string) {
    setActiveTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }

  function toggleTag(tag: string) {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds(new Set());
    setActionMenuOpen(false);
    setChosenAction(null);
    setChosenParam(null);
    setBulkError(null);
  }

  function pickAction(action: BulkActionKey) {
    setChosenAction(action);
    setChosenParam(null);
    setActionMenuOpen(false);
  }

  const selectedNodes = nodes.filter((n) => selectedIds.has(n.stable_id));
  const tagsOnSelected = Array.from(new Set(selectedNodes.flatMap((n) => n.clause_tags.map((t) => t.value)))).sort();

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const allIds = filtered.map((n) => n.stable_id);
    const allSelected = allIds.every((id) => selectedIds.has(id));
    setSelectedIds(allSelected ? new Set() : new Set(allIds));
  }

  async function handleApply() {
    if (!chosenAction) return;
    const ids = Array.from(selectedIds);
    const needsParam = chosenAction === "set_type" || chosenAction === "add_tag" || chosenAction === "remove_tag";
    if (needsParam && !chosenParam) return;
    setBulkError(null);
    try {
      await bulkAction(docPath, workspacePath, ids, chosenAction, { clause_type: chosenParam ?? undefined, tag: chosenParam ?? undefined });

      // Update UI
      if (chosenAction === "reclassify") onBulkUpdate({ needs_reclassification: true }, ids);
      else if (chosenAction === "set_type") onBulkUpdate({ clause_type: chosenParam!, needs_reclassification: false }, ids);
      else if (chosenAction === "clear_type") onBulkUpdate({ clause_type: undefined, needs_reclassification: false }, ids);
      else if (chosenAction === "add_tag" || chosenAction === "remove_tag" || chosenAction === "clear_tags") await onRefreshNodes();

      exitSelectMode();
      if (chosenAction === "reclassify") onParse?.();
    } catch {
      setBulkError("Failed — check backend logs.");
    }
  }

  // Pill style for view mode switcher
  const viewPill = (active: boolean): React.CSSProperties => ({
    fontSize: FONT.sm,
    fontWeight: 700,
    padding: "2px 8px",
    borderRadius: 9999,
    border: "none",
    cursor: "pointer",
    background: active ? THEME.terracotta : THEME.taupe,
    color: active ? "#fff" : THEME.black,
  });

  // Pill style for type filters
  const typePill = (active: boolean, colour?: string): React.CSSProperties => {
    const bg = active ? (colour ?? THEME.terracotta) : THEME.taupe;
    return {
      fontSize: FONT.sm,
      fontWeight: 700,
      padding: "2px 8px",
      borderRadius: 9999,
      border: "none",
      cursor: "pointer",
      background: bg,
      color: active ? typeTextColour(bg) : THEME.black,
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
    };
  };

  // Pill style for tag filters
  const tagPill = (active: boolean): React.CSSProperties => ({
    fontSize: FONT.sm,
    fontWeight: active ? 700 : 400,
    padding: "2px 8px",
    borderRadius: 9999,
    border: "none",
    cursor: "pointer",
    background: active ? THEME.charcoal : THEME.taupe,
    color: active ? "#fff" : THEME.black,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: THEME.base, color: THEME.black }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      {/* View mode switcher */}
      <div
        style={{
          padding: "6px 10px",
          borderBottom: `1px solid ${THEME.edgeBorder}`,
          display: "flex",
          gap: 4,
          flexShrink: 0,
        }}
      >
        {VIEW_MODES.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setViewMode(key)}
            style={viewPill(viewMode === key)}
          >
            {label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
      </div>

      {/* Bubble cluster toggle */}
      {viewMode === "tiles" && allTypes.length > 0 && (
        <div style={{ borderBottom: `1px solid ${THEME.edgeBorder}`, flexShrink: 0 }}>
          <button
            onClick={() => setBubblesCollapsed((v) => !v)}
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "4px 10px", background: "none", border: "none", cursor: "pointer",
              fontSize: FONT.label, fontWeight: 600, color: THEME.muted, textTransform: "uppercase", letterSpacing: "0.05em",
            }}
          >
            <span>Overview</span>
            <span style={{ fontSize: FONT.sm }}>{bubblesCollapsed ? "▸" : "▾"}</span>
          </button>
          {!bubblesCollapsed && (
            <TilesView
              nodes={filtered}
              panelNodeId={panelNodeId}
              activeTypes={activeTypes}
              onToggleType={toggleType}
              onSelect={selectMode ? toggleSelected : onNodeSelect}
              onDeselect={selectMode ? undefined : onDeselect}
              selectMode={selectMode}
              selectedIds={selectedIds}
              bubblesOnly
            />
          )}
        </div>
      )}

      {/* Filter sections */}
      {(allTypes.length > 0 || allTags.length > 0) && (
        <div style={{ borderBottom: `1px solid ${THEME.edgeBorder}`, flexShrink: 0 }}>
          {/* Clause Types */}
          {allTypes.length > 0 && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "4px 10px", borderBottom: `1px solid ${THEME.edgeBorder}` }}>
              <span style={{ fontSize: FONT.label, fontWeight: 600, color: THEME.muted, textTransform: "uppercase", letterSpacing: "0.05em", paddingTop: 4, whiteSpace: "nowrap", minWidth: 72 }}>Types</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {allTypes.map((type) => (
                  <button
                    key={type}
                    onClick={() => toggleType(type)}
                    style={typePill(activeTypes.includes(type), getTypeColour(type, THEME))}
                  >
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: activeTypes.includes(type) ? "rgba(255,255,255,0.7)" : getTypeColour(type, THEME), display: "inline-block", flexShrink: 0 }} />
                    {type}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          {allTags.length > 0 && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "4px 10px", borderBottom: `1px solid ${THEME.edgeBorder}` }}>
              <span style={{ fontSize: FONT.label, fontWeight: 600, color: THEME.muted, textTransform: "uppercase", letterSpacing: "0.05em", paddingTop: 4, whiteSpace: "nowrap", minWidth: 72 }}>Tags</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {(tagsExpanded ? allTags : allTags.slice(0, TAG_COLLAPSE_AT)).map((tag) => (
                  <button key={`tag:${tag}`} onClick={() => toggleTag(tag)} style={tagPill(activeTags.includes(tag))}>
                    #{tag}
                  </button>
                ))}
                {!tagsExpanded && allTags.length > TAG_COLLAPSE_AT && (
                  <button onClick={() => setTagsExpanded(true)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: FONT.sm, color: THEME.muted, padding: "2px 4px" }}>
                    +{allTags.length - TAG_COLLAPSE_AT} more
                  </button>
                )}
                {tagsExpanded && allTags.length > TAG_COLLAPSE_AT && (
                  <button onClick={() => setTagsExpanded(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: FONT.sm, color: THEME.muted, padding: "2px 4px" }}>
                    show less
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Connections + Clear */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px" }}>
            <span style={{ fontSize: FONT.label, fontWeight: 600, color: THEME.muted, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap", minWidth: 72 }}>Connections</span>
            <button onClick={() => setConnectedOnly((p) => !p)} style={tagPill(connectedOnly)}>
              has connections
            </button>
            {hasFilter && (
              <button
                onClick={() => { setActiveTypes([]); setActiveTags([]); setConnectedOnly(false); }}
                style={{ fontSize: FONT.sm, fontWeight: 700, padding: "2px 8px", borderRadius: 9999, border: "none", cursor: "pointer", background: THEME.terracotta, color: "#fff", marginLeft: "auto" }}
              >
                Clear all
              </button>
            )}
          </div>
        </div>
      )}

      {/* Select bar — full width, only in list mode */}
      {viewMode === "tiles" && (
        <button
          onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 7,
            padding: "6px 12px", border: "none", borderBottom: `1px solid ${THEME.edgeBorder}`,
            cursor: "pointer", flexShrink: 0,
            background: selectMode ? THEME.terracotta : `${THEME.terracotta}18`,
            color: selectMode ? "#fff" : THEME.terracotta,
            fontSize: FONT.sm, fontWeight: 700,
          }}
        >
          {/* Checkbox icon */}
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0 }}>
            {selectMode ? (
              <>
                <rect x="1" y="1" width="11" height="11" rx="2.5" fill={THEME.terracotta} stroke="#fff" strokeWidth="1"/>
                <polyline points="3,6.5 5.5,9 10,4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </>
            ) : (
              <rect x="1" y="1" width="11" height="11" rx="2.5" stroke={THEME.terracotta} strokeWidth="1.5"/>
            )}
          </svg>
          <span style={{ flex: 1, textAlign: "left" }}>
            {selectMode ? `${selectedIds.size} clause${selectedIds.size === 1 ? "" : "s"} selected` : "Select clauses"}
          </span>
          <span style={{ fontSize: FONT.sm, opacity: 0.7 }}>{selectMode ? "✕" : ""}</span>
        </button>
      )}

      {/* View area — splits when detailsPanel is provided */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative", display: "flex" }} id="contract-map-view-area">
        {isParsing && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 10,
            background: `${THEME.white}a8`,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexDirection: "column", gap: 8,
            backdropFilter: "blur(1px)",
          }}>
            <svg width="28" height="28" viewBox="0 0 28 28" style={{ animation: "spin 0.9s linear infinite" }}>
              <circle cx="14" cy="14" r="11" fill="none" stroke={THEME.edgeBorder} strokeWidth="3" />
              <path d="M14 3 A11 11 0 0 1 25 14" fill="none" stroke={THEME.terracotta} strokeWidth="3" strokeLinecap="round" />
            </svg>
            <span style={{ fontSize: FONT.sm, color: THEME.muted, fontWeight: 600 }}>
              {isReparsing ? "Re-parsing…" : "Parsing…"}
            </span>
            {enrichStatus && (
              <span style={{ fontSize: FONT.sm, color: THEME.muted, maxWidth: 200, textAlign: "center" }}>
                {enrichStatus}
              </span>
            )}
          </div>
        )}

        {/* Left: graph or tiles */}
        <div style={{ flex: detailsPanel ? "0 0 55%" : 1, overflow: "hidden", position: "relative" }}>
          {viewMode === "tiles" && (
            <TilesView
              nodes={filtered}
              panelNodeId={panelNodeId}
              activeTypes={activeTypes}
              onToggleType={toggleType}
              onSelect={selectMode ? toggleSelected : onNodeSelect}
              onDeselect={selectMode ? undefined : onDeselect}
              selectMode={selectMode}
              selectedIds={selectedIds}
            />
          )}
          {viewMode === "graph" && (
            <div style={{ height: "100%", position: "relative" }}>
              <GraphCanvas
                ref={canvasRef}
                nodes={nodes}
                filteredIds={hasFilter ? new Set(filtered.map((n) => n.stable_id)) : null}
                highlightConnections={connectedOnly}
                selectedNodeId={selectedNodeId}
                primaryDocId={primaryDocId}
                view="full"
                onNodeClick={(id) => { if (id) onNodeSelect(id); }}
                onNodeDoubleClick={(id) => { onNodeSelect(id); onScrollTo(id); }}
                onDeselect={onDeselect}
                height={0}
              />
              {/* Zoom controls */}
              <div style={{ position: "absolute", bottom: 8, right: 8, display: "flex", flexDirection: "column", gap: 3 }}>
                {[
                  { label: "+", title: "Zoom in",   action: () => canvasRef.current?.zoomIn() },
                  { label: "−", title: "Zoom out",  action: () => canvasRef.current?.zoomOut() },
                  { label: "⌖", title: "Re-centre", action: () => canvasRef.current?.recenter() },
                ].map(({ label, title, action }) => (
                  <button
                    key={label}
                    title={title}
                    onClick={action}
                    style={{
                      width: 22, height: 22, borderRadius: 5,
                      border: `1px solid ${THEME.edgeBorder}`,
                      background: THEME.white, color: THEME.black,
                      fontSize: FONT.title, lineHeight: 1, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      opacity: 0.8,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Floating bulk action bar — rendered outside overflow:hidden via portal-like placement */}
        {selectMode && (
          <div style={{
            position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
            zIndex: 100, background: "rgba(22,22,28,0.97)", borderRadius: 10,
            padding: "8px 12px", display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8,
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)", minWidth: 320, maxWidth: "min(90vw, 540px)",
            border: "1px solid rgba(255,255,255,0.1)",
          }}>
            {/* Row 1: select all + count */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={toggleSelectAll} style={{ fontSize: FONT.sm, padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", background: "transparent", color: "rgba(255,255,255,0.75)", cursor: "pointer", whiteSpace: "nowrap" }}>
                {filtered.every((n) => selectedIds.has(n.stable_id)) ? "Deselect all" : "Select all"}
              </button>
              <span style={{ fontSize: FONT.sm, color: "rgba(255,255,255,0.5)", flex: 1 }}>{selectedIds.size} selected</span>
              <button onClick={exitSelectMode} style={{ fontSize: FONT.sm, padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "transparent", color: "rgba(255,255,255,0.5)", cursor: "pointer" }}>Cancel</button>
            </div>

            {/* Row 2: action picker + param picker + apply */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {/* Action dropdown */}
                <div style={{ position: "relative", flex: 1 }}>
                  <button
                    onClick={() => setActionMenuOpen((v) => !v)}
                    style={{ width: "100%", fontSize: FONT.sm, padding: "5px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.9)", cursor: "pointer", textAlign: "left", display: "flex", justifyContent: "space-between" }}
                  >
                    <span>{chosenAction ? ACTION_LABELS[chosenAction] : "Choose action…"}</span>
                    <span style={{ opacity: 0.5 }}>▾</span>
                  </button>
                  {actionMenuOpen && (
                    <div style={{ position: "absolute", bottom: "calc(100% + 4px)", left: 0, width: "100%", background: THEME.white, borderRadius: 8, border: `1px solid ${THEME.edgeBorder}`, boxShadow: "0 4px 16px rgba(0,0,0,0.2)", overflow: "hidden", zIndex: 30 }}>
                      <MenuItem label="Re-classify" onClick={() => pickAction("reclassify")} theme={THEME} />
                      <Divider label="Clause Type" theme={THEME} />
                      <MenuItem label="Change Clause Type" onClick={() => pickAction("set_type")} theme={THEME} />
                      <MenuItem label="Clear Clause Type" onClick={() => pickAction("clear_type")} destructive theme={THEME} />
                      <Divider label="Tags" theme={THEME} />
                      <MenuItem label="Add Tag" onClick={() => pickAction("add_tag")} theme={THEME} />
                      <MenuItem label="Remove Tag" onClick={() => pickAction("remove_tag")} theme={THEME} />
                      <MenuItem label="Clear All Tags" onClick={() => pickAction("clear_tags")} destructive theme={THEME} />
                    </div>
                  )}
                </div>

                {/* Param picker for actions that need one */}
                {chosenAction === "set_type" && (
                  <ParamPicker
                    options={nodeTypes.filter(t => t !== "Section Title" && t !== "Subsection Title")}
                    value={chosenParam}
                    onChange={setChosenParam}
                    theme={THEME}
                  />
                )}
                {chosenAction === "add_tag" && (
                  <ParamPicker
                    options={poolTags.map(t => t.tag)}
                    value={chosenParam}
                    onChange={setChosenParam}
                    placeholder="Pick tag…"
                    theme={THEME}
                  />
                )}
                {chosenAction === "remove_tag" && (
                  <ParamPicker
                    options={tagsOnSelected}
                    value={chosenParam}
                    onChange={setChosenParam}
                    placeholder="Pick tag…"
                    theme={THEME}
                  />
                )}

                {/* Apply */}
                {chosenAction && (
                  <button
                    onClick={handleApply}
                    disabled={
                      (["set_type","add_tag","remove_tag"].includes(chosenAction) && !chosenParam) ||
                      (chosenAction !== "reclassify" && selectedIds.size === 0)
                    }
                    style={{
                      fontSize: FONT.sm, fontWeight: 700, padding: "5px 12px", borderRadius: 6, border: "none", whiteSpace: "nowrap",
                      background: ["clear_type","clear_tags"].includes(chosenAction) ? "#b91c1c" : THEME.terracotta,
                      color: typeTextColour(["clear_type","clear_tags"].includes(chosenAction) ? "#b91c1c" : THEME.terracotta),
                      cursor: "pointer",
                      opacity: (
                        (["set_type","add_tag","remove_tag"].includes(chosenAction) && !chosenParam) ||
                        (chosenAction !== "reclassify" && selectedIds.size === 0)
                      ) ? 0.4 : 1,
                    }}
                  >
                    Apply
                  </button>
                )}
            </div>
            {chosenAction === "reclassify" && (
              <span style={{ fontSize: FONT.sm, color: "rgba(255,255,255,0.45)", lineHeight: 1.4, display: "flex", alignItems: "flex-start", gap: 5 }}>
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
                  <path d="M5.5 1L10 9.5H1L5.5 1Z" fill="rgba(255,200,50,0.7)" stroke="rgba(255,200,50,0.7)" strokeWidth="0.5" strokeLinejoin="round"/>
                  <line x1="5.5" y1="4.5" x2="5.5" y2="7" stroke="#1a1a1a" strokeWidth="1.2" strokeLinecap="round"/>
                  <circle cx="5.5" cy="8.3" r="0.6" fill="#1a1a1a"/>
                </svg>
                {selectedIds.size > 0 ? "Selected clauses + any unclassified clauses in the document will be re-examined." : "All unclassified clauses in the document will be re-examined."}
              </span>
            )}
            {bulkError && <span style={{ fontSize: FONT.sm, color: "#fca5a5" }}>{bulkError}</span>}
          </div>
        )}

        {/* Right: details panel */}
        {detailsPanel && (
          <div style={{
            flex: "0 0 45%",
            borderLeft: `1px solid ${THEME.edgeBorder}`,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}>
            {detailsPanel(toggleTag)}
          </div>
        )}
      </div>
    </div>
  );
}
