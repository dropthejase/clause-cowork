import { useState, useRef } from "react";
import { GraphNode, EDGE_TYPE_LABELS, EDGE_TYPE_PASSIVE_LABELS } from "../components/WordGraphPanel/types";
import { useTheme } from "../components/WordGraphPanel/ThemeContext";
import { getTypeColour, typeTextColour } from "../components/WordGraphPanel/theme";
import { FONT } from "../components/WordGraphPanel/fonts";
import { PoolTag, patchClause, addTag } from "../api";

const QUOTE_RE = new RegExp('["“”]([^"“”]+)["“”]', "g");

function extractDefinedTerms(text: string): Set<string> {
  const terms = new Set<string>();
  let m: RegExpExecArray | null;
  QUOTE_RE.lastIndex = 0;
  while ((m = QUOTE_RE.exec(text)) !== null) {
    const term = m[1].trim();
    if (term.length > 0 && /^[A-Z]/.test(term)) terms.add(term);
  }
  return terms;
}

function findRelatedDefinitions(node: GraphNode, allNodes: GraphNode[]): GraphNode[] {
  if (node.clause_type === "Definition") return [];
  const defNodes = allNodes.filter(
    (n) => n.clause_type === "Definition" && !n.tombstoned && n.stable_id !== node.stable_id
  );
  if (defNodes.length === 0) return [];
  return defNodes.filter((def) => {
    const terms = extractDefinedTerms(def.raw_text);
    if (terms.size === 0) return false;
    return [...terms].some((term) => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`["“”]${escaped}["“”]|\\b${escaped}\\b`).test(node.raw_text);
    });
  });
}

export interface ClauseDetailsProps {
  node: GraphNode;
  allNodes: GraphNode[];
  docPath: string;
  workspacePath: string;
  poolTags: PoolTag[];
  onNavigateTo: (nodeId: string) => void;
  onNodeUpdate: (updated: GraphNode) => void;
  onPoolChange: () => Promise<void>;
  onFilterByTag?: (tag: string) => void;
  onClose?: () => void;
}

