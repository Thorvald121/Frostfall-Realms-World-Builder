"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  fetchCharacterRelations, saveCharacterRelation,
  deleteCharacterRelation, confirmCharacterRelation,
} from "@/lib/supabase";

// ─────────────────────────────────────────────────────────────────
// Relationship detection — scans article body + fields for language
// ─────────────────────────────────────────────────────────────────
const PARENT_PATTERNS   = /\b(father|mother|parent|sire|dam|born of|son of|daughter of|child of|offspring of)\b/i;
const CHILD_PATTERNS    = /\b(son|daughter|child|offspring|heir|firstborn|sired|gave birth|bore)\b/i;
const SPOUSE_PATTERNS   = /\b(married|spouse|wife|husband|wed|betrothed|consort|partner|beloved)\b/i;
const SIBLING_PATTERNS  = /\b(brother|sister|sibling|twin|half-brother|half-sister)\b/i;

function detectRelationType(text) {
  if (PARENT_PATTERNS.test(text))  return "parent";
  if (CHILD_PATTERNS.test(text))   return "child";
  if (SPOUSE_PATTERNS.test(text))  return "spouse";
  if (SIBLING_PATTERNS.test(text)) return "sibling";
  return null;
}

// Extract all @[Title](slug) mentions from body HTML
function extractMentions(html) {
  if (!html) return [];
  const rich = [...(html.matchAll(/@\[([^\]]+)\]\(([^)]+)\)/g))].map((m) => ({ title: m[1], id: m[2] }));
  return rich;
}

// Scan a window of text around an @mention for relationship keywords
function contextAround(html, mentionId, windowChars = 80) {
  if (!html) return "";
  const plain = html.replace(/<[^>]*>/g, " ");
  const mentionPatterns = [
    new RegExp(`.{0,${windowChars}}@\\[?[^\\]]*\\]?\\(${mentionId}\\).{0,${windowChars}}`, "i"),
    new RegExp(`.{0,${windowChars}}@${mentionId}.{0,${windowChars}}`, "i"),
  ];
  for (const pat of mentionPatterns) {
    const m = plain.match(pat);
    if (m) return m[0];
  }
  return "";
}

/** Returns array of suggestion objects */
export function detectRelationSuggestions(articles, existingRelations) {
  const characters = articles.filter((a) => a.category === "character");
  const charById = new Map(characters.map((c) => [c.id, c]));
  const suggestions = [];
  const existing = new Set();
  Object.entries(existingRelations).forEach(([fromId, rels]) => {
    rels.forEach((r) => existing.add(`${fromId}:${r.targetId}:${r.type}`));
  });

  characters.forEach((ch) => {
    const mentions = extractMentions(ch.body);
    mentions.forEach(({ id: targetId }) => {
      if (targetId === ch.id) return;
      if (!charById.has(targetId)) return;
      const ctx = contextAround(ch.body, targetId);
      if (!ctx) return;
      const type = detectRelationType(ctx);
      if (!type) return;
      // Dedupe against existing confirmed + pending suggestions
      const key = `${ch.id}:${targetId}:${type}`;
      if (existing.has(key)) return;
      if (suggestions.find((s) => s.fromId === ch.id && s.toId === targetId && s.type === type)) return;
      suggestions.push({
        fromId: ch.id, fromTitle: ch.title,
        toId: targetId, toTitle: charById.get(targetId).title,
        type, context: ctx.trim().slice(0, 120),
      });
    });
  });
  return suggestions;
}

