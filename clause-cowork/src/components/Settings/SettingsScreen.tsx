import { useState, useEffect } from "react";
import { useTheme } from "../../ThemeContext";
import { getWorkspaceConfig, saveWorkspaceConfig } from "../../api";
import type { WorkspaceConfig } from "../../types";

import { Section } from "@word-graph/shared";
import { ConnectionThresholdSection } from "@word-graph/shared";
import { CacheSection } from "./CacheSection";
import { AgentServerSection } from "./AgentServerSection";
import { FONT } from "@word-graph/shared";

function ReEnrichSection({ threshold, onChange }: { threshold: number; onChange: (v: number) => void }) {
  const { theme } = useTheme();
  const pct = Math.round(threshold * 100);
  const label =
    threshold >= 1.0 ? "Any change — re-analyse always" :
    threshold >= 0.9 ? "High — re-analyse on minor edits" :
    threshold >= 0.7 ? "Medium — re-analyse on significant edits" :
    "Low — re-analyse on major rewrites only";

  return (
    <Section label="Re-analysis Sensitivity">
      <div style={{ padding: "8px 13px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
        <p style={{ fontSize: FONT.md, color: theme.muted, margin: 0, lineHeight: 1.5 }}>
          When you re-parse after editing, clauses whose text has changed are re-analysed by the agent
          if the similarity to the original falls below this threshold. Your manually added tags are always preserved.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, position: "relative", height: 20, display: "flex", alignItems: "center" }}>
            <div style={{ position: "absolute", left: 0, right: 0, height: 4, borderRadius: 9999, background: theme.base }} />
            <div style={{ position: "absolute", left: 0, width: `${pct}%`, height: 4, borderRadius: 9999, background: theme.terracotta, transition: "width 0.08s" }} />
            <input
              type="range" min={0} max={1} step={0.05} value={threshold}
              onChange={(e) => onChange(parseFloat(e.target.value))}
              style={{ position: "absolute", left: 0, right: 0, width: "100%", opacity: 0, cursor: "pointer", height: 20, margin: 0 }}
            />
            <div style={{
              position: "absolute", left: `calc(${pct}% - 8px)`,
              width: 16, height: 16, borderRadius: "50%",
              background: "#fff", border: `2px solid ${theme.terracotta}`,
              boxShadow: "0 1px 4px rgba(0,0,0,0.18)", pointerEvents: "none",
              transition: "left 0.08s",
            }} />
          </div>
          <span style={{ fontSize: FONT.md, fontWeight: 700, color: theme.black, minWidth: 36, textAlign: "right" }}>{pct}%</span>
        </div>
        <div style={{ fontSize: FONT.md, color: theme.terracotta, fontWeight: 600 }}>{label}</div>
      </div>
    </Section>
  );
}

interface SettingsScreenProps {
  workspacePath: string;
  onBack: () => void;
}

export function SettingsScreen({ workspacePath, onBack }: SettingsScreenProps) {
  const { theme } = useTheme();
  const [config, setConfig] = useState<WorkspaceConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function reloadConfig() {
    getWorkspaceConfig(workspacePath).catch(() => null).then((cfg) => {
      setConfig(cfg ?? null);
    });
  }

  useEffect(() => { reloadConfig(); }, [workspacePath]);

  async function handleChange(updated: Partial<WorkspaceConfig>) {
    if (!config) return;
    const next = { ...config, ...updated };
    setConfig(next);
    setSaving(true);
    setSaved(false);
    try {
      await saveWorkspaceConfig(workspacePath, next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ background: theme.graphBg, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Toolbar */}
      <div style={{ background: theme.base, borderBottom: `1px solid ${theme.edgeBorder}`, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <button
          onClick={onBack}
          style={{ display: "flex", alignItems: "center", gap: 5, fontSize: FONT.md, color: theme.muted, background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
          Back
        </button>
        {saving && <span style={{ fontSize: FONT.sm, color: theme.muted }}>Saving…</span>}
        {saved && <span style={{ fontSize: FONT.sm, color: "#16a34a" }}>Saved</span>}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 680, margin: "0 auto", padding: "28px 32px 80px", display: "flex", flexDirection: "column", gap: 20 }}>
          {config ? (
            <>
              <ConnectionThresholdSection
                customPrompt={config.connection_threshold_prompt ?? ""}
                onChange={(prompt) => handleChange({ connection_threshold_prompt: prompt })}
              />

              <ReEnrichSection
                threshold={config.re_enrich_threshold ?? 0.85}
                onChange={(v) => handleChange({ re_enrich_threshold: v })}
              />

              <AgentServerSection workspace={workspacePath} />

              <CacheSection workspacePath={workspacePath} onDataDeleted={reloadConfig} onSettingsReset={reloadConfig} />
            </>
          ) : (
            <div style={{ padding: 24, fontSize: FONT.md, color: theme.muted, textAlign: "center" }}>
              {workspacePath ? "Loading settings…" : "Open a workspace to configure settings."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
