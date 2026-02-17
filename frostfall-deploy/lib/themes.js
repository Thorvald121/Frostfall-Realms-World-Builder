// lib/themes.js
export const THEMES = {
  dark_arcane: {
    name: "Dark Arcane",
    desc: "The original — deep blacks, gold accents",
    rootBg: "linear-gradient(170deg, #0a0e1a 0%, #111827 40%, #0f1420 100%)",
    sidebarBg: "linear-gradient(180deg, #0d1117 0%, #0a0e1a 100%)",
    border: "#1e2a3a",
    surface: "#111827",
    surfaceHover: "rgba(17,24,39,0.85)",
    text: "#d4c9a8",
    textMuted: "#8899aa",
    textDim: "#556677",
    accent: "#f0c040",
    accentBg: "rgba(240,192,64,0.12)",
    inputBg: "#0d1117",
    topBarBg: "rgba(10,14,26,0.6)",
    cardBg: "rgba(17,24,39,0.6)",
  },

  midnight_blue: {
    name: "Midnight Blue",
    desc: "Cool blues and silver — oceanic depths",
    rootBg: "linear-gradient(170deg, #0a1628 0%, #0f1f3a 40%, #0a1425 100%)",
    sidebarBg: "linear-gradient(180deg, #0c1424 0%, #0a1020 100%)",
    border: "#1a2d4a",
    surface: "#0f1f3a",
    surfaceHover: "rgba(15,31,58,0.85)",
    text: "#c8d8e8",
    textMuted: "#7899bb",
    textDim: "#4a6888",
    accent: "#5ea8d0",
    accentBg: "rgba(94,168,208,0.12)",
    inputBg: "#0a1628",
    topBarBg: "rgba(10,22,40,0.6)",
    cardBg: "rgba(15,31,58,0.6)",
  },

  parchment: {
    name: "Parchment Light",
    desc: "Warm cream and ink — like aged paper",
    rootBg: "linear-gradient(170deg, #f5f0e8 0%, #ece4d4 40%, #f0ead8 100%)",
    sidebarBg: "linear-gradient(180deg, #e8e0d0 0%, #ddd4c4 100%)",
    border: "#c8b898",
    surface: "#f5f0e8",
    surfaceHover: "rgba(220,210,190,0.5)",
    text: "#3a2f20",
    textMuted: "#6b5d48",
    textDim: "#9a8a70",
    accent: "#8b6914",
    accentBg: "rgba(139,105,20,0.12)",
    inputBg: "#faf6f0",
    topBarBg: "rgba(245,240,232,0.85)",
    cardBg: "rgba(236,228,212,0.6)",
  },

  // NEW THEME 1
  frostfall_ice: {
    name: "Frostfall Ice",
    desc: "Glacier blues, bright legibility, cold steel accents",
    rootBg: "linear-gradient(170deg, #06121f 0%, #0a1b2d 45%, #07101b 100%)",
    sidebarBg: "linear-gradient(180deg, #071628 0%, #05101e 100%)",
    border: "#1c3450",
    surface: "#0a1b2d",
    surfaceHover: "rgba(10,27,45,0.88)",
    text: "#d7e6f6",
    textMuted: "#9fb9d6",
    textDim: "#6e8aa7",
    accent: "#7dd3fc",
    accentBg: "rgba(125,211,252,0.14)",
    inputBg: "#06121f",
    topBarBg: "rgba(6,18,31,0.62)",
    cardBg: "rgba(10,27,45,0.62)",
  },

  // NEW THEME 2
  emberforge: {
    name: "Emberforge",
    desc: "Charcoal + ember orange, warmer contrast, forge-lit UI",
    rootBg: "linear-gradient(170deg, #120a0a 0%, #1a1010 40%, #0e0a0a 100%)",
    sidebarBg: "linear-gradient(180deg, #140c0c 0%, #0f0a0a 100%)",
    border: "#3a2622",
    surface: "#1a1010",
    surfaceHover: "rgba(26,16,16,0.88)",
    text: "#f1e2d0",
    textMuted: "#c8ab8a",
    textDim: "#8a6b52",
    accent: "#fb923c",
    accentBg: "rgba(251,146,60,0.14)",
    inputBg: "#120a0a",
    topBarBg: "rgba(18,10,10,0.62)",
    cardBg: "rgba(26,16,16,0.62)",
  },
};

export const DEFAULT_THEME_KEY = "dark_arcane";

export function normalizeThemeKey(key) {
  if (!key) return DEFAULT_THEME_KEY;
  return THEMES[key] ? key : DEFAULT_THEME_KEY;
}

export function applyThemeToRoot(themeKey) {
  if (typeof document === "undefined") return;

  const key = normalizeThemeKey(themeKey);
  const t = THEMES[key];

  const root = document.documentElement;
  root.dataset.theme = key;

  // Push all theme values into CSS variables (tokens)
  const vars = {
    "--rootBg": t.rootBg,
    "--sidebarBg": t.sidebarBg,
    "--border": t.border,
    "--surface": t.surface,
    "--surfaceHover": t.surfaceHover,
    "--text": t.text,
    "--textMuted": t.textMuted,
    "--textDim": t.textDim,
    "--accent": t.accent,
    "--accentBg": t.accentBg,
    "--inputBg": t.inputBg,
    "--topBarBg": t.topBarBg,
    "--cardBg": t.cardBg,
  };

  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

export function loadThemeKey() {
  if (typeof window === "undefined") return DEFAULT_THEME_KEY;
  return normalizeThemeKey(window.localStorage.getItem("ff_theme"));
}

export function saveThemeKey(themeKey) {
  if (typeof window === "undefined") return;
  const key = normalizeThemeKey(themeKey);
  window.localStorage.setItem("ff_theme", key);
}
