import { useRef, useEffect, useState, useCallback } from "react";
import { GraphNode } from "../components/WordGraphPanel/types";
import { useTheme } from "../components/WordGraphPanel/ThemeContext";
import { getTypeColour, typeTextColour, ThemeShape } from "../components/WordGraphPanel/theme";
import { FONT } from "../components/WordGraphPanel/fonts";

interface Props {
  nodes: GraphNode[];
  panelNodeId: string | null;
  activeTypes: string[];
  onToggleType: (type: string) => void;
  onSelect: (id: string) => void;
  onDeselect?: () => void;
  selectMode?: boolean;
  selectedIds?: Set<string>;
  bubblesOnly?: boolean;
}

interface BubbleInfo {
  type: string;
  count: number;
  colour: string;
  radius: number;
  x: number;
  y: number;
}

function placeBubbles(types: Array<{ type: string; count: number }>, maxCount: number, areaW: number, areaH: number, theme: ThemeShape): BubbleInfo[] {
  const MIN_R = 20;
  const MAX_R = 44;
  const PADDING = 10;

  const tiles: BubbleInfo[] = types.map(({ type, count }) => {
    const radius = MIN_R + ((count / maxCount) * (MAX_R - MIN_R));
    return { type, count, colour: getTypeColour(type, theme), radius, x: 0, y: 0 };
  });

  // Row-pack to determine total layout size
  const rows: BubbleInfo[][] = [];
  let row: BubbleInfo[] = [];
  let rowW = 0;

  for (const b of tiles) {
    const needed = b.radius * 2 + (row.length > 0 ? PADDING : 0);
    if (row.length > 0 && rowW + needed > areaW) {
      rows.push(row);
      row = [];
      rowW = 0;
    }
    row.push(b);
    rowW += needed;
  }
  if (row.length > 0) rows.push(row);

  // Total layout height
  const rowHeights = rows.map((r) => Math.max(...r.map((b) => b.radius * 2)));
  const totalH = rowHeights.reduce((s, h) => s + h, 0) + PADDING * (rows.length - 1);
  let startY = Math.max(0, (areaH - totalH) / 2);

  for (let ri = 0; ri < rows.length; ri++) {
    const r = rows[ri];
    const rowH = rowHeights[ri];
    const rowTotalW = r.reduce((s, b) => s + b.radius * 2, 0) + PADDING * (r.length - 1);
    let cx = (areaW - rowTotalW) / 2;
    for (const b of r) {
      b.x = cx + b.radius;
      b.y = startY + rowH / 2;
      cx += b.radius * 2 + PADDING;
    }
    startY += rowH + PADDING;
  }

  return tiles;
}

