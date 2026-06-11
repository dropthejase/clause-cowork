import { useEffect, useState } from "react";
import { useTheme } from "../../ThemeContext";
import { DocumentTypesSection } from "@word-graph/shared";
import { TagPoolPage } from "./TagPoolPage";
import { listTags, addTag, deleteTag } from "@word-graph/shared";
import type { WorkspaceConfig } from "../../types";

interface Props {
  docPath: string;
  config: WorkspaceConfig;
  onConfigChange: (updated: Partial<WorkspaceConfig>) => void;
  onBack: () => void;
}

export function DocLevelPage({ docPath, config, onConfigChange, onBack }: Props) {
  const { theme } = useTheme();
  const [docTypes, setDocTypes] = useState<Array<{ name: string; description: string }>>([]);

  useEffect(() => {
    listTags(docPath, "doc_type").then((tags) =>
      setDocTypes(tags.map((t) => ({ name: t.tag, description: t.description })))
    ).catch(() => {});
  }, [docPath]);

  async function handleDocTypesChange(updated: Array<{ name: string; description: string }>) {
    const current = new Set(docTypes.map((t) => t.name));
    const next = new Set(updated.map((t) => t.name));
    for (const t of updated) {
      if (!current.has(t.name)) {
        try { await addTag(docPath, t.name, t.description, "manual", "doc_type"); } catch { /* already exists */ }
      }
    }
    for (const t of docTypes) {
      if (!next.has(t.name)) {
        try { await deleteTag(docPath, t.name); } catch { /* ignore */ }
      }
    }
    setDocTypes(updated);
  }

  return (
    <div>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "28px 32px 0" }}>
        <DocumentTypesSection
          docTypes={[...docTypes].sort((a, b) => a.name.localeCompare(b.name))}
          onChange={handleDocTypesChange}
          strict={config.strict_doc_types ?? true}
          onStrictChange={(v) => onConfigChange({ strict_doc_types: v })}
        />
      </div>
      <div style={{ borderTop: `1px solid ${theme.edgeBorder}`, marginTop: 20 }} />
      <TagPoolPage
        onBack={onBack}
        hideHeader
        kind="doc_tag"
        strict={config.strict_doc_tags ?? false}
        onStrictChange={(v) => onConfigChange({ strict_doc_tags: v })}
      />
    </div>
  );
}
