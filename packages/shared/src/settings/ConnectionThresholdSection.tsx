import { useState } from "react";
import { useTheme } from "../components/WordGraphPanel/ThemeContext";
import { FONT } from "../components/WordGraphPanel/fonts";
import { Section } from "./Section";

const DEFAULT_PROMPT =
  "Record connections where there is a clear, direct legal relationship between two clauses " +
  "(e.g. one qualifies, suspends, or conditions the other). Omit tenuous or incidental links.";

interface Props {
  customPrompt?: string;
  onChange: (prompt: string) => void;
}

export function ConnectionThresholdSection({ customPrompt = "", onChange }: Props) {
  const THEME = useTheme();
  const [draft, setDraft] = useState(customPrompt || DEFAULT_PROMPT);

  function handleReset() {
    setDraft(DEFAULT_PROMPT);
    onChange(DEFAULT_PROMPT);
  }

  function handleBlur() {
    if (draft.trim() !== customPrompt) {
      onChange(draft.trim() || DEFAULT_PROMPT);
    }
  }

  return (
    <Section label="Connection Guidance">
      <div style={{ padding: "8px 13px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        <p style={{ fontSize: FONT.md, color: THEME.muted, margin: 0, lineHeight: 1.5 }}>
          Instructs the agent on how to find connections between clauses. Takes effect on next Parse.
        </p>
        <div style={{ position: "relative" }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 512))}
            onBlur={handleBlur}
            rows={5}
            maxLength={512}
            style={{
              width: "100%", fontSize: FONT.md, color: THEME.black,
              background: THEME.base, border: `1px solid ${THEME.edgeBorder}`,
              borderRadius: 6, padding: "8px 10px", resize: "vertical",
              lineHeight: 1.5, outline: "none", boxSizing: "border-box",
              fontFamily: "inherit",
            }}
          />
          {draft.length > 400 && (
            <span style={{ position: "absolute", bottom: 6, right: 8, fontSize: FONT.sm, color: draft.length >= 512 ? "#b91c1c" : THEME.muted }}>
              {draft.length}/512
            </span>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          {(() => {
            const isModified = draft.trim() !== DEFAULT_PROMPT;
            return (
              <button
                onClick={handleReset}
                style={{
                  fontSize: FONT.md, fontWeight: isModified ? 700 : 400,
                  padding: "3px 10px", borderRadius: 6,
                  border: isModified ? "none" : `1px solid ${THEME.edgeBorder}`,
                  background: isModified ? THEME.terracotta : THEME.base,
                  color: isModified ? "#fff" : THEME.muted,
                  cursor: "pointer",
                }}
              >
                Reset to default
              </button>
            );
          })()}
        </div>
      </div>
    </Section>
  );
}
