// lib/domain/integrity.js
//
// Frostfall Realms — Truth Engine (Domain Layer)
// Phase A2: Graph Injection Optimization
// Phase B: Temporal propagation (multi-hop inference) + draft-safe evaluation
//
// Key guarantees:
// - Pure + deterministic (no React, no side effects)
// - Backward compatible call signature
// - Fuzzy matches ALWAYS return: [{ article, score }]
//
// Preferred signature (A2):
//   checkArticleIntegrity(article, allArticles, graph)
// Optional legacy arg (compat):
//   checkArticleIntegrity(article, allArticles, graph, excludeId)
// Older callsites that used excludeId as 3rd arg are still supported.

import {
  buildTemporalGraph,
  extractMentionIds,
  isImpossibleReference,
  propagateTemporalImpossibilities,
} from "./truth/temporalGraph";

// --- Hard gating registry (centralized) ---
export const HARD_INTEGRITY_TYPES = new Set([
  "broken_ref",
  "contradiction",
  // NOTE: temporal_impossible is intentionally NOT hard-gated yet.
  // Phase D (Canon Enforcement Mode) will decide gating by mode.
]);

export function isHardIntegrityIssue(w) {
  if (!w || typeof w !== "object") return false;
  return HARD_INTEGRITY_TYPES.has(w.type);
}

// --- Utilities ---
function lower(s) {
  return String(s || "").toLowerCase();
}

