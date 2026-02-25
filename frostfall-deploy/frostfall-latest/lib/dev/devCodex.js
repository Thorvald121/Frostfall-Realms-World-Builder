// lib/dev/devCodex.js
//
// Dev-only codex persistence that resets on every `pnpm dev` restart.
// Uses /api/dev-run which changes each server boot.

export function isDev() {
  return process.env.NODE_ENV === "development";
}

function safeParseArray(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function fetchDevRunId() {
  if (!isDev()) return "prod";
  try {
    const res = await fetch("/api/dev-run", { cache: "no-store" });
    const json = await res.json();
    const runId = String(json?.startedAt || "");
    return runId || "dev";
  } catch {
    return "dev";
  }
}

export function makeDevKey(runId) {
  return `frostfall_dev_codex_run_${runId}`;
}

export async function loadSeedCodex() {
  const mod = await import("./seedCodex.local");
  const seed = mod?.DEV_SEED_ARTICLES;
  return Array.isArray(seed) ? seed : [];
}

export async function initDevCodex() {
  const runId = await fetchDevRunId();
  const key = makeDevKey(runId);

  // Try load working copy for THIS dev run
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? safeParseArray(raw) : null;
    if (parsed && parsed.length) {
      return { runId, key, articles: parsed, source: "storage" };
    }
  } catch {}

  // Otherwise seed fresh for THIS run
  const seed = await loadSeedCodex();
  try {
    localStorage.setItem(key, JSON.stringify(seed));
  } catch {}

  return { runId, key, articles: seed, source: "seed" };
}

export function saveDevCodex(key, articles) {
  if (!isDev()) return;
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(Array.isArray(articles) ? articles : []));
  } catch {}
}

export async function resetDevCodex(key) {
  const seed = await loadSeedCodex();
  try {
    if (key) localStorage.setItem(key, JSON.stringify(seed));
  } catch {}
  return seed;
}