// ─────────────────────────────────────────────────────────────────
// Generational canvas tree layout
// ─────────────────────────────────────────────────────────────────
function buildGenerationalLayout(focusId, relations, characters) {
  const charById = new Map(characters.map((c) => [c.id, c]));
  const nodes = [];
  const edges = [];
  const placed = new Set();

  const getRelOf = (id, type) =>
    (relations[id] || []).filter((r) => r.type === type && r.confirmed).map((r) => r.targetId).filter((tid) => charById.has(tid));

  // BFS: layer 0 = focus, layer -1/-2 = ancestors, layer 1/2 = descendants
  const layers = new Map(); // id → layer
  layers.set(focusId, 0);
  const queue = [{ id: focusId, layer: 0 }];
  while (queue.length) {
    const { id, layer } = queue.shift();
    if (placed.has(id)) continue;
    placed.add(id);
    // Parents → layer - 1
    getRelOf(id, "parent").forEach((pid) => {
      if (!placed.has(pid) && !layers.has(pid)) {
        layers.set(pid, layer - 1);
        queue.push({ id: pid, layer: layer - 1 });
      }
    });
    // Children → layer + 1
    getRelOf(id, "child").forEach((cid) => {
      if (!placed.has(cid) && !layers.has(cid)) {
        layers.set(cid, layer + 1);
        queue.push({ id: cid, layer: layer + 1 });
      }
    });
    // Spouses → same layer
    getRelOf(id, "spouse").forEach((sid) => {
      if (!placed.has(sid) && !layers.has(sid)) {
        layers.set(sid, layer);
        queue.push({ id: sid, layer });
      }
    });
    // Siblings → same layer
    getRelOf(id, "sibling").forEach((sib) => {
      if (!placed.has(sib) && !layers.has(sib)) {
        layers.set(sib, layer);
        queue.push({ id: sib, layer });
      }
    });
  }

  // Group by layer, assign x positions
  const byLayer = new Map();
  layers.forEach((layer, id) => {
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer).push(id);
  });

  const layerNums = [...byLayer.keys()].sort((a, b) => a - b);
  const NODE_W = 140, NODE_H = 56, H_GAP = 32, V_GAP = 80;

  layerNums.forEach((layer, li) => {
    const ids = byLayer.get(layer);
    const totalW = ids.length * NODE_W + (ids.length - 1) * H_GAP;
    ids.forEach((id, xi) => {
      const ch = charById.get(id);
      if (!ch) return;
      nodes.push({
        id, title: ch.title,
        category: ch.category,
        portrait: ch.portrait,
        fields: ch.fields,
        layer,
        x: xi * (NODE_W + H_GAP) - totalW / 2 + NODE_W / 2,
        y: li * (NODE_H + V_GAP),
        isFocus: id === focusId,
        isSpouse: (relations[focusId] || []).some((r) => r.targetId === id && r.type === "spouse" && r.confirmed),
      });
    });
  });

  // Edges
  nodes.forEach((n) => {
    (relations[n.id] || []).filter((r) => r.confirmed).forEach((r) => {
      const target = nodes.find((t) => t.id === r.targetId);
      if (!target) return;
      if (!edges.find((e) => (e.from === n.id && e.to === r.targetId) || (e.from === r.targetId && e.to === n.id))) {
        edges.push({ from: n.id, to: r.targetId, type: r.type });
      }
    });
  });

  return { nodes, edges };
}

// ─────────────────────────────────────────────────────────────────
// REL type colours and labels
// ─────────────────────────────────────────────────────────────────
const REL_META = {
  parent:  { label: "Parents",  icon: "👑", color: "#d4a060" },
  child:   { label: "Children", icon: "🌱", color: "#8ec8a0" },
  spouse:  { label: "Spouses",  icon: "💍", color: "#f472b6" },
  sibling: { label: "Siblings", icon: "👥", color: "#7ec8e3" },
};

const MIRROR = { parent: "child", child: "parent", spouse: "spouse", sibling: "sibling" };

