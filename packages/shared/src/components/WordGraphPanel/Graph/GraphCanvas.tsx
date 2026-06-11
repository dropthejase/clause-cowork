import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import * as d3 from "d3";
import { GraphNode } from "../types";
import { LINK_DISTANCE, nodeColor, nodeRadius } from "../theme";
import { useTheme } from "../ThemeContext";

export interface GraphCanvasHandle {
  zoomIn(): void;
  zoomOut(): void;
  recenter(): void;
  focusSection(sectionLabel: string): void;
  focusNode(nodeId: string): void;
}

interface Props {
  nodes: GraphNode[];
  filteredIds?: Set<string> | null;
  highlightConnections?: boolean;
  selectedNodeId: string | null;
  primaryDocId: string;
  view: "local" | "full";
  onNodeClick: (nodeId: string | null) => void;
  onNodeDoubleClick?: (nodeId: string) => void;
  onDeselect?: () => void;
  onSectionFocus?: (sectionLabel: string) => void;
  onSectionClear?: () => void;
  height: number;
}

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  node: GraphNode;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  isCrossDoc: boolean;
  isHub: boolean;
  isSectionHub: boolean;
  isClauseToSection: boolean;
}

function getClusterIds(nodes: GraphNode[], selectedId: string | null): Set<string> {
  if (!selectedId) return new Set(nodes.map((n) => n.stable_id));
  const selected = nodes.find((n) => n.stable_id === selectedId);
  if (!selected) return new Set(nodes.map((n) => n.stable_id));
  const ids = new Set<string>([selectedId]);
  for (const conn of selected.connections) ids.add(conn.target_id);
  for (const n of nodes) {
    if (n.connections.some((c) => c.target_id === selectedId)) ids.add(n.stable_id);
  }
  return ids;
}

