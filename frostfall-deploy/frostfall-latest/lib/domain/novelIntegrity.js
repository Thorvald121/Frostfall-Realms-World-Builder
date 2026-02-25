// lib/domain/novelIntegrity.js
//
// Scene/Novel Integrity (Truth Engine-ready)
// - Stable `type` fields
// - Domain-owned hard rule classification
// - Pure functions (no React dependencies)

function safeText(s) {
  return (typeof s === "string" ? s : "") || "";
}

function lower(s) {
  return safeText(s).toLowerCase();
}

/*
|--------------------------------------------------------------------------
| Truth Engine – Scene Hard Rule Registry
|--------------------------------------------------------------------------
| Scenes should gate only on true canon violations.
|--------------------------------------------------------------------------
*/

export const HARD_SCENE_TYPES = new Set([
  "broken_ref",
]);

export function isHardSceneIssue(w) {
  if (!w) return false;
  if (w.severity === "error") return true;
  if (HARD_SCENE_TYPES.has(w.type)) return true;
  return false;
}

/*
|--------------------------------------------------------------------------
| Mention Extraction Helpers
|--------------------------------------------------------------------------
*/

function extractMentionIds(body) {
  const text = safeText(body);

  const rich = (text.match(/@\[([^\]]+)\]\(([^)]+)\)/g) || [])
    .map((m) => {
      const match = m.match(/@\[([^\]]+)\]\(([^)]+)\)/);
      return match ? match[2] : null;
    })
    .filter(Boolean);

  const legacy = (text.match(/@(?!\[)([\w]+)/g) || []).map((m) => m.slice(1));

  return [...new Set([...rich, ...legacy])];
}

function buildArticleMaps(articles) {
  const byId = new Map();
  const byTitleLower = new Map();

  (Array.isArray(articles) ? articles : []).forEach((a) => {
    if (!a) return;
    if (a.id) byId.set(String(a.id), a);
    if (a.title) byTitleLower.set(lower(a.title), a);
  });

  return { byId, byTitleLower };
}

/*
|--------------------------------------------------------------------------
| Scene Integrity Evaluation
|--------------------------------------------------------------------------
*/

export function checkSceneIntegrity(sceneBody, articles) {
  const warnings = [];
  const body = safeText(sceneBody);

  const mentionIds = extractMentionIds(body);
  if (mentionIds.length === 0) return warnings;

  const { byId, byTitleLower } = buildArticleMaps(articles);

  function resolveMention(refId) {
    const exact = byId.get(String(refId));
    if (exact) return exact;

    const titleLike = byTitleLower.get(lower(refId));
    if (titleLike) return titleLike;

    return null;
  }

  /*
  |--------------------------------------------------------------------------
  | 1) Broken / Stale / Raw Mentions
  |--------------------------------------------------------------------------
  */

  mentionIds.forEach((refId) => {
    const art = resolveMention(refId);

    if (!art) {
      warnings.push({
        type: "broken_ref",
        severity: "error",
        message: `"${refId}" not found in codex.`,
        ref: refId,
        suggestion: "Create the referenced codex entry or correct the mention.",
      });
      return;
    }

    if (String(art.id) !== String(refId)) {
      warnings.push({
        type: "stale_ref",
        severity: "warning",
        message: `"${refId}" resolves to "${art.title}" — mention may be stale or mismatched.`,
        ref: refId,
        suggestion: `Replace with a rich mention @[${art.title}](${art.id}).`,
      });
    }

    const rawPattern = new RegExp(`(^|[^\\[])@${String(refId)}\\b`);
    if (rawPattern.test(body)) {
      warnings.push({
        type: "raw_mention",
        severity: "warning",
        message: `"@${refId}" is a raw mention — not linked to a codex entry.`,
        ref: refId,
        suggestion: `Use rich mentions like @[${art.title}](${art.id}) for reliable linking.`,
      });
    }
  });

  /*
  |--------------------------------------------------------------------------
  | 2) Temporal Cross-Checks (Informational Only)
  |--------------------------------------------------------------------------
  */

  const mentionedArts = mentionIds
    .map((id) => resolveMention(id))
    .filter(Boolean);

  const mortals = mentionedArts.filter(
    (a) => a?.temporal && a.temporal.death_year != null
  );

  const events = mentionedArts.filter(
    (a) => a?.temporal && a.temporal.active_start != null
  );

  mortals.forEach((mortal) => {
    const dy = Number(mortal.temporal.death_year);
    if (!Number.isFinite(dy)) return;

    events.forEach((event) => {
      const ey = Number(event.temporal.active_start);
      if (!Number.isFinite(ey)) return;

      if (dy < ey) {
        warnings.push({
          type: "temporal",
          severity: "info",
          dismissable: true,
          message: `"${mortal.title}" (died Year ${dy}) referenced alongside "${event.title}" (Year ${ey}).`,
          ref: `${mortal.id}::${event.id}`,
          suggestion:
            "If intentional (historical memory, legacy, narration), dismiss. Otherwise adjust scene references or timeline.",
        });
      }
    });
  });

  return warnings;
}