import { X } from "lucide-react";
import { useTheme } from "../../ThemeContext";
import { FONT } from "@word-graph/shared";

interface RightPanelProps {
  title: string;
  open: boolean;
  onClose: () => void;
  width: number;
  children: React.ReactNode;
}

export function RightPanel({ title, open, onClose, width, children }: RightPanelProps) {
  const { theme } = useTheme();
  if (!open) return null;

  return (
    <div style={{
      width,
      display: "flex",
      flexDirection: "column",
      flexShrink: 0,
      borderLeft: "1px solid #e0d5c8",
      background: theme.base,
      height: "100%",
      overflow: "hidden",
    }}>
      <div style={{
        padding: "6px 10px",
        borderBottom: "1px solid #e8e0d4",
        fontSize: FONT.sm,
        color: theme.muted,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        background: theme.base,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexShrink: 0,
      }}>
        <span>{title}</span>
        <button
          title="Close panel"
          onClick={onClose}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: theme.muted, padding: 0, display: "flex",
          }}
        >
          <X size={12} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {children}
      </div>
    </div>
  );
}
