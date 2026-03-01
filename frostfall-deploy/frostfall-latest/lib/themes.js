// lib/themes.js
//
// Frostfall Realms — Theme Definitions (Single Source of Truth)
// 7 genre-driven themes, 17 tokens each. All text meets WCAG AA contrast.
//
// Each theme has a unique background hue so they're instantly distinguishable:
//
//   Dark Arcane    — blue-black + gold         (classic dark fantasy)
//   Obsidian       — true black + violet        (void, shadow, arcane)
//   Parchment      — warm tan + burnt amber     (medieval candlelit)
//   Frozen Steel   — neutral grey + ice         (arctic / tundra)
//   Emberforge     — charcoal-red + ember       (volcanic / dwarven forge)
//   Voidbloom      — purple-black + toxic green  (eldritch / cosmic horror)
//   Thornwood      — forest green + amber        (druidic / nature / fae)

export const THEMES = {

  // ═══════════════════════════════════════════════════════════
  //  1. DARK ARCANE — Blue-Black + Gold  (hue ~220° bg, ~45° accent)
  // ═══════════════════════════════════════════════════════════
  dark_arcane: {
    name: "Dark Arcane",
    desc: "Deep blacks and gold — classic dark fantasy",
    rootBg: "linear-gradient(170deg, #0a0e1a 0%, #111827 40%, #0f1420 100%)",
    sidebarBg: "linear-gradient(180deg, #0d1117 0%, #0a0e1a 100%)",
    border: "#283848",
    divider: "#1e2e40",
    surface: "#111827",
    surfaceHover: "rgba(17,24,39,0.85)",
    deepBg: "#0a0e1a",
    text: "#e2d9be",
    textMuted: "#a8b4c2",
    textDim: "#7a8da0",
    accent: "#f0c040",
    accentBg: "rgba(240,192,64,0.12)",
    inputBg: "#0d1117",
    topBarBg: "rgba(10,14,26,0.95)",
    cardBg: "rgba(17,24,39,0.6)",
  },

  // ═══════════════════════════════════════════════════════════
  //  2. OBSIDIAN — True Black + Electric Violet  (hue ~0° bg, ~275° accent)
  //     The darkest theme — ink-black void with purple glow
  // ═══════════════════════════════════════════════════════════
  obsidian: {
    name: "Obsidian",
    desc: "True black and violet — void, shadow, the abyss",
    rootBg: "linear-gradient(170deg, #050505 0%, #0e0e10 40%, #080808 100%)",
    sidebarBg: "linear-gradient(180deg, #0a0a0e 0%, #050505 100%)",
    border: "#382e48",
    divider: "#2a2238",
    surface: "#0e0e10",
    surfaceHover: "rgba(14,14,16,0.90)",
    deepBg: "#050505",
    text: "#e8e4f0",
    textMuted: "#b0a8c4",
    textDim: "#7e74a0",
    accent: "#a855f7",
    accentBg: "rgba(168,85,247,0.12)",
    inputBg: "#0a0a0c",
    topBarBg: "rgba(5,5,5,0.96)",
    cardBg: "rgba(14,14,16,0.65)",
  },

  // ═══════════════════════════════════════════════════════════
  //  3. PARCHMENT — Warm Tan + Burnt Amber  (light theme, candlelit feel)
  //     Sidebar/topbar intentionally darker than content area
  //     for clear layer separation and tab visibility
  // ═══════════════════════════════════════════════════════════
  parchment: {
    name: "Parchment",
    desc: "Warm tan and ink — candlelit manuscript",
    rootBg: "linear-gradient(170deg, #d8ceb8 0%, #ccc2aa 40%, #d4cab2 100%)",
    sidebarBg: "linear-gradient(180deg, #dccca0ff 0%, #a89c82 100%)",
    border: "#85734fff",
    divider: "#867552ff",
    surface: "#c9bc9eff",
    surfaceHover: "rgba(176,164,136,0.45)",
    deepBg: "#918976ff",
    text: "#161006",
    textMuted: "#241e10",
    textDim: "#3e3624",
    accent: "#5e3400",
    accentBg: "rgba(94,52,0,0.14)",
    inputBg: "#e4dcc8",
    topBarBg: "rgba(176,164,138,0.96)",
    cardBg: "rgba(204,194,170,0.6)",
  },

  // ═══════════════════════════════════════════════════════════
  //  4. FROZEN STEEL — Neutral Grey + Ice White  (hue ~200° desaturated)
  //     Grey/steel — not blue. Feels like frozen metal.
  // ═══════════════════════════════════════════════════════════
  frozen_steel: {
    name: "Frozen Steel",
    desc: "Cold steel and frost — arctic tundra, ice kingdoms",
    rootBg: "linear-gradient(170deg, #0e1114 0%, #171c21 40%, #0f1316 100%)",
    sidebarBg: "linear-gradient(180deg, #111518 0%, #0e1114 100%)",
    border: "#2a3440",
    divider: "#222c36",
    surface: "#171c21",
    surfaceHover: "rgba(23,28,33,0.88)",
    deepBg: "#0e1114",
    text: "#e4eaf0",
    textMuted: "#a8b8c8",
    textDim: "#788898",
    accent: "#a5f3fc",
    accentBg: "rgba(165,243,252,0.10)",
    inputBg: "#0f1316",
    topBarBg: "rgba(14,17,20,0.95)",
    cardBg: "rgba(23,28,33,0.62)",
  },

  // ═══════════════════════════════════════════════════════════
  //  5. EMBERFORGE — Charcoal-Red + Ember Orange  (hue ~0° bg, ~20° accent)
  // ═══════════════════════════════════════════════════════════
  emberforge: {
    name: "Emberforge",
    desc: "Charcoal and ember — forge-lit, volcanic depths",
    rootBg: "linear-gradient(170deg, #120a0a 0%, #1a1010 40%, #0e0a0a 100%)",
    sidebarBg: "linear-gradient(180deg, #140c0c 0%, #0f0a0a 100%)",
    border: "#48302a",
    divider: "#382420",
    surface: "#1a1010",
    surfaceHover: "rgba(26,16,16,0.88)",
    deepBg: "#0f0a0a",
    text: "#f4eadc",
    textMuted: "#d4bfa4",
    textDim: "#aa8e74",
    accent: "#fb923c",
    accentBg: "rgba(251,146,60,0.14)",
    inputBg: "#120a0a",
    topBarBg: "rgba(18,10,10,0.95)",
    cardBg: "rgba(26,16,16,0.62)",
  },

  // ═══════════════════════════════════════════════════════════
  //  6. VOIDBLOOM — Purple-Black + Toxic Green  (hue ~270° bg, ~150° accent)
  // ═══════════════════════════════════════════════════════════
  voidbloom: {
    name: "Voidbloom",
    desc: "Deep violet and toxic green — eldritch, cosmic horror",
    rootBg: "linear-gradient(170deg, #0c0a14 0%, #14101e 40%, #0e0a16 100%)",
    sidebarBg: "linear-gradient(180deg, #100c18 0%, #0c0a14 100%)",
    border: "#362c50",
    divider: "#2c2242",
    surface: "#14101e",
    surfaceHover: "rgba(20,16,30,0.88)",
    deepBg: "#0c0a14",
    text: "#e0daea",
    textMuted: "#b0a4c8",
    textDim: "#8878a8",
    accent: "#86efac",
    accentBg: "rgba(134,239,172,0.10)",
    inputBg: "#0e0a16",
    topBarBg: "rgba(12,10,20,0.95)",
    cardBg: "rgba(20,16,30,0.62)",
  },

  // ═══════════════════════════════════════════════════════════
  //  7. THORNWOOD — Forest Green + Warm Amber  (hue ~120° bg, ~43° accent)
  // ═══════════════════════════════════════════════════════════
  thornwood: {
    name: "Thornwood",
    desc: "Forest canopy and amber light — druidic, fae, nature",
    rootBg: "linear-gradient(170deg, #0a100a 0%, #121a12 40%, #0c120c 100%)",
    sidebarBg: "linear-gradient(180deg, #0e150e 0%, #0a100a 100%)",
    border: "#243824",
    divider: "#1e3020",
    surface: "#121a12",
    surfaceHover: "rgba(18,26,18,0.88)",
    deepBg: "#0a100a",
    text: "#e4ece0",
    textMuted: "#a8c4a0",
    textDim: "#7a9a72",
    accent: "#fbbf24",
    accentBg: "rgba(251,191,36,0.12)",
    inputBg: "#0c120c",
    topBarBg: "rgba(10,16,10,0.95)",
    cardBg: "rgba(18,26,18,0.62)",
  },
};