export function ClauseDetails({ node, allNodes, docPath, workspacePath, poolTags, onNavigateTo, onNodeUpdate, onPoolChange, onFilterByTag, onClose }: ClauseDetailsProps) {
  const THEME = useTheme();
  const [tagInput, setTagInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);
  const [focusedTagIdx, setFocusedTagIdx] = useState<number | null>(null);
  const [tagsOpen, setTagsOpen] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const relatedDefs = findRelatedDefinitions(node, allNodes);

  const existingTagValues = new Set(node.clause_tags.map((t) => t.value));
  const inputNormalised = tagInput.trim().toLowerCase().replace(/\s+/g, "-");
  const filtered = poolTags.filter(
    (p) => p.tag.includes(inputNormalised) && !existingTagValues.has(p.tag)
  );
  const isNewTag = inputNormalised.length > 0 && !poolTags.some((p) => p.tag === inputNormalised);

  // Merge server response with current in-memory node to preserve tags that were
  // never persisted (e.g. stub agent tags only in frontend state).
  // removedValues: tags explicitly removed in this operation — don't re-add them.
  function mergeTopics(serverNode: GraphNode, removedValues: string[] = []): GraphNode {
    const serverValues = new Set(serverNode.clause_tags.map((t) => t.value));
    const removed = new Set(removedValues);
    const inMemoryOnly = node.clause_tags.filter((t) => !serverValues.has(t.value) && !removed.has(t.value));
    return { ...serverNode, clause_tags: [...inMemoryOnly, ...serverNode.clause_tags] };
  }

  async function handleSelectPoolTag(tag: string) {
    setTagError(null);
    try {
      const updated = await patchClause(node.stable_id, docPath, workspacePath, { add_tags: [{ value: tag, user_defined: true }] });
      onNodeUpdate(mergeTopics(updated));
      setTagInput(""); setShowSuggestions(false);
      inputRef.current?.focus();
    } catch {
      setTagError("Failed to add tag. Please try again.");
    }
  }

  async function handleAddNewToPool() {
    if (!inputNormalised) return;
    setTagError(null);
    try {
      await addTag(docPath, inputNormalised, `User-defined tag: ${inputNormalised}`, "manual");
      await onPoolChange();
      await handleSelectPoolTag(inputNormalised);
    } catch {
      setTagError("Failed to add tag to pool. Please try again.");
    }
  }

  async function handleRemoveTag(value: string) {
    setTagError(null);
    try {
      const updated = await patchClause(node.stable_id, docPath, workspacePath, { remove_tags: [value] });
      onNodeUpdate(mergeTopics(updated, [value]));
    } catch {
      setTagError("Failed to remove tag. Please try again.");
    }
  }

  async function handleClearAllTags() {
    const allTags = node.clause_tags.map((t) => t.value);
    if (allTags.length === 0) return;
    setTagError(null);
    try {
      const updated = await patchClause(node.stable_id, docPath, workspacePath, { remove_tags: allTags });
      // Clear all — don't preserve in-memory tags, user explicitly removed everything
      onNodeUpdate(updated);
    } catch {
      setTagError("Failed to clear tags. Please try again.");
    }
  }

  type RelatedClause = { conn: typeof node.connections[0]; target: GraphNode; inbound: boolean };

  // Outbound: edges on this node
  const outbound: RelatedClause[] = node.connections
    .filter((c) => !c.user_rejected)
    .map((c) => {
      const target = allNodes.find((n) => n.stable_id === c.target_id);
      if (!target || target.tombstoned) return null;
      return { conn: c, target, inbound: false };
    })
    .filter((x): x is RelatedClause => x !== null);

  // Inbound: edges on other nodes pointing here — deduplicate against outbound
  const outboundTargetIds = new Set(outbound.map((r) => r.target.stable_id));
  const inbound: RelatedClause[] = [];
  for (const other of allNodes) {
    if (other.stable_id === node.stable_id || other.tombstoned) continue;
    for (const c of other.connections) {
      if (c.target_id === node.stable_id && !c.user_rejected) {
        if (!outboundTargetIds.has(other.stable_id)) {
          inbound.push({ conn: { ...c, target_id: other.stable_id }, target: other, inbound: true });
        }
      }
    }
  }

  const relatedClauses: RelatedClause[] = [...outbound, ...inbound];

  const typeColour = getTypeColour(node.clause_type, THEME);

  const sectionLabelStyle: React.CSSProperties = {
    fontSize: FONT.label,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: THEME.charcoal,
    opacity: 0.65,
    padding: "10px 12px 4px",
    borderTop: `1px solid ${THEME.edgeBorder}`,
  };

  return (
    <div style={{ height: "100%", overflowY: "auto", background: THEME.base }}>
      {/* Header: type badge + close button */}
      <div style={{ padding: "8px 12px 4px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{
            fontSize: FONT.sm,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 9999,
            background: typeColour,
            color: typeTextColour(typeColour),
          }}
        >
          {node.clause_type ?? "Unclassified"}
        </span>
        {onClose && (
          <button
            onClick={onClose}
            title="Close"
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1, color: THEME.muted, padding: "0 2px" }}
          >×</button>
        )}
      </div>

      {/* Section label */}
      {node.parent && (
        <div style={{ padding: "2px 12px 4px", fontSize: FONT.sm, fontWeight: 700, color: THEME.charcoal }}>
          {node.parent}
        </div>
      )}

      {/* Full clause text */}
      <div style={{ padding: "4px 12px 10px", fontSize: FONT.sm, color: THEME.black, lineHeight: 1.6 }}>
        {node.raw_text}
      </div>

      {/* Related Definitions */}
      {relatedDefs.length > 0 && (
        <>
          <div style={sectionLabelStyle}>Related Definitions</div>
          {relatedDefs.map((def) => (
            <button
              key={def.stable_id}
              onClick={() => onNavigateTo(def.stable_id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "none",
                border: "none",
                padding: "6px 12px",
                cursor: "pointer",
                fontSize: FONT.sm,
                color: THEME.black,
                lineHeight: 1.5,
                borderBottom: `1px solid ${THEME.edgeBorder}`,
              }}
            >
              {def.raw_text}
            </button>
          ))}
        </>
      )}

      {/* Related Clauses */}
      {relatedClauses.length > 0 && (
        <>
          <div style={sectionLabelStyle}>Related Clauses</div>
          {relatedClauses.map(({ conn, target, inbound }) => (
            <button
              key={conn.id}
              onClick={() => onNavigateTo(target.stable_id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "none",
                border: "none",
                padding: "6px 12px 8px",
                cursor: "pointer",
                borderBottom: `1px solid ${THEME.edgeBorder}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                <span
                  style={{
                    fontSize: FONT.sm,
                    fontWeight: 700,
                    padding: "1px 6px",
                    borderRadius: 9999,
                    background: THEME.taupe,
                    color: THEME.charcoal,
                  }}
                >
                  {inbound
                    ? (EDGE_TYPE_PASSIVE_LABELS[conn.edge_type] ?? conn.edge_type)
                    : (EDGE_TYPE_LABELS[conn.edge_type] ?? conn.edge_type)}
                </span>
                {target.parent && (
                  <span style={{ fontSize: FONT.sm, color: THEME.muted }}>{target.parent}</span>
                )}
              </div>
              <div style={{ fontSize: FONT.sm, color: THEME.black, lineHeight: 1.5 }}>
                {target.raw_text}
              </div>
              {conn.note && (
                <div style={{ fontSize: FONT.sm, color: THEME.muted, marginTop: 2 }}>{conn.note}</div>
              )}
            </button>
          ))}
        </>
      )}

      {/* Tags */}
      <>
        <div
          onClick={() => setTagsOpen((o) => !o)}
          style={{ ...sectionLabelStyle, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", userSelect: "none" }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: FONT.sm, opacity: 0.5, display: "inline-block", transform: tagsOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>›</span>
            Tags
            {!tagsOpen && node.clause_tags.length > 0 && (
              <span style={{ fontSize: FONT.sm, fontWeight: 400, opacity: 0.55, marginLeft: 2 }}>({node.clause_tags.length})</span>
            )}
          </span>
          {tagsOpen && node.clause_tags.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); handleClearAllTags(); }}
              style={{ fontSize: FONT.sm, background: "none", border: "none", cursor: "pointer", color: THEME.muted, padding: "0 12px 0 0", fontWeight: 400 }}
            >Clear all</button>
          )}
        </div>
        {tagsOpen && tagError && (
          <div style={{ padding: "2px 12px 4px", fontSize: FONT.sm, color: "#b91c1c" }}>{tagError}</div>
        )}
        {tagsOpen && <div style={{ padding: "4px 12px 10px", display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
          {node.clause_tags.map((tag, idx) => (
            <span
              key={tag.value}
              style={{
                fontSize: FONT.sm, borderRadius: 9999,
                background: focusedTagIdx === idx
                  ? (tag.user_defined ? THEME.terracotta : THEME.charcoal)
                  : (tag.user_defined ? `${THEME.terracotta}22` : THEME.taupe),
                color: focusedTagIdx === idx ? "#fff" : (tag.user_defined ? THEME.terracotta : THEME.black),
                border: tag.user_defined ? `1px solid ${focusedTagIdx === idx ? "transparent" : `${THEME.terracotta}44`}` : "none",
                display: "inline-flex", alignItems: "center", gap: 2,
                padding: "4px 6px 4px 10px",
              }}
            >
              <span
                onClick={() => onFilterByTag?.(tag.value)}
                style={{ lineHeight: 1.2, cursor: onFilterByTag ? "pointer" : "default" }}
                title={onFilterByTag ? `Filter by #${tag.value}` : undefined}
              >{tag.value}</span>
              <span
                onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); handleRemoveTag(tag.value); }}
                style={{
                  cursor: "pointer", fontSize: FONT.lg, lineHeight: 1,
                  opacity: 0.6, padding: "0 2px", userSelect: "none",
                }}
              >×</span>
            </span>
          ))}
          <div style={{ position: "relative" }}>
            <input
              ref={inputRef}
              value={tagInput}
              onChange={(e) => { setTagInput(e.target.value); setShowSuggestions(true); setFocusedTagIdx(null); }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => { setTimeout(() => setShowSuggestions(false), 150); }}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setTagInput(""); setShowSuggestions(false); setFocusedTagIdx(null); }
                // Backspace with empty input: highlight last tag, or delete highlighted tag
                if (e.key === "Backspace" && tagInput === "") {
                  e.preventDefault();
                  if (focusedTagIdx !== null) {
                    handleRemoveTag(node.clause_tags[focusedTagIdx].value);
                    setFocusedTagIdx(null);
                  } else if (node.clause_tags.length > 0) {
                    setFocusedTagIdx(node.clause_tags.length - 1);
                  }
                }
                // ArrowLeft: navigate into tags
                if (e.key === "ArrowLeft" && tagInput === "") {
                  e.preventDefault();
                  setFocusedTagIdx((prev) =>
                    prev === null ? node.clause_tags.length - 1 : Math.max(0, prev - 1)
                  );
                }
                // ArrowRight: navigate back toward input
                if (e.key === "ArrowRight" && tagInput === "") {
                  e.preventDefault();
                  setFocusedTagIdx((prev) => {
                    if (prev === null) return null;
                    if (prev >= node.clause_tags.length - 1) { setFocusedTagIdx(null); return null; }
                    return prev + 1;
                  });
                }
              }}
              placeholder="+ add tag"
              maxLength={64}
              style={{ fontSize: FONT.sm, border: "none", outline: "none", background: "transparent", color: THEME.charcoal, width: 70, padding: "2px 0" }}
            />
            {showSuggestions && (tagInput.length > 0) && (
              <div style={{
                position: "absolute", top: "100%", left: 0, zIndex: 20,
                background: THEME.white, border: `1px solid ${THEME.edgeBorder}`,
                borderRadius: 6, boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                minWidth: 180, maxHeight: 160, overflowY: "auto",
              }}>
                {filtered.map((p) => (
                  <button
                    key={p.tag}
                    onMouseDown={() => handleSelectPoolTag(p.tag)}
                    style={{
                      display: "block", width: "100%", textAlign: "left",
                      padding: "5px 10px", fontSize: FONT.sm, background: "none",
                      border: "none", cursor: "pointer", color: THEME.charcoal,
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{p.tag}</span>
                    <span style={{ color: THEME.muted, marginLeft: 6 }}>{p.description.length > 40 ? p.description.slice(0, 40) + "…" : p.description}</span>
                  </button>
                ))}
                {isNewTag && (
                  <button
                    onMouseDown={handleAddNewToPool}
                    style={{
                      display: "block", width: "100%", textAlign: "left",
                      padding: "5px 10px", fontSize: FONT.sm, background: THEME.taupe,
                      border: "none", borderTop: `1px solid ${THEME.edgeBorder}`,
                      cursor: "pointer", color: THEME.terracotta,
                    }}
                  >
                    + Add "{inputNormalised}" to pool and apply
                  </button>
                )}
                {filtered.length === 0 && !isNewTag && (
                  <div style={{ padding: "5px 10px", fontSize: FONT.sm, color: THEME.muted }}>No matching tags</div>
                )}
              </div>
            )}
          </div>
        </div>}
      </>
    </div>
  );
}