function formatKey(k) {
  const label = FIELD_LABELS[k];
  if (label) return label;
  return String(k || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function titleForId(id, entityMap) {
  const a = entityMap?.[id];
  return a?.title || id;
}

function toIntOrNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function getTemporalSourceYear(dataTemporal) {
  const t = dataTemporal || {};
  return toIntOrNull(t.active_start ?? t.year);
}

function getTemporalTargetEndYear(targetTemporal) {
  const tt = targetTemporal || {};
  return toIntOrNull(tt.death_year ?? tt.active_end);
}

// Fuzzy match a broken ref ID against all existing articles — returns scored suggestions
// Shape MUST remain: [{ article, score }]
export function findFuzzyMatches(brokenRefId, articles, limit = 5) {
  const broken = lower(brokenRefId).replace(/_/g, " ");
  const brokenWords = broken.split(/[\s_]+/).filter((w) => w.length >= 3);
  const results = [];

  (articles || []).forEach((a) => {
    if (!a) return;

    let score = 0;
    const titleLower = lower(a.title);
    const idLower = lower(a.id).replace(/_/g, " ");

    // ID / title substring matches
    if (idLower.includes(broken)) score += 50;
    else if (broken.includes(idLower)) score += 40;

    if (titleLower.includes(broken)) score += 45;
    else if (broken.includes(titleLower)) score += 35;

    // Word overlap scoring
    const titleWords = titleLower.split(/[\s_\-]+/).filter((w) => w.length >= 3);
    for (const bw of brokenWords) {
      for (const tw of titleWords) {
        if (tw === bw) score += 20;
        else if (tw.startsWith(bw) || bw.startsWith(tw)) score += 12;
        else if (tw.includes(bw) || bw.includes(tw)) score += 8;
      }
    }

    // First-word boost
    if (
      brokenWords[0] &&
      titleWords[0] &&
      (titleWords[0].startsWith(brokenWords[0]) ||
        brokenWords[0].startsWith(titleWords[0]))
    ) {
      score += 15;
    }

    if (score > 5) results.push({ article: a, score });
  });

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// Extract rich mentions @[Title](id) + legacy @id with raw mention strings (for UI fixers)
function extractMentionsWithRaw(body) {
  const text = String(body || "");

  const rich = (text.match(/@\[([^\]]+)\]\(([^)]+)\)/g) || [])
    .map((m) => {
      const match = m.match(/@\[([^\]]+)\]\(([^)]+)\)/);
      if (!match) return null;
      return { id: match[2], title: match[1], rawMention: m, isRich: true };
    })
    .filter(Boolean);

  const legacy = (text.match(/@(?!\[)([\w]+)/g) || [])
    .filter((m) => !m.match(/@\[/))
    .map((m) => ({ id: m.slice(1), rawMention: m, isRich: false }));

  return { rich, legacy };
}

/**
 * Draft-safe propagation:
 * Treat the draft as a virtual root that has outgoing edges equal to its mentionIds.
 * Then traverse the real graph from those targets to find impossible edges downstream.
 *
 * Returns findings shaped similarly to propagateTemporalImpossibilities but with a path
 * that starts at a virtual label (draftTitle).
 */
function propagateFromDraft(draftTitle, draftMentionIds, graph, opts = {}) {
  const g = graph || null;
  if (!g || !g.nodes || !g.edges) return [];

  const maxDepth = Number.isFinite(opts.maxDepth) ? Math.max(1, Math.trunc(opts.maxDepth)) : 3;

  // Root is virtual; we BFS starting from the draft's mentioned ids.
  const start = Array.isArray(draftMentionIds) ? draftMentionIds.filter(Boolean) : [];
  const starts = start.slice().sort((a, b) => String(a).localeCompare(String(b)));

  // parent map for path reconstruction inside graph (node -> parent node)
  const parent = Object.create(null);
  const depth = Object.create(null);
  const visited = new Set();

  const queue = [];

  for (const s of starts) {
    if (!s) continue;
    if (visited.has(s)) continue;
    visited.add(s);
    parent[s] = null; // directly from virtual root
    depth[s] = 1; // draft -> s is hop 1
    queue.push(s);
  }

  const findings = [];
  const seenEdge = new Set(); // `${from}=>${to}`

  while (queue.length) {
    const u = queue.shift();
    const du = depth[u] ?? 1;
    if (du >= maxDepth) continue;

    const neighbors = (g.edges[u] || []).slice().sort((a, b) => String(a).localeCompare(String(b)));

    for (const v of neighbors) {
      if (!v) continue;

      if (!visited.has(v)) {
        visited.add(v);
        parent[v] = u;
        depth[v] = du + 1;
        queue.push(v);
      }

      if (g.nodes[u] && g.nodes[v]) {
        if (isImpossibleReference(u, v, g)) {
          const edgeKey = `${u}=>${v}`;
          if (!seenEdge.has(edgeKey)) {
            seenEdge.add(edgeKey);

            // Reconstruct path: [DRAFT] -> ... -> u -> v
            const chain = [];
            let cur = u;
            while (cur) {
              chain.push(cur);
              cur = parent[cur];
            }
            chain.reverse();

            // chain currently starts at a graph node that is directly from draft
            const path = [draftTitle, ...chain, v];

            findings.push({
              sourceId: null,
              fromId: u,
              toId: v,
              path,
              depth: (depth[u] ?? 1) + 1,
            });
          }
        }
      }
    }
  }

  findings.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    const af = String(a.fromId).localeCompare(String(b.fromId));
    if (af !== 0) return af;
    return String(a.toId).localeCompare(String(b.toId));
  });

  return findings;
}

/**
 * Check a single article or form data against all existing articles for integrity violations.
 *
 * Preferred (A2):
 *   checkArticleIntegrity(data, articles, graph)
 *
 * Back-compat:
 *   checkArticleIntegrity(data, articles, excludeId)
 *   checkArticleIntegrity(data, articles, graph, excludeId)
 */
