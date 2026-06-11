import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        stone: {
          base: "#f8f5f1",
          graph: "#f0e9df",
          edge: "#e8e1d8",
          muted: "#9a8a7a",
          charcoal: "#3d2e22",
          taupe: "#ccc4b8",
        },
        terracotta: {
          DEFAULT: "#b05a2f",
          dark: "#1a1108",
        },
        slate: {
          cross: "#5c6b7a",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
