import { useState, useRef, useEffect } from "react";
import { Folder, Settings, Check, Tag, Home, RotateCcw, HelpCircle, Network, Brain } from "lucide-react";
import { useTheme } from "../../ThemeContext";
import { THEMES } from "@word-graph/shared";
import type { ThemeKey } from "@word-graph/shared";
import { FONT } from "@word-graph/shared";

const THEME_LABELS: Record<ThemeKey, string> = {
  warm: "Warm",
  light: "Light",
  dark: "Dark",
  alien: "Alien",
  halloween: "Halloween 🎃",
  christmas: "Christmas 🎄",
};

interface IconRailProps {
  onToggleFilePanel: () => void;
  filePanelOpen: boolean;
  onOpenSettings: () => void;
  onOpenTagPool: () => void;
  tagPoolOpen: boolean;
  filePanelDisabled?: boolean;
  onHome?: () => void;
  onRefresh?: () => Promise<void>;
  onHelp?: () => void;
  onToggleGraph?: () => void;
  graphOpen?: boolean;
}

export function IconRail({ onToggleFilePanel, filePanelOpen, onOpenSettings, onOpenTagPool, tagPoolOpen, filePanelDisabled, onHome, onRefresh, onHelp, onToggleGraph, graphOpen }: IconRailProps) {
  const { theme, themeKey, setTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleRefresh = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  };

  // Rail is always dark — IDE chrome stays dark regardless of content theme
  const railBg = "#1e140c";
  const hoverBg = "#3a2518";
  const iconColor = "rgba(255,255,255,0.6)";

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  return (
    <div style={{
      width: 44,
      background: railBg,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "10px 0",
      gap: 4,
      flexShrink: 0,
      height: "100%",
      position: "relative",
    }}>
      {onHome ? (
        <button
          title="Workspaces"
          onClick={onHome}
          style={{
            width: 36, height: 36, borderRadius: 6, border: "none", cursor: "pointer",
            background: "transparent", marginBottom: 4, marginTop: 2,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: iconColor, opacity: 0.7,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = hoverBg; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.7"; e.currentTarget.style.background = "transparent"; }}
        >
          <Home size={16} />
        </button>
      ) : (
        <div style={{ color: iconColor, marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Brain size={18} />
        </div>
      )}

      <button
        title="File Browser"
        onClick={filePanelDisabled ? undefined : onToggleFilePanel}
        style={{
          width: 36, height: 36, borderRadius: 6, border: "none",
          cursor: filePanelDisabled ? "default" : "pointer",
          background: filePanelOpen ? hoverBg : "transparent",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: iconColor,
          opacity: filePanelDisabled ? 0.25 : 1,
        }}
      >
        <Folder size={16} />
      </button>

      {onToggleGraph && (
        <button
          title="Workspace graph"
          onClick={onToggleGraph}
          style={{
            width: 36, height: 36, borderRadius: 6, border: "none", cursor: "pointer",
            background: graphOpen ? hoverBg : "transparent",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: iconColor,
          }}
        >
          <Network size={16} />
        </button>
      )}

      <button
        title="Tag Pool"
        onClick={onOpenTagPool}
        style={{
          width: 36, height: 36, borderRadius: 6, border: "none", cursor: "pointer",
          background: tagPoolOpen ? hoverBg : "transparent",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: iconColor,
        }}
      >
        <Tag size={16} />
      </button>

      {onRefresh && (
        <button
          title="Refresh workspace"
          onClick={handleRefresh}
          disabled={refreshing}
          style={{
            width: 36, height: 36, borderRadius: 6, border: "none",
            cursor: refreshing ? "not-allowed" : "pointer",
            background: "transparent",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: iconColor,
            opacity: refreshing ? 0.4 : 0.7,
            animation: refreshing ? "railRefreshSpin 0.8s linear infinite" : "none",
          }}
          onMouseEnter={(e) => { if (!refreshing) { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = hoverBg; } }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = refreshing ? "0.4" : "0.7"; e.currentTarget.style.background = "transparent"; }}
        >
          <style>{`@keyframes railRefreshSpin { to { transform: rotate(360deg); } }`}</style>
          <RotateCcw size={16} />
        </button>
      )}

      <div style={{ flex: 1 }} />

      {onHelp && (
        <button
          title="Getting started"
          onClick={onHelp}
          style={{
            width: 36, height: 36, borderRadius: 6, border: "none", cursor: "pointer",
            background: "transparent",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: iconColor, opacity: 0.7,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = hoverBg; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.7"; e.currentTarget.style.background = "transparent"; }}
        >
          <HelpCircle size={16} />
        </button>
      )}

      <div style={{ position: "relative" }}>
        <button
          ref={btnRef}
          title="Settings"
          onClick={() => setMenuOpen((v) => !v)}
          style={{
            width: 36, height: 36, borderRadius: 6, border: "none", cursor: "pointer",
            background: menuOpen ? hoverBg : "transparent",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff",
            opacity: menuOpen ? 1 : 0.5,
          }}
        >
          <Settings size={16} />
        </button>

        {menuOpen && (
          <div
            ref={menuRef}
            style={{
              position: "absolute",
              bottom: 0,
              left: "calc(100% + 4px)",
              width: 190,
              background: "#2a1e14",
              border: "1px solid #4a3020",
              borderRadius: 8,
              boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
              zIndex: 1000,
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "6px 0 2px", borderBottom: "1px solid #3a2518" }}>
              <div style={{ padding: "2px 12px 4px", fontSize: FONT.label, fontWeight: 700, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Theme
              </div>
              {(Object.keys(THEMES) as ThemeKey[]).map((k) => (
                <button
                  key={k}
                  onClick={() => { setTheme(k); setMenuOpen(false); }}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 8,
                    padding: "6px 12px", border: "none", cursor: "pointer",
                    background: "transparent",
                    color: k === themeKey ? "#fff" : "rgba(255,255,255,0.6)",
                    fontSize: FONT.md, textAlign: "left",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#3a2518")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <Check size={12} style={{ opacity: k === themeKey ? 1 : 0, flexShrink: 0, color: iconColor }} />
                  {THEME_LABELS[k]}
                </button>
              ))}
            </div>
            <div style={{ padding: "2px 0" }}>
              <button
                onClick={() => { setMenuOpen(false); onOpenSettings(); }}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 12px", border: "none", cursor: "pointer",
                  background: "transparent",
                  color: "rgba(255,255,255,0.6)",
                  fontSize: FONT.md, textAlign: "left",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#3a2518")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <Settings size={12} style={{ flexShrink: 0 }} />
                Settings
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