// ─────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────
export function FamilyTreeView({
  theme, ta, tBtnP, tBtnS, S, Ornament,
  articles, activeWorld, isMobile,
  onOpenArticle,
}) {
  const characters = useMemo(() => articles.filter((a) => a.category === "character"), [articles]);

  // ── Relations state ──
  const [relations, setRelations]         = useState({});
  const [relLoaded, setRelLoaded]         = useState(false);
  const [relTableMissing, setRelTableMissing] = useState(false);
  const [suggestions, setSuggestions]     = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // ── UI state ──
  const [selected, setSelected]           = useState(null); // character id
  const [addingRel, setAddingRel]         = useState(null); // { type }
  const [tab, setTab]                     = useState("tree"); // "tree" | "manage" | "suggest"

  // ── Canvas state ──
  const canvasRef  = useRef(null);
  const containerRef = useRef(null);
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const panStartRef  = useRef(null);
  const rafRef       = useRef(null);
  const nodesRef     = useRef([]);
  const edgesRef     = useRef([]);
  const hoveredRef   = useRef(null);
  const [hovered, setHovered] = useState(null);
  const [zoom, setZoom] = useState(1);

  // ── Load relations from Supabase ──
  const loadRelations = useCallback(async () => {
    if (!activeWorld?.id) return;
    const { relations: r, error } = await fetchCharacterRelations(activeWorld.id);
    if (error === "table_missing") {
      setRelTableMissing(true);
      // Fall back to localStorage migration
      try {
        const local = JSON.parse(localStorage.getItem("ff_relationships") || "{}");
        setRelations(local);
      } catch { setRelations({}); }
    } else {
      setRelations(r);
    }
    setRelLoaded(true);
  }, [activeWorld?.id]);

  useEffect(() => { loadRelations(); }, [loadRelations]);

  // ── Auto-detect suggestions when relations load ──
  useEffect(() => {
    if (!relLoaded || characters.length === 0) return;
    const s = detectRelationSuggestions(articles, relations);
    setSuggestions(s);
  }, [relLoaded, articles, relations]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Add relation (Supabase + mirror) ──
  const addRelation = useCallback(async (fromId, toId, type) => {
    const worldId = activeWorld?.id;
    // Optimistic update
    const update = (r) => {
      const next = { ...r };
      if (!next[fromId]) next[fromId] = [];
      if (!next[toId]) next[toId] = [];
      if (!next[fromId].find((x) => x.targetId === toId && x.type === type))
        next[fromId].push({ targetId: toId, type, confirmed: true, source: "manual" });
      const mirrorType = MIRROR[type];
      if (!next[toId].find((x) => x.targetId === fromId && x.type === mirrorType))
        next[toId].push({ targetId: fromId, type: mirrorType, confirmed: true, source: "manual" });
      return next;
    };
    setRelations(update);
    if (!relTableMissing && worldId) {
      await saveCharacterRelation(worldId, fromId, toId, type, true, "manual");
      await saveCharacterRelation(worldId, toId, fromId, MIRROR[type], true, "manual");
    } else {
      // localStorage fallback
      setRelations((prev) => {
        try { localStorage.setItem("ff_relationships", JSON.stringify(prev)); } catch {}
        return prev;
      });
    }
    setAddingRel(null);
  }, [activeWorld?.id, relTableMissing]);

  // ── Remove relation ──
  const removeRelation = useCallback(async (fromId, toId, type) => {
    const worldId = activeWorld?.id;
    setRelations((prev) => {
      const next = { ...prev };
      if (next[fromId]) next[fromId] = next[fromId].filter((r) => !(r.targetId === toId && r.type === type));
      const m = MIRROR[type];
      if (next[toId]) next[toId] = next[toId].filter((r) => !(r.targetId === fromId && r.type === m));
      return next;
    });
    if (!relTableMissing && worldId) {
      await deleteCharacterRelation(worldId, fromId, toId, type);
      await deleteCharacterRelation(worldId, toId, fromId, MIRROR[type]);
    }
  }, [activeWorld?.id, relTableMissing]);

  // ── Approve suggestion ──
  const approveSuggestion = useCallback(async (s) => {
    await addRelation(s.fromId, s.toId, s.type);
    setSuggestions((prev) => prev.filter((x) => !(x.fromId === s.fromId && x.toId === s.toId && x.type === s.type)));
  }, [addRelation]);

  const dismissSuggestion = useCallback((s) => {
    setSuggestions((prev) => prev.filter((x) => !(x.fromId === s.fromId && x.toId === s.toId && x.type === s.type)));
  }, []);

  // ── Build canvas layout when selected changes ──
  useEffect(() => {
    if (!selected || !relLoaded) { nodesRef.current = []; edgesRef.current = []; return; }
    const { nodes, edges } = buildGenerationalLayout(selected, relations, characters);
    nodesRef.current = nodes;
    edgesRef.current = edges;
    // Center the focused node
    const focus = nodes.find((n) => n.isFocus);
    const canvas = canvasRef.current;
    if (focus && canvas) {
      transformRef.current = {
        x: canvas.width / 2 - focus.x * transformRef.current.scale,
        y: canvas.height / 2 - focus.y * transformRef.current.scale,
        scale: transformRef.current.scale,
      };
    }
  }, [selected, relations, characters, relLoaded]);

  // ── Canvas draw loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let stopped = false;
    const NODE_W = 140, NODE_H = 56, RADIUS = 8;

    function draw() {
      if (stopped) return;
      rafRef.current = requestAnimationFrame(draw);
      const W = canvas.width, H = canvas.height;
      const { x: tx, y: ty, scale } = transformRef.current;
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const hov = hoveredRef.current;

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = theme.deepBg || "#0a0e1a";
      ctx.fillRect(0, 0, W, H);

      // Dot grid
      ctx.fillStyle = "rgba(255,255,255,0.025)";
      const gs = 50;
      for (let gx = ((tx % gs) + gs) % gs - gs; gx < W; gx += gs)
        for (let gy = ((ty % gs) + gs) % gs - gs; gy < H; gy += gs) {
          ctx.beginPath(); ctx.arc(gx, gy, 1, 0, Math.PI * 2); ctx.fill();
        }

      if (nodes.length === 0) {
        ctx.fillStyle = theme.textDim || "#556677";
        ctx.font = "14px 'Cinzel', serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Select a character to view their family tree", W / 2, H / 2);
        return;
      }

      ctx.save();
      ctx.translate(tx, ty);
      ctx.scale(scale, scale);

      // Edges
      edges.forEach(({ from, to, type }) => {
        const a = nodes.find((n) => n.id === from);
        const b = nodes.find((n) => n.id === to);
        if (!a || !b) return;
        const meta = REL_META[type] || REL_META.sibling;
        const ax = a.x, ay = a.y + NODE_H / 2;
        const bx = b.x, by = b.y - NODE_H / 2;
        const isVert = Math.abs(a.layer - b.layer) > 0;

        ctx.strokeStyle = meta.color + "60";
        ctx.lineWidth = 1.5 / scale;
        ctx.setLineDash(type === "spouse" ? [4 / scale, 4 / scale] : []);
        ctx.beginPath();
        if (isVert) {
          const my = (ay + by) / 2;
          ctx.moveTo(ax, ay); ctx.bezierCurveTo(ax, my, bx, my, bx, by);
        } else {
          // Horizontal — draw a bracket
          ctx.moveTo(a.x + NODE_W / 2, a.y);
          ctx.lineTo(b.x - NODE_W / 2, b.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Relation label mid-point
        const mx = (a.x + b.x) / 2;
        const my2 = (a.y + b.y) / 2;
        ctx.font = `${10 / scale}px sans-serif`;
        ctx.fillStyle = meta.color + "cc";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(meta.icon, mx, my2);
      });

      // Nodes
      nodes.forEach((n) => {
        const isHov = hov === n.id;
        const isFocus = n.isFocus;
        const borderColor = isFocus ? theme.accent : (n.isSpouse ? "#f472b6" : (theme.border || "#283848"));
        const bgColor = isFocus ? ta(theme.accent, 0.15) : ta(theme.surface, 0.9);
        const lx = n.x - NODE_W / 2, ly = n.y - NODE_H / 2;

        // Shadow / glow
        if (isHov || isFocus) {
          ctx.shadowColor = isFocus ? theme.accent : "#ffffff";
          ctx.shadowBlur = 12 / scale;
        }

        // Card background
        ctx.fillStyle = bgColor;
        ctx.strokeStyle = borderColor + (isFocus ? "" : "80");
        ctx.lineWidth = (isFocus ? 2 : 1) / scale;
        ctx.beginPath();
        ctx.roundRect(lx, ly, NODE_W, NODE_H, RADIUS / scale);
        ctx.fill(); ctx.stroke();
        ctx.shadowBlur = 0;

        // Avatar circle
        const av = 20 / scale;
        ctx.beginPath();
        ctx.arc(lx + 28, n.y, av, 0, Math.PI * 2);
        ctx.fillStyle = ta(isFocus ? theme.accent : "#e8a050", 0.15);
        ctx.fill();
        ctx.strokeStyle = (isFocus ? theme.accent : "#e8a050") + "50";
        ctx.lineWidth = 1 / scale;
        ctx.stroke();
        ctx.font = `${14 / scale}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = isFocus ? theme.accent : "#e8a050";
        ctx.fillText("👤", lx + 28, n.y);

        // Name
        const maxNameW = NODE_W - 56;
        ctx.font = `${isFocus ? 700 : 500} ${11 / scale}px 'Cinzel', serif`;
        ctx.fillStyle = isFocus ? theme.accent : (theme.text || "#e2d9be");
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const name = n.title.length > 16 ? n.title.slice(0, 14) + "…" : n.title;
        ctx.fillText(name, lx + 52, n.y - 8 / scale);

        // Sub-info
        const sub = n.fields?.char_race || n.fields?.role || "";
        if (sub) {
          ctx.font = `${9 / scale}px inherit`;
          ctx.fillStyle = theme.textDim || "#556677";
          ctx.fillText(sub.slice(0, 18), lx + 52, n.y + 8 / scale);
        }
      });

      ctx.restore();
    }

    draw();
    return () => { stopped = true; cancelAnimationFrame(rafRef.current); };
  }, [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Canvas resize ──
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ro = new ResizeObserver(() => { canvas.width = container.clientWidth; canvas.height = container.clientHeight; });
    ro.observe(container);
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    return () => ro.disconnect();
  }, []);

  // ── Pointer helpers ──
  const canvasToWorld = useCallback((cx, cy) => {
    const { x, y, scale } = transformRef.current;
    return { x: (cx - x) / scale, y: (cy - y) / scale };
  }, []);

  const hitTestNode = useCallback((wx, wy) => {
    const NODE_W = 140, NODE_H = 56;
    return nodesRef.current.find((n) =>
      wx >= n.x - NODE_W / 2 && wx <= n.x + NODE_W / 2 &&
      wy >= n.y - NODE_H / 2 && wy <= n.y + NODE_H / 2
    ) || null;
  }, []);

  const onMouseMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    if (panStartRef.current) {
      transformRef.current = {
        ...transformRef.current,
        x: panStartRef.current.tx + cx - panStartRef.current.cx,
        y: panStartRef.current.ty + cy - panStartRef.current.cy,
      };
      return;
    }
    const { x: wx, y: wy } = canvasToWorld(cx, cy);
    const hit = hitTestNode(wx, wy)?.id || null;
    if (hit !== hoveredRef.current) { hoveredRef.current = hit; setHovered(hit); canvas.style.cursor = hit ? "pointer" : "grab"; }
  }, [canvasToWorld, hitTestNode]);

  const onMouseDown = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const { x: wx, y: wy } = canvasToWorld(cx, cy);
    if (!hitTestNode(wx, wy)) {
      const { x, y } = transformRef.current;
      panStartRef.current = { cx, cy, tx: x, ty: y };
      canvas.style.cursor = "grabbing";
    }
  }, [canvasToWorld, hitTestNode]);

  const onMouseUp = useCallback(() => { panStartRef.current = null; }, []);

  const onClick = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { x: wx, y: wy } = canvasToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const hit = hitTestNode(wx, wy);
    if (hit) setSelected(hit.id);
  }, [canvasToWorld, hitTestNode]);

  const onDblClick = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { x: wx, y: wy } = canvasToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const hit = hitTestNode(wx, wy);
    if (hit && onOpenArticle) {
      const article = articles.find((a) => a.id === hit.id);
      if (article) onOpenArticle(article);
    }
  }, [canvasToWorld, hitTestNode, articles, onOpenArticle]);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? 0.88 : 1.14;
    const { x, y, scale } = transformRef.current;
    const newScale = Math.max(0.2, Math.min(3, scale * delta));
    transformRef.current = {
      x: cx - (cx - x) * (newScale / scale),
      y: cy - (cy - y) * (newScale / scale),
      scale: newScale,
    };
    setZoom(newScale);
  }, []);

  const resetView = () => {
    transformRef.current = { x: 0, y: 0, scale: 1 };
    setZoom(1);
    const canvas = canvasRef.current;
    const focus = nodesRef.current.find((n) => n.isFocus);
    if (focus && canvas) {
      transformRef.current = { x: canvas.width / 2 - focus.x, y: canvas.height / 2 - focus.y, scale: 1 };
    }
  };

  // ── Selected character detail ──
  const selectedChar = useMemo(() => articles.find((a) => a.id === selected), [articles, selected]);
  const selectedRels = useMemo(() => {
    if (!selected) return {};
    const rels = relations[selected] || [];
    const out = {};
    Object.keys(REL_META).forEach((type) => {
      out[type] = rels.filter((r) => r.type === type && r.confirmed)
        .map((r) => articles.find((a) => a.id === r.targetId)).filter(Boolean);
    });
    return out;
  }, [selected, relations, articles]);

  const totalRels = Object.values(relations).reduce((s, r) => s + r.length, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 56px)", overflow: "hidden", margin: "0 -28px" }}>

      {/* ── Header ── */}
      <div style={{ padding: "12px 28px", borderBottom: "1px solid " + theme.divider, display: "flex", alignItems: "center", gap: 12, flexShrink: 0, flexWrap: "wrap", background: ta(theme.sidebarBg, 0.9) }}>
        <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 20, color: theme.text, margin: 0, letterSpacing: 1 }}>🌳 Family Tree & Lineage</h2>
        <Ornament width={120} />
        <span style={{ fontSize: 11, color: theme.textDim }}>{characters.length} characters · {totalRels / 2 | 0} relationships</span>
        {suggestions.length > 0 && (
          <button onClick={() => { setShowSuggestions(true); setTab("suggest"); }}
            style={{ fontSize: 11, padding: "4px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", background: "rgba(240,192,64,0.12)", border: "1px solid rgba(240,192,64,0.3)", color: "#f0c040", fontWeight: 600 }}>
            💡 {suggestions.length} suggestion{suggestions.length !== 1 ? "s" : ""} detected
          </button>
        )}
        {relTableMissing && (
          <span style={{ fontSize: 10, color: "#f0c040" }}>⚠ Run schema_character_relations.sql to persist relations</span>
        )}
      </div>

      {/* ── Tab bar ── */}
      <div style={{ display: "flex", gap: 4, padding: "8px 28px", borderBottom: "1px solid " + ta(theme.divider, 0.5), background: ta(theme.sidebarBg, 0.7), flexShrink: 0 }}>
        {[
          { id: "tree", label: "Tree View", icon: "🌳" },
          { id: "manage", label: "Manage Relations", icon: "⚙" },
          { id: "suggest", label: `Suggestions${suggestions.length > 0 ? " (" + suggestions.length + ")" : ""}`, icon: "💡" },
        ].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ fontSize: 11, padding: "5px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: tab === t.id ? 600 : 400, letterSpacing: 0.3, border: "1px solid " + (tab === t.id ? ta(theme.accent, 0.4) : ta(theme.border, 0.5)), background: tab === t.id ? ta(theme.accent, 0.1) : "transparent", color: tab === t.id ? theme.accent : theme.textMuted, transition: "all 0.15s" }}>
            {t.icon} {t.label}
          </button>
        ))}
        {tab === "tree" && <span style={{ marginLeft: "auto", fontSize: 10, color: theme.textDim, alignSelf: "center" }}>{Math.round(zoom * 100)}% · Scroll to zoom · Drag to pan · Double-click to open</span>}
      </div>

      {/* ══════════════════════════════
          TREE TAB
      ══════════════════════════════ */}
      {tab === "tree" && (
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Character list sidebar */}
          <div style={{ width: 220, flexShrink: 0, borderRight: "1px solid " + theme.divider, display: "flex", flexDirection: "column", background: ta(theme.sidebarBg, 0.5), overflowY: "auto" }}>
            <div style={{ padding: "10px 12px 6px", fontSize: 9, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 600 }}>Characters</div>
            {characters.length === 0 && <div style={{ padding: "20px 12px", fontSize: 12, color: theme.textDim }}>No characters yet.</div>}
            {characters.map((ch) => {
              const relCount = Math.floor(((relations[ch.id] || []).filter((r) => r.confirmed).length));
              const isSelected = selected === ch.id;
              return (
                <div key={ch.id} onClick={() => setSelected(ch.id)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", cursor: "pointer", background: isSelected ? ta(theme.accent, 0.1) : "transparent", borderLeft: "3px solid " + (isSelected ? theme.accent : "transparent"), transition: "all 0.12s" }}
                  onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = ta(theme.surface, 0.6); }}
                  onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}>
                  <div style={{ width: 26, height: 26, borderRadius: "50%", background: ta("#e8a050", 0.12), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>
                    {ch.portrait ? <img src={ch.portrait} alt="" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} /> : "👤"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: isSelected ? 700 : 500, color: isSelected ? theme.accent : theme.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ch.title}</div>
                    {ch.fields?.char_race && <div style={{ fontSize: 9, color: theme.textDim }}>{ch.fields.char_race}</div>}
                  </div>
                  {relCount > 0 && <span style={{ fontSize: 9, color: theme.textDim, background: ta(theme.accent, 0.06), padding: "1px 5px", borderRadius: 6, flexShrink: 0 }}>{relCount}</span>}
                </div>
              );
            })}
          </div>

          {/* Canvas area */}
          <div ref={containerRef} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
            <canvas ref={canvasRef} style={{ display: "block", cursor: "grab", touchAction: "none" }}
              onMouseMove={onMouseMove} onMouseDown={onMouseDown} onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp} onClick={onClick} onDoubleClick={onDblClick} onWheel={onWheel} />
            <div style={{ position: "absolute", bottom: 12, right: 12, display: "flex", gap: 6 }}>
              <button onClick={resetView} style={{ fontSize: 10, padding: "4px 10px", borderRadius: 6, background: ta(theme.surface, 0.85), border: "1px solid " + theme.border, color: theme.textMuted, cursor: "pointer" }}>⌖ Reset View</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════
          MANAGE RELATIONS TAB
      ══════════════════════════════ */}
      {tab === "manage" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}>
          {/* Character picker */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: theme.textDim, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Character:</span>
            <select value={selected || ""} onChange={(e) => { setSelected(e.target.value || null); setAddingRel(null); }}
              style={{ ...S.input, fontSize: 12, padding: "6px 10px", minWidth: 200 }}>
              <option value="">— select a character —</option>
              {characters.map((ch) => <option key={ch.id} value={ch.id}>{ch.title}</option>)}
            </select>
            {selectedChar && <button onClick={() => onOpenArticle && onOpenArticle(selectedChar)} style={{ ...tBtnS, fontSize: 10, padding: "5px 12px" }}>View Article</button>}
          </div>

          {selectedChar ? (
            <div style={{ maxWidth: 680 }}>
              {/* Character header */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24, padding: "14px 18px", background: ta(theme.surface, 0.5), border: "1px solid " + theme.border, borderRadius: 10 }}>
                <div style={{ width: 48, height: 48, borderRadius: "50%", background: ta("#e8a050", 0.12), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>
                  {selectedChar.portrait ? <img src={selectedChar.portrait} alt="" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} /> : "👤"}
                </div>
                <div>
                  <div style={{ fontFamily: "'Cinzel', serif", fontSize: 16, fontWeight: 700, color: theme.text }}>{selectedChar.title}</div>
                  <div style={{ fontSize: 11, color: theme.textMuted }}>
                    {[selectedChar.fields?.char_race, selectedChar.fields?.role, selectedChar.fields?.titles].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </div>

              {/* Relation groups */}
              {Object.entries(REL_META).map(([type, meta]) => {
                const list = selectedRels[type] || [];
                const isAddingThis = addingRel?.type === type;
                const available = characters.filter((c) => c.id !== selected && !list.find((r) => r.id === c.id));
                return (
                  <div key={type} style={{ marginBottom: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 16 }}>{meta.icon}</span>
                      <span style={{ fontFamily: "'Cinzel', serif", fontSize: 12, fontWeight: 600, color: meta.color, letterSpacing: 0.5 }}>{meta.label}</span>
                      <span style={{ fontSize: 10, color: theme.textDim }}>({list.length})</span>
                      <button onClick={() => setAddingRel(isAddingThis ? null : { type })}
                        style={{ marginLeft: "auto", fontSize: 10, color: meta.color, background: isAddingThis ? ta(meta.color, 0.15) : ta(meta.color, 0.06), border: "1px solid " + ta(meta.color, 0.2), borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontFamily: "inherit" }}>
                        {isAddingThis ? "Cancel" : "+ Add"}
                      </button>
                    </div>

                    {isAddingThis && (
                      <div style={{ marginBottom: 10, padding: "10px 12px", background: ta(theme.surface, 0.5), border: "1px solid " + ta(meta.color, 0.2), borderRadius: 8, maxHeight: 180, overflowY: "auto" }}>
                        <div style={{ fontSize: 10, color: theme.textDim, marginBottom: 6 }}>Select a character:</div>
                        {available.length === 0 && <div style={{ fontSize: 11, color: theme.textDim }}>No available characters.</div>}
                        {available.map((c) => (
                          <div key={c.id} onClick={() => addRelation(selected, c.id, type)}
                            style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, cursor: "pointer" }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = ta(meta.color, 0.1); }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                            <span style={{ fontSize: 12 }}>👤</span>
                            <span style={{ fontSize: 12, color: theme.text }}>{c.title}</span>
                            {c.fields?.char_race && <span style={{ fontSize: 10, color: theme.textDim }}>{c.fields.char_race}</span>}
                          </div>
                        ))}
                      </div>
                    )}

                    {list.length > 0 ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {list.map((rel) => (
                          <div key={rel.id} style={{ display: "flex", alignItems: "center", gap: 6, background: ta(meta.color, 0.06), border: "1px solid " + ta(meta.color, 0.15), borderRadius: 8, padding: "6px 10px" }}>
                            <span onClick={() => setSelected(rel.id)} style={{ fontSize: 12, color: theme.text, fontWeight: 500, cursor: "pointer" }}
                              onMouseEnter={(e) => { e.currentTarget.style.color = meta.color; }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = theme.text; }}>{rel.title}</span>
                            <span onClick={() => removeRelation(selected, rel.id, type)}
                              style={{ fontSize: 11, color: "#e07050", cursor: "pointer", opacity: 0.5, padding: "0 2px" }}
                              onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}>✕</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: theme.textDim, fontStyle: "italic", padding: "4px 0" }}>None</div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: 60, color: theme.textDim }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🌳</div>
              <p>Select a character above to manage their relationships.</p>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════
          SUGGESTIONS TAB
      ══════════════════════════════ */}
      {tab === "suggest" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}>
          <p style={{ fontSize: 12, color: theme.textDim, marginBottom: 16, lineHeight: 1.6 }}>
            These relationships were detected automatically by scanning your article bodies for relationship language near @mentions. Review each one and approve or dismiss.
          </p>
          {suggestions.length === 0 ? (
            <div style={{ textAlign: "center", padding: 60, color: theme.textDim }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>✓</div>
              <p>No suggestions right now. As you write more articles with @mentions and relationship language, new suggestions will appear here.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 700 }}>
              {suggestions.map((s, i) => {
                const meta = REL_META[s.type] || REL_META.sibling;
                return (
                  <div key={i} style={{ padding: "14px 18px", background: ta(theme.surface, 0.55), border: "1px solid " + theme.border, borderRadius: 10, borderLeft: "3px solid " + meta.color }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 16 }}>{meta.icon}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: meta.color, textTransform: "uppercase", letterSpacing: 0.5 }}>{meta.label.slice(0, -1)}</span>
                          <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 8, background: "rgba(240,192,64,0.1)", color: "#f0c040" }}>auto-detected</span>
                        </div>
                        <div style={{ fontSize: 13, color: theme.text }}>
                          <strong style={{ color: theme.accent }}>{s.fromTitle}</strong>
                          <span style={{ color: theme.textDim }}> → {s.type} → </span>
                          <strong style={{ color: theme.accent }}>{s.toTitle}</strong>
                        </div>
                        {s.context && (
                          <div style={{ marginTop: 6, fontSize: 10, color: theme.textDim, fontStyle: "italic", lineHeight: 1.5, background: ta(theme.deepBg, 0.5), padding: "4px 8px", borderRadius: 4 }}>
                            "…{s.context}…"
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button onClick={() => approveSuggestion(s)}
                          style={{ fontSize: 11, padding: "6px 16px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, background: ta(meta.color, 0.15), border: "1px solid " + ta(meta.color, 0.4), color: meta.color }}>
                          ✓ Confirm
                        </button>
                        <button onClick={() => dismissSuggestion(s)}
                          style={{ fontSize: 11, padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", background: "transparent", border: "1px solid " + theme.border, color: theme.textDim }}>
                          Dismiss
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default FamilyTreeView;