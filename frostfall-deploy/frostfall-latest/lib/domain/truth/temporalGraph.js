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
 * IMPORTANT:
 * A codex entry should be allowed to reference *past* people/events (historical mentions).
 * The true "impossibility" is referencing something that has not happened / does not exist yet
 * relative to the source entry's time.
 *
 * Rule:
 *  - sourceYear   = source.temporal.active_start || source.temporal.year
 *  - targetStart  = target.temporal.birth_year || target.temporal.active_start || target.temporal.year
 *  - if sourceYear < targetStart => impossible
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

  if (tt?.type === "concept") return false;

  const sourceYear = toIntOrNull(st.active_start ?? st.year);
  if (sourceYear === null) return false;

  const targetStart = toIntOrNull(tt.birth_year ?? tt.active_start ?? tt.year);
  if (targetStart === null) return false;

  return sourceYear < targetStart;
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