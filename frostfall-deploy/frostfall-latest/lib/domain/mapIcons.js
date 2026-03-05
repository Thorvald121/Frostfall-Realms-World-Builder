/**
 * MAP ICON LIBRARY — Fantasy Cartography SVGs
 * 24x24 viewBox, designed for map marker use at 16–32px
 */

// Each icon: { path, label, category }
// path is SVG path data within a 24x24 viewBox

export const MAP_ICONS = {
  // ── Settlements ──
  castle: {
    path: "M3 21V11h2V8h2V5h2V3h6v2h2v3h2v3h2v10H3zm4-2h2v-4h6v4h2v-8h-1V8h-1V6H9v2H8v3H7v8zm3-4h4v4h-4v-4zM7 13h2v2H7v-2zm8 0h2v2h-2v-2z",
    label: "Castle",
    category: "settlement",
  },
  city: {
    path: "M1 21V10l4-3v-3h4v2h2V3h6v3h2v4l4 3v11H1zm2-2h3v-4h2v4h2v-6h2v6h2v-4h2v4h3v-7l-3-2.25V7h-2V5h-4v3h-2V5H8v5L5 12.75V19zM10 10h4v2h-4v-2z",
    label: "City",
    category: "settlement",
  },
  town: {
    path: "M4 21V12l4-4 4 4 4-4 4 4v9H4zm2-2h4v-3h4v3h4v-5.5l-2-2-4 4-4-4-2 2V19zm5-5h2v2h-2v-2z",
    label: "Town",
    category: "settlement",
  },
  village: {
    path: "M5 21V13l7-6 7 6v8H5zm2-2h4v-4h2v4h4v-5l-5-4.3L7 14v5zm5-6a1 1 0 100 2 1 1 0 000-2z",
    label: "Village",
    category: "settlement",
  },
  ruins: {
    path: "M2 21v-2h2v-5h2V9h1V6h2v2h1V5h1v4h1V7h2v3h1V8h2v3h1v5h2v2h2v2H0v-2h2zm4-2h3v-4h1V9.5L9.5 8v7H8v4h-2v-2zm7 0h3v-2h-2v-4h-1.5V8l-.5 1.5V15h-1v4h2z",
    label: "Ruins",
    category: "settlement",
  },
  fort: {
    path: "M3 21V10h3V7h2V5h1V3h6v2h1v2h2v3h3v11H3zm2-2h2v-3h2v3h2v-5h2v5h2v-3h2v3h2v-7h-2V9h-1V7h-1V5H9v2H8v2H7v2H5v8zM5 8h2V6H5v2zm12 0h2V6h-2v2z",
    label: "Fort",
    category: "settlement",
  },

  // ── Terrain ──
  mountain: {
    path: "M12 3L2 21h20L12 3zm0 4.5L17.5 19h-11L12 7.5zM8.5 17l2-3.5 1.5 2 1.5-2 2 3.5h-7z",
    label: "Mountain",
    category: "terrain",
  },
  forest: {
    path: "M12 2l-5 7h2l-4 6h3l-4 7h16l-4-7h3l-4-6h2L12 2zm0 3.2L14.8 9h-1.6l3 4.5h-2.1L17 18H7l2.9-4.5H7.8l3-4.5H9.2L12 5.2z",
    label: "Forest",
    category: "terrain",
  },
  lake: {
    path: "M12 4C7.6 4 4 7.6 4 12s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8zm0 14c-3.3 0-6-2.7-6-6s2.7-6 6-6 6 2.7 6 6-2.7 6-6 6zm-3-7c.8-.8 1.8-1 3-1s2.2.2 3 1c.5.5.5 1.3 0 1.8s-1.3.5-1.8 0c-.3-.3-.7-.5-1.2-.5s-.9.2-1.2.5c-.5.5-1.3.5-1.8 0s-.5-1.3 0-1.8z",
    label: "Lake",
    category: "terrain",
  },
  cave: {
    path: "M4 20c0-6 3-10 8-14 5 4 8 8 8 14H4zm3.2-2h9.6c-.6-3.5-2.8-6.5-4.8-8.8-2 2.3-4.2 5.3-4.8 8.8zM10 17a2 2 0 014 0v1h-4v-1z",
    label: "Cave",
    category: "terrain",
  },
  volcano: {
    path: "M12 2l-2 4h4l-2-4zM9 8L2 21h20L15 8H9zm0 2.5h6L19 19H5l4-8.5zM10 16h4l-2-4-2 4z",
    label: "Volcano",
    category: "terrain",
  },
  desert: {
    path: "M2 18c2-3 4-5 7-5s4 1.5 6 1.5 4-2 7-5v4c-2 2-4 4-7 4s-4-1.5-6-1.5-4 2.5-7 5v-3zm0-6c2-3 4-5 7-5s4 1.5 6 1.5 4-2 7-5v4c-2 2-4 4-7 4s-4-1.5-6-1.5-4 2.5-7 5V12z",
    label: "Desert",
    category: "terrain",
  },
  swamp: {
    path: "M6 17c1-2 3-3 6-3s5 1 6 3M3 21c2-3 5-5 9-5s7 2 9 5H3zM11 4a2 2 0 104 0 2 2 0 00-4 0zM7 8v3m5-6v4m5-2v3",
    label: "Swamp",
    category: "terrain",
    stroke: true,
  },

  // ── Points of Interest ──
  temple: {
    path: "M12 2l-1 3H5l-1 2h16l-1-2h-6l-1-3zM6 9v2h1v8H5v2h14v-2h-2v-8h1V9H6zm3 2h2v8H9v-8zm4 0h2v8h-2v-8z",
    label: "Temple",
    category: "poi",
  },
  tavern: {
    path: "M7 3v5c0 2.2 1.8 4 4 4h.5v6H9v2h6v-2h-2.5v-6H13c2.2 0 4-1.8 4-4V3H7zm2 2h6v3c0 1.1-.9 2-2 2h-2c-1.1 0-2-.9-2-2V5zm8 0h2v3c0 .5-.2 1-.5 1.4L17 8V5z",
    label: "Tavern",
    category: "poi",
  },
  port: {
    path: "M3 18c2 2 4 3 7 3h4c3 0 5-1 7-3M12 3v10M8 7l4-4 4 4M6 13h12",
    label: "Port",
    category: "poi",
    stroke: true,
  },
  mine: {
    path: "M12 2L6 8l1.5 1.5L12 5l4.5 4.5L18 8l-6-6zM4 12l2 2 4-4-2-2-4 4zm10-2l4 4 2-2-4-4-2 2zM8 16l-4 4v2h4l4-4-2-2-2 2zm6-2l2 2 4 4v-2l-4-4-2 2z",
    label: "Mine",
    category: "poi",
  },
  battlefield: {
    path: "M6 3l-2 8h4V3H6zm10 0v8h4l-2-8h-2zM5 13l-3 8h6l1-4h6l1 4h6l-3-8H5zm3.5 2h7l.5 2H8l.5-2z",
    label: "Battlefield",
    category: "poi",
  },
  tower: {
    path: "M10 3h4v2h-4V3zM9 7h6V5.5H9V7zM8 9v10h2v-5h4v5h2V9H8zm1 2h6v2H9v-2zM7 21v-2h10v2H7z",
    label: "Tower",
    category: "poi",
  },
  bridge: {
    path: "M2 16h20v2H2v-2zM3 12c2-3 4-5 6-5h6c2 0 4 2 6 5H3zm4-1c1-1.5 2.5-2.5 4-2.5h2c1.5 0 3 1 4 2.5H7zM4 7v2m16-2v2M8 5v2m8-2v2",
    label: "Bridge",
    category: "poi",
    stroke: true,
  },
  camp: {
    path: "M12 3L4 15h16L12 3zm0 4l4.5 6h-9L12 7zM2 17h20v2H2v-2z",
    label: "Camp",
    category: "poi",
  },

  // ── Other ──
  graveyard: {
    path: "M10 4h4v2h2v2h-2v6h3v2H7v-2h3V8H8V6h2V4zm1 2v8h2V6h-2zM4 18h16v2H4v-2z",
    label: "Graveyard",
    category: "other",
  },
  lighthouse: {
    path: "M11 2h2v2h-2V2zM10 6h4l1 10H9l1-10zm1.5 2l-.7 6h2.4l-.7-6h-1zM7 18h10v2H7v-2zM5 21h14v1H5v-1z",
    label: "Lighthouse",
    category: "other",
  },
  dragon_lair: {
    path: "M12 3c-2 0-3.5 1-4.5 2.5S6 8 6 10c0 1.5.5 3 1.5 4L6 16l2 1 1-1.5c1 .5 2 .8 3 .8s2-.3 3-.8L16 17l2-1-1.5-2c1-1 1.5-2.5 1.5-4 0-2-.5-3.5-1.5-4.5S14 3 12 3zm-2 5a1 1 0 112 0 1 1 0 01-2 0zm3 0a1 1 0 112 0 1 1 0 01-2 0zm-2 3l1 2 1-2h-2zM4 19c2 0 4 1 8 1s6-1 8-1v2c-3 0-5 1-8 1s-5-1-8-1v-2z",
    label: "Dragon Lair",
    category: "other",
  },
  waypoint: {
    path: "M12 2a7 7 0 00-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 00-7-7zm0 10a3 3 0 110-6 3 3 0 010 6z",
    label: "Waypoint",
    category: "other",
  },
  treasure: {
    path: "M5 10h14v2H5v-2zM6 8c0-1.7 2.7-3 6-3s6 1.3 6 3H6zm-1 6h14v4c0 1-1 2-2 2H7c-1 0-2-1-2-2v-4zm3 1v2h2v-2H8zm3 0v2h2v-2h-2zm3 0v2h2v-2h-2z",
    label: "Treasure",
    category: "other",
  },
};

