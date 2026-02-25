// lib/domain/truth/temporalGraph.js
//
// Frostfall Realms — Temporal Graph Engine (Domain Layer)
// Phase A1/A2 support: build once, inject into integrity checks.
// Phase B: temporal propagation (multi-hop inference)
//
// Exports:
//   - buildTemporalGraph(articles)
//   - extractMentionIds(body)
//   - isImpossibleReference(sourceId, targetId, graph)
//   - propagateTemporalImpossibilities(sourceId, graph, opts)
//
// Design notes:
// - Pure + deterministic: no IO, no dates, no randomness.
// - Graph is a simple index of nodes + edges derived from @mentions.
// - Temporal impossibility rule (current):
//     If source occurs after target ends (death_year or active_end), referencing is impossible.
// - Concepts/immortals without an end year are treated as always referenceable.

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
  // Capture group 1 is the id
  const richRe = /@\[[^\]]+\]\(([^)]+)\)/g;
  let m;
  while ((m = richRe.exec(text)) !== null) {
    const id = normId(m[1]);
    if (id) ids.add(id);
  }

  // Legacy: @id (avoid matching rich "@[")
  const legacyRe = /@(?!\[)([A-Za-z0-9_]+)/g;
  while ((m = legacyRe.exec(text)) !== null) {
    const id = normId(m[1]);
    if (id) ids.add(id);
  }

  return Array.from(ids);
}

/**
 * Build a temporal graph from articles.
 *
 * Graph shape:
 * {
 *   nodes: {
 *     [id]: { id, title, category, temporal: { ... }, fields: { ... } }
 *   },
 *   edges: {
 *     [sourceId]: string[]  // outgoing mention targets (unique)
 *   }
 * }
 */
export function buildTemporalGraph(articles) {
  const list = Array.isArray(articles) ? articles : [];

  const nodes = Object.create(null);
  const edges = Object.create(null);

  // Build nodes index
  for (const a of list) {
    const id = normId(a?.id);
    if (!id) continue;

    // Shallow copy only what we need to keep graph lean + stable
    nodes[id] = {
      id,
      title: a?.title || id,
      category: a?.category || null,
      temporal: a?.temporal || null,
      fields: a?.fields || null,
    };
  }

  // Build edges from mention extraction
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

  return { nodes, edges };
}

/**
 * Determine if a reference from sourceId -> targetId is temporally impossible.
 *
 * Rule (current, Phase A1):
 *   - Determine the "source year" (when the source occurs):
 *       source.temporal.active_start (preferred)
 *       else source.temporal.year
 *       else null => cannot decide => false
 *
 *   - Determine the "target end year" (when target stops being present):
 *       target.temporal.death_year (preferred)
 *       else target.temporal.active_end
 *       else null => target has no known end => false
 *
 *   - If sourceYear > targetEndYear => impossible reference => true
 *
 * Notes:
 *   - Concepts / immortals with no end are always referenceable.
 *   - If source/target not found in graph nodes, returns false (integrity handles broken refs separately).
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

  // Concepts are outside time in this model
  if (tt?.type === "concept") return false;

  // Source occurrence year
  const sourceYear = toIntOrNull(st.active_start ?? st.year);
  if (sourceYear === null) return false;

  // Target end year (death beats active_end)
  const targetEnd = toIntOrNull(tt.death_year ?? tt.active_end);
  if (targetEnd === null) return false;

  // Immortals with no end: reference is always possible
  if (tt?.type === "immortal" && targetEnd === null) return false;

  return sourceYear > targetEnd;
}

function sortIdsDeterministic(ids) {
  return (Array.isArray(ids) ? ids : []).slice().sort((a, b) => String(a).localeCompare(String(b)));
}

/**
 * Phase B — Temporal Propagation
 *
 * Starting from a given sourceId, walk outgoing mention chains up to maxDepth.
 * If any edge U -> V inside that reachable subgraph is temporally impossible,
 * surface it as a "propagated" finding for the original sourceId.
 *
 * Returns findings:
 * [
 *   {
 *     sourceId,          // the root article being evaluated
 *     fromId,            // the edge start where impossibility occurs (U)
 *     toId,              // the edge end where impossibility occurs (V)
 *     path,              // ids from sourceId to fromId, then toId at end
 *     depth,             // hop count from sourceId to toId
 *   }
 * ]
 *
 * Determinism rules:
 * - BFS traversal
 * - neighbors sorted
 * - findings sorted by (depth, fromId, toId)
 *
 * Safety rules:
 * - maxDepth default 3
 * - dedupe by fromId->toId per sourceId
 */
export function propagateTemporalImpossibilities(sourceId, graph, opts = {}) {
  const g = graph || null;
  const root = normId(sourceId);
  if (!g || !g.nodes || !g.edges || !root) return [];

  const maxDepth = Number.isFinite(opts.maxDepth) ? Math.max(1, Math.trunc(opts.maxDepth)) : 3;

  // BFS over nodes reachable from root
  const visited = new Set([root]);

  // parent map for path reconstruction
  const parent = Object.create(null); // childId -> parentId
  const depth = Object.create(null); // nodeId -> depth from root
  depth[root] = 0;

  const queue = [root];

  // Collect impossible edges encountered within reachable region
  const findings = [];
  const seenEdge = new Set(); // `${from}->${to}`

  while (queue.length) {
    const u = queue.shift();
    const du = depth[u] ?? 0;

    // Don't expand beyond maxDepth-1 (because u->v would be +1)
    if (du >= maxDepth) continue;

    const neighbors = sortIdsDeterministic(g.edges[u] || []);
    for (const v of neighbors) {
      const to = normId(v);
      if (!to) continue;

      // Record discovery for BFS tree
      if (!visited.has(to)) {
        visited.add(to);
        parent[to] = u;
        depth[to] = du + 1;
        queue.push(to);
      }

      // Only evaluate impossibility when both nodes exist in graph (broken handled elsewhere)
      if (g.nodes[u] && g.nodes[to]) {
        if (isImpossibleReference(u, to, g)) {
          const edgeKey = `${u}=>${to}`;
          if (!seenEdge.has(edgeKey)) {
            seenEdge.add(edgeKey);

            // Reconstruct path root -> ... -> u
            const pathToU = [];
            let cur = u;
            while (cur) {
              pathToU.push(cur);
              if (cur === root) break;
              cur = parent[cur];
            }
            pathToU.reverse();

            const fullPath = [...pathToU, to];

            findings.push({
              sourceId: root,
              fromId: u,
              toId: to,
              path: fullPath,
              depth: (depth[u] ?? 0) + 1,
            });
          }
        }
      }
    }
  }

  // Deterministic ordering
  findings.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    const af = String(a.fromId).localeCompare(String(b.fromId));
    if (af !== 0) return af;
    return String(a.toId).localeCompare(String(b.toId));
  });

  return findings;
}