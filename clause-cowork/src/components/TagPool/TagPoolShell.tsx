import { useState, useEffect } from "react";
import { useTheme } from "../../ThemeContext";
import { useAppStore } from "../../store";
import { DocLevelPage } from "./DocLevelPage";
import { ClauseLevelPage } from "./ClauseLevelPage";
import { FONT, THEMES, ThemeContext as SharedThemeContext } from "@word-graph/shared";
import { getWorkspaceConfig, saveWorkspaceConfig } from "../../api";
import type { WorkspaceConfig } from "../../types";

type Tab = "doc" | "clause";

export function TagPoolShell({ onBack }: { onBack: () => void }) {
  const { theme, themeKey } = useTheme();
  const { activeWorkspace } = useAppStore();
  const [tab, setTab] = useState<Tab>("doc");
  const [config, setConfig] = useState<WorkspaceConfig | null>(null);

  useEffect(() => {
    if (!activeWorkspace) return;
    getWorkspaceConfig(activeWorkspace).then(setConfig).catch(() => {});
  }, [activeWorkspace]);

  async function handleConfigChange(updated: Partial<WorkspaceConfig>) {
    if (!config || !activeWorkspace) return;
    const next = { ...config, ...updated };
    setConfig(next);
    await saveWorkspaceConfig(activeWorkspace, next).catch(() => {});
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    fontSize: FONT.md, padding: "4px 14px", borderRadius: 6, cursor: "pointer",
    border: "none",
    background: active ? theme.terracotta : "transparent",
    color: active ? "#fff" : theme.muted,
    fontWeight: active ? 600 : 400,
  });

  return (
    <SharedThemeContext.Provider value={{ theme: THEMES[themeKey as keyof typeof THEMES] ?? THEMES.warm, themeKey: themeKey as keyof typeof THEMES }}>
    <div style={{ background: theme.graphBg, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ background: theme.base, borderBottom: `1px solid ${theme.edgeBorder}`, padding: "8px 12px", display: "flex", alignItems: "center", flexShrink: 0 }}>
        <button
          onClick={onBack}
          style={{ display: "flex", alignItems: "center", gap: 5, fontSize: FONT.md, color: theme.muted, background: "none", border: "none", cursor: "pointer", padding: 0, flexShrink: 0 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
          Back
        </button>

        {/* Centred tab toggle */}
        <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
          <div style={{ display: "flex", gap: 2, background: theme.graphBg, borderRadius: 8, padding: 2 }}>
            <button style={tabStyle(tab === "doc")} onClick={() => setTab("doc")}>Document Level</button>
            <button style={tabStyle(tab === "clause")} onClick={() => setTab("clause")}>Clause Level</button>
          </div>
        </div>

        {/* Spacer to balance the back button */}
        <div style={{ width: 48, flexShrink: 0 }} />
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {tab === "doc"
          ? config && activeWorkspace
            ? <DocLevelPage docPath={activeWorkspace} config={config} onConfigChange={handleConfigChange} onBack={onBack} />
            : null
          : config && activeWorkspace
            ? <ClauseLevelPage docPath={activeWorkspace} config={config} onConfigChange={handleConfigChange} onBack={onBack} />
            : null
        }
      </div>
    </div>
    </SharedThemeContext.Provider>
  );
}
