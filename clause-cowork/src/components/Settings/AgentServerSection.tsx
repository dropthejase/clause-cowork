import { useState, useEffect } from "react";
import { useTheme } from "../../ThemeContext";
import { Section } from "@word-graph/shared";
import { getAgentConfig, saveAgentConfig, testAgentConfig, installSkills } from "../../api";
import { FONT } from "@word-graph/shared";

interface Props {
  workspace?: string;
  onAgentChanged?: () => void;
}

export function AgentServerSection({ workspace, onAgentChanged }: Props) {
  const { theme } = useTheme();
  const [acpBin, setAcpBin] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    getAgentConfig().then((cfg) => setAcpBin(cfg.acp_bin)).catch(() => {});
  }, []);

  async function handleConnect() {
    setStatus(null);
    setConnecting(true);
    try {
      const res = await testAgentConfig(acpBin.trim(), workspace);
      await saveAgentConfig(acpBin.trim(), workspace);
      setStatus({ ok: true, message: `Connected — ${res.agent}${res.version ? ` v${res.version}` : ""}` });
      if (workspace) installSkills(acpBin.trim(), workspace).catch(() => {});
      onAgentChanged?.();
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? "Connection failed — check the command is correct and the agent is installed.";
      setStatus({ ok: false, message: detail });
    } finally {
      setConnecting(false);
    }
  }

  return (
    <Section label="Agent Server">
      <div style={{ padding: "8px 13px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
        <p style={{ fontSize: FONT.md, color: theme.muted, margin: 0, lineHeight: 1.5 }}>
          Command to launch the ACP agent. Include arguments if needed — the full string is split on spaces.
          Connecting will restart the active session with the new agent.
        </p>
        <div style={{ fontSize: FONT.md, color: theme.muted, fontFamily: "monospace", lineHeight: 1.8 }}>
          <div>Claude: <span style={{ color: theme.charcoal }}>npx @agentclientprotocol/claude-agent-acp</span></div>
          <div>Kiro: <span style={{ color: theme.charcoal }}>kiro-cli acp</span></div>
          <div>Codex: <span style={{ color: theme.charcoal }}>npx @zed-industries/codex-acp</span></div>
          <div>Gemini: <span style={{ color: theme.muted }}>gemini --acp (under construction)</span></div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={acpBin}
            onChange={(e) => { setAcpBin(e.target.value); setStatus(null); }}
            onKeyDown={(e) => e.key === "Enter" && handleConnect()}
            placeholder="npx @agentclientprotocol/claude-agent-acp"
            style={{
              flex: 1, fontSize: FONT.md, fontFamily: "monospace",
              padding: "5px 8px", borderRadius: 4,
              border: `1px solid ${theme.edgeBorder}`,
              background: theme.graphBg, color: theme.black,
              outline: "none",
            }}
          />
          <button
            onClick={handleConnect}
            disabled={connecting || !acpBin.trim()}
            style={{
              fontSize: FONT.md, padding: "5px 10px", borderRadius: 4, cursor: connecting ? "default" : "pointer",
              background: theme.terracotta, color: "#fff", border: "none", flexShrink: 0,
              opacity: connecting ? 0.5 : 1,
            }}
          >
            {connecting ? "Connecting…" : "Connect"}
          </button>
        </div>
        {status && (
          <span style={{ fontSize: FONT.sm, color: status.ok ? "#16a34a" : theme.terracotta }}>
            {status.message}
          </span>
        )}
      </div>
    </Section>
  );
}
