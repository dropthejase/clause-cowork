import { useTheme } from "../../ThemeContext";
import type { WorkspaceDocument } from "../../types";
import { FONT } from "@word-graph/shared";

interface DocCardProps {
  doc: WorkspaceDocument;
  onOpen: (path: string, docId: string) => void;
}

export function DocCard({ doc, onOpen }: DocCardProps) {
  const { theme } = useTheme();
  const pct = doc.clause_count > 0 ? Math.round((doc.classified_count / doc.clause_count) * 100) : 0;

  return (
    <div style={{
      background: theme.base,
      border: `1px solid ${theme.edgeBorder}`,
      borderRadius: 8, padding: 14,
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: FONT.md, fontWeight: 600, color: theme.black }}>{doc.name}</div>
        <button
          onClick={() => onOpen(doc.path, doc.doc_id)}
          style={{
            fontSize: FONT.sm, padding: "4px 10px", borderRadius: 4,
            background: theme.terracotta, color: theme.white,
            border: "none", cursor: "pointer",
          }}
        >
          Open
        </button>
      </div>
      <div style={{ display: "flex", gap: 12, fontSize: FONT.sm, color: theme.muted }}>
        <span>{doc.clause_count} clauses</span>
        <span>{doc.classified_count} classified ({pct}%)</span>
        <span>{doc.connection_count} connections</span>
      </div>
      {doc.last_analysed_at && (
        <div style={{ fontSize: FONT.sm, color: theme.muted }}>
          Analysed {new Date(doc.last_analysed_at).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}