export const DEFAULT_THEME_KEY = "dark_arcane";

// Map old/renamed theme keys so saved preferences still work
const THEME_MIGRATION = {
  midnight_blue: "dark_arcane",
  frostfall_ice: "frozen_steel",
  abyssal_depths: "dark_arcane",
};

export function normalizeThemeKey(key) {
  if (!key) return DEFAULT_THEME_KEY;
  if (THEMES[key]) return key;
  if (THEME_MIGRATION[key]) return THEME_MIGRATION[key];
  return DEFAULT_THEME_KEY;
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

export function applyThemeToRoot(themeKey) {
  if (typeof document === "undefined") return;

  const key = normalizeThemeKey(themeKey);
  const t = THEMES[key];

  const root = document.documentElement;
  root.dataset.theme = key;

  const vars = {
    "--rootBg": t.rootBg,
    "--sidebarBg": t.sidebarBg,
    "--border": t.border,
    "--divider": t.divider,
    "--surface": t.surface,
    "--surfaceHover": t.surfaceHover,
    "--deepBg": t.deepBg,
    "--text": t.text,
    "--textMuted": t.textMuted,
    "--textDim": t.textDim,
    "--accent": t.accent,
    "--accentBg": t.accentBg,
    "--inputBg": t.inputBg,
    "--topBarBg": t.topBarBg,
    "--cardBg": t.cardBg,
  };

  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
}