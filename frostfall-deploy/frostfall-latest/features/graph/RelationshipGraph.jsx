"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Constants & helpers
// ─────────────────────────────────────────────────────────────────────────────
const CATEGORY_ORDER = [
  "character", "location", "event", "organization", "deity",
  "magic", "item", "race", "language", "flora_fauna", "laws_customs",
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ─────────────────────────────────────────────────────────────────────────────
// Force simulation (pure JS, no D3)
// ─────────────────────────────────────────────────────────────────────────────
function createSimulation(nodes, edges) {
  // Attach physics state directly on node objects
  nodes.forEach((n) => {
    if (n.vx === undefined) { n.vx = 0; n.vy = 0; }
  });

  function tick(W, H, alpha) {
    const k = Math.sqrt((W * H) / Math.max(1, nodes.length)) * 1.4;
    const cx = W / 2, cy = H / 2;

    // 1. Repulsion (Barnes-Hut approximation skipped for simplicity — O(n²) fine for ≤300 nodes)
    for (let i = 0; i < nodes.length; i++) {
      let fx = 0, fy = 0;
      const ni = nodes[i];
      for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue;
        const nj = nodes[j];
        const dx = ni.x - nj.x, dy = ni.y - nj.y;
        const d2 = dx * dx + dy * dy + 0.01;
        const d = Math.sqrt(d2);
        const f = (k * k) / d2;
        fx += (dx / d) * f;
        fy += (dy / d) * f;
      }
      ni.vx += fx * alpha * 0.7;
      ni.vy += fy * alpha * 0.7;
    }

    // 2. Spring attraction along edges
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const idealLen = k * 1.1;
    edges.forEach(({ from, to }) => {
      const a = nodeMap.get(from), b = nodeMap.get(to);
      if (!a || !b) return;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = ((d - idealLen) / d) * alpha * 0.4;
      a.vx += dx * f; a.vy += dy * f;
      b.vx -= dx * f; b.vy -= dy * f;
    });

    // 3. Center gravity
    nodes.forEach((n) => {
      n.vx += (cx - n.x) * alpha * 0.03;
      n.vy += (cy - n.y) * alpha * 0.03;
    });

    // 4. Integrate + damp
    nodes.forEach((n) => {
      if (n.pinned) return;
      // Clamp velocities to prevent explosion
      n.vx = Math.max(-40, Math.min(40, n.vx)) * 0.82;
      n.vy = Math.max(-40, Math.min(40, n.vy)) * 0.82;
      n.x += n.vx;
      n.y += n.vy;
      // Guard against NaN
      if (!isFinite(n.x)) n.x = W / 2;
      if (!isFinite(n.y)) n.y = H / 2;
      // Soft boundary
      const margin = 40;
      if (n.x < margin) n.vx += (margin - n.x) * 0.1;
      if (n.x > W - margin) n.vx -= (n.x - (W - margin)) * 0.1;
      if (n.y < margin) n.vy += (margin - n.y) * 0.1;
      if (n.y > H - margin) n.vy -= (n.y - (H - margin)) * 0.1;
    });
  }

  return { tick };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export function RelationshipGraph({ articles, CATEGORIES, theme, ta, onOpenArticle, isMobile }) {
  const canvasRef = useRef(null);
  const simRef = useRef(null);
  const nodesRef = useRef([]);
  const edgesRef = useRef([]);
  const rafRef = useRef(null);
  const alphaRef = useRef(1);
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const dragNodeRef = useRef(null);
  const panStartRef = useRef(null);
  const lastPointerRef = useRef(null);
  const hoveredRef = useRef(null);
  const focusedRef = useRef(null);
  const containerRef = useRef(null);

  // ── UI state ──
  const [activeCategories, setActiveCategories] = useState(new Set(["all"]));
  const [minConnections, setMinConnections] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [focused, setFocused] = useState(null);       // article id
  const [hovered, setHovered] = useState(null);       // article id
  const [detailArticle, setDetailArticle] = useState(null);
  const [simRunning, setSimRunning] = useState(true);
  const simRunningRef = useRef(true);
  const [zoom, setZoom] = useState(1);
  const [statsText, setStatsText] = useState("");

  // ── Derived filtered node set ──
  const filteredArticles = useMemo(() => {
    const catFilter = activeCategories.has("all")
      ? articles
      : articles.filter((a) => activeCategories.has(a.category));

    // Build connection counts including back-links
    const backLinks = new Map();
    articles.forEach((a) => {
      (a.linkedIds || []).forEach((lid) => {
        backLinks.set(lid, (backLinks.get(lid) || 0) + 1);
      });
    });

    return catFilter.filter((a) => {
      const out = (a.linkedIds || []).length;
      const back = backLinks.get(a.id) || 0;
      return (out + back) >= minConnections;
    });
  }, [articles, activeCategories, minConnections]);

  const filteredIds = useMemo(() => new Set(filteredArticles.map((a) => a.id)), [filteredArticles]);

  // ── Build / rebuild simulation when filter changes ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.width, H = canvas.height;

    // Preserve positions of existing nodes
    const existingPositions = new Map(nodesRef.current.map((n) => [n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy }]));

    const cx = W / 2, cy = H / 2;
    const nodes = filteredArticles.map((a, i) => {
      const existing = existingPositions.get(a.id);
      // Spread nodes in a sunflower pattern across most of the canvas
      const angle = i * 2.39996;
      const r = 60 + Math.sqrt(i) * Math.min(W, H) * 0.055;
      return {
        id: a.id, title: a.title, category: a.category,
        summary: a.summary || "",
        x: existing?.x ?? clamp(cx + r * Math.cos(angle), 60, W - 60),
        y: existing?.y ?? clamp(cy + r * Math.sin(angle), 60, H - 60),
        vx: existing?.vx ?? 0,
        vy: existing?.vy ?? 0,
        pinned: false,
        outDeg: (a.linkedIds || []).length,
        inDeg: 0,
      };
    });

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const edges = [];
    filteredArticles.forEach((a) => {
      (a.linkedIds || []).forEach((lid) => {
        if (nodeMap.has(lid)) {
          edges.push({ from: a.id, to: lid });
          nodeMap.get(lid).inDeg++;
        }
      });
    });
    nodes.forEach((n) => { n.totalDeg = n.outDeg + n.inDeg; });

    nodesRef.current = nodes;
    edgesRef.current = edges;
    simRef.current = createSimulation(nodes, edges);
    alphaRef.current = existingPositions.size > 0 ? 0.35 : 0.55;

    const totalConns = edges.length;
    setStatsText(`${nodes.length} nodes · ${totalConns} connections`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredArticles]);

  useEffect(() => { simRunningRef.current = simRunning; }, [simRunning]);
  useEffect(() => { focusedRef.current = focused; }, [focused]);
  useEffect(() => { hoveredRef.current = hovered; }, [hovered]);

  // ── Canvas render loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let stopped = false;

    const nodeRadius = (n) => clamp(6 + n.totalDeg * 1.8, 6, 26);

    function draw() {
      if (stopped) return;
      rafRef.current = requestAnimationFrame(draw);

      const W = canvas.width, H = canvas.height;
      const sim = simRef.current;
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const { x: tx, y: ty, scale } = transformRef.current;
      const foc = focusedRef.current;
      const hov = hoveredRef.current;

      // Tick simulation
      if (alphaRef.current > 0.005 && simRunningRef.current) {
        sim?.tick(W, H, alphaRef.current);
        alphaRef.current *= 0.994;
      }

      // Search matches
      const sq = searchQuery.trim().toLowerCase();
      const searchMatches = sq
        ? new Set(nodes.filter((n) => n.title.toLowerCase().includes(sq)).map((n) => n.id))
        : null;

      // Focus neighborhood
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));
      const focusNeighbors = foc
        ? new Set([foc, ...edges.filter((e) => e.from === foc || e.to === foc).flatMap((e) => [e.from, e.to])])
        : null;

      // Clear
      ctx.clearRect(0, 0, W, H);

      // Background
      ctx.fillStyle = theme.deepBg || "#0a0e1a";
      ctx.fillRect(0, 0, W, H);

      // Grid dots
      ctx.save();
      ctx.translate(tx, ty);
      ctx.scale(scale, scale);
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      const gridSpacing = 60;
      const gridOffX = ((-tx / scale) % gridSpacing + gridSpacing) % gridSpacing;
      const gridOffY = ((-ty / scale) % gridSpacing + gridSpacing) % gridSpacing;
      for (let gx = gridOffX - gridSpacing; gx < W / scale + gridSpacing; gx += gridSpacing) {
        for (let gy = gridOffY - gridSpacing; gy < H / scale + gridSpacing; gy += gridSpacing) {
          ctx.beginPath(); ctx.arc(gx, gy, 1, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();

      ctx.save();
      ctx.translate(tx, ty);
      ctx.scale(scale, scale);

      // ── Draw edges ──
      edges.forEach(({ from, to }) => {
        const a = nodeMap.get(from), b = nodeMap.get(to);
        if (!a || !b) return;
        if (!isFinite(a.x) || !isFinite(a.y) || !isFinite(b.x) || !isFinite(b.y)) return;

        const isFocused = focusNeighbors
          ? focusNeighbors.has(from) && focusNeighbors.has(to)
          : true;
        const isHovered = hov && (hov === from || hov === to);
        const isSearch = searchMatches && (searchMatches.has(from) || searchMatches.has(to));

        let alpha = 0.12;
        let width = 0.7;
        let color = theme.textDim || "#556677";

        if (isHovered) { alpha = 0.85; width = 2; color = theme.accent; }
        else if (foc && isFocused) { alpha = 0.6; width = 1.5; color = theme.accent; }
        else if (foc && !isFocused) { alpha = 0.03; }
        else if (isSearch) { alpha = 0.5; color = theme.accent; }

        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth = width / scale;

        // Arrow direction
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const rbEnd = nodeRadius(b);
        const ex = b.x - (dx / d) * rbEnd;
        const ey = b.y - (dy / d) * rbEnd;

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();

        // Arrowhead
        if (width > 1) {
          const aLen = 8 / scale;
          const angle = Math.atan2(dy, dx);
          ctx.globalAlpha = alpha * 0.9;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(ex, ey);
          ctx.lineTo(ex - aLen * Math.cos(angle - 0.4), ey - aLen * Math.sin(angle - 0.4));
          ctx.lineTo(ex - aLen * Math.cos(angle + 0.4), ey - aLen * Math.sin(angle + 0.4));
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      });

      // ── Draw nodes ──
      nodes.forEach((n) => {
        // Skip nodes with invalid coords (can happen during first tick)
        if (!isFinite(n.x) || !isFinite(n.y)) return;
        const cat = CATEGORIES[n.category] || {};
        const color = cat.color || theme.accent || "#f0c040";
        const r = nodeRadius(n);
        const isHov = hov === n.id;
        const isFoc = foc === n.id;
        const inFocusNeighbor = focusNeighbors ? focusNeighbors.has(n.id) : true;
        const isSearchMatch = searchMatches ? searchMatches.has(n.id) : false;

        const dimmed = (foc && !inFocusNeighbor) || (searchMatches && !isSearchMatch);
        const nodeAlpha = dimmed ? 0.12 : 1;

        ctx.globalAlpha = nodeAlpha;

        // Glow ring for focused/hovered
        if (isHov || isFoc || isSearchMatch) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 7, 0, Math.PI * 2);
          const glowColor = isFoc ? color : (isSearchMatch ? "#f0c040" : color);
          ctx.fillStyle = glowColor + "25";
          ctx.fill();
        }

        // Node fill
        // Node fill — flat color with opacity variation (gradients crash on NaN coords)
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = (isHov || isFoc) ? color : color + "88";
        ctx.fill();

        // Border
        ctx.strokeStyle = isHov || isFoc ? "#fff" : color + "aa";
        ctx.lineWidth = (isHov || isFoc ? 2 : 1) / scale;
        ctx.stroke();

        // Category icon (small)
        if (cat.icon && r > 10) {
          ctx.globalAlpha = nodeAlpha * (isHov || isFoc ? 1 : 0.85);
          ctx.font = `${clamp(r * 0.85, 9, 16)}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "#fff";
          ctx.fillText(cat.icon, n.x, n.y);
        }

        ctx.globalAlpha = 1;

        // Label
        const showLabel = isHov || isFoc || inFocusNeighbor || isSearchMatch || n.totalDeg >= 3;
        if (showLabel) {
          const label = n.title.length > 22 ? n.title.slice(0, 20) + "…" : n.title;
          const fontSize = clamp(9 + (isHov || isFoc ? 2 : 0), 9, 13);
          ctx.font = `${isHov || isFoc ? "700" : "400"} ${fontSize}px 'Cinzel', serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";

          // Label background
          const tw = ctx.measureText(label).width;
          ctx.globalAlpha = dimmed ? 0.08 : (isHov || isFoc ? 0.85 : 0.55);
          ctx.fillStyle = theme.deepBg || "#0a0e1a";
          ctx.fillRect(n.x - tw / 2 - 3, n.y + r + 4, tw + 6, fontSize + 4);

          // Label text
          ctx.globalAlpha = dimmed ? 0.1 : 1;
          ctx.fillStyle = isHov || isFoc ? theme.text || "#e2d9be" : (theme.textMuted || "#a8b4c2");
          ctx.fillText(label, n.x, n.y + r + 6);
          ctx.globalAlpha = 1;
        }
      });

      ctx.restore();
    }

    draw();
    return () => { stopped = true; cancelAnimationFrame(rafRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, searchQuery]);

  // ── Canvas resize observer ──
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ro = new ResizeObserver(() => {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      alphaRef.current = 0.3;
    });
    ro.observe(container);
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    return () => ro.disconnect();
  }, []);

  // ── Pointer helpers (canvas coords → world coords) ──
  const canvasToWorld = useCallback((cx, cy) => {
    const { x, y, scale } = transformRef.current;
    return { x: (cx - x) / scale, y: (cy - y) / scale };
  }, []);

  const hitTest = useCallback((wx, wy) => {
    const nodes = nodesRef.current;
    const clamp6to26 = (n) => clamp(6 + n.totalDeg * 1.8, 6, 26);
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const r = clamp6to26(n) + 4;
      if (Math.hypot(n.x - wx, n.y - wy) <= r) return n;
    }
    return null;
  }, []);

  // ── Mouse events ──
  const onMouseMove = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    lastPointerRef.current = { cx, cy };

    if (dragNodeRef.current) {
      const { x, y, scale } = transformRef.current;
      const n = dragNodeRef.current;
      n.x = (cx - x) / scale;
      n.y = (cy - y) / scale;
      n.vx = 0; n.vy = 0;
      n.pinned = true;
      alphaRef.current = Math.max(alphaRef.current, 0.05);
      return;
    }

    if (panStartRef.current) {
      const dx = cx - panStartRef.current.cx;
      const dy = cy - panStartRef.current.cy;
      transformRef.current = {
        ...transformRef.current,
        x: panStartRef.current.tx + dx,
        y: panStartRef.current.ty + dy,
      };
      return;
    }

    const { x: wx, y: wy } = canvasToWorld(cx, cy);
    const hit = hitTest(wx, wy);
    const newHov = hit?.id || null;
    if (newHov !== hoveredRef.current) {
      hoveredRef.current = newHov;
      setHovered(newHov);
      canvas.style.cursor = newHov ? "pointer" : "grab";
    }
  }, [canvasToWorld, hitTest]);

  const onMouseDown = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const { x: wx, y: wy } = canvasToWorld(cx, cy);
    const hit = hitTest(wx, wy);

    if (hit) {
      dragNodeRef.current = hit;
      canvas.style.cursor = "grabbing";
    } else {
      const { x, y } = transformRef.current;
      panStartRef.current = { cx, cy, tx: x, ty: y };
      canvas.style.cursor = "grabbing";
    }
  }, [canvasToWorld, hitTest]);

  const onClick = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { x: wx, y: wy } = canvasToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const hit = hitTest(wx, wy);

    if (hit) {
      const newFocus = focusedRef.current === hit.id ? null : hit.id;
      focusedRef.current = newFocus;
      setFocused(newFocus);
      setDetailArticle(newFocus ? hit : null);
    } else {
      focusedRef.current = null;
      setFocused(null);
      setDetailArticle(null);
    }
  }, [canvasToWorld, hitTest]);

  const onDblClick = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { x: wx, y: wy } = canvasToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const hit = hitTest(wx, wy);
    if (hit && onOpenArticle) onOpenArticle(hit.id);
  }, [canvasToWorld, hitTest, onOpenArticle]);

  const onMouseUp = useCallback(() => {
    dragNodeRef.current = null;
    panStartRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = hoveredRef.current ? "pointer" : "grab";
  }, []);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? 0.88 : 1.14;
    const { x, y, scale } = transformRef.current;
    const newScale = clamp(scale * delta, 0.15, 5);
    // Zoom toward cursor
    const newX = cx - (cx - x) * (newScale / scale);
    const newY = cy - (cy - y) * (newScale / scale);
    transformRef.current = { x: newX, y: newY, scale: newScale };
    setZoom(newScale);
  }, []);

  // Touch support
  const touchRef = useRef(null);
  const onTouchStart = useCallback((e) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const cx = t.clientX - rect.left, cy = t.clientY - rect.top;
      const { x: wx, y: wy } = canvasToWorld(cx, cy);
      const hit = hitTest(wx, wy);
      if (hit) { dragNodeRef.current = hit; }
      else {
        const { x, y } = transformRef.current;
        panStartRef.current = { cx, cy, tx: x, ty: y };
      }
      touchRef.current = { cx, cy };
    }
  }, [canvasToWorld, hitTest]);

  const onTouchMove = useCallback((e) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      const t = e.touches[0];
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const cx = t.clientX - rect.left, cy = t.clientY - rect.top;
      if (dragNodeRef.current) {
        const { x, y, scale } = transformRef.current;
        const n = dragNodeRef.current;
        n.x = (cx - x) / scale; n.y = (cy - y) / scale;
        n.vx = 0; n.vy = 0; n.pinned = true;
      } else if (panStartRef.current) {
        transformRef.current = {
          ...transformRef.current,
          x: panStartRef.current.tx + cx - panStartRef.current.cx,
          y: panStartRef.current.ty + cy - panStartRef.current.cy,
        };
      }
    }
  }, []);

  const onTouchEnd = useCallback(() => { dragNodeRef.current = null; panStartRef.current = null; }, []);

  // Reset view
  const resetView = useCallback(() => {
    transformRef.current = { x: 0, y: 0, scale: 1 };
    setZoom(1);
    // Unpin all
    nodesRef.current.forEach((n) => { n.pinned = false; });
    alphaRef.current = 0.8;
  }, []);

  const reheat = useCallback(() => { alphaRef.current = 0.8; setSimRunning(true); }, []);

  // Toggle category filter
  const toggleCategory = useCallback((key) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (key === "all") return new Set(["all"]);
      next.delete("all");
      if (next.has(key)) {
        next.delete(key);
        if (next.size === 0) return new Set(["all"]);
      } else {
        next.add(key);
      }
      return next;
    });
    alphaRef.current = 0.6;
  }, []);

  // ── Render ──
  const ta2 = (hex, a) => {
    if (!hex || hex.startsWith("rgba")) return hex;
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  };

  // Get detail info for the focused node
  const focusedArticle = useMemo(() => {
    if (!detailArticle) return null;
    return articles.find((a) => a.id === detailArticle.id) || null;
  }, [detailArticle, articles]);

  const focusedConnections = useMemo(() => {
    if (!focusedArticle) return { outgoing: [], incoming: [] };
    const outgoing = (focusedArticle.linkedIds || [])
      .map((id) => articles.find((a) => a.id === id))
      .filter(Boolean);
    const incoming = articles.filter((a) => a.linkedIds?.includes(focusedArticle.id));
    return { outgoing, incoming };
  }, [focusedArticle, articles]);

  const presentCategories = useMemo(
    () => CATEGORY_ORDER.filter((k) => articles.some((a) => a.category === k)),
    [articles]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: theme.deepBg, overflow: "hidden" }}>

      {/* ── Toolbar ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "10px 16px",
        background: ta2(theme.sidebarBg, 0.95), borderBottom: "1px solid " + theme.border,
        flexShrink: 0, flexWrap: "wrap", zIndex: 10,
      }}>
        {/* Title */}
        <span style={{ fontFamily: "'Cinzel', serif", fontSize: 14, fontWeight: 700, color: theme.text, letterSpacing: 1, marginRight: 4, flexShrink: 0 }}>
          ◉ Relationship Web
        </span>
        <span style={{ fontSize: 10, color: theme.textDim, marginRight: 8, flexShrink: 0 }}>{statsText}</span>

        <div style={{ width: 1, height: 20, background: theme.divider, flexShrink: 0 }} />

        {/* Search */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: theme.textDim, fontSize: 12, pointerEvents: "none" }}>⌕</span>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Highlight…"
            style={{
              background: ta2(theme.surface, 0.7), border: "1px solid " + theme.border,
              borderRadius: 6, padding: "5px 10px 5px 26px", color: theme.text,
              fontSize: 11, width: 130, outline: "none", fontFamily: "inherit",
            }}
          />
        </div>

        <div style={{ width: 1, height: 20, background: theme.divider, flexShrink: 0 }} />

        {/* Min connections */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: theme.textDim, whiteSpace: "nowrap" }}>Min links:</span>
          <input type="range" min={0} max={10} value={minConnections}
            onChange={(e) => { setMinConnections(Number(e.target.value)); alphaRef.current = 0.5; }}
            style={{ width: 70, accentColor: theme.accent, cursor: "pointer" }} />
          <span style={{ fontSize: 10, color: theme.accent, width: 12, textAlign: "center" }}>{minConnections}</span>
        </div>

        <div style={{ width: 1, height: 20, background: theme.divider, flexShrink: 0 }} />

        {/* Action buttons */}
        <button onClick={reheat} title="Re-run layout"
          style={{ fontSize: 11, color: theme.textMuted, background: ta2(theme.surface, 0.6), border: "1px solid " + theme.border, borderRadius: 6, padding: "4px 10px", cursor: "pointer", flexShrink: 0 }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = theme.accent; e.currentTarget.style.color = theme.accent; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = theme.border; e.currentTarget.style.color = theme.textMuted; }}>
          ↺ Relayout
        </button>
        <button onClick={resetView} title="Reset pan & zoom"
          style={{ fontSize: 11, color: theme.textMuted, background: ta2(theme.surface, 0.6), border: "1px solid " + theme.border, borderRadius: 6, padding: "4px 10px", cursor: "pointer", flexShrink: 0 }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = theme.accent; e.currentTarget.style.color = theme.accent; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = theme.border; e.currentTarget.style.color = theme.textMuted; }}>
          ⌖ Reset View
        </button>
        <button onClick={() => setSimRunning((v) => !v)} title={simRunning ? "Pause simulation" : "Resume simulation"}
          style={{ fontSize: 11, color: simRunning ? theme.accent : theme.textDim, background: ta2(theme.surface, 0.6), border: "1px solid " + (simRunning ? ta2(theme.accent, 0.3) : theme.border), borderRadius: 6, padding: "4px 10px", cursor: "pointer", flexShrink: 0 }}>
          {simRunning ? "⏸ Pause" : "▶ Run"}
        </button>

        {/* Zoom indicator */}
        <span style={{ fontSize: 10, color: theme.textDim, marginLeft: "auto", flexShrink: 0 }}>
          {Math.round(zoom * 100)}%
        </span>
      </div>

      {/* ── Category filter bar ── */}
      <div style={{
        display: "flex", gap: 4, padding: "8px 16px", flexShrink: 0,
        background: ta2(theme.sidebarBg, 0.7), borderBottom: "1px solid " + ta2(theme.border, 0.5),
        overflowX: "auto", flexWrap: isMobile ? "wrap" : "nowrap",
      }}>
        {[{ key: "all", label: "All", color: theme.accent, icon: "◈" },
          ...presentCategories.map((k) => ({ key: k, ...CATEGORIES[k] }))
        ].map((f) => {
          const active = activeCategories.has(f.key);
          return (
            <button key={f.key} onClick={() => toggleCategory(f.key)}
              style={{
                fontSize: 10, padding: "3px 10px", borderRadius: 12, cursor: "pointer", flexShrink: 0,
                fontWeight: active ? 700 : 400, letterSpacing: 0.3,
                background: active ? ta2(f.color, 0.18) : "transparent",
                color: active ? f.color : theme.textDim,
                border: "1px solid " + (active ? ta2(f.color, 0.4) : ta2(theme.border, 0.5)),
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = f.color; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = theme.textDim; }}>
              {f.icon} {f.label}
            </button>
          );
        })}
      </div>

      {/* ── Main canvas area + detail panel ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>

        {/* Canvas */}
        <div ref={containerRef} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <canvas
            ref={canvasRef}
            style={{ display: "block", cursor: "grab", touchAction: "none" }}
            onMouseMove={onMouseMove}
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onClick={onClick}
            onDoubleClick={onDblClick}
            onWheel={onWheel}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          />

          {/* Hint overlay — only when empty */}
          {nodesRef.current.length === 0 && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <div style={{ textAlign: "center", color: theme.textDim }}>
                <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>◉</div>
                <p style={{ fontSize: 14, margin: 0 }}>No connected articles to display.</p>
                <p style={{ fontSize: 11, marginTop: 6, opacity: 0.6 }}>Create articles and link them with @mentions to see the relationship web.</p>
              </div>
            </div>
          )}

          {/* Controls hint */}
          <div style={{
            position: "absolute", bottom: 12, left: 12,
            fontSize: 10, color: ta2(theme.textDim, 0.6),
            lineHeight: 1.7, pointerEvents: "none",
          }}>
            Scroll to zoom · Drag to pan · Click node to focus · Double-click to open
          </div>
        </div>

        {/* ── Detail panel ── */}
        {focusedArticle && (
          <div style={{
            width: isMobile ? "100%" : 280, flexShrink: 0,
            background: ta2(theme.sidebarBg, 0.97),
            borderLeft: "1px solid " + theme.border,
            display: "flex", flexDirection: "column",
            overflowY: "auto",
            animation: "slideInRight 0.18s ease",
            ...(isMobile ? { position: "absolute", bottom: 0, left: 0, right: 0, height: "55%", borderTop: "1px solid " + theme.border, borderLeft: "none" } : {}),
          }}>
            <style>{`@keyframes slideInRight { from { transform: translateX(100%); opacity:0 } to { transform: translateX(0); opacity:1 } }`}</style>

            {/* Article header */}
            {(() => {
              const cat = CATEGORIES[focusedArticle.category] || {};
              return (
                <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid " + theme.divider }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                        <span style={{ fontSize: 14 }}>{cat.icon}</span>
                        <span style={{ fontSize: 10, color: cat.color, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{cat.label}</span>
                      </div>
                      <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: theme.text, margin: 0, lineHeight: 1.3 }}>
                        {focusedArticle.title}
                      </h3>
                      {focusedArticle.summary && (
                        <p style={{ fontSize: 11, color: theme.textMuted, margin: "8px 0 0", lineHeight: 1.5 }}>
                          {focusedArticle.summary.slice(0, 140)}{focusedArticle.summary.length > 140 ? "…" : ""}
                        </p>
                      )}
                    </div>
                    <button onClick={() => { setFocused(null); setDetailArticle(null); focusedRef.current = null; }}
                      style={{ background: "none", border: "none", color: theme.textDim, fontSize: 16, cursor: "pointer", padding: 2, flexShrink: 0 }}>×</button>
                  </div>
                  <button onClick={() => onOpenArticle && onOpenArticle(focusedArticle.id)}
                    style={{ marginTop: 10, width: "100%", padding: "7px 0", fontSize: 12, fontFamily: "'Cinzel', serif", fontWeight: 600, letterSpacing: 0.5, background: ta2(cat.color || theme.accent, 0.12), border: "1px solid " + ta2(cat.color || theme.accent, 0.3), borderRadius: 6, color: cat.color || theme.accent, cursor: "pointer" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = ta2(cat.color || theme.accent, 0.22); }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = ta2(cat.color || theme.accent, 0.12); }}>
                    Open Article →
                  </button>
                </div>
              );
            })()}

            {/* Connection stats */}
            <div style={{ padding: "10px 16px", borderBottom: "1px solid " + theme.divider, display: "flex", gap: 16 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: theme.accent }}>{focusedConnections.outgoing.length}</div>
                <div style={{ fontSize: 9, color: theme.textDim, textTransform: "uppercase", letterSpacing: 0.5 }}>Outgoing</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: theme.accent }}>{focusedConnections.incoming.length}</div>
                <div style={{ fontSize: 9, color: theme.textDim, textTransform: "uppercase", letterSpacing: 0.5 }}>Incoming</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: theme.accent }}>{focusedConnections.outgoing.length + focusedConnections.incoming.length}</div>
                <div style={{ fontSize: 9, color: theme.textDim, textTransform: "uppercase", letterSpacing: 0.5 }}>Total</div>
              </div>
            </div>

            {/* Connections list */}
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
              {focusedConnections.outgoing.length > 0 && (
                <div>
                  <div style={{ padding: "6px 16px 4px", fontSize: 9, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>Links to</div>
                  {focusedConnections.outgoing.map((a) => {
                    const cat = CATEGORIES[a.category] || {};
                    return (
                      <div key={a.id} onClick={() => {
                        const node = nodesRef.current.find((n) => n.id === a.id);
                        if (node) { focusedRef.current = a.id; setFocused(a.id); setDetailArticle(node); }
                      }}
                        style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 16px", cursor: "pointer", transition: "background 0.12s" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = ta2(theme.surface, 0.7); }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                        <span style={{ fontSize: 13, flexShrink: 0 }}>{cat.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, color: theme.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</div>
                          <div style={{ fontSize: 9, color: cat.color }}>{cat.label}</div>
                        </div>
                        <span style={{ fontSize: 10, color: theme.textDim, flexShrink: 0 }}>→</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {focusedConnections.incoming.length > 0 && (
                <div>
                  <div style={{ padding: "6px 16px 4px", fontSize: 9, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>Referenced by</div>
                  {focusedConnections.incoming.map((a) => {
                    const cat = CATEGORIES[a.category] || {};
                    return (
                      <div key={a.id} onClick={() => {
                        const node = nodesRef.current.find((n) => n.id === a.id);
                        if (node) { focusedRef.current = a.id; setFocused(a.id); setDetailArticle(node); }
                      }}
                        style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 16px", cursor: "pointer", transition: "background 0.12s" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = ta2(theme.surface, 0.7); }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                        <span style={{ fontSize: 13, flexShrink: 0 }}>{cat.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 11, color: theme.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</div>
                          <div style={{ fontSize: 9, color: cat.color }}>{cat.label}</div>
                        </div>
                        <span style={{ fontSize: 10, color: theme.textDim, flexShrink: 0 }}>←</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {focusedConnections.outgoing.length === 0 && focusedConnections.incoming.length === 0 && (
                <div style={{ padding: "20px 16px", textAlign: "center", color: theme.textDim, fontSize: 12 }}>
                  No connections yet. Use @mentions in the article body to create links.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default RelationshipGraph;