import { useTheme } from "../../ThemeContext";
import { DocCard } from "./DocCard";
import type { WorkspaceDocument } from "../../types";
import { FONT } from "@word-graph/shared";

interface WorkspaceViewProps {
  docs: WorkspaceDocument[];
  onOpenDoc: (path: string, docId: string) => void;
}

export function WorkspaceView({ docs, onOpenDoc }: WorkspaceViewProps) {
  const { theme } = useTheme();

  return (
    <div style={{ flex: 1, padding: 24, overflowY: "auto" }}>
      <div style={{ maxWidth: 700, margin: "0 auto" }}>
        {docs.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: theme.muted, fontSize: FONT.md }}>
            <p>No documents found. Parse a .docx file to get started.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
            {docs.map((doc) => (
              <DocCard key={doc.doc_id} doc={doc} onOpen={onOpenDoc} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
