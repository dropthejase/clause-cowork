import { useTheme } from "../components/WordGraphPanel/ThemeContext";
import { FONT } from "../components/WordGraphPanel/fonts";

export function Section({ label, badge, children }: { label: string; badge?: React.ReactNode; children: React.ReactNode }) {
  const THEME = useTheme();
  return (
    <div style={{ background: THEME.white, borderRadius: 9, overflow: "hidden", boxShadow: "0 1px 3px rgba(60,30,10,0.06)" }}>
      <div style={{ padding: "10px 13px", borderBottom: `1px solid ${THEME.edgeBorder}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: FONT.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: THEME.muted }}>{label}</span>
        {badge}
      </div>
      {children}
    </div>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  const THEME = useTheme();
  return (
    <div style={{ padding: "10px 13px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${THEME.base}`, gap: 12 }}>
      <span style={{ fontSize: FONT.md, color: THEME.black, fontWeight: 500 }}>{label}</span>
      {children}
    </div>
  );
}

export function InputRow({ label, sub, children }: { label: string; sub?: React.ReactNode; children: React.ReactNode }) {
  const THEME = useTheme();
  return (
    <div style={{ padding: "10px 13px", borderBottom: `1px solid ${THEME.base}` }}>
      <div style={{ fontSize: FONT.sm, color: THEME.charcoal, fontWeight: 500, marginBottom: 3 }}>{label}</div>
      {sub && <div style={{ fontSize: FONT.sm, color: THEME.muted, marginBottom: 6 }}>{sub}</div>}
      {children}
    </div>
  );
}
