import React, { createContext, useContext, useState } from "react";
import { THEMES, THEME } from "@word-graph/shared";
import type { ThemeShape, ThemeKey } from "@word-graph/shared";

interface ThemeContextValue {
  theme: ThemeShape;
  themeKey: ThemeKey;
  setTheme: (key: ThemeKey) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: THEME,
  themeKey: "warm",
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeKey, setThemeKey] = useState<ThemeKey>(() => {
    try {
      return (localStorage.getItem("cc-theme") as ThemeKey) ?? "warm";
    } catch {
      return "warm";
    }
  });

  const theme = THEMES[themeKey] ?? THEME;

  function setTheme(key: ThemeKey) {
    setThemeKey(key);
    try { localStorage.setItem("cc-theme", key); } catch { /* ignore */ }
  }

  return (
    <ThemeContext.Provider value={{ theme, themeKey, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
