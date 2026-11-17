import { ensureContrast, themeSurfaces } from "./contrast.js";

/** Identity colors stay fixed between worlds and across theme changes.
 * All visible labels and icons are contrast-adjusted to the active sidebar.
 * Different entries intentionally have different hues, rather than sharing
 * one global accent (the active indicator does not erase identity).
 */
export const NAV_COLOR_IDS = Object.freeze({
  dashboard: "#f2bc58", world_home: "#74cdfa", codex: "#c2acff",
  atlas: "#73b8f1", expand_categories: "#b7b0e8",
  deity: "#eac568", race: "#83dfba", character: "#ff94be",
  event: "#ffa576", location: "#86baff", organization: "#b8a2e9",
  item: "#f5d882", magic: "#cc97fa", language: "#68dfd5",
  flora_fauna: "#a5e28d", laws_customs: "#ffaba3",
  timeline: "#6dd6f3", graph: "#daa1ec", cross_refs: "#78d7a9",
  family_tree: "#c3e480", novel: "#ffad82", generator: "#bca8ff",
  sessions: "#8cdbd0", integrity: "#ff928b", canon_studio: "#93d1ff", archives: "#b5bfdd",
  ai_import: "#8ac0ff", staging: "#ebc77c", settings: "#a6c3d6",
  scratchpad: "#f0aaac", collaboration: "#93e0c1", support_page: "#a1b0f4",
  donate: "#ffa1ca", admin: "#e9a4f3",
});

const paletteCache = new WeakMap();

export function navTone(theme, id) {
  // No repeated contrast searches during frequent manuscript-editor renders.
  let colors = paletteCache.get(theme);
  if (!colors) { colors = new Map(); paletteCache.set(theme, colors); }
  if (!colors.has(id)) {
    const base = NAV_COLOR_IDS[id] || "#8ed2ff";
    colors.set(id, ensureContrast(base, themeSurfaces(theme), 5));
  }
  return colors.get(id);
}
