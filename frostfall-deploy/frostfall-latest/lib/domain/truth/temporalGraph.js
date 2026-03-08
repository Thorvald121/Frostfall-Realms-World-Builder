// lib/domain/truth/temporalGraph.js
//
// Frostfall Realms — Temporal Graph Engine (Domain Layer)
// Phase A1/A2: build once, inject into integrity checks
// Phase B: multi-hop temporal propagation (deterministic)
//
// Exports:
//   - buildTemporalGraph(articles)
//   - extractMentionIds(body)
//   - isImpossibleReference(sourceId, targetId, graph)              -> boolean
//   - propagateTemporalImpossibilities(sourceId, graph, opts)       -> findings[]
//
// Compatibility:
// - buildTemporalGraph returns a graph object that ALSO exposes methods:
//     g.isImpossibleReference(sourceId, targetId) -> null | { type: "temporal_impossible", ... }
//     g.propagateTemporalImpossibilities(sourceId, opts)

function toIntOrNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function normId(id) {
  return String(id || "").trim();
}

/**
 * Extract IDs mentioned in body text via:
 *  - Rich mentions: @[Title](id)
 *  - Legacy mentions: @id
 *
 * Returns: string[] of ids (unique)
 */
export function extractMentionIds(body) {
  const text = String(body || "");
  const ids = new Set();

  // Rich: @[Title](id)
  const richRe = /@\[[^\]]+\]\(([^)]+)\)/g;
  let m;
  while ((m = richRe.exec(text)) !== null) {
    const id = normId(m[1]);
    if (id) ids.add(id);
  }

  // Legacy: @id (avoid matching "@[")
  const legacyRe = /@(?!\[)([A-Za-z0-9_]+)/g;
  while ((m = legacyRe.exec(text)) !== null) {
    const id = normId(m[1]);
    if (id) ids.add(id);
  }

  return Array.from(ids);
}

/**
 * Determine if a reference from sourceId -> targetId is temporally impossible.
 *
 * Return: boolean
 *
 * Rule: A reference is impossible when the SOURCE ended BEFORE the TARGET began.
 * This means the source couldn't have known about the target.
 *
 * Historical references (source starts AFTER target ends) are perfectly valid —
 * a modern article can reference an ancient event or deceased character.
 */
export function isImpossibleReference(sourceId, targetId, graph) {
  const g = graph || null;
  const sId = normId(sourceId);
  const tId = normId(targetId);

  if (!g || !g.nodes || !sId || !tId) return false;

  const s = g.nodes[sId];
  const t = g.nodes[tId];
  if (!s || !t) return false;

  const st = s.temporal || {};
  const tt = t.temporal || {};

  // Concepts are always referenceable
  if (tt?.type === "concept") return false;
  if (st?.type === "concept") return false;

  // Immortals with no end date can reference anything
  if (st?.type === "immortal" && !st.active_end && !st.death_year) return false;

  // The source needs an end date (death_year or active_end) for the check to apply
  const sourceEnd = toIntOrNull(st.death_year ?? st.active_end);
  if (sourceEnd === null) return false;

  // The target needs a start date for the check to apply
  const targetStart = toIntOrNull(tt.active_start ?? tt.year);
  if (targetStart === null) return false;

  // Impossible: source ended before target even began
  return sourceEnd < targetStart;
}

/**
 * Multi-hop propagation: starting from sourceId, traverse outgoing edges up to maxDepth.
 *
 * Findings are deterministic and include a path.
 *
 * opts:
 *  - maxDepth (default 3)
 */
export function propagateTemporalImpossibilities(sourceId, graph, opts = {}) {
  const g = graph || null;
  const start = normId(sourceId);
  if (!g || !g.nodes || !g.edges || !start) return [];

  const maxDepth = Number.isFinite(opts.maxDepth) ? opts.maxDepth : 3;

  // BFS queue items: { id, depth, pathIds }
  const q = [{ id: start, depth: 0, path: [start] }];
  const visited = new Set([start]);
  const findings = [];

  while (q.length) {
    const cur = q.shift();
    const fromId = cur.id;
    const depth = cur.depth;

    if (depth >= maxDepth) continue;

    const targets = g.edges[fromId] || [];
    for (const toIdRaw of targets) {
      const toId = normId(toIdRaw);
      if (!toId) continue;

      const newPath = [...cur.path, toId];

      if (isImpossibleReference(fromId, toId, g)) {
        findings.push({
          type: "temporal_propagated",
          sourceId: start,
          fromId,
          toId,
          path: newPath,
          depth: depth + 1,
        });
      }

      if (!visited.has(toId)) {
        visited.add(toId);
        q.push({ id: toId, depth: depth + 1, path: newPath });
      }
    }
  }

  findings.sort((a, b) => {
    const ap = (a.path || []).join(">");
    const bp = (b.path || []).join(">");
    if (ap < bp) return -1;
    if (ap > bp) return 1;
    return 0;
  });

  return findings;
}

/**
 * Build a temporal graph from articles.
 *
 * Graph shape:
 * {
 *   nodes: { [id]: { id, title, category, temporal, fields } },
 *   edges: { [sourceId]: string[] },
 *   isImpossibleReference: (sourceId, targetId) => null | warningObject,
 *   propagateTemporalImpossibilities: (sourceId, opts) => findings[]
 * }
 */
export function buildTemporalGraph(articles) {
  const list = Array.isArray(articles) ? articles : [];

  const nodes = Object.create(null);
  const edges = Object.create(null);

  for (const a of list) {
    const id = normId(a?.id);
    if (!id) continue;

    nodes[id] = {
      id,
      title: a?.title || id,
      category: a?.category || null,
      temporal: a?.temporal || null,
      fields: a?.fields || null,
    };
  }

  for (const a of list) {
    const sourceId = normId(a?.id);
    if (!sourceId) continue;

    const mentionIds = extractMentionIds(a?.body || "");
    const uniq = [];
    const seen = new Set();

    for (const tid of mentionIds) {
      const targetId = normId(tid);
      if (!targetId) continue;
      if (targetId === sourceId) continue;
      if (seen.has(targetId)) continue;
      seen.add(targetId);
      uniq.push(targetId);
    }

    edges[sourceId] = uniq;
  }

  const graph = { nodes, edges };

  // IMPORTANT: compatibility with temporalGraph.test.js expectation:
  // return null or an object with type "temporal_impossible"
  graph.isImpossibleReference = (sourceId, targetId) => {
    const impossible = isImpossibleReference(sourceId, targetId, graph);
    if (!impossible) return null;

    const sId = normId(sourceId);
    const tId = normId(targetId);

    return {
      type: "temporal_impossible",
      severity: "warning",
      sourceId: sId,
      targetId: tId,
      message: `Temporal impossibility: "${graph.nodes?.[sId]?.title || sId}" cannot reference "${
        graph.nodes?.[tId]?.title || tId
      }" after its end date.`,
    };
  };

  graph.propagateTemporalImpossibilities = (sourceId, opts) =>
    propagateTemporalImpossibilities(sourceId, graph, opts);

  return graph;
}