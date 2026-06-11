export interface ThemeShape {
  base: string;
  graphBg: string;
  edgeLine: string;
  edgeBorder: string;
  muted: string;
  charcoal: string;
  nodeColour: string;  // primary-doc clause node fill (graph) — separate from charcoal text token
  crossDoc: string;
  terracotta: string;
  taupe: string;
  black: string;
  white: string;
  hubLine: string;  // colour for the dashed hub spokes
  typeColours: {
    Definition: string;
    Obligation: string;
    Condition: string;
    Exclusion: string;
    Indemnity: string;
    "Governing Law": string;
  };
}

export function getTypeColour(type: string | undefined | null, theme: ThemeShape): string {
  if (!type) return theme.charcoal;
  return (theme.typeColours as Record<string, string>)[type] ?? theme.charcoal;
}

// Returns true when the background colour is dark enough for white text.
export function isDarkColour(hex: string): boolean {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  // Perceived luminance (WCAG formula)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum < 0.55;
}

export function typeTextColour(bgHex: string): string {
  return isDarkColour(bgHex) ? "#fff" : "#1a1108";
}

export type ThemeKey = "warm" | "light" | "dark" | "alien" | "halloween" | "christmas";

export const THEMES: Record<ThemeKey, ThemeShape> = {
  warm: {
    base: "#f8f5f1",
    graphBg: "#f0e9df",
    edgeLine: "#c8a87a",
    edgeBorder: "#e8e1d8",
    muted: "#7a6a5a",
    charcoal: "#3d2e22",
    nodeColour: "#3d2e22",
    crossDoc: "#5c6b7a",
    terracotta: "#b05a2f",
    taupe: "#ccc4b8",
    black: "#1a1108",
    white: "#ffffff",
    hubLine: "#8a7a68",
    typeColours: {
      Definition:      "#8898c8",
      Obligation:      "#5a9e60",
      Condition:       "#b090e0",
      Exclusion:       "#c080c0",
      Indemnity:       "#d4884a",
      "Governing Law": "#5898a8",
    },
  },
  light: {
    base: "#f4f5f7",
    graphBg: "#eaecf0",
    edgeLine: "#8899bb",
    edgeBorder: "#d0d5e0",
    muted: "#5a6480",
    charcoal: "#2a3550",
    nodeColour: "#2a3550",
    crossDoc: "#7a5090",
    terracotta: "#4060c0",
    taupe: "#bec5d8",
    black: "#121828",
    white: "#ffffff",
    hubLine: "#8090b0",
    typeColours: {
      Definition:      "#6878c0",
      Obligation:      "#4888a0",
      Condition:       "#9070d0",
      Exclusion:       "#a060a8",
      Indemnity:       "#b07040",
      "Governing Law": "#3878a0",
    },
  },
  dark: {
    base: "#2a2d38",
    graphBg: "#22252e",
    edgeLine: "#505870",
    edgeBorder: "#383c4a",
    muted: "#8890b0",
    charcoal: "#d8ddf0",
    nodeColour: "#6878b8",  // mid indigo-blue — distinct from pale lavender text
    crossDoc: "#8898c8",
    terracotta: "#7888cc",
    taupe: "#484e62",
    black: "#eceef8",
    white: "#2a2d38",
    hubLine: "#6870a0",
    typeColours: {
      Definition:      "#5870e8",  // bright cobalt
      Obligation:      "#38b870",  // vivid green
      Condition:       "#a060e8",  // vivid violet
      Exclusion:       "#e04898",  // hot pink
      Indemnity:       "#e08030",  // bright amber
      "Governing Law": "#20a0c8",  // bright cyan-blue
    },
  },
  alien: {
    // Dark charcoal base — purple, pink, green pastel accents
    base: "#1a1820",
    graphBg: "#141218",
    edgeLine: "#3a4858",
    edgeBorder: "#252030",
    muted: "#6860a0",      // dim purple — secondary text
    charcoal: "#a8c8a8",   // UI text — pale sage green, readable on dark bg
    nodeColour: "#4a9858", // graph node fill — richer green
    crossDoc: "#c080c0",   // cross-doc — dusty pink/purple
    terracotta: "#b090e0", // selected — soft lavender-purple
    taupe: "#2e2840",      // out-of-cluster nodes — dark purple-grey
    black: "#d8d0f0",      // primary UI text — pale lavender
    white: "#1a1820",
    hubLine: "#7068a8",
    typeColours: {
      Definition:      "#7060f8",  // electric purple-blue
      Obligation:      "#40d060",  // neon green
      Condition:       "#d040f0",  // neon magenta
      Exclusion:       "#f040a0",  // hot pink
      Indemnity:       "#f08020",  // neon orange
      "Governing Law": "#20d0d0",  // neon teal
    },
  },
  halloween: {
    base: "#f5e8d8",       // warm cream-orange
    graphBg: "#eeddc8",    // slightly deeper for graph
    edgeLine: "#c89060",   // tan-orange edges
    edgeBorder: "#e0cdb0", // soft border
    muted: "#9a6848",      // warm brown muted
    charcoal: "#2e1a0e",   // dark brown UI text
    nodeColour: "#3a7028", // forest green graph nodes
    crossDoc: "#4a7830",   // forest green
    terracotta: "#3a7028", // GREEN primary accent — select bar, buttons, active tab
    taupe: "#d4b898",      // pale tan unselected
    black: "#1a0e08",      // very dark brown primary text
    white: "#fdf4e8",      // warm cream card surface
    hubLine: "#4a7830",    // green hub spokes
    typeColours: {
      Definition:      "#7a5c9a",
      Obligation:      "#3a7a38",
      Condition:       "#8a4878",
      Exclusion:       "#6a3060",
      Indemnity:       "#c06020",
      "Governing Law": "#2a6858",
    },
  },
  christmas: {
    base: "#4a1010",       // lighter burgundy base
    graphBg: "#3a0a0a",    // slightly deeper for graph
    edgeLine: "#e05050",   // lighter holly red edges
    edgeBorder: "#6a2828", // mid-burgundy border
    muted: "#d4a0a0",      // muted pink-red secondary text
    charcoal: "#fdf0f0",   // near-white text
    nodeColour: "#6ee880", // bright mint green — pops on dark red bg
    crossDoc: "#e8c84a",   // gold cross-doc
    terracotta: "#4ab860", // lighter green accent — buttons, active tab, selection bar
    taupe: "#8a4848",      // lighter red-brown unselected nodes — visible on dark bg
    black: "#fff5f5",      // off-white primary text
    white: "#4a1010",      // surface = lighter burgundy
    hubLine: "#e8c84a",    // gold hub spokes
    typeColours: {
      Definition:      "#e8c84a",  // gold
      Obligation:      "#6ad07a",  // lighter green
      Condition:       "#e86060",  // lighter red
      Exclusion:       "#b0e0b8",  // pale green
      Indemnity:       "#fdf0f0",  // near-white
      "Governing Law": "#c8960a",  // deep gold
    },
  },
};

