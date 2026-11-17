/**
 * Color contrast and palette helpers for Frostfall Studio.
 * WCAG 2.x contrast calculations are deterministic and browser-independent.
 */
export function parseHex(value) {
  const match = /^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.exec(String(value || ""));
  if (!match) throw new Error(`Expected hexadecimal color; got ${value}`);
  let hex = match[1];
  if (hex.length === 3) hex = [...hex].map((ch) => ch + ch).join("");
  return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
}

export function toHex(rgb) {
  return `#${rgb.map((v) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;
}

const channel = (s) => {
  const c = s / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export function luminance(color) {
  const [r, g, b] = Array.isArray(color) ? color : parseHex(color);
  return channel(r) * 0.2126 + channel(g) * 0.7152 + channel(b) * 0.0722;
}

export function contrastRatio(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function mix(first, second, t) {
  const a = parseHex(first), b = parseHex(second);
  return toHex(a.map((v, i) => v * (1 - t) + b[i] * t));
}

/** Return the nearest contrasting color (same base hue where possible). */
export function ensureContrast(foreground, backgrounds, target = 5) {
  const bases = (Array.isArray(backgrounds) ? backgrounds : [backgrounds]).filter(Boolean);
  if (!bases.length) return foreground;
  const ratio = (color) => Math.min(...bases.map((bg) => contrastRatio(color, bg)));
  if (ratio(foreground) >= target) return foreground;
  // Highest possible contrast direction for the darkest/brightest background.
  const darkScore = Math.min(...bases.map((bg) => contrastRatio("#080a10", bg)));
  const lightScore = Math.min(...bases.map((bg) => contrastRatio("#ffffff", bg)));
  const targetColor = darkScore > lightScore ? "#080a10" : "#ffffff";
  // If the backgrounds span wildly different lightness values, one-color
  // foreground might be impossible. No app theme currently has this issue.
  let lo = 0, hi = 1;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (ratio(mix(foreground, targetColor, mid)) >= target) hi = mid;
    else lo = mid;
  }
  return mix(foreground, targetColor, hi);
}

export function themeSurfaces(theme) {
  const stops = String(theme.sidebarBg || "").match(/#[0-9a-f]{6}(?:[0-9a-f]{2})?/gi) || [];
  return stops.length ? stops : [theme.deepBg || theme.surface];
}


/** Accessible text color on a solid action surface (e.g., theme accent buttons). */
export function readableOn(background) {
  return contrastRatio("#10151d", background) >= contrastRatio("#ffffff", background)
    ? "#10151d" : "#ffffff";
}
