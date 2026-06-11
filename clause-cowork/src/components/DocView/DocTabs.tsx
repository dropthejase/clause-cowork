import { X, MessageSquare, Eye } from "lucide-react";
import { useState, useRef } from "react";
import { useTheme } from "../../ThemeContext";
import { FONT } from "@word-graph/shared";

interface OpenDoc {
  path: string;
  docId: string;
}

interface DocTabsProps {
  docs: OpenDoc[];
  activeDocPath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  chatOpen: boolean;
  onToggleChat: () => void;
  previewOpen: boolean;
  onTogglePreview: () => void;
  noDocOpen?: boolean;
  previewDisabledMessage?: string;
}

export function DocTabs({ docs, activeDocPath, onSelect, onClose, chatOpen, onToggleChat, previewOpen, onTogglePreview, noDocOpen, previewDisabledMessage }: DocTabsProps) {
  const { theme } = useTheme();
  const [showPopup, setShowPopup] = useState(false);
  const [popupMessage, setPopupMessage] = useState("Open a document first");
  const popupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePreviewClick = () => {
    if (previewOpen) {
      onTogglePreview();
      return;
    }
    if (noDocOpen || previewDisabledMessage) {
      setPopupMessage(previewDisabledMessage ?? "Open a document first");
      setShowPopup(true);
      if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
      popupTimerRef.current = setTimeout(() => setShowPopup(false), 2000);
      return;
    }
    onTogglePreview();
  };

  return (
    <div
      style={{
        height: 32,
        background: theme.graphBg,
        borderBottom: `1px solid ${theme.edgeBorder}`,
        display: "flex",
        alignItems: "stretch",
        overflow: "visible",
        flexShrink: 0,
        position: "relative",
        zIndex: 10,
      }}
    >
      {/* Tabs */}
      <div style={{ display: "flex", flex: 1, alignItems: "stretch", overflow: "hidden" }}>
        {docs.map((doc) => {
          const active = doc.path === activeDocPath;
          const filename = doc.path.split("/").pop() ?? doc.path;
          return (
            <div
              key={doc.path}
              onClick={() => !active && onSelect(doc.path)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "0 10px",
                background: active ? theme.base : "transparent",
                borderTop: active ? `2px solid ${theme.terracotta}` : "2px solid transparent",
                fontWeight: active ? 700 : 400,
                fontSize: FONT.sm,
                color: theme.black,
                cursor: active ? "default" : "pointer",
                flexShrink: 0,
                userSelect: "none",
              }}
            >
              <span>{filename}</span>
              <button
                title="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(doc.path);
                }}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: theme.muted,
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <X size={10} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Right-side actions */}
      <div style={{ display: "flex", alignItems: "center", padding: "0 8px", gap: 4, flexShrink: 0 }}>
        <div style={{ position: "relative" }}>
          <button
            title="Doc Preview"
            onClick={handlePreviewClick}
            style={{
              width: 26, height: 26, borderRadius: 5, border: "none",
              background: previewOpen ? theme.terracotta : "transparent",
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: previewOpen ? "#fff" : theme.muted,
            }}
          >
            <Eye size={14} />
          </button>
          {showPopup && (
            <div style={{
              position: "absolute", top: "50%", right: "calc(100% + 6px)",
              transform: "translateY(-50%)",
              background: theme.charcoal, color: theme.white,
              padding: "5px 10px", borderRadius: 5, fontSize: FONT.sm, fontWeight: 500,
              whiteSpace: "nowrap", pointerEvents: "none", zIndex: 100,
              boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
            }}>
              {popupMessage}
            </div>
          )}
        </div>
        <button
          title="Chat"
          onClick={onToggleChat}
          style={{
            width: 26, height: 26, borderRadius: 5, border: "none",
            background: chatOpen ? theme.terracotta : "transparent",
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: chatOpen ? "#fff" : theme.muted,
          }}
        >
          <MessageSquare size={14} />
        </button>
      </div>

    </div>
  );
}