export function checkArticleIntegrity(data, articles, graphOrExclude = null, maybeExclude = null) {
  const warnings = [];
  const list = Array.isArray(articles) ? articles : [];

  // --- Backward compatible arg decode ---
  let graph = null;
  let excludeId = null;

  if (
    graphOrExclude &&
    typeof graphOrExclude === "object" &&
    (graphOrExclude.nodes || graphOrExclude.edges || graphOrExclude.index)
  ) {
    graph = graphOrExclude;
    excludeId = maybeExclude ?? null;
  } else {
    graph = null;
    excludeId = graphOrExclude ?? null;
  }

  const entityMap = Object.create(null);
  for (const a of list) {
    if (a && a.id) entityMap[a.id] = a;
  }

  const temporal = data?.temporal || null;
  const body = String(data?.body || "");
  const fields = data?.fields && typeof data.fields === "object" ? data.fields : {};

  // --- Mentions (rich + legacy) ---
  const { rich, legacy } = extractMentionsWithRaw(body);

  const legacyFiltered = legacy.filter((ref) => {
    const id = ref?.id;
    if (!id) return false;
    if (id.length < 4) return false;
    return true;
  });

  const allRefs = [
    ...rich.map((r) => ({ id: r.id, rawMention: r.rawMention, isRich: r.isRich })),
    ...legacyFiltered,
  ];

  // --- Graph (A2): use injected graph if provided, else build internally (A1 compat) ---
  const temporalGraph = graph || buildTemporalGraph(list);

  // 1) Broken references
  for (const ref of allRefs) {
    if (!ref?.id) continue;
    if (excludeId && ref.id === excludeId) continue;

    if (!entityMap[ref.id]) {
      const readableName = ref.id
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

      const fuzzyMatches = findFuzzyMatches(
        ref.id,
        list.filter((a) => a?.id && a.id !== excludeId)
      );

      warnings.push({
        type: "broken_ref",
        severity: "warning",
        message: `References "${readableName}" which doesn't exist in the codex.`,
        suggestion:
          fuzzyMatches.length > 0
            ? "Did you mean one of these? Click to fix:"
            : "Create the referenced article, or remove the @mention if unintended.",
        refId: ref.id,
        rawMention: ref.rawMention,
        fuzzyMatches,
      });
    }
  }

  // 2) Temporal impossibility + propagation
  const sourceId = data?.id || excludeId || null;
  const sourceYearDraft = getTemporalSourceYear(temporal);
  const mentionIds = extractMentionIds(body) || [];

  // 2a) Direct temporal impossibility
  if (sourceId) {
    // Normal mode: source exists as a node in the graph
    for (const targetId of mentionIds) {
      if (!targetId) continue;
      if (excludeId && targetId === excludeId) continue;
      if (!entityMap[targetId]) continue;

      if (isImpossibleReference(sourceId, targetId, temporalGraph)) {
        const target = entityMap[targetId];
        warnings.push({
          type: "temporal_impossible",
          severity: "warning",
          refId: targetId,
          message: `⛓️ Timeline impossibility: this entry cannot reference "${target?.title || targetId}" in the configured chronology.`,
          suggestion:
            "Adjust dates (birth/death/active years), or remove/replace the reference if unintended.",
        });
      }
    }

    // Propagation from a real source node
    const propagated = propagateTemporalImpossibilities(sourceId, temporalGraph, { maxDepth: 3 });

    const directImpossibleTargets = new Set(
      warnings
        .filter((w) => w?.type === "temporal_impossible" && w?.refId)
        .map((w) => w.refId)
    );

    for (const f of propagated) {
      if (f.fromId === sourceId && directImpossibleTargets.has(f.toId)) continue;

      const pathIds = Array.isArray(f.path) ? f.path : [];
      const hasMissing = pathIds.some((pid) => !entityMap[pid]);
      if (hasMissing) continue;

      const chainTitles = pathIds.map((pid) => titleForId(pid, entityMap));
      const chainLabel = chainTitles.join(" → ");

      warnings.push({
        type: "temporal_propagated",
        severity: "info",
        dismissable: true,
        refId: f.toId,
        fromId: f.fromId,
        toId: f.toId,
        path: f.path,
        message: `🕸️ Downstream timeline impossibility via: ${chainLabel}`,
        suggestion: `The impossible edge is "${titleForId(f.fromId, entityMap)}" → "${titleForId(
          f.toId,
          entityMap
        )}". Fix dates or references in the downstream entry to restore consistency.`,
      });
    }
  } else {
    // Draft mode: check if draft ended before any referenced entity began
    const draftEnd = getTemporalTargetEndYear(temporal); // reuse: gets death_year or active_end
    if (draftEnd !== null) {
      for (const targetId of mentionIds) {
        if (!targetId) continue;
        if (!entityMap[targetId]) continue;

        const target = entityMap[targetId];
        const tt = target?.temporal || {};
        if (tt?.type === "concept") continue;

        const targetStart = toIntOrNull(tt?.active_start ?? tt?.year);
        if (targetStart === null) continue;

        // Impossible: draft ended before target even began
        if (draftEnd < targetStart) {
          warnings.push({
            type: "temporal_impossible",
            severity: "warning",
            refId: targetId,
            message: `⛓️ Timeline impossibility: this draft (ending Year ${draftEnd}) references "${target?.title || targetId}" which begins in Year ${targetStart}.`,
            suggestion:
              "The referenced entity didn't exist yet during this entry's timeframe. Adjust dates or remove the reference.",
          });
        }
      }
    }

    // Draft propagation: treat draft as virtual root
    const draftTitle = data?.title ? `Draft: ${String(data.title)}` : "Draft Entry";
    const propagatedDraft = propagateFromDraft(draftTitle, mentionIds, temporalGraph, { maxDepth: 3 });

    for (const f of propagatedDraft) {
      // f.path begins with a string label, then ids. Only surface if ids exist.
      const idsOnly = (Array.isArray(f.path) ? f.path.slice(1) : []).filter(Boolean);
      const hasMissing = idsOnly.some((pid) => !entityMap[pid]);
      if (hasMissing) continue;

      const chainTitles = idsOnly.map((pid) => titleForId(pid, entityMap));
      const chainLabel = `${draftTitle} → ${chainTitles.join(" → ")}`;

      warnings.push({
        type: "temporal_propagated",
        severity: "info",
        dismissable: true,
        refId: f.toId,
        fromId: f.fromId,
        toId: f.toId,
        path: f.path,
        message: `🕸️ Downstream timeline impossibility via: ${chainLabel}`,
        suggestion: `The impossible edge is "${titleForId(f.fromId, entityMap)}" → "${titleForId(
          f.toId,
          entityMap
        )}". Fix dates or references in the downstream entry to restore consistency.`,
      });
    }
  }

  // 3) Temporal context notes (storytelling-safe, dismissable info)
  if (temporal && temporal.active_start != null) {
    for (const ref of allRefs) {
      const target = entityMap[ref.id];
      if (!target?.temporal || target.temporal.type === "concept") continue;

      const tt = target.temporal;

      // immortal w/ no end is always fine
      if (tt.type === "immortal" && !tt.active_end) continue;

      if (tt.active_end != null && temporal.active_start > tt.active_end) {
        const discrepancy = temporal.active_start - tt.active_end;
        warnings.push({
          type: "temporal",
          severity: "info",
          refId: ref.id,
          dismissable: true,
          message: `📅 "${target.title}" ended in Year ${tt.active_end} — ${discrepancy} year${
            discrepancy !== 1 ? "s" : ""
          } before this entry (Year ${temporal.active_start}).`,
          suggestion:
            "Timeline note: this is a historical reference in your text. Dismiss if intentional.",
        });
      }

      if (tt.death_year && temporal.active_start > tt.death_year) {
        const deathGap = temporal.active_start - tt.death_year;
        warnings.push({
          type: "temporal",
          severity: "info",
          refId: ref.id,
          dismissable: true,
          message: `📅 "${target.title}" died in Year ${tt.death_year} (${deathGap} year${
            deathGap !== 1 ? "s" : ""
          } before this entry).`,
          suggestion:
            "Timeline note: likely a posthumous or historical mention. Dismiss if intentional.",
        });
      }
    }
  }

  // 4) Orphan detection — article references nothing and nothing references it
  if (body.length > 100 && allRefs.length === 0) {
    const thisId = data?.id || excludeId || "";
    const referencedByOthers =
      thisId &&
      list.some((a) => a?.id !== excludeId && String(a?.body || "").includes("@" + thisId));

    if (!referencedByOthers && list.length > 3) {
      warnings.push({
        type: "orphan",
        severity: "info",
        message: "This entry has no cross-references and isn't referenced by other entries.",
        suggestion: "Consider adding @mentions to connect it with related entries.",
      });
    }
  }

  // 5) Missing key fields for category
  const cat = data?.category;
  const requiredFields = {
    deity: ["domain"],
    race: ["lifespan", "homeland"],
    character: ["char_race"],
    event: ["date_range"],
    location: ["region"],
    organization: ["type", "purpose"],
    language: ["speakers"],
    magic: ["type"],
    item: ["type"],
  };

  if (requiredFields[cat]) {
    for (const f of requiredFields[cat]) {
      if (!fields[f] || !String(fields[f]).trim()) {
        warnings.push({
          type: "missing_field",
          severity: "info",
          message: `"${formatKey(f)}" is empty — this field helps with cross-referencing and integrity checks.`,
          suggestion: "Fill in this field for better codex integration.",
        });
      }
    }
  }

  // 6) Contradicting facts — same unique role in same region with overlapping time
  if (fields.titles || fields.role) {
    const roleText = String(fields.titles || "") + " " + String(fields.role || "");
    const uniqueRoles = ["king", "queen", "emperor", "empress", "high priest", "archmage", "chieftain", "ruler"];

    for (const role of uniqueRoles) {
      if (!lower(roleText).includes(role)) continue;

      const region = fields.region || fields.affiliations || fields.homeland || "";
      if (!region) continue;

      for (const other of list) {
        if (!other || other.id === excludeId) continue;
        if (other.category !== data?.category) continue;

        const otherRoles = lower(String(other.fields?.titles || "") + " " + String(other.fields?.role || ""));
        const otherRegion = other.fields?.region || other.fields?.affiliations || other.fields?.homeland || "";

        if (!otherRoles.includes(role)) continue;
        if (!otherRegion) continue;
        if (lower(region) !== lower(otherRegion)) continue;

        const ot = other.temporal;
        if (temporal && ot && temporal.active_start != null && ot.active_start != null) {
          const overlap =
            !(temporal.active_end != null && temporal.active_end < ot.active_start) &&
            !(ot.active_end != null && ot.active_end < temporal.active_start);

          if (overlap) {
            warnings.push({
              type: "contradiction",
              severity: "warning",
              message: `Both this entry and "${other.title}" claim the role of ${role} in ${region} during overlapping time periods.`,
              suggestion: "Verify that these roles don't conflict, or adjust time periods.",
            });
          }
        }
      }
    }
  }

  return warnings;
}