// Default export kept for components that haven't migrated to context
export const THEME: ThemeShape = THEMES.warm;

// Link distance levels — controls how tightly D3 pulls connected nodes together.
// Lower = closer. Applied per edge based on relationship type.
// Link distance levels — controls how tightly D3 pulls connected nodes together.
// Lower = closer. Applied per edge based on relationship type.
export const LINK_DISTANCE = {
  sequence: 20,          // kept for legacy data (no longer injected)
  crossSection: 55,      // fallback, not used directly
  hub: 170,              // doc hub → section hub (weak gravitational pull)
  sectionHub: 240,       // doc hub ↔ section hub spoke distance
  clauseToSection: 25,   // clause → its section hub — tight so clauses follow when hub moves
} as const;


export const NODE_RADIUS = {
  base: 6,
  selected: 10,
  hover: 9,
  minByConnections: 5,
  maxByConnections: 14,
} as const;

export function nodeColor(node: { doc_id: string }, primaryDocId: string, selected: boolean, inCluster: boolean, theme: ThemeShape = THEME): string {
  if (selected) return theme.terracotta;
  if (!inCluster) return theme.taupe;
  if (node.doc_id !== primaryDocId) return theme.crossDoc;
  return theme.nodeColour;
}

export function nodeRadius(connectionCount: number, _state: "selected" | "hover" | null): number {
  const scaled = NODE_RADIUS.minByConnections +
    Math.min(connectionCount, 10) * (NODE_RADIUS.maxByConnections - NODE_RADIUS.minByConnections) / 10;
  return Math.round(scaled);
}
