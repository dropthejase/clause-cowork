import { createContext, useContext } from "react";
import { ThemeShape, ThemeKey, THEMES } from "./theme";

interface ThemeCtx {
  theme: ThemeShape;
  themeKey: ThemeKey;
}

export const ThemeContext = createContext<ThemeCtx>({ theme: THEMES.warm, themeKey: "warm" });

export function useTheme(): ThemeShape {
  return useContext(ThemeContext).theme;
}