// Icon categories for grouped picker
export const ICON_CATEGORIES = [
  { key: "settlement", label: "Settlements", icons: ["castle", "city", "town", "village", "ruins", "fort"] },
  { key: "terrain", label: "Terrain", icons: ["mountain", "forest", "lake", "cave", "volcano", "desert", "swamp"] },
  { key: "poi", label: "Points of Interest", icons: ["temple", "tavern", "port", "mine", "battlefield", "tower", "bridge", "camp"] },
  { key: "other", label: "Other", icons: ["graveyard", "lighthouse", "dragon_lair", "waypoint", "treasure"] },
];

// Default map data for a new map
export const createNewMap = (name = "New Map") => ({
  id: "map_" + Date.now(),
  name,
  image: null,
  imageW: 0,
  imageH: 0,
  pins: [],
  territories: [],
  routes: [],
  labels: [],
  fogAreas: [],
  gridSettings: { type: "none", size: 50, opacity: 0.2, color: "#ffffff" },
  scaleSettings: { pixelsPerUnit: 100, unitName: "miles", unitDistance: 50 },
  layerVisibility: { pins: true, territories: true, labels: true, routes: true, grid: false, fog: false, legend: true },
});

// Migrate old single-map format to multi-map
export const migrateMapData = (oldData) => {
  if (!oldData) return [];
  // Already new format (array)
  if (Array.isArray(oldData)) return oldData;
  // Old format: { image, imageW, imageH, pins, territories }
  if (oldData.image || oldData.pins?.length || oldData.territories?.length) {
    return [{
      ...createNewMap("World Map"),
      id: "map_migrated",
      image: oldData.image,
      imageW: oldData.imageW || 0,
      imageH: oldData.imageH || 0,
      pins: (oldData.pins || []).map((p) => ({ ...p, icon: p.icon || "waypoint", iconSize: p.iconSize || 24, description: p.description || "" })),
      territories: (oldData.territories || []).map((t) => ({ ...t, opacity: t.opacity || 0.15, description: t.description || "" })),
    }];
  }
  return [];
};

// Render an SVG icon inline
export const MapIcon = ({ icon, size = 24, color = "#f0c040", className = "" }) => {
  const def = MAP_ICONS[icon];
  if (!def) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={def.stroke ? "none" : color} stroke={def.stroke ? color : "none"} strokeWidth={def.stroke ? 2 : 0} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ flexShrink: 0 }}>
      <path d={def.path} />
    </svg>
  );
};