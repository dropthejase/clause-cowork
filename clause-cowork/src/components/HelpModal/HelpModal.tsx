import { useTheme } from "../../ThemeContext";
import { FONT } from "@word-graph/shared";
import { X, FolderOpen, Settings, FileSearch, BarChart2, Brain } from "lucide-react";

const STEPS = [
  {
    icon: FolderOpen,
    label: "Add a workspace",
    detail: "From the home screen, click + Add workspace and select a folder containing your documents.",
  },
  {
    icon: Settings,
    label: "Connect your agent",
    detail: "Go to Settings → Agent Server. Paste your agent launch command (e.g. npx @agentclientprotocol/claude-agent-acp) and click Connect. This also installs the Clause CoWork skills.",
  },
  {
    icon: FileSearch,
    label: "Run /index",
    detail: "Open the Chat panel and type /index. The agent reads every document, writes summary notes, and records cross-document links.",
  },
  {
    icon: BarChart2,
    label: "Run /analyse",
    detail: "Type /analyse. The agent classifies each document, parses clauses, assigns types and tags, records connections, and builds the clause graph.",
  },
];

interface Props {
  onClose: () => void;
}

export function HelpModal({ onClose }: Props) {
  const { theme } = useTheme();

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: theme.base, borderRadius: 12,
          border: `1px solid ${theme.edgeBorder}`,
          boxShadow: "0 8px 40px rgba(0,0,0,0.4)",
          width: 480, maxWidth: "90vw",
          padding: "28px 32px 32px",
          position: "relative",
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: 16, right: 16,
            background: "none", border: "none", cursor: "pointer",
            color: theme.muted, padding: 4, borderRadius: 4,
            display: "flex", alignItems: "center",
          }}
        >
          <X size={16} />
        </button>

        <div style={{ marginBottom: 24 }}>
          <Brain size={22} color={theme.terracotta} style={{ marginRight: 8, flexShrink: 0 }} />
          <span style={{ fontSize: FONT.title, fontWeight: 700, color: theme.black }}>Getting started</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <div key={i} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                  background: theme.graphBg, border: `1px solid ${theme.edgeBorder}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  position: "relative",
                }}>
                  <Icon size={16} style={{ color: theme.terracotta }} />
                  <span style={{
                    position: "absolute", top: -8, left: -8,
                    width: 18, height: 18, borderRadius: "50%",
                    background: theme.terracotta, color: "#fff",
                    fontSize: 10, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>{i + 1}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: FONT.md, fontWeight: 600, color: theme.black, marginBottom: 3 }}>
                    {step.label}
                  </div>
                  <div style={{ fontSize: FONT.sm, color: theme.muted, lineHeight: 1.5 }}>
                    {step.detail}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
