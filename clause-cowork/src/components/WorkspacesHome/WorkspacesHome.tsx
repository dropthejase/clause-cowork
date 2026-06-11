import { useState, useRef, useEffect } from "react";
import { Folder, FolderOpen, Settings, X, Check, Trash2, HelpCircle, Brain } from "lucide-react";
import { useTheme } from "../../ThemeContext";
import { useAppStore } from "../../store";
import { FolderPicker } from "../FolderPicker/FolderPicker";
import { THEMES } from "@word-graph/shared";
import type { ThemeKey } from "@word-graph/shared";
import { FONT } from "@word-graph/shared";
import { HelpModal } from "../HelpModal/HelpModal";

function basename(p: string): string {
  return p.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? p;
}

const THEME_LABELS: Record<ThemeKey, string> = {
  warm: "Warm",
  light: "Light",
  dark: "Dark",
  alien: "Alien",
  halloween: "Halloween 🎃",
  christmas: "Christmas 🎄",
};

interface WorkspacesHomeProps {
  onOpenSettings: () => void;
}

export function WorkspacesHome({ onOpenSettings }: WorkspacesHomeProps) {
  const { theme, themeKey, setTheme } = useTheme();
  const { workspaces, openWorkspace, addWorkspace, removeWorkspace } = useAppStore();
  const [showPicker, setShowPicker] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

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

  function handleSelect(path: string) {
    setShowPicker(false);
    addWorkspace(path);
    openWorkspace(path);
  }

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden", background: theme.graphBg, height: "100vh" }}>
      {/* Left sidebar */}
      <div style={{
        width: 200, flexShrink: 0, background: theme.base,
        borderRight: `1px solid ${theme.edgeBorder}`,
        display: "flex", flexDirection: "column",
        padding: "16px 0",
      }}>
        <div style={{ padding: "0 16px 16px", borderBottom: `1px solid ${theme.edgeBorder}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Brain size={20} color={theme.terracotta} />
            <span style={{ fontSize: FONT.title, fontWeight: 700, color: theme.black }}>Clause CoWork</span>
          </div>
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ padding: "0 8px 4px" }}>
          <button
            onClick={() => setShowHelp(true)}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 8,
              padding: "7px 8px", borderRadius: 5, cursor: "pointer",
              border: "none", background: "transparent",
              color: theme.muted, fontSize: FONT.md,
            }}
          >
            <HelpCircle size={14} />
            Getting started
          </button>
        </div>

        <div style={{ padding: "0 8px", position: "relative" }}>
          <button
            ref={btnRef}
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 8,
              padding: "7px 8px", borderRadius: 5, cursor: "pointer",
              border: "none", background: menuOpen ? theme.edgeBorder : "transparent",
              color: theme.muted, fontSize: FONT.md,
            }}
          >
            <Settings size={14} />
            Settings
          </button>

          {menuOpen && (
            <div
              ref={menuRef}
              style={{
                position: "absolute",
                bottom: "calc(100% + 4px)",
                left: 8, right: 8,
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
                    <Check size={12} style={{ opacity: k === themeKey ? 1 : 0, flexShrink: 0, color: "#b05a2f" }} />
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

      {/* Main content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "40px 48px" }}>
        <div style={{ maxWidth: 700 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: theme.black, margin: "0 0 20px" }}>Workspaces</h2>

          {workspaces.length === 0 ? (
            <div style={{ padding: "24px 0", color: theme.muted, fontSize: FONT.title }}>
              No workspaces yet. Add a folder to get started.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12, marginBottom: 16 }}>
              {workspaces.map((ws) => (
                <div
                  key={ws}
                  style={{
                    border: `1px solid ${theme.edgeBorder}`,
                    borderRadius: 8, padding: "14px 16px",
                    background: theme.white,
                    display: "flex", alignItems: "center", gap: 12,
                  }}
                >
                  <Folder size={20} style={{ color: theme.terracotta, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: FONT.title, color: theme.black, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {basename(ws)}
                    </div>
                    <div style={{ fontSize: FONT.sm, color: theme.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ws}
                    </div>
                  </div>
                  <button
                    onClick={() => openWorkspace(ws)}
                    style={{
                      height: 28, padding: "0 12px", borderRadius: 4,
                      background: theme.terracotta, color: theme.white,
                      border: "none", cursor: "pointer", fontSize: FONT.sm, flexShrink: 0,
                    }}
                  >
                    Open
                  </button>
                  {confirmingRemove === ws ? (
                    <button
                      title="Click to confirm removal"
                      onClick={() => { removeWorkspace(ws); setConfirmingRemove(null); }}
                      onBlur={() => setConfirmingRemove(null)}
                      autoFocus
                      style={{
                        width: 24, height: 24, borderRadius: 4, border: "none",
                        cursor: "pointer", background: "#c0392b",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#fff", flexShrink: 0,
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  ) : (
                    <button
                      title="Remove workspace"
                      onClick={() => setConfirmingRemove(ws)}
                      style={{
                        width: 24, height: 24, borderRadius: 4, border: "none",
                        cursor: "pointer", background: "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: theme.muted, flexShrink: 0,
                      }}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => setShowPicker(true)}
            style={{
              marginTop: 16, height: 36, padding: "0 16px", borderRadius: 6,
              background: theme.terracotta, color: theme.white,
              border: "none", cursor: "pointer",
              fontSize: FONT.md, fontWeight: 600, display: "flex", alignItems: "center", gap: 8,
            }}
          >
            <FolderOpen size={14} />
            + Add workspace
          </button>
        </div>
      </div>

      {showPicker && (
        <FolderPicker onSelect={handleSelect} onClose={() => setShowPicker(false)} />
      )}

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}