// --- Field labels (domain-only convenience) ---
const FIELD_LABELS = {
  domain: "Domain",
  symbol: "Holy Symbol",
  court: "Divine Court",
  sacred_time: "Sacred Time",
  worshippers: "Worshippers",
  gift_to_mortals: "Gift to Mortals",
  creators: "Creator Gods",
  lifespan: "Lifespan",
  population: "Population",
  magic_affinity: "Magic Affinity",
  homeland: "Homeland",
  capital: "Capital",
  major_clans: "Major Clans",
  defining_trait: "Defining Trait",
  date_range: "Date Range",
  age: "Age / Era",
  casualties: "Casualties",
  key_figures: "Key Figures",
  outcome: "Outcome",
  type: "Type",
  origin: "Origin",
  scope: "Scope",
  cost_types: "Cost Types",
  violation_consequence: "Violation Consequence",
  counterpart: "Counterpart",
  current_state: "Current State",
  legacy: "Legacy",
  current_age: "Current Age",
  notable_regions: "Notable Regions",
  physical_characteristics: "Physical Characteristics",
  // Character fields
  char_race: "Race",
  birth_year: "Birth Year",
  death_year: "Death Year",
  titles: "Titles",
  affiliations: "Affiliations",
  role: "Role",
  // Location fields
  region: "Region",
  ruler: "Ruler",
  founding_year: "Founded",
  notable_features: "Notable Features",
  status: "Status",
  // Organization fields
  founded: "Founded",
  leader: "Leader",
  headquarters: "Headquarters",
  purpose: "Purpose",
  members: "Key Members",
  // Item fields
  creator: "Creator",
  current_location: "Current Location",
  power: "Power / Ability",
  history: "History",
};