function buildLinks(simNodes: SimNode[]): SimLink[] {
  const nodeMap = new Map(simNodes.map((n) => [n.id, n]));
  const links: SimLink[] = [];
  const seen = new Set<string>();
  for (const sn of simNodes) {
    if (!sn.node) continue;
    for (const conn of sn.node.connections) {
      if (conn.note === "Sequential clause in same section") continue;
      const targetSn = nodeMap.get(conn.target_id);
      if (!targetSn) continue;
      // Suppress within-section edges — section clusters make these redundant
      if (sn.node.parent && targetSn.node?.parent && sn.node.parent === targetSn.node.parent) continue;
      const key = [sn.id, conn.target_id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({
        source: sn.id,
        target: conn.target_id,
        isCrossDoc: false,
        isHub: false,
        isSectionHub: false,
        isClauseToSection: false,
      });
    }
  }
  return links;
}

function isSectionNode(sn: SimNode): boolean {
  return sn.node?.clause_type === "Section Title" || sn.node?.clause_type === "Subsection Title";
}

export const GraphCanvas = forwardRef<GraphCanvasHandle, Props>(function GraphCanvas(
  { nodes, filteredIds, highlightConnections, selectedNodeId, primaryDocId, view, onNodeClick, onNodeDoubleClick, onDeselect, onSectionFocus, onSectionClear, height }, ref
) {
  const THEME = useTheme();
  const themeRef = useRef(THEME);
  themeRef.current = THEME;
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const simNodesRef = useRef<Map<string, SimNode>>(new Map());
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;
  const onNodeDoubleClickRef = useRef(onNodeDoubleClick);
  onNodeDoubleClickRef.current = onNodeDoubleClick;
  const onDeselectRef = useRef(onDeselect);
  onDeselectRef.current = onDeselect;
  const onSectionFocusRef = useRef(onSectionFocus);
  onSectionFocusRef.current = onSectionFocus;
  const onSectionClearRef = useRef(onSectionClear);
  onSectionClearRef.current = onSectionClear;
  const heightRef = useRef(height);
  heightRef.current = height;
  const selectedNodeIdRef = useRef(selectedNodeId);
  selectedNodeIdRef.current = selectedNodeId;
  const viewRef = useRef(view);
  viewRef.current = view;
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const primaryDocIdRef = useRef(primaryDocId);
  primaryDocIdRef.current = primaryDocId;
  const filteredIdsRef = useRef(filteredIds);
  filteredIdsRef.current = filteredIds;
  const highlightConnectionsRef = useRef(highlightConnections);
  highlightConnectionsRef.current = highlightConnections;
  const prevLinkCountRef = useRef(0);
  const selectedSectionRef = useRef<string | null>(null);

  useImperativeHandle(ref, () => ({
    zoomIn() {
      const svg = svgRef.current;
      if (!svg || !zoomRef.current) return;
      d3.select(svg).transition().duration(250).call(zoomRef.current.scaleBy, 1.4);
    },
    zoomOut() {
      const svg = svgRef.current;
      if (!svg || !zoomRef.current) return;
      d3.select(svg).transition().duration(250).call(zoomRef.current.scaleBy, 1 / 1.4);
    },
    recenter() {
      const svg = svgRef.current;
      if (!svg || !zoomRef.current) return;
      d3.select(svg).transition().duration(400).call(zoomRef.current.transform, d3.zoomIdentity);
    },
    focusSection(sectionLabel: string) {
      const svg = svgRef.current;
      if (!svg || !zoomRef.current) return;
      // Find the Section Title node whose raw_text matches sectionLabel
      const sn = Array.from(simNodesRef.current.values()).find(
        (n) => n.node && (n.node.clause_type === "Section Title" || n.node.clause_type === "Subsection Title") && n.node.raw_text === sectionLabel
      );
      if (!sn || sn.x == null || sn.y == null) return;
      const w = svg.getBoundingClientRect().width || 300;
      const h = svg.getBoundingClientRect().height || svg.clientHeight || 600;
      const t = themeRef.current;
      selectedSectionRef.current = sectionLabel;
      onNodeClickRef.current("");
      onSectionFocusRef.current?.(sectionLabel);
      // Pan to section hub
      const transform = d3.zoomIdentity.translate(w / 2 - sn.x, h / 2 - sn.y).scale(1);
      d3.select(svg).transition().duration(400).call(zoomRef.current.transform, transform);
      // Highlight member clauses
      const sectionHubIds = new Set(
        Array.from(simNodesRef.current.values())
          .filter((n) => n.node?.clause_type === "Section Title" || n.node?.clause_type === "Subsection Title")
          .map((n) => n.id)
      );
      d3.select(svg).selectAll<SVGGElement, SimNode>("g g g").select("circle")
        .attr("fill", (n) => {
          if (sectionHubIds.has(n.id)) return n.id === sn.id ? t.terracotta : t.taupe;
          if (!n.node) return t.taupe;
          return n.node.parent === sectionLabel ? t.charcoal : t.taupe;
        })
        .attr("stroke", (n) => sectionHubIds.has(n.id) && n.id === sn.id ? t.terracotta : "none");
      d3.select(svg).selectAll<SVGGElement, SimNode>("g g g").select("text")
        .attr("fill", (n) => {
          if (!n.node || sectionHubIds.has(n.id)) return t.muted;
          return n.node.parent === sectionLabel ? t.black : t.muted;
        });
    },
    focusNode(nodeId: string) {
      const svg = svgRef.current;
      if (!svg || !zoomRef.current) return;
      const sn = simNodesRef.current.get(nodeId);
      if (!sn || sn.x == null || sn.y == null) return;
      const w = svg.getBoundingClientRect().width || 300;
      const h = svg.getBoundingClientRect().height || svg.clientHeight || 600;
      const transform = d3.zoomIdentity.translate(w / 2 - sn.x, h / 2 - sn.y).scale(1);
      d3.select(svg).transition().duration(350).call(zoomRef.current.transform, transform);
    },
  }));

  // Rebuild when node set, sections, or Section Title nodes change
  const nodeIds = nodes.map((n) => `${n.stable_id}:${n.parent ?? ""}:${n.clause_type ?? ""}`).sort().join(",");

  // Rebuild simulation when node set changes or sections are assigned
  useEffect((): (() => void) | void => {
    const container = containerRef.current;
    const svg = svgRef.current;
    if (!svg || !container || nodes.length === 0) return;

    const width = container.clientWidth || 300;
    const height = container.clientHeight || heightRef.current || 600;
    const cx = width / 2;
    const cy = height / 2;

    // Doc hub — fixed at canvas centre
    const HUB_ID = `hub-${primaryDocId}`;
    const existingHub = simNodesRef.current.get(HUB_ID);
    const hubNode: SimNode = existingHub ?? {
      id: HUB_ID, node: null as unknown as GraphNode,
      x: cx, y: cy, fx: cx, fy: cy,
    };

    // Section Title / Subsection Title nodes act as hubs — map raw_text → stable_id
    const sectionNodeIds = new Map<string, string>(); // raw_text → stable_id
    const SECTION_RADIUS = 240;
    const sectionTitleNodes = nodes.filter(
      (n) => n.clause_type === "Section Title" || n.clause_type === "Subsection Title"
    );
    sectionTitleNodes.forEach((n) => {
      if (n.raw_text) sectionNodeIds.set(n.raw_text, n.stable_id);
    });

    const SECTION_HUB_IDS = new Set(sectionNodeIds.values());

    // All clause SimNodes — preserve positions, pre-place near their section node
    const sectionPositions = new Map<string, { x: number; y: number }>();
    sectionTitleNodes.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / sectionTitleNodes.length - Math.PI / 2;
      const existing = simNodesRef.current.get(n.stable_id);
      sectionPositions.set(n.stable_id, existing
        ? { x: existing.x ?? cx, y: existing.y ?? cy }
        : { x: cx + SECTION_RADIUS * Math.cos(angle), y: cy + SECTION_RADIUS * Math.sin(angle) }
      );
    });

    const sectionCounters = new Map<string, number>();
    const simNodes: SimNode[] = nodes.map((n) => {
      const existing = simNodesRef.current.get(n.stable_id);
      if (existing) return { ...existing, node: n };
      // Pre-place clause nodes near their section hub
      const secId = n.parent ? sectionNodeIds.get(n.parent) : undefined;
      if (secId) {
        const hubPos = sectionPositions.get(secId);
        if (hubPos) {
          const idx = sectionCounters.get(secId) ?? 0;
          sectionCounters.set(secId, idx + 1);
          const angle = (2 * Math.PI * idx) / 8;
          return {
            id: n.stable_id, node: n,
            x: hubPos.x + 40 * Math.cos(angle) + (Math.random() - 0.5) * 10,
            y: hubPos.y + 40 * Math.sin(angle) + (Math.random() - 0.5) * 10,
          };
        }
      }
      return { id: n.stable_id, node: n };
    });

    const allSimNodes = [...simNodes, hubNode];
    simNodesRef.current = new Map(allSimNodes.map((n) => [n.id, n]));

    const simLinks = buildLinks(simNodes);

    // Doc hub → Section Title node links
    for (const sn of simNodes) {
      if (SECTION_HUB_IDS.has(sn.id) && sn.node?.clause_type === "Section Title") {
        simLinks.push({
          source: HUB_ID, target: sn.id,
          isCrossDoc: false, isHub: true, isSectionHub: true, isClauseToSection: false,
        });
      }
    }

    // Subsection Title → parent Section Title links
    for (const sn of simNodes) {
      if (sn.node?.clause_type === "Subsection Title" && sn.node.parent) {
        const parentId = sectionNodeIds.get(sn.node.parent);
        if (parentId) {
          simLinks.push({
            source: sn.id, target: parentId,
            isCrossDoc: false, isHub: true, isSectionHub: true, isClauseToSection: false,
          });
        }
      }
    }

    // Clause → section node (or doc hub fallback for unassigned)
    for (const sn of simNodes) {
      if (SECTION_HUB_IDS.has(sn.id)) continue; // section nodes handled above
      const sec = sn.node?.parent;
      const secId = sec ? sectionNodeIds.get(sec) : undefined;
      if (secId) {
        simLinks.push({
          source: sn.id, target: secId,
          isCrossDoc: false, isHub: false, isSectionHub: false, isClauseToSection: true,
        });
      } else {
        simLinks.push({
          source: sn.id, target: HUB_ID,
          isCrossDoc: false, isHub: true, isSectionHub: false, isClauseToSection: false,
        });
      }
    }

    d3.select(svg).selectAll("*").remove();
    if (simRef.current) simRef.current.stop();

    const root = d3.select(svg);
    const g = root.append("g");

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("zoom", (event) => g.attr("transform", event.transform));
    root.call(zoom).on("dblclick.zoom", null)
      .on("dblclick", (event) => {
        if (event.target === svg) onDeselectRef.current?.();
      });
    zoomRef.current = zoom;

    const clusterIds = view === "local"
      ? getClusterIds(nodes, selectedNodeId)
      : new Set(nodes.map((n) => n.stable_id));

    const linkG = g.append("g");

    const link = linkG.selectAll<SVGLineElement, SimLink>("line.vis")
      .data(simLinks)
      .join("line")
      .attr("class", "vis")
      .attr("stroke", (l) => (l.isHub || l.isClauseToSection) ? themeRef.current.hubLine : themeRef.current.edgeLine)
      .attr("stroke-width", (l) => (l.isHub || l.isClauseToSection) ? 0.5 : 0.8)
      .attr("opacity", (l) => (l.isHub || l.isClauseToSection) ? 0.35 : 0.45)
      .attr("stroke-dasharray", (l) => (l.isHub || l.isClauseToSection) ? "4,3" : "none")
      .attr("pointer-events", "none");

    // Restores link visual state after hover, respecting active filters and selection
    function restoreLinks() {
      const t = themeRef.current;
      const curSelectedId = selectedNodeIdRef.current;
      const curFilteredIds = filteredIdsRef.current;
      const curHighlight = highlightConnectionsRef.current;
      link
        .attr("opacity", (l) => {
          if (l.isHub || l.isClauseToSection) return 0.35;
          if (curFilteredIds) {
            const src = (l.source as SimNode).id;
            const tgt = (l.target as SimNode).id;
            if (l.isSectionHub) return 0.35;
            const isVisible = curFilteredIds.has(src) && curFilteredIds.has(tgt);
            return isVisible ? (curHighlight ? 1 : 0.45) : 0.04;
          }
          if (!curSelectedId) return 0.45;
          const src = (l.source as SimNode).id;
          const tgt = (l.target as SimNode).id;
          return (src === curSelectedId || tgt === curSelectedId) ? 0.9 : 0.1;
        })
        .attr("stroke", (l) => {
          if (l.isHub || l.isClauseToSection || l.isSectionHub) return t.hubLine;
          if (curFilteredIds) {
            const src = (l.source as SimNode).id;
            const tgt = (l.target as SimNode).id;
            return (curHighlight && curFilteredIds.has(src) && curFilteredIds.has(tgt)) ? t.terracotta : t.edgeLine;
          }
          return t.edgeLine;
        })
        .attr("stroke-width", (l) => {
          if (l.isHub || l.isClauseToSection || l.isSectionHub) return 0.5;
          if (curFilteredIds) {
            const src = (l.source as SimNode).id;
            const tgt = (l.target as SimNode).id;
            return (curHighlight && curFilteredIds.has(src) && curFilteredIds.has(tgt)) ? 2.5 : 0.8;
          }
          if (!curSelectedId) return 0.8;
          const src = (l.source as SimNode).id;
          const tgt = (l.target as SimNode).id;
          return (src === curSelectedId || tgt === curSelectedId) ? 1.5 : 0.8;
        });
    }

    // Invisible wide hit-area lines for link hover
    const linkHit = linkG.selectAll<SVGLineElement, SimLink>("line.hit")
      .data(simLinks)
      .join("line")
      .attr("class", "hit")
      .attr("stroke", "transparent")
      .attr("stroke-width", 10)
      .attr("fill", "none")
      .style("cursor", "crosshair")
      .on("mouseenter", (_event, l) => {
        const t = themeRef.current;
        const src = (l.source as SimNode).id;
        const tgt = (l.target as SimNode).id;

        if (l.isClauseToSection) {
          // Hover on section spoke: highlight the section hub and all its clauses
          const secHubId = l.isSectionHub ? src : (SECTION_HUB_IDS.has(tgt) ? tgt : src);
          const secLabel = simNodesRef.current.get(secHubId)?.node?.raw_text ?? null;
          node.select("circle")
            .attr("fill", (n) => {
              if (SECTION_HUB_IDS.has(n.id)) return n.id === secHubId ? t.terracotta : t.taupe;
              if (!n.node) return t.taupe;
              return n.node.parent === secLabel ? t.nodeColour : t.taupe;
            });
          link.attr("opacity", (ll) => {
            const s = (ll.source as SimNode).id;
            const tg = (ll.target as SimNode).id;
            if (s === secHubId || tg === secHubId) return 0.9;
            return (ll.isHub || ll.isClauseToSection) ? 0.1 : 0.1;
          }).attr("stroke-width", (ll) => {
            const s = (ll.source as SimNode).id;
            const tg = (ll.target as SimNode).id;
            return (s === secHubId || tg === secHubId) ? 1.5 : (ll.isHub || ll.isClauseToSection) ? 0.5 : 0.8;
          });
          return;
        }

        if (l.isHub) {
          // Hover on doc-hub spoke: dim everything, highlight just this spoke
          link.attr("opacity", (ll) => {
            const s = (ll.source as SimNode).id;
            const tg = (ll.target as SimNode).id;
            return (s === src && tg === tgt) || (s === tgt && tg === src) ? 0.9 : 0.1;
          });
          return;
        }

        // Semantic edge: highlight both endpoints and all their connections
        const bothIds = new Set<string>([src, tgt]);
        const srcNode = nodesRef.current.find((n) => n.stable_id === src);
        const tgtNode = nodesRef.current.find((n) => n.stable_id === tgt);
        if (srcNode) { for (const c of srcNode.connections) bothIds.add(c.target_id); }
        if (tgtNode) { for (const c of tgtNode.connections) bothIds.add(c.target_id); }
        for (const n of nodesRef.current) {
          if (n.connections.some((c) => c.target_id === src || c.target_id === tgt)) bothIds.add(n.stable_id);
        }
        node.select("circle")
          .attr("fill", (n) => {
            if (SECTION_HUB_IDS.has(n.id) || !n.node) return t.taupe;
            if (n.id === src || n.id === tgt) return t.terracotta;
            return bothIds.has(n.id) ? t.nodeColour : t.taupe;
          })
          .attr("r", (n) => {
            if (n.id === HUB_ID || SECTION_HUB_IDS.has(n.id)) return n.id === HUB_ID ? 10 : 7;
            const base = nodeRadius(n.node?.connections.length ?? 0, n.id === selectedNodeIdRef.current ? "selected" : null);
            return base;
          });
        link.attr("opacity", (ll) => {
          if (ll.isHub || ll.isClauseToSection) return 0.1;
          const s = (ll.source as SimNode).id;
          const tg = (ll.target as SimNode).id;
          if ((s === src && tg === tgt) || (s === tgt && tg === src)) return 1.0;
          if (s === src || tg === src || s === tgt || tg === tgt) return 0.6;
          return 0.08;
        }).attr("stroke-width", (ll) => {
          if (ll.isHub || ll.isClauseToSection) return 0.5;
          const s = (ll.source as SimNode).id;
          const tg = (ll.target as SimNode).id;
          return (s === src && tg === tgt) || (s === tgt && tg === src) ? 2.0 : 0.8;
        });
      })
      .on("mouseleave", restoreLinks);

    const node = g.append("g").selectAll<SVGGElement, SimNode>("g")
      .data(allSimNodes, (d) => d.id)
      .join("g")
      .style("cursor", "pointer")
      .on("click", (_event, d) => {
        const svgEl = svgRef.current;
        if (!svgEl || !zoomRef.current) return;
        const w = svgEl.getBoundingClientRect().width || svgEl.clientWidth || 300;
        if (d.id === HUB_ID) {
          selectedSectionRef.current = null;
          onSectionClearRef.current?.();
          onDeselectRef.current?.();
          if (d.x != null && d.y != null) {
            const h = svgEl.getBoundingClientRect().height || svgEl.clientHeight || 600;
            const transform = d3.zoomIdentity.translate(w / 2 - d.x, h / 2 - d.y).scale(1);
            d3.select(svgEl).transition().duration(400).call(zoomRef.current.transform, transform);
          }
          return;
        }
        if (SECTION_HUB_IDS.has(d.id)) {
          // Highlight member clauses, recenter to section hub, don't select a clause
          const secLabel = simNodesRef.current.get(d.id)?.node?.raw_text ?? null;
          selectedSectionRef.current = secLabel;
          onNodeClickRef.current("");
          if (secLabel) onSectionFocusRef.current?.(secLabel);
          // Recolour immediately via D3
          const t = themeRef.current;
          d3.select(svgEl).selectAll<SVGGElement, SimNode>("g g g").select("circle")
            .attr("fill", (n) => {
              if (!n.node || SECTION_HUB_IDS.has(n.id)) return n.id === d.id ? t.terracotta : t.taupe;
              const inSection = secLabel && n.node.parent === secLabel;
              return inSection ? t.nodeColour : t.taupe;
            })
            .attr("stroke", (n) => SECTION_HUB_IDS.has(n.id) && n.id === d.id ? t.terracotta : "none");
          d3.select(svgEl).selectAll<SVGGElement, SimNode>("g g g").select("text")
            .attr("fill", (n) => {
              if (!n.node || SECTION_HUB_IDS.has(n.id)) return t.muted;
              return secLabel && n.node.parent === secLabel ? t.black : t.muted;
            });
          if (d.x != null && d.y != null) {
            const transform = d3.zoomIdentity.translate(w / 2 - d.x, svgEl.getBoundingClientRect().height / 2 - d.y).scale(1);
            d3.select(svgEl).transition().duration(400).call(zoomRef.current.transform, transform);
          }
          return;
        }
        selectedSectionRef.current = null;
        onSectionClearRef.current?.();
        if (d.id === selectedNodeIdRef.current) {
          onDeselectRef.current?.();
          return;
        }
        onNodeClickRef.current(d.id);
      })
      .on("dblclick", (_event, d) => {
        if (!d.node || d.id === HUB_ID || SECTION_HUB_IDS.has(d.id)) return;
        onNodeDoubleClickRef.current?.(d.id);
      })
      .call(d3.drag<SVGGElement, SimNode>()
        .filter((_, d) => d.id !== HUB_ID)
        .on("start", (event, d) => {
          if (!simRef.current) return;
          if (!event.active) simRef.current.alphaTarget(0.02).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on("end", (event, d) => {
          if (!simRef.current) return;
          if (!event.active) simRef.current.alphaTarget(0);
          if (!isSectionNode(d)) { d.fx = null; d.fy = null; }
        })
      );

    node.append("circle")
      .attr("r", (d) => {
        if (d.id === HUB_ID) return 10;
        if (SECTION_HUB_IDS.has(d.id)) return 7;
        return nodeRadius(d.node?.connections.length ?? 0, d.id === selectedNodeId ? "selected" : null);
      })
      .attr("fill", (d) => {
        if (d.id === HUB_ID || SECTION_HUB_IDS.has(d.id)) return themeRef.current.taupe;
        return nodeColor(d.node, primaryDocId, d.id === selectedNodeId, clusterIds.has(d.id), themeRef.current);
      })
      .attr("stroke", (d) => {
        if (d.id === HUB_ID || SECTION_HUB_IDS.has(d.id)) return themeRef.current.muted;
        return d.id === selectedNodeId ? themeRef.current.terracotta : "none";
      })
      .attr("stroke-width", (d) => (d.id === HUB_ID || SECTION_HUB_IDS.has(d.id)) ? 1 : 2)
      .attr("stroke-dasharray", (d) => (d.id === HUB_ID || SECTION_HUB_IDS.has(d.id)) ? "3,2" : "none");

    node.append("text")
      .attr("text-anchor", "middle")
      .attr("font-size", (d) => SECTION_HUB_IDS.has(d.id) ? 8 : 9)
      .attr("font-weight", (d) => SECTION_HUB_IDS.has(d.id) ? "600" : "normal")
      .attr("fill", (d) => {
        if (d.id === HUB_ID || SECTION_HUB_IDS.has(d.id)) return themeRef.current.muted;
        return clusterIds.has(d.id) ? themeRef.current.black : themeRef.current.muted;
      })
      .attr("pointer-events", "none")
      .attr("user-select", "none")
      .text((d) => {
        if (d.id === HUB_ID) return "doc";
        if (SECTION_HUB_IDS.has(d.id)) {
          const label = d.node?.raw_text ?? "";
          return label.length > 18 ? label.slice(0, 17) + "…" : label;
        }
        const txt = d.node.raw_text.slice(0, 20).replace(/\n/g, " ");
        return txt + (d.node.raw_text.length > 20 ? "…" : "");
      });

    // Hover tooltip (clause nodes only)
    const tooltip = d3.select(container)
      .selectAll<HTMLDivElement, unknown>(".graph-tooltip")
      .data([null])
      .join("div")
      .attr("class", "graph-tooltip")
      .style("position", "absolute")
      .style("pointer-events", "none")
      .style("background", "rgba(30,20,10,0.88)")
      .style("color", "#f8f5f1")
      .style("font-size", "11px")
      .style("line-height", "1.4")
      .style("padding", "6px 9px")
      .style("border-radius", "5px")
      .style("max-width", "220px")
      .style("word-wrap", "break-word")
      .style("display", "none")
      .style("z-index", "10");

    node
      .on("mouseenter", (_event, d) => {
        const t = themeRef.current;
        if (SECTION_HUB_IDS.has(d.id)) {
          // Highlight all clause nodes in this section
          const secLabel = simNodesRef.current.get(d.id)?.node?.raw_text ?? null;
          node.select("circle")
            .attr("fill", (n) => {
              if (SECTION_HUB_IDS.has(n.id)) return n.id === d.id ? t.terracotta : t.taupe;
              if (!n.node) return t.taupe;
              return n.node.parent === secLabel ? t.charcoal : t.taupe;
            })
            .attr("r", (n) => {
              if (n.id === HUB_ID) return 10;
              if (SECTION_HUB_IDS.has(n.id)) return n.id === d.id ? 9 : 7;
              return nodeRadius(n.node?.connections.length ?? 0, n.id === selectedNodeId ? "selected" : null);
            });
          link.attr("opacity", (l) => {
            const src = (l.source as SimNode).id;
            const tgt = (l.target as SimNode).id;
            if (src === d.id || tgt === d.id) return 0.9;
            return (l.isHub || l.isClauseToSection) ? 0.15 : 0.15;
          });
          return;
        }
        if (!d.node) return;
        // Highlight this node + its connected edges
        const connectedIds = new Set<string>([d.id]);
        for (const conn of d.node.connections) connectedIds.add(conn.target_id);
        for (const n of nodes) {
          if (n.connections.some((c) => c.target_id === d.id)) connectedIds.add(n.stable_id);
        }
        node.select("circle")
          .attr("fill", (n) => {
            if (SECTION_HUB_IDS.has(n.id) || !n.node) return t.taupe;
            if (n.id === d.id) return t.terracotta;
            return connectedIds.has(n.id) ? t.nodeColour : t.taupe;
          })
          .attr("r", (n) => {
            if (n.id === HUB_ID) return 10;
            if (SECTION_HUB_IDS.has(n.id)) return 7;
            const base = nodeRadius(n.node?.connections.length ?? 0, n.id === selectedNodeId ? "selected" : null);
            return base;
          });
        link.attr("opacity", (l) => {
          const src = (l.source as SimNode).id;
          const tgt = (l.target as SimNode).id;
          if (l.isHub || l.isClauseToSection) return 0.15;
          if (src === d.id || tgt === d.id) return 0.9;
          return 0.1;
        }).attr("stroke-width", (l) => {
          const src = (l.source as SimNode).id;
          const tgt = (l.target as SimNode).id;
          if (!l.isHub && !l.isClauseToSection && (src === d.id || tgt === d.id)) return 1.5;
          return (l.isHub || l.isClauseToSection) ? 0.5 : 0.8;
        });
        // Tooltip
        const preview = d.node.raw_text.slice(0, 120).replace(/\n/g, " ");
        tooltip.style("display", "block")
          .text(preview.length < d.node.raw_text.length ? preview + "…" : preview);
      })
      .on("mousemove", (event) => {
        const rect = container.getBoundingClientRect();
        tooltip.style("left", `${event.clientX - rect.left + 10}px`)
          .style("top", `${event.clientY - rect.top + 10}px`);
      })
      .on("mouseleave", () => {
        tooltip.style("display", "none");
        // Restore to selection-driven state (mirrors the selectedNodeId useEffect)
        const t = themeRef.current;
        const curNodes = nodesRef.current;
        const curSelectedId = selectedNodeIdRef.current;
        const curView = viewRef.current;
        const curPrimaryDocId = primaryDocIdRef.current;
        const clusterIds = curView === "local"
          ? getClusterIds(curNodes, curSelectedId)
          : new Set(curNodes.map((n) => n.stable_id));
        const secLabel = selectedSectionRef.current;

        const selConnectedIds = new Set<string>();
        if (curSelectedId) {
          selConnectedIds.add(curSelectedId);
          const sel = curNodes.find((n) => n.stable_id === curSelectedId);
          if (sel) {
            for (const conn of sel.connections) selConnectedIds.add(conn.target_id);
            for (const n of curNodes) {
              if (n.connections.some((c) => c.target_id === curSelectedId)) selConnectedIds.add(n.stable_id);
            }
          }
        }

        node.select("circle")
          .attr("fill", (d) => {
            if (SECTION_HUB_IDS.has(d.id)) {
              return secLabel && d.node?.raw_text === secLabel ? t.terracotta : t.taupe;
            }
            if (!d.node) return t.taupe;
            if (secLabel) return d.node.parent === secLabel ? t.nodeColour : t.taupe;
            if (curSelectedId) {
              if (d.id === curSelectedId) return t.terracotta;
              return selConnectedIds.has(d.id) ? t.nodeColour : t.taupe;
            }
            return nodeColor(d.node, curPrimaryDocId, false, clusterIds.has(d.id), t);
          })
          .attr("r", (d) => {
            if (d.id === HUB_ID) return 10;
            if (SECTION_HUB_IDS.has(d.id)) return 7;
            return nodeRadius(d.node?.connections.length ?? 0, d.id === curSelectedId ? "selected" : null);
          });
        restoreLinks();
      });

    const sim = d3.forceSimulation<SimNode, SimLink>(allSimNodes)
      .alpha(0.4)
      .alphaDecay(0.04)   // settles in ~60 ticks vs default 300
      .velocityDecay(0.3)
      .force("link", d3.forceLink<SimNode, SimLink>(simLinks).id((d) => d.id)
        .distance((l) => {
          if (l.isSectionHub) return LINK_DISTANCE.sectionHub;
          if (l.isClauseToSection) return LINK_DISTANCE.clauseToSection;
          if (l.isHub) return LINK_DISTANCE.hub;
          return LINK_DISTANCE.crossSection;
        })
        .strength((l) => {
          if (l.isSectionHub) return 0.08;
          if (l.isClauseToSection) return 0.85; // strong but not rigid — avoids centre-pull on filtered sets
          if (l.isHub) return 0.01;
          return 0; // semantic links are visual only — no positional force
        }))
      .force("charge", d3.forceManyBody().strength(-120))
      .force("center", d3.forceCenter(cx, cy).strength(0.008))
      .force("collision", d3.forceCollide(22))
      .on("tick", () => {
        for (const sn of simNodes) {
          const r = simNodesRef.current.get(sn.id);
          if (r) { r.x = sn.x; r.y = sn.y; }
        }
        const setPos = (sel: typeof link) => sel
          .attr("x1", (d) => (d.source as SimNode).x ?? 0)
          .attr("y1", (d) => (d.source as SimNode).y ?? 0)
          .attr("x2", (d) => (d.target as SimNode).x ?? 0)
          .attr("y2", (d) => (d.target as SimNode).y ?? 0);
        setPos(link); setPos(linkHit);
        node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
        node.select("text").attr("y", (d) => {
          if (d.id === HUB_ID || SECTION_HUB_IDS.has(d.id)) return -14;
          return -(nodeRadius(d.node?.connections.length ?? 0, null) + 4);
        });
      });

    simRef.current = sim;
    return () => { sim.stop(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeIds]);

  // Update links when connections change, without rebuilding the simulation
  useEffect(() => {
    const svg = svgRef.current;
    const sim = simRef.current;
    if (!svg || !sim) return;

    for (const [id, sn] of simNodesRef.current) {
      const updated = nodes.find((n) => n.stable_id === id);
      if (updated) sn.node = updated;
    }

    const allCached = Array.from(simNodesRef.current.values());
    const clauseNodes = allCached.filter((sn) => sn.node && !sn.id.startsWith("hub-") && !isSectionNode(sn));
    const simLinks = buildLinks(clauseNodes);

    const HUB_ID_UPDATE = Array.from(simNodesRef.current.keys()).find((k) => k.startsWith("hub-"));
    const sectionNodeMap = new Map<string, string>(); // raw_text → stable_id
    for (const sn of allCached) {
      if (isSectionNode(sn) && sn.node?.raw_text) sectionNodeMap.set(sn.node.raw_text, sn.id);
    }
    // Doc hub → Section Title nodes
    if (HUB_ID_UPDATE) {
      for (const sn of allCached) {
        if (sn.node?.clause_type === "Section Title") {
          simLinks.push({
            source: HUB_ID_UPDATE, target: sn.id,
            isCrossDoc: false, isHub: true, isSectionHub: true, isClauseToSection: false,
          });
        }
      }
    }

    // Subsection Title → parent Section Title
    for (const sn of allCached) {
      if (sn.node?.clause_type === "Subsection Title" && sn.node.parent) {
        const parentId = sectionNodeMap.get(sn.node.parent);
        if (parentId) {
          simLinks.push({
            source: sn.id, target: parentId,
            isCrossDoc: false, isHub: true, isSectionHub: true, isClauseToSection: false,
          });
        }
      }
    }

    // Clause → section node (or doc hub fallback)
    for (const sn of clauseNodes) {
      const sec = sn.node?.parent;
      const secId = sec ? sectionNodeMap.get(sec) : undefined;
      if (secId) {
        simLinks.push({
          source: sn.id, target: secId,
          isCrossDoc: false, isHub: false, isSectionHub: false, isClauseToSection: true,
        });
      } else if (HUB_ID_UPDATE) {
        simLinks.push({
          source: sn.id, target: HUB_ID_UPDATE,
          isCrossDoc: false, isHub: true, isSectionHub: false, isClauseToSection: false,
        });
      }
    }

    (sim.force("link") as d3.ForceLink<SimNode, SimLink>)
      .links(simLinks)
      .distance((l) => {
        if (l.isSectionHub) return LINK_DISTANCE.sectionHub;
        if (l.isClauseToSection) return LINK_DISTANCE.clauseToSection;
        if (l.isHub) return LINK_DISTANCE.hub;
        return LINK_DISTANCE.crossSection;
      });

    const g = d3.select(svg).select<SVGGElement>("g");
    const linkG = g.select<SVGGElement>("g:first-child");
    linkG.selectAll<SVGLineElement, SimLink>("line.vis")
      .data(simLinks)
      .join("line")
      .attr("class", "vis")
      .attr("pointer-events", "none")
      .attr("stroke", (l) => (l.isHub || l.isClauseToSection) ? themeRef.current.hubLine : themeRef.current.edgeLine)
      .attr("stroke-width", (l) => (l.isHub || l.isClauseToSection) ? 0.5 : 0.8)
      .attr("opacity", (l) => (l.isHub || l.isClauseToSection) ? 0.35 : 0.45)
      .attr("stroke-dasharray", (l) => (l.isHub || l.isClauseToSection) ? "4,3" : "none");
    linkG.selectAll<SVGLineElement, SimLink>("line.hit")
      .data(simLinks)
      .join("line")
      .attr("class", "hit")
      .attr("stroke", "transparent")
      .attr("stroke-width", 10)
      .style("cursor", "crosshair");

    // After re-joining, set positions immediately from current node positions
    // (d3 hasn't resolved source/target string IDs to SimNode refs yet on new elements)
    const setPos = (sel: d3.Selection<SVGLineElement, SimLink, SVGGElement, unknown>) =>
      sel
        .attr("x1", (l) => simNodesRef.current.get(typeof l.source === "string" ? l.source : (l.source as SimNode).id)?.x ?? 0)
        .attr("y1", (l) => simNodesRef.current.get(typeof l.source === "string" ? l.source : (l.source as SimNode).id)?.y ?? 0)
        .attr("x2", (l) => simNodesRef.current.get(typeof l.target === "string" ? l.target : (l.target as SimNode).id)?.x ?? 0)
        .attr("y2", (l) => simNodesRef.current.get(typeof l.target === "string" ? l.target : (l.target as SimNode).id)?.y ?? 0);
    setPos(linkG.selectAll<SVGLineElement, SimLink>("line.vis"));
    setPos(linkG.selectAll<SVGLineElement, SimLink>("line.hit"));

    const semanticLinkCount = simLinks.filter(
      (l) => !l.isHub && !l.isSectionHub && !l.isClauseToSection
    ).length;
    if (semanticLinkCount > prevLinkCountRef.current) {
      sim.alpha(0.3).restart();
    }
    prevLinkCountRef.current = semanticLinkCount;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  // Update colours when selection or theme changes
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const clusterIds = view === "local"
      ? getClusterIds(nodes, selectedNodeId)
      : new Set(nodes.map((n) => n.stable_id));

    const t = themeRef.current;
    const sectionHubIds = new Set(
      Array.from(simNodesRef.current.values()).filter(isSectionNode).map((sn) => sn.id)
    );
    const secLabel = selectedSectionRef.current;

    // Build connected-node set for the selected node (same as hover logic)
    const connectedIds = new Set<string>();
    if (selectedNodeId) {
      connectedIds.add(selectedNodeId);
      const sel = nodes.find((n) => n.stable_id === selectedNodeId);
      if (sel) {
        for (const conn of sel.connections) connectedIds.add(conn.target_id);
        for (const n of nodes) {
          if (n.connections.some((c) => c.target_id === selectedNodeId)) connectedIds.add(n.stable_id);
        }
      }
    }

    const nodeGs = d3.select(svg).selectAll<SVGGElement, SimNode>("g g g");
    const link = d3.select(svg).selectAll<SVGLineElement, SimLink>("g g line.vis");

    nodeGs.select("circle")
      .attr("fill", (d) => {
        if (sectionHubIds.has(d.id)) {
          return secLabel && d.node?.raw_text === secLabel ? t.terracotta : t.taupe;
        }
        if (!d.node) return t.taupe;
        if (secLabel) return d.node.parent === secLabel ? t.nodeColour : t.taupe;
        if (selectedNodeId && !secLabel) {
          if (d.id === selectedNodeId) return t.terracotta;
          return connectedIds.has(d.id) ? t.nodeColour : t.taupe;
        }
        return nodeColor(d.node, primaryDocId, false, clusterIds.has(d.id), t);
      })
      .attr("stroke", (d) => {
        if (sectionHubIds.has(d.id)) {
          return secLabel && d.node?.raw_text === secLabel ? t.terracotta : "none";
        }
        return d.id === selectedNodeId ? t.terracotta : "none";
      });
    nodeGs.select("text")
      .attr("fill", (d) => {
        if (!d.node || sectionHubIds.has(d.id)) return t.muted;
        if (secLabel) return d.node.parent === secLabel ? t.black : t.muted;
        if (selectedNodeId) return connectedIds.has(d.id) ? t.black : t.muted;
        return clusterIds.has(d.id) ? t.black : t.muted;
      });

    // Highlight edges connected to the selected node
    link
      .attr("opacity", (l) => {
        if (l.isHub || l.isClauseToSection) return 0.35;
        if (!selectedNodeId) return 0.45;
        const src = (l.source as SimNode).id;
        const tgt = (l.target as SimNode).id;
        return (src === selectedNodeId || tgt === selectedNodeId) ? 0.9 : 0.1;
      })
      .attr("stroke-width", (l) => {
        if (l.isHub || l.isClauseToSection) return 0.5;
        if (!selectedNodeId) return 0.8;
        const src = (l.source as SimNode).id;
        const tgt = (l.target as SimNode).id;
        return (src === selectedNodeId || tgt === selectedNodeId) ? 1.5 : 0.8;
      });
  }, [selectedNodeId, view, nodes, primaryDocId, THEME]);

  // Apply filter dim without rebuilding the simulation
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const sectionHubIds = new Set(
      Array.from(simNodesRef.current.values()).filter(isSectionNode).map((sn) => sn.id)
    );
    const sectionNodeMap = new Map<string, string>();
    for (const sn of simNodesRef.current.values()) {
      if (isSectionNode(sn) && sn.node?.raw_text) sectionNodeMap.set(sn.node.raw_text, sn.id);
    }
    const nodeGs = d3.select(svg).selectAll<SVGGElement, SimNode>("g g g");
    const link = d3.select(svg).selectAll<SVGLineElement, SimLink>("g g line.vis");
    const linkHit = d3.select(svg).selectAll<SVGLineElement, SimLink>("g g line.hit");

    if (!filteredIds) {
      // No filter active — restore full opacity and default stroke
      nodeGs.attr("opacity", 1);
      link.attr("opacity", (l) => (l.isHub || l.isClauseToSection) ? 0.35 : 0.45)
          .attr("stroke", (l) => (l.isHub || l.isClauseToSection) ? themeRef.current.hubLine : themeRef.current.edgeLine)
          .attr("stroke-width", (l) => (l.isHub || l.isClauseToSection) ? 1 : 1.5);
      linkHit.attr("opacity", 0);
      return;
    }

    // Determine which section hubs have at least one visible clause or are directly filtered
    const visibleSections = new Set<string>();
    for (const id of filteredIds) {
      const sn = simNodesRef.current.get(id);
      if (sn && isSectionNode(sn)) {
        visibleSections.add(id); // Section Title node is directly in filter
      } else if (sn?.node?.parent) {
        const secId = sectionNodeMap.get(sn.node.parent);
        if (secId) visibleSections.add(secId);
      }
    }

    nodeGs.attr("opacity", (d) => {
      if (!d.node) return 1; // doc hub always visible
      if (sectionHubIds.has(d.id)) return visibleSections.has(d.id) ? 1 : 0.08;
      return filteredIds.has(d.id) ? 1 : 0.06;
    });

    // On light themes use a dark high-contrast colour; on dark themes use the accent colour
    const hlColor = themeRef.current.terracotta;
    link
      .attr("opacity", (l) => {
        const src = (l.source as SimNode).id;
        const tgt = (l.target as SimNode).id;
        if (l.isSectionHub) return visibleSections.has(tgt) ? 0.35 : 0.04;
        if (l.isClauseToSection) return filteredIds.has(src) ? 0.35 : 0.04;
        if (l.isHub) return filteredIds.has(src) ? 0.35 : 0.04;
        const isVisible = filteredIds.has(src) && filteredIds.has(tgt);
        return isVisible ? (highlightConnections ? 1 : 0.45) : 0.04;
      })
      .attr("stroke", (l) => {
        if (l.isHub || l.isClauseToSection || l.isSectionHub) return themeRef.current.hubLine;
        const src = (l.source as SimNode).id;
        const tgt = (l.target as SimNode).id;
        return (highlightConnections && filteredIds.has(src) && filteredIds.has(tgt)) ? hlColor : themeRef.current.edgeLine;
      })
      .attr("stroke-width", (l) => {
        if (l.isHub || l.isClauseToSection || l.isSectionHub) return 0.5;
        const src = (l.source as SimNode).id;
        const tgt = (l.target as SimNode).id;
        return (highlightConnections && filteredIds.has(src) && filteredIds.has(tgt)) ? 2.5 : 0.8;
      });
    linkHit.attr("opacity", 0);
  }, [filteredIds, highlightConnections]);

  return (
    <div ref={containerRef} style={{ width: "100%", height: height || "100%" }}>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ background: THEME.graphBg, display: "block" }}
      />
    </div>
  );
});
