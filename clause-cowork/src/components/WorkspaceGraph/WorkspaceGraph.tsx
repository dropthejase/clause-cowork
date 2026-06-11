import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import { X } from "lucide-react";
import { useTheme } from "../../ThemeContext";
import { FONT } from "@word-graph/shared";
import type { ThemeShape } from "@word-graph/shared";
import { fetchWorkspace, fetchAllDocumentLinks } from "../../api";
import type { WorkspaceDocument } from "../../types";
import type { WorkspaceDocumentLink } from "../../api";
import { InfoTab } from "../DocView/InfoTab";

interface Props {
  workspacePath: string;
  onOpenDoc: (path: string, docId: string) => void;
}

const WORKSPACE_ID = "__workspace__";
const HUB_R = 16;
const TAG_R = 12;
const DOC_R = 9;
const LABEL_FONT = 13;
// Rest distance for doc→tag spring
const DOC_TAG_DIST = 90;

function parseTags(doc: WorkspaceDocument): string[] {
  return doc.doc_type ? [doc.doc_type] : [];
}

// ── React component ───────────────────────────────────────────────────────────

export function WorkspaceGraph({ workspacePath, onOpenDoc }: Props) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [graphData, setGraphData] = useState<{ docs: WorkspaceDocument[]; links: WorkspaceDocumentLink[] } | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<WorkspaceDocument | null>(null);
  const onSelectDocRef = useRef(setSelectedDoc);
  onSelectDocRef.current = setSelectedDoc;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchWorkspace(workspacePath),
      fetchAllDocumentLinks(workspacePath),
    ]).then(([ws, links]) => {
      if (cancelled) return;
      const docs = ws.documents.filter((d) => !d.name.startsWith("."));
      setLoading(false);
      if (docs.length === 0) { setEmpty(true); return; }
      setGraphData({ docs, links });
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workspacePath]);

  const build = useCallback(() => {
    if (!graphData || !svgRef.current || !containerRef.current) return;
    buildGraph(svgRef.current, containerRef.current, graphData.docs, graphData.links, theme, onSelectDocRef);
  }, [graphData, theme]);

  useEffect(() => { build(); }, [build]);

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden", background: theme.graphBg }}>
      <div ref={containerRef} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {loading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: theme.muted, fontSize: FONT.md }}>
            Loading…
          </div>
        )}
        {!loading && empty && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: theme.muted, fontSize: FONT.md, gap: 8 }}>
            <div>No documents yet.</div>
            <div style={{ fontSize: FONT.sm }}>Run /discover to register documents.</div>
          </div>
        )}
        <svg ref={svgRef} width="100%" height="100%" style={{ background: theme.graphBg, display: "block" }} />
      </div>

      {selectedDoc && (
        <div style={{
          width: 300, flexShrink: 0, background: theme.base,
          borderLeft: `1px solid ${theme.edgeBorder}`,
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 14px", borderBottom: `1px solid ${theme.edgeBorder}`, flexShrink: 0,
          }}>
            <span style={{ fontSize: FONT.md, fontWeight: 600, color: theme.black, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, marginRight: 8 }}>
              {selectedDoc.name}
            </span>
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              <button
                onClick={() => onOpenDoc(selectedDoc.path, selectedDoc.doc_id)}
                style={{ fontSize: FONT.sm, padding: "3px 10px", borderRadius: 4, background: theme.terracotta, color: theme.white, border: "none", cursor: "pointer" }}
              >
                Open
              </button>
              <button
                onClick={() => setSelectedDoc(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: theme.muted, display: "flex", alignItems: "center", padding: 2 }}
              >
                <X size={14} />
              </button>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            <InfoTab workspacePath={workspacePath} docId={selectedDoc.doc_id} docPath={selectedDoc.path} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── D3 types ──────────────────────────────────────────────────────────────────

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  kind: "workspace" | "tag" | "doc";
  label: string;
  doc?: WorkspaceDocument;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  kind: "tag-member" | "doc-link";
  broken?: boolean;
}

// ── D3 graph ──────────────────────────────────────────────────────────────────

function buildGraph(
  svgEl: SVGSVGElement,
  container: HTMLDivElement,
  docs: WorkspaceDocument[],
  links: WorkspaceDocumentLink[],
  theme: ThemeShape,
  onSelectDocRef: React.MutableRefObject<(doc: WorkspaceDocument | null) => void>,
) {
  d3.select(svgEl).selectAll("*").remove();
  (svgEl as SVGSVGElement & { _sim?: d3.Simulation<SimNode, SimLink> })._sim?.stop();

  const width = container.clientWidth || 800;
  const height = container.clientHeight || 600;
  const cx = width / 2;
  const cy = height / 2;

  // ── Nodes ─────────────────────────────────────────────────────────────────
  const tagSet = new Set<string>();
  docs.forEach((d) => parseTags(d).forEach((t) => tagSet.add(t)));
  const tags = [...tagSet];
  const TAG_IDS = new Set(tags.map((t) => `tag:${t}`));

  // Workspace: fixed at centre, never moves
  const workspaceNode: SimNode = { id: WORKSPACE_ID, kind: "workspace", label: "workspace", x: cx, y: cy, fx: cx, fy: cy };

  // Tags: pre-positioned radially, pinned with fx/fy — draggable, re-pin on drag end
  const tagRadius = Math.min(cx, cy) * 0.72;
  const tagNodes: SimNode[] = tags.map((t, i) => {
    const angle = (2 * Math.PI * i) / Math.max(tags.length, 1) - Math.PI / 2;
    const x = cx + tagRadius * Math.cos(angle);
    const y = cy + tagRadius * Math.sin(angle);
    return { id: `tag:${t}`, kind: "tag", label: t, x, y, fx: x, fy: y };
  });

  // Docs: pre-positioned near average of their tag positions
  const tagPosMap = new Map(tagNodes.map((t) => [t.label, { x: t.x!, y: t.y! }]));
  const docNodes: SimNode[] = docs.map((d) => {
    const docTags = parseTags(d).map((t) => tagPosMap.get(t)).filter(Boolean) as { x: number; y: number }[];
    let sx = cx, sy = cy;
    if (docTags.length > 0) {
      sx = docTags.reduce((s, t) => s + t.x, 0) / docTags.length;
      sy = docTags.reduce((s, t) => s + t.y, 0) / docTags.length;
    }
    return { id: d.doc_id, kind: "doc", label: d.name, doc: d, x: sx + (Math.random() - 0.5) * 40, y: sy + (Math.random() - 0.5) * 40 };
  });

  const allNodes: SimNode[] = [workspaceNode, ...tagNodes, ...docNodes];

  // ── Links ─────────────────────────────────────────────────────────────────
  const simLinks: SimLink[] = [];

  // Doc → each of its tags (spring with rest distance DOC_TAG_DIST)
  docs.forEach((d) => {
    const docTags = parseTags(d);
    if (docTags.length > 0) {
      docTags.forEach((t) => {
        if (tagSet.has(t)) simLinks.push({ source: d.doc_id, target: `tag:${t}`, kind: "tag-member" });
      });
    }
    // Untagged docs: weak pull to workspace
    if (docTags.length === 0) {
      simLinks.push({ source: d.doc_id, target: WORKSPACE_ID, kind: "tag-member" });
    }
  });

  // Cross-doc links (visual only, strength 0)
  links.forEach((l) => simLinks.push({
    source: l.source_doc_id, target: l.target_doc_id, kind: "doc-link", broken: !!l.broken_at,
  }));

  // ── SVG setup ─────────────────────────────────────────────────────────────
  const root = d3.select(svgEl);
  const g = root.append("g");
  const zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.2, 4])
    .on("zoom", (e) => g.attr("transform", e.transform));
  root.call(zoom).on("dblclick.zoom", null);

  // ── Link visuals ──────────────────────────────────────────────────────────
  const linkG = g.append("g");

  const link = linkG.selectAll<SVGLineElement, SimLink>("line.vis")
    .data(simLinks)
    .join("line")
    .attr("class", "vis")
    .attr("stroke", (l) => l.kind === "tag-member" ? theme.hubLine : theme.edgeLine)
    .attr("stroke-width", (l) => l.kind === "tag-member" ? 0.5 : 1.0)
    .attr("stroke-dasharray", (l) => l.kind === "tag-member" ? "4,3" : (l.broken ? "4,3" : "none"))
    .attr("opacity", (l) => l.kind === "tag-member" ? 0.4 : 0.5)
    .attr("pointer-events", "none");

  const linkHit = linkG.selectAll<SVGLineElement, SimLink>("line.hit")
    .data(simLinks.filter((l) => l.kind === "doc-link"))
    .join("line")
    .attr("class", "hit")
    .attr("stroke", "transparent")
    .attr("stroke-width", 10)
    .style("cursor", "pointer");

  function restoreLinks() {
    link
      .attr("stroke", (l) => l.kind === "tag-member" ? theme.hubLine : theme.edgeLine)
      .attr("stroke-width", (l) => l.kind === "tag-member" ? 0.5 : 1.0)
      .attr("opacity", (l) => l.kind === "tag-member" ? 0.4 : 0.5);
  }

  // ── Nodes ─────────────────────────────────────────────────────────────────
  const node = g.append("g").selectAll<SVGGElement, SimNode>("g")
    .data(allNodes, (d) => d.id)
    .join("g")
    .style("cursor", "pointer");

  node.append("circle")
    .attr("r", (d) => d.kind === "workspace" ? HUB_R : d.kind === "tag" ? TAG_R : DOC_R)
    .attr("fill", (d) => d.kind === "doc" ? theme.nodeColour : theme.taupe)
    .attr("stroke", (d) => d.kind === "doc" ? "none" : theme.muted)
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", (d) => d.kind === "doc" ? "none" : "3,2");

  node.append("text")
    .attr("text-anchor", "middle")
    .attr("font-size", LABEL_FONT)
    .attr("font-weight", (d) => d.kind === "tag" ? "600" : d.kind === "workspace" ? "600" : "normal")
    .attr("fill", (d) => d.kind === "doc" ? theme.black : theme.muted)
    .attr("pointer-events", "none")
    .attr("user-select", "none")
    .text((d) => {
      if (d.kind === "workspace") return "workspace";
      if (d.kind === "tag") return d.label;
      return d.label.length > 20 ? d.label.slice(0, 19) + "…" : d.label;
    });

  // ── Selection state ───────────────────────────────────────────────────────
  const selectedTagRef = { current: null as string | null };

  function applyState(selectedTag: string | null) {
    const t = theme;
    node.select("circle")
      .attr("fill", (n) => {
        if (n.kind === "workspace") return t.taupe;
        if (n.kind === "tag") return (selectedTag && n.label === selectedTag) ? t.terracotta : t.taupe;
        if (!selectedTag) return t.nodeColour;
        return parseTags(n.doc!).includes(selectedTag) ? t.nodeColour : t.taupe;
      })
      .attr("stroke", (n) => {
        if (n.kind === "doc") return "none";
        return (selectedTag && n.kind === "tag" && n.label === selectedTag) ? t.terracotta : t.muted;
      });
    node.select("text")
      .attr("fill", (n) => {
        if (n.kind === "workspace" || n.kind === "tag") return t.muted;
        if (!selectedTag) return t.black;
        return parseTags(n.doc!).includes(selectedTag) ? t.black : t.muted;
      });
    link.attr("opacity", (l) => {
      if (l.kind !== "tag-member" || !selectedTag) return l.kind === "tag-member" ? 0.4 : 0.5;
      const tgt = typeof l.target === "object" ? (l.target as SimNode).id : l.target as string;
      return tgt === `tag:${selectedTag}` ? 0.9 : 0.08;
    });
  }

  // ── Click — registered BEFORE drag ───────────────────────────────────────
  node.on("click", (_e, d) => {
    if (d.id === WORKSPACE_ID) {
      selectedTagRef.current = null;
      onSelectDocRef.current(null);
      applyState(null);
      d3.select(svgEl).transition().duration(400).call(zoom.transform, d3.zoomIdentity);
      return;
    }
    if (TAG_IDS.has(d.id)) {
      selectedTagRef.current = d.label;
      onSelectDocRef.current(null);
      applyState(d.label);
      if (d.x != null && d.y != null) {
        const t = d3.zoomIdentity.translate(width / 2 - d.x, height / 2 - d.y).scale(1);
        d3.select(svgEl).transition().duration(400).call(zoom.transform, t);
      }
      return;
    }
    // Doc
    selectedTagRef.current = null;
    applyState(null);
    onSelectDocRef.current(d.doc!);
    if (d.x != null && d.y != null) {
      const t = d3.zoomIdentity.translate(width / 2 - d.x, height / 2 - d.y).scale(1);
      d3.select(svgEl).transition().duration(400).call(zoom.transform, t);
    }
  });

  // ── Hover ─────────────────────────────────────────────────────────────────
  node
    .on("mouseenter", (_e, d) => {
      const t = theme;
      if (d.kind === "tag") {
        node.select("circle")
          .attr("fill", (n) => {
            if (n.kind === "workspace") return t.taupe;
            if (n.kind === "tag") return n.id === d.id ? t.terracotta : t.taupe;
            return parseTags(n.doc!).includes(d.label) ? t.nodeColour : t.taupe;
          })
          .attr("r", (n) => n.kind === "workspace" ? HUB_R : n.kind === "tag" ? (n.id === d.id ? TAG_R + 2 : TAG_R) : DOC_R);
        link.attr("opacity", (l) => {
          if (l.kind !== "tag-member") return 0.05;
          const tgt = typeof l.target === "object" ? (l.target as SimNode).id : l.target as string;
          return tgt === d.id ? 0.9 : 0.05;
        });
        return;
      }
      if (d.kind === "workspace") return;
      // Doc
      node.select("circle")
        .attr("fill", (n) => n.kind !== "doc" ? t.taupe : n.id === d.id ? t.terracotta : t.taupe)
        .attr("r", (n) => n.kind === "workspace" ? HUB_R : n.kind === "tag" ? TAG_R : (n.id === d.id ? DOC_R + 2 : DOC_R));
      link.attr("opacity", (l) => {
        if (l.kind === "tag-member") {
          const src = typeof l.source === "object" ? (l.source as SimNode).id : l.source as string;
          return src === d.id ? 0.9 : 0.05;
        }
        const src = typeof l.source === "object" ? (l.source as SimNode).id : l.source as string;
        const tgt = typeof l.target === "object" ? (l.target as SimNode).id : l.target as string;
        return (src === d.id || tgt === d.id) ? 0.9 : 0.05;
      });
    })
    .on("mouseleave", () => {
      node.select("circle").attr("r", (n) => n.kind === "workspace" ? HUB_R : n.kind === "tag" ? TAG_R : DOC_R);
      applyState(selectedTagRef.current);
    });

  // Doc-link edge hover
  linkHit
    .on("mouseenter", (_e, l) => {
      const src = typeof l.source === "object" ? (l.source as SimNode).id : l.source as string;
      const tgt = typeof l.target === "object" ? (l.target as SimNode).id : l.target as string;
      link.attr("opacity", (ll) => {
        if (ll.kind === "tag-member") return 0.05;
        const ls = typeof ll.source === "object" ? (ll.source as SimNode).id : ll.source as string;
        const lt = typeof ll.target === "object" ? (ll.target as SimNode).id : ll.target as string;
        return (ls === src && lt === tgt) || (ls === tgt && lt === src) ? 1 : 0.05;
      }).attr("stroke", (ll) => {
        if (ll.kind === "tag-member") return theme.hubLine;
        const ls = typeof ll.source === "object" ? (ll.source as SimNode).id : ll.source as string;
        const lt = typeof ll.target === "object" ? (ll.target as SimNode).id : ll.target as string;
        return (ls === src && lt === tgt) || (ls === tgt && lt === src) ? theme.terracotta : theme.edgeLine;
      }).attr("stroke-width", (ll) => {
        if (ll.kind === "tag-member") return 0.5;
        const ls = typeof ll.source === "object" ? (ll.source as SimNode).id : ll.source as string;
        const lt = typeof ll.target === "object" ? (ll.target as SimNode).id : ll.target as string;
        return (ls === src && lt === tgt) || (ls === tgt && lt === src) ? 2.5 : 0.8;
      });
      node.select("circle").attr("fill", (n) => {
        if (n.kind !== "doc") return theme.taupe;
        return (n.id === src || n.id === tgt) ? theme.terracotta : theme.taupe;
      });
    })
    .on("mouseleave", () => {
      restoreLinks();
      applyState(selectedTagRef.current);
    });

  // ── Drag ──────────────────────────────────────────────────────────────────
  // Workspace: excluded (fixed forever)
  // Tags: draggable, re-pin at new position on drag end
  // Docs: draggable, release on drag end
  node.call(
    d3.drag<SVGGElement, SimNode>()
      .on("start", (event, d) => {
        if (d.id === WORKSPACE_ID) return;
        if (!event.active) sim.alphaTarget(0.02).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on("drag", (event, d) => {
        if (d.id === WORKSPACE_ID) return;
        d.fx = event.x; d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (d.id === WORKSPACE_ID) return;
        if (!event.active) sim.alphaTarget(0);
        if (d.kind === "tag") {
          // Re-pin tag at new position
          d.fx = d.x; d.fy = d.y;
        } else {
          // Release doc
          d.fx = null; d.fy = null;
        }
      })
  );

  // ── Simulation ────────────────────────────────────────────────────────────
  const sim = d3.forceSimulation<SimNode, SimLink>(allNodes)
    .alpha(0.6)
    .alphaDecay(0.04)
    .velocityDecay(0.6)
    .force("link", d3.forceLink<SimNode, SimLink>(simLinks)
      .id((d) => d.id)
      .distance((l) => l.kind === "tag-member" ? DOC_TAG_DIST : 160)
      .strength((l) => l.kind === "tag-member" ? 0.8 : 0)
    )
    .force("charge", d3.forceManyBody<SimNode>().strength((d) => {
      const n = d as SimNode;
      return n.kind === "workspace" ? 0 : n.kind === "tag" ? 0 : -60;
    }))
    .force("collision", d3.forceCollide<SimNode>((d) => {
      const n = d as SimNode;
      return n.kind === "workspace" ? HUB_R + 10 : n.kind === "tag" ? TAG_R + 10 : DOC_R + 8;
    }))
    .on("tick", () => {
      link
        .attr("x1", (l) => (l.source as SimNode).x ?? 0)
        .attr("y1", (l) => (l.source as SimNode).y ?? 0)
        .attr("x2", (l) => (l.target as SimNode).x ?? 0)
        .attr("y2", (l) => (l.target as SimNode).y ?? 0);
      linkHit
        .attr("x1", (l) => (l.source as SimNode).x ?? 0)
        .attr("y1", (l) => (l.source as SimNode).y ?? 0)
        .attr("x2", (l) => (l.target as SimNode).x ?? 0)
        .attr("y2", (l) => (l.target as SimNode).y ?? 0);
      node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
      node.select("text").attr("y", (d) => -(d.kind === "workspace" ? HUB_R : d.kind === "tag" ? TAG_R : DOC_R) - 5);
    });

  (svgEl as SVGSVGElement & { _sim?: typeof sim })._sim = sim;
}
