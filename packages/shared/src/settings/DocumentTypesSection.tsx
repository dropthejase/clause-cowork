import React, { useState } from "react";
import { useTheme } from "../components/WordGraphPanel/ThemeContext";
import { FONT } from "../components/WordGraphPanel/fonts";
import { Section } from "./Section";

interface DocType {
  name: string;
  description: string;
}

interface Props {
  docTypes: DocType[];
  onChange: (updated: DocType[]) => void;
  strict?: boolean;
  onStrictChange?: (v: boolean) => void;
}

export function DocumentTypesSection({ docTypes, onChange, strict = true, onStrictChange }: Props) {
  const THEME = useTheme();
  const [addingType, setAddingType] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  function handleAdd() {
    if (!newName.trim()) return;
    onChange([...docTypes, { name: newName.trim(), description: newDesc.trim() }]);
    setNewName("");
    setNewDesc("");
    setAddingType(false);
  }

  const inputStyle: React.CSSProperties = {
    fontSize: FONT.md, color: THEME.black, background: THEME.base,
    border: `1px solid ${THEME.edgeBorder}`, borderRadius: 6,
    padding: "5px 9px", width: "100%", outline: "none",
  };

  return (
    <Section label="Document Types">
      <div style={{ padding: "6px 13px 4px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: FONT.md, color: THEME.muted, flex: 1 }}>
          Used by the agent to classify whole documents. Extensible — add your own with a description.
        </span>
      </div>
      {onStrictChange && (
        <div style={{ padding: "4px 13px 8px", display: "flex", alignItems: "center", gap: 8, borderBottom: `1px solid ${THEME.base}` }}>
          <span style={{ fontSize: FONT.md, color: THEME.muted, flex: 1 }}>Lock types — agent may only use types from this list</span>
          <button
            onClick={() => onStrictChange(!strict)}
            style={{
              width: 36, height: 20, borderRadius: 10, border: "none", cursor: "pointer", padding: 0,
              background: strict ? THEME.terracotta : THEME.edgeBorder, position: "relative", flexShrink: 0,
              transition: "background 0.2s",
            }}
          >
            <div style={{
              width: 14, height: 14, borderRadius: "50%", background: "#fff",
              position: "absolute", top: 3, left: strict ? 19 : 3, transition: "left 0.2s",
            }} />
          </button>
        </div>
      )}
      <div style={{ padding: "8px 13px", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {docTypes.map((t) => (
          <span
            key={t.name}
            title={t.description}
            style={{
              fontSize: FONT.md, padding: "3px 8px", borderRadius: 9999,
              border: `1px solid ${THEME.edgeBorder}`, background: THEME.graphBg,
              color: THEME.charcoal, display: "flex", alignItems: "center", gap: 4,
            }}
          >
            {t.name}
            <button
              onClick={() => onChange(docTypes.filter((x) => x.name !== t.name))}
              style={{ background: "none", border: "none", cursor: "pointer", color: THEME.muted, fontSize: FONT.md, lineHeight: 1, padding: 0 }}
            >
              ×
            </button>
          </span>
        ))}

        {!addingType ? (
          <button
            onClick={() => setAddingType(true)}
            style={{ fontSize: FONT.md, padding: "3px 8px", borderRadius: 9999, border: `1px dashed #c8b89a`, color: "#b0a080", cursor: "pointer", background: "none" }}
          >
            + Add type
          </button>
        ) : (
          <div style={{ width: "100%", marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: FONT.sm, color: THEME.muted }}>
              Type name: max 64 characters. Description: max 256 characters.
            </div>
            <div style={{ position: "relative" }}>
              <input
                style={inputStyle}
                placeholder="Type name (e.g. Joint Venture)"
                value={newName}
                maxLength={64}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
              />
              {newName.length > 48 && (
                <span style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: FONT.sm, color: newName.length >= 64 ? "#b91c1c" : THEME.muted }}>
                  {newName.length}/64
                </span>
              )}
            </div>
            <div>
              <textarea
                style={{ ...inputStyle, resize: "vertical", minHeight: 56, lineHeight: 1.4, fontFamily: "inherit" }}
                placeholder="Description — used by the AI agent for classification"
                value={newDesc}
                maxLength={256}
                rows={2}
                onChange={(e) => setNewDesc(e.target.value)}
              />
              {newDesc.length > 200 && (
                <div style={{ textAlign: "right", fontSize: FONT.sm, color: newDesc.length >= 256 ? "#b91c1c" : THEME.muted, marginTop: 2 }}>
                  {newDesc.length}/256
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={handleAdd}
                disabled={!newName.trim()}
                style={{ fontSize: FONT.md, fontWeight: 600, padding: "4px 10px", borderRadius: 6, border: "none", background: THEME.terracotta, color: "#fff", cursor: "pointer", opacity: !newName.trim() ? 0.4 : 1 }}
              >
                Add
              </button>
              <button
                onClick={() => { setAddingType(false); setNewName(""); setNewDesc(""); }}
                style={{ fontSize: FONT.md, padding: "4px 10px", borderRadius: 6, border: `1px solid ${THEME.edgeBorder}`, background: THEME.white, cursor: "pointer", color: THEME.charcoal }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
