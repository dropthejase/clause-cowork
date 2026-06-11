import { useEffect, useState } from "react";
import { useTheme } from "../../ThemeContext";
import { ClauseTypesSection } from "@word-graph/shared";
import { TagPoolPage } from "./TagPoolPage";
import { listTags, addTag, deleteTag } from "@word-graph/shared";
import type { WorkspaceConfig } from "../../types";

interface Props {
  docPath: string;
  config: WorkspaceConfig;
  onConfigChange: (updated: Partial<WorkspaceConfig>) => void;
  onBack: () => void;
}

export function ClauseLevelPage({ docPath, config, onConfigChange, onBack }: Props) {
  const { theme } = useTheme();
  const [clauseTypes, setClauseTypes] = useState<Array<{ name: string; description: string }>>([]);

  useEffect(() => {
    listTags(docPath, "clause_type").then((tags) =>
      setClauseTypes(tags.map((t) => ({ name: t.tag, description: t.description })))
    ).catch(() => {});
  }, [docPath]);

  async function handleClauseTypesChange(updated: Array<{ name: string; description: string }>) {
    const current = new Set(clauseTypes.map((t) => t.name));
    const next = new Set(updated.map((t) => t.name));
    // Add new types
    for (const t of updated) {
      if (!current.has(t.name)) {
        try {
          await addTag(docPath, t.name, t.description, "manual", "clause_type");
        } catch { /* already exists */ }
      }
    }
    // Remove deleted types
    for (const t of clauseTypes) {
      if (!next.has(t.name)) {
        try { await deleteTag(docPath, t.name); } catch { /* ignore */ }
      }
    }
    setClauseTypes(updated);
  }

  return (
    <div>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "28px 32px 0" }}>
        <ClauseTypesSection
          clauseTypes={[...clauseTypes].sort((a, b) => a.name.localeCompare(b.name))}
          onChange={handleClauseTypesChange}
          strict={config.strict_clause_types ?? true}
          onStrictChange={(v) => onConfigChange({ strict_clause_types: v })}
        />
      </div>
      <div style={{ borderTop: `1px solid ${theme.edgeBorder}`, marginTop: 20 }} />
      <TagPoolPage
        onBack={onBack}
        hideHeader
        strict={config.strict_clause_tags ?? false}
        onStrictChange={(v) => onConfigChange({ strict_clause_tags: v })}
      />
    </div>
  );
}
