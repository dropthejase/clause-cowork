import { useState } from "react";
import { useTheme } from "../../ThemeContext";
import { Section } from "@word-graph/shared";
import { api } from "../../api";
import { FONT } from "@word-graph/shared";

interface Props {
  workspacePath: string;
  onDataDeleted?: () => void;
  onSettingsReset?: () => void;
}

export function CacheSection({ workspacePath, onDataDeleted, onSettingsReset }: Props) {
  const { theme: THEME } = useTheme();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [deletingData, setDeletingData] = useState(false);
  const [deletedData, setDeletedData] = useState(false);
  const [resettingSettings, setResettingSettings] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  async function handleDeleteData() {
    setDeletingData(true);
    setConfirmDelete(false);
    try {
      await api.delete("/config/data", { params: { workspace_path: workspacePath } });
      setDeletedData(true);
      onDataDeleted?.();
    } catch {
      alert("Failed to delete document data — check backend logs.");
    } finally {
      setDeletingData(false);
    }
  }

  async function handleResetSettings() {
    setResettingSettings(true);
    setConfirmReset(false);
    try {
      await api.delete("/config/settings", { params: { workspace_path: workspacePath } });
      setResetDone(true);
      onSettingsReset?.();
      setTimeout(() => setResetDone(false), 2000);
    } catch {
      alert("Failed to reset settings — check backend logs.");
    } finally {
      setResettingSettings(false);
    }
  }

  return (
    <Section label="Data & Settings">
      <div style={{ padding: "10px 13px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${THEME.base}` }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: FONT.md, color: THEME.black, fontWeight: 500 }}>Reset to defaults</span>
          <span style={{ fontSize: FONT.md, color: THEME.muted, marginTop: 2 }}>Resets clause types, thresholds, and other settings. Provider and model are preserved.</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: 12 }}>
          {confirmReset && (
            <>
              <span style={{ fontSize: FONT.md, color: THEME.charcoal }}>Sure?</span>
              <button onClick={handleResetSettings} style={{ fontSize: FONT.md, fontWeight: 600, padding: "4px 9px", borderRadius: 6, border: `1px solid ${THEME.edgeBorder}`, background: THEME.charcoal, color: "#fff", cursor: "pointer" }}>Yes</button>
              <button onClick={() => setConfirmReset(false)} style={{ fontSize: FONT.md, padding: "4px 9px", borderRadius: 6, border: `1px solid ${THEME.edgeBorder}`, background: "none", color: THEME.muted, cursor: "pointer" }}>No</button>
            </>
          )}
          {!confirmReset && (
            <button
              onClick={() => setConfirmReset(true)}
              disabled={resettingSettings || resetDone}
              style={{ fontSize: FONT.md, fontWeight: 600, padding: "5px 11px", borderRadius: 6, border: `1px solid ${THEME.edgeBorder}`, background: THEME.base, color: THEME.charcoal, cursor: resettingSettings || resetDone ? "not-allowed" : "pointer", opacity: resettingSettings || resetDone ? 0.5 : 1 }}
            >
              {resettingSettings ? "Resetting…" : resetDone ? "Reset" : "Reset to defaults"}
            </button>
          )}
        </div>
      </div>

      <div style={{ padding: "10px 13px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: FONT.md, color: THEME.black, fontWeight: 500 }}>{deletedData ? "Data deleted" : "Delete document data"}</span>
          <span style={{ fontSize: FONT.md, color: THEME.muted, marginTop: 2 }}>Removes all parsed nodes, connections, and tags for this document</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: 12 }}>
          {confirmDelete && (
            <>
              <span style={{ fontSize: FONT.md, color: THEME.charcoal }}>Sure?</span>
              <button onClick={handleDeleteData} style={{ fontSize: FONT.md, fontWeight: 600, padding: "4px 9px", borderRadius: 6, border: "1px solid #fecaca", background: "#b91c1c", color: "#fff", cursor: "pointer" }}>Yes</button>
              <button onClick={() => setConfirmDelete(false)} style={{ fontSize: FONT.md, padding: "4px 9px", borderRadius: 6, border: `1px solid ${THEME.edgeBorder}`, background: "none", color: THEME.muted, cursor: "pointer" }}>No</button>
            </>
          )}
          {!confirmDelete && (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={deletingData || deletedData}
              style={{ fontSize: FONT.md, fontWeight: 600, padding: "5px 11px", borderRadius: 6, border: "1px solid #fecaca", background: "#fff0f0", color: "#b91c1c", cursor: deletingData || deletedData ? "not-allowed" : "pointer", opacity: deletingData || deletedData ? 0.5 : 1 }}
            >
              {deletingData ? "Deleting…" : deletedData ? "Deleted" : "Delete data"}
            </button>
          )}
        </div>
      </div>
    </Section>
  );
}