export function TilesView({ nodes, panelNodeId, activeTypes, onToggleType, onSelect, onDeselect, selectMode = false, selectedIds = new Set(), bubblesOnly = false }: Props) {
  const THEME = useTheme();
  const areaRef = useRef<HTMLDivElement>(null);
  const selectedRowRef = useRef<HTMLDivElement>(null);
  const [areaW, setAreaW] = useState(300);
  const [areaH] = useState(150);

  // ResizeObserver keeps bubble layout in sync with container width
  const measureArea = useCallback(() => {
    if (areaRef.current) setAreaW(areaRef.current.clientWidth);
  }, []);

  useEffect(() => {
    measureArea();
    if (!areaRef.current) return;
    const ro = new ResizeObserver(measureArea);
    ro.observe(areaRef.current);
    return () => ro.disconnect();
  }, [measureArea]);

  // Scroll panel-open clause into view when it changes.
  useEffect(() => {
    if (!panelNodeId) return;
    const id = setTimeout(() => {
      selectedRowRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 0);
    return () => clearTimeout(id);
  }, [panelNodeId]);

  // Count by type
  const typeCounts = new Map<string, number>();
  for (const n of nodes) {
    const t = n.clause_type ?? "Unclassified";
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }

  const typesArr = Array.from(typeCounts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  const maxCount = typesArr.length > 0 ? typesArr[0].count : 1;
  const tiles = placeBubbles(typesArr, maxCount, areaW, areaH, THEME);
  const sorted = [...nodes].sort((a, b) => a.position - b.position);

  if (bubblesOnly) {
    return (
      <div ref={areaRef} style={{ height: 150, position: "relative", background: THEME.graphBg, overflow: "hidden" }}>
        {tiles.map((b) => {
          const isActive = activeTypes.includes(b.type);
          const anyActive = activeTypes.length > 0;
          return (
            <button key={b.type} onClick={() => onToggleType(b.type)} title={`${b.type}: ${b.count}`}
              style={{ position: "absolute", left: b.x - b.radius + 8, top: b.y - b.radius + 8, width: b.radius * 2, height: b.radius * 2, borderRadius: "50%", background: b.colour, border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 0, opacity: anyActive && !isActive ? 0.35 : 1, transition: "opacity 0.15s, transform 0.15s", transform: isActive ? "scale(1.1)" : "scale(1)" }}>
              <span style={{ fontSize: Math.max(8, b.radius * 0.28), fontWeight: 700, color: typeTextColour(b.colour), lineHeight: 1.1, textAlign: "center", pointerEvents: "none", padding: "0 4px", wordBreak: "break-word" }}>
                {b.type.length > 10 ? b.type.slice(0, 9) + "…" : b.type}
              </span>
              <span style={{ fontSize: Math.max(7, b.radius * 0.22), color: typeTextColour(b.colour), opacity: 0.7, pointerEvents: "none" }}>{b.count}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: THEME.base }}>
      {/* Clause list */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {sorted.map((n) => {
          const colour = getTypeColour(n.clause_type, THEME);
          const isPanelOpen = !selectMode && n.stable_id === panelNodeId;
          const isSelected = selectMode && selectedIds.has(n.stable_id);
          return (
            <div
              key={n.stable_id}
              ref={isPanelOpen ? selectedRowRef : null}
              onClick={() => {
                if (selectMode) { onSelect(n.stable_id); return; }
                isPanelOpen ? onDeselect?.() : onSelect(n.stable_id);
              }}
              style={{
                padding: "6px 12px 6px 10px",
                borderBottom: `1px solid ${THEME.edgeBorder}`,
                borderLeft: `3px solid ${isPanelOpen ? THEME.terracotta : isSelected ? THEME.charcoal : "transparent"}`,
                background: isPanelOpen ? `${THEME.terracotta}12` : isSelected ? `${THEME.charcoal}12` : "transparent",
                cursor: "pointer",
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
              }}
            >
              {selectMode && (
                <div style={{
                  marginTop: 2, width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                  border: `2px solid ${isSelected ? THEME.charcoal : THEME.edgeBorder}`,
                  background: isSelected ? THEME.charcoal : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {isSelected && <svg width="9" height="9" viewBox="0 0 9 9"><polyline points="1.5,4.5 3.5,6.5 7.5,2.5" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                {n.parent && (
                  <div style={{ fontSize: FONT.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: THEME.muted, marginBottom: 2 }}>
                    {n.parent}
                  </div>
                )}
                <span style={{ fontSize: FONT.sm, fontWeight: 700, padding: "1px 6px", borderRadius: 9999, background: colour, color: typeTextColour(colour), display: "inline-block", marginBottom: 3 }}>
                  {n.clause_type ?? "Unclassified"}
                </span>
                {n.needs_reclassification && (
                  <span
                    title="This clause has changed since it was last analysed. Ask the Agent to re-analyse."
                    style={{
                      fontSize: FONT.sm, fontWeight: 700,
                      padding: "1px 8px", borderRadius: 9999,
                      background: "#e0a04022", color: "#e0a040",
                      border: "1px solid #e0a04066",
                      display: "inline-block", marginLeft: 6, marginBottom: 3,
                      cursor: "default",
                      transition: "transform 0.1s, box-shadow 0.1s",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = "scale(1.08)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px #e0a04044"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ""; (e.currentTarget as HTMLElement).style.boxShadow = ""; }}
                  >⚠ Analysis may be outdated</span>
                )}
                <div
                  style={{
                    fontSize: FONT.sm,
                    color: THEME.black,
                    lineHeight: 1.5,
                    display: "-webkit-box",
                    WebkitLineClamp: isPanelOpen ? undefined : 2,
                    WebkitBoxOrient: "vertical",
                    overflow: isPanelOpen ? "visible" : "hidden",
                  }}
                >
                  {n.raw_text}
                </div>
              </div>
            </div>
          );
        })}
        {sorted.length === 0 && (
          <div style={{ padding: 16, fontSize: FONT.sm, color: THEME.muted, textAlign: "center" }}>
            No clauses
          </div>
        )}
      </div>
    </div>
  );
}