// --- Cross-article temporal conflict detection ---
// Scans ALL articles pairwise for temporal impossibilities in mentions and key_figures.
// Returns conflicts shaped for the IntegrityPanel "Temporal Conflicts" section.
export function detectConflicts(articles) {
  const conflicts = [];
  const entityMap = Object.create(null);
  (articles || []).forEach((a) => { if (a?.id) entityMap[a.id] = a; });

  (articles || []).forEach((source) => {
    const st = source?.temporal;
    if (!st || st.active_start == null) return;

    // Extract mentions from body
    const mentionIds = extractMentionIds(source?.body || "");

    mentionIds.forEach((refId) => {
      const target = entityMap[refId];
      if (!target?.temporal) return;
      const tt = target.temporal;
      if (tt.type === "concept") return;
      if (tt.type === "immortal" && !tt.active_end && !tt.faded) return;

      if (tt.active_end != null && st.active_start > tt.active_end) {
        conflicts.push({
          id: source.id + "->" + refId + "-post",
          type: "temporal",
          severity: "info",
          dismissable: true,
          sourceId: source.id,
          sourceTitle: source.title,
          targetId: refId,
          targetTitle: target.title,
          message:
            target.title +
            ' is referenced in "' +
            source.title +
            '" (Year ' +
            st.active_start +
            "+) but " +
            (tt.death_year
              ? "died in Year " + tt.death_year
              : "ceased to be active after Year " + tt.active_end) +
            ".",
          suggestion: tt.death_year
            ? target.title +
              " died ~" +
              (st.active_start - tt.death_year) +
              " years before this event. Consider removing or noting it as legacy/memory."
            : target.title + " was no longer active by this time period.",
        });
      }
    });

    // Key Figures cross-check
    const kf = source?.fields?.key_figures || "";
    if (kf && st.active_start != null) {
      (articles || []).forEach((target) => {
        if (!target?.temporal || target.id === source.id) return;
        const tt = target.temporal;
        if (tt.death_year && st.active_start > tt.death_year) {
          const words = lower(target.title).split(/\s+/);
          const kfL = lower(kf);
          const match = words.some((w) => w.length > 3 && kfL.includes(w));
          if (match && !conflicts.find((c) => c.sourceId === source.id && c.targetId === target.id)) {
            conflicts.push({
              id: source.id + "->" + target.id + "-kf",
              type: "temporal",
              severity: "info",
              dismissable: true,
              sourceId: source.id,
              sourceTitle: source.title,
              targetId: target.id,
              targetTitle: target.title,
              message:
                '"' +
                source.title +
                '" lists a figure matching "' +
                target.title +
                '" in Key Figures, but they died in Year ' +
                tt.death_year +
                " — " +
                (st.active_start - tt.death_year) +
                " years before.",
              suggestion: "Verify if this is the same person or perhaps a descendant/namesake.",
            });
          }
        }
      });
    }
  });

  return conflicts;
}