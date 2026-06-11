import { useState, useEffect } from "react";
import { ChevronRight, Folder, FolderOpen, X } from "lucide-react";
import { useTheme } from "../../ThemeContext";
import { listDirectory } from "../../api";
import type { FsEntry } from "../../api";
import { FONT } from "@word-graph/shared";

interface Props {
  onSelect: (path: string) => void;
  onClose: () => void;
}

function tildePath(path: string, home: string): string {
  return home && path.startsWith(home) ? "~" + path.slice(home.length) : path;
}

export function FolderPicker({ onSelect, onClose }: Props) {
  const { theme } = useTheme();
  const [currentPath, setCurrentPath] = useState<string>("");
  const [home, setHome] = useState<string>("");
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  async function navigate(path?: string) {
    setLoading(true);
    setSelected(null);
    try {
      const listing = await listDirectory(path);
      setCurrentPath(listing.path);
      setParent(listing.parent);
      setEntries(listing.entries);
      if (!home && listing.home) setHome(listing.home);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { navigate(); }, []);

  const displayPath = tildePath(currentPath, home);
  const breadcrumbs = displayPath.split("/").filter(Boolean);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.4)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520, height: 560,
          background: theme.white, borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "14px 16px", borderBottom: `1px solid ${theme.edgeBorder}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: FONT.title, fontWeight: 700, color: theme.black }}>Choose Workspace Folder</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: theme.muted }}>
            <X size={16} />
          </button>
        </div>

        {/* Breadcrumb */}
        <div style={{
          padding: "8px 16px", borderBottom: `1px solid ${theme.edgeBorder}`,
          display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap",
          flexShrink: 0, background: theme.base,
        }}>
          {parent !== null && (
            <button
              onClick={() => navigate(parent)}
              style={{ background: "none", border: "none", cursor: "pointer", color: theme.muted, fontSize: FONT.sm, padding: "2px 4px" }}
            >
              ←
            </button>
          )}
          {breadcrumbs.map((crumb, i) => {
            const realSegments = currentPath.split("/").filter(Boolean);
            const realPath = "/" + realSegments.slice(0, realSegments.length - (breadcrumbs.length - 1 - i)).join("/");
            const isLast = i === breadcrumbs.length - 1;
            return (
              <span key={realPath} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {i > 0 && <ChevronRight size={10} style={{ color: theme.muted }} />}
                <button
                  onClick={() => !isLast && navigate(realPath)}
                  style={{
                    background: "none", border: "none", cursor: isLast ? "default" : "pointer",
                    color: isLast ? theme.black : theme.muted,
                    fontSize: FONT.sm, fontWeight: isLast ? 600 : 400, padding: "2px 4px",
                  }}
                >
                  {crumb}
                </button>
              </span>
            );
          })}
        </div>

        {/* Directory listing */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: "center", color: theme.muted, fontSize: FONT.md }}>Loading…</div>
          ) : entries.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: theme.muted, fontSize: FONT.md }}>No subfolders</div>
          ) : (
            entries.map((entry) => {
              const isSelected = entry.path === selected;
              return (
                <div
                  key={entry.path}
                  onClick={() => setSelected(entry.path)}
                  onDoubleClick={() => navigate(entry.path)}
                  style={{
                    padding: "8px 16px",
                    display: "flex", alignItems: "center", gap: 10,
                    cursor: "pointer",
                    background: isSelected ? `${theme.terracotta}18` : "transparent",
                    borderLeft: isSelected ? `3px solid ${theme.terracotta}` : "3px solid transparent",
                  }}
                >
                  {isSelected
                    ? <FolderOpen size={16} style={{ color: theme.terracotta, flexShrink: 0 }} />
                    : <Folder size={16} style={{ color: theme.muted, flexShrink: 0 }} />
                  }
                  <span style={{ fontSize: FONT.md, color: theme.black, flex: 1 }}>{entry.name}</span>
                  <ChevronRight
                    size={14}
                    style={{ color: theme.muted, cursor: "pointer" }}
                    onClick={(e) => { e.stopPropagation(); navigate(entry.path); }}
                  />
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 16px", borderTop: `1px solid ${theme.edgeBorder}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0, gap: 12,
        }}>
          <div style={{
            flex: 1, fontSize: FONT.sm, color: theme.muted,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {tildePath(selected ?? currentPath, home)}
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button
              onClick={onClose}
              style={{
                height: 32, padding: "0 14px", borderRadius: 6,
                border: `1px solid ${theme.edgeBorder}`, background: "none",
                color: theme.muted, cursor: "pointer", fontSize: FONT.md,
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => onSelect(selected ?? currentPath)}
              style={{
                height: 32, padding: "0 16px", borderRadius: 6,
                border: "none", background: theme.terracotta,
                color: theme.white, cursor: "pointer", fontSize: FONT.md, fontWeight: 600,
              }}
            >
              Add workspace
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
