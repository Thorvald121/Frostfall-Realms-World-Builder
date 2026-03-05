"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { MAP_ICONS, ICON_CATEGORIES, MapIcon, createNewMap } from "@/lib/domain/mapIcons";
import { CATEGORIES } from "@/lib/domain/categories";

const ta = (hex, alpha) => {
  if (!hex) return "transparent";
  if (hex.startsWith("rgba")) return hex;
  if (hex.startsWith("rgb(")) return hex.replace("rgb(", "rgba(").replace(")", `,${alpha})`);
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};
const pointInPoly = (px, py, pts) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const ptDist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

export function MapBuilder({ theme, articles, settings, isMobile, activeWorld, navigate, maps, setMaps, S, tBtnS, tBtnP }) {

  const [activeMapId, setActiveMapId] = useState(null);
  const activeMap = useMemo(() => maps.find((m) => m.id === activeMapId) || maps[0] || null, [maps, activeMapId]);
  useEffect(() => { if (maps.length > 0 && !maps.find((m) => m.id === activeMapId)) setActiveMapId(maps[0].id); }, [maps, activeMapId]);

  const [tool, setTool] = useState("select");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [selected, setSelected] = useState(null);
  const [drawing, setDrawing] = useState(null);
  const [editPanel, setEditPanel] = useState(null);
  const [layerPanelOpen, setLayerPanelOpen] = useState(false);
  const [measurePoints, setMeasurePoints] = useState([]);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newMapName, setNewMapName] = useState("");
  const containerRef = useRef(null);
  const fileRef = useRef(null);

  const updateMap = useCallback((updater) => {
    if (!activeMap) return;
    setMaps((prev) => prev.map((m) => m.id === activeMap.id ? (typeof updater === "function" ? updater(m) : { ...m, ...updater }) : m));
  }, [activeMap, setMaps]);

  const layers = activeMap?.layerVisibility || { pins: true, territories: true, labels: true, routes: true, grid: false, fog: false, legend: true };
  const toggleLayer = (key) => updateMap((m) => ({ ...m, layerVisibility: { ...m.layerVisibility, [key]: !m.layerVisibility[key] } }));
  const grid = activeMap?.gridSettings || { type: "none", size: 50, opacity: 0.2, color: "#ffffff" };
  const scale = activeMap?.scaleSettings || { pixelsPerUnit: 100, unitName: "miles", unitDistance: 50 };

  const addMap = () => { const m = createNewMap("Map " + (maps.length + 1)); setMaps((prev) => [...prev, m]); setActiveMapId(m.id); setEditPanel(null); setSelected(null); };
  const deleteMap = () => { if (maps.length <= 1) return; setMaps((prev) => prev.filter((m) => m.id !== activeMap.id)); setEditPanel(null); setSelected(null); };
  const renameMap = (name) => { updateMap({ name }); setRenaming(false); };

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8000000) { alert("Image must be under 8MB"); return; }
    const reader = new FileReader();
    reader.onload = (ev) => { const img = new Image(); img.onload = () => { updateMap({ image: ev.target.result, imageW: img.naturalWidth, imageH: img.naturalHeight }); setZoom(1); setPan({ x: 0, y: 0 }); }; img.src = ev.target.result; };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleClick = (e) => {
    if (!activeMap?.image || dragging) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left - pan.x) / zoom;
    const y = (e.clientY - rect.top - pan.y) / zoom;
    const nx = x / activeMap.imageW, ny = y / activeMap.imageH;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;

    if (tool === "pin") {
      const pin = { id: "pin_" + Date.now(), x: nx, y: ny, label: "New Pin", icon: "waypoint", iconSize: 24, color: theme.accent, linkedArticleId: null, description: "" };
      updateMap((m) => ({ ...m, pins: [...m.pins, pin] }));
      setEditPanel(pin); setSelected({ type: "pin", id: pin.id });
    } else if (tool === "territory" || tool === "route" || tool === "fog") {
      setDrawing((prev) => prev && prev.type === tool ? { ...prev, points: [...prev.points, { x: nx, y: ny }] } : { type: tool, points: [{ x: nx, y: ny }] });
    } else if (tool === "label") {
      const lbl = { id: "lbl_" + Date.now(), x: nx, y: ny, text: "Label", fontSize: 16, color: theme.accent, rotation: 0 };
      updateMap((m) => ({ ...m, labels: [...m.labels, lbl] }));
      setEditPanel(lbl); setSelected({ type: "label", id: lbl.id });
    } else if (tool === "measure") {
      setMeasurePoints((prev) => prev.length >= 2 ? [{ x: nx, y: ny }] : [...prev, { x: nx, y: ny }]);
    } else if (tool === "select") {
      const clickedPin = activeMap.pins.find((p) => Math.abs(p.x - nx) < 0.02 && Math.abs(p.y - ny) < 0.02);
      if (clickedPin) { setEditPanel(clickedPin); setSelected({ type: "pin", id: clickedPin.id }); return; }
      const clickedLabel = activeMap.labels.find((l) => Math.abs(l.x - nx) < 0.03 && Math.abs(l.y - ny) < 0.02);
      if (clickedLabel) { setEditPanel(clickedLabel); setSelected({ type: "label", id: clickedLabel.id }); return; }
      const clickedTerr = activeMap.territories.find((t) => pointInPoly(nx, ny, t.points));
      if (clickedTerr) { setEditPanel(clickedTerr); setSelected({ type: "territory", id: clickedTerr.id }); return; }
      const clickedRoute = activeMap.routes.find((r) => r.points.some((p) => ptDist(p, { x: nx, y: ny }) < 0.02));
      if (clickedRoute) { setEditPanel(clickedRoute); setSelected({ type: "route", id: clickedRoute.id }); return; }
      setEditPanel(null); setSelected(null);
    } else if (tool === "erase") {
      const pin = activeMap.pins.find((p) => Math.abs(p.x - nx) < 0.02 && Math.abs(p.y - ny) < 0.02);
      if (pin) { updateMap((m) => ({ ...m, pins: m.pins.filter((p) => p.id !== pin.id) })); if (selected?.id === pin.id) { setSelected(null); setEditPanel(null); } return; }
      const lbl = activeMap.labels.find((l) => Math.abs(l.x - nx) < 0.03 && Math.abs(l.y - ny) < 0.02);
      if (lbl) { updateMap((m) => ({ ...m, labels: m.labels.filter((l) => l.id !== lbl.id) })); return; }
      const terr = activeMap.territories.find((t) => pointInPoly(nx, ny, t.points));
      if (terr) { updateMap((m) => ({ ...m, territories: m.territories.filter((t) => t.id !== terr.id) })); return; }
      const route = activeMap.routes.find((r) => r.points.some((p) => ptDist(p, { x: nx, y: ny }) < 0.02));
      if (route) { updateMap((m) => ({ ...m, routes: m.routes.filter((r) => r.id !== route.id) })); return; }
      const fog = activeMap.fogAreas.find((f) => pointInPoly(nx, ny, f.points));
      if (fog) { updateMap((m) => ({ ...m, fogAreas: m.fogAreas.filter((f) => f.id !== fog.id) })); return; }
    }
  };

  const finishDrawing = () => {
    if (!drawing || drawing.points.length < (drawing.type === "route" ? 2 : 3)) return;
    if (drawing.type === "territory") {
      const terr = { id: "terr_" + Date.now(), points: drawing.points, label: "New Territory", color: theme.accent, fill: ta(theme.accent, 0.15), opacity: 0.15, linkedArticleId: null, description: "" };
      updateMap((m) => ({ ...m, territories: [...m.territories, terr] }));
      setEditPanel(terr); setSelected({ type: "territory", id: terr.id });
    } else if (drawing.type === "route") {
      const route = { id: "route_" + Date.now(), points: drawing.points, label: "New Route", color: "#d4a060", style: "solid", width: 3, description: "" };
      updateMap((m) => ({ ...m, routes: [...m.routes, route] }));
      setEditPanel(route); setSelected({ type: "route", id: route.id });
    } else if (drawing.type === "fog") {
      const fog = { id: "fog_" + Date.now(), points: drawing.points };
      updateMap((m) => ({ ...m, fogAreas: [...m.fogAreas, fog] }));
    }
    setDrawing(null);
  };

  const handleMouseDown = (e) => { if (tool === "select" && !editPanel) { setDragging(true); setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y }); } };
  const handleMouseMove = (e) => { if (dragging) setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y }); };
  const handleMouseUp = () => setDragging(false);
  const handleWheel = useCallback((e) => { e.preventDefault(); setZoom((z) => Math.max(0.15, Math.min(8, z + (e.deltaY > 0 ? -0.1 : 0.1)))); }, []);

  const updateItem = (id, changes) => {
    const k = id.startsWith("pin_") ? "pins" : id.startsWith("terr_") ? "territories" : id.startsWith("route_") ? "routes" : id.startsWith("lbl_") ? "labels" : null;
    if (!k) return;
    updateMap((m) => ({ ...m, [k]: m[k].map((i) => i.id === id ? { ...i, ...changes } : i) }));
    setEditPanel((prev) => prev?.id === id ? { ...prev, ...changes } : prev);
  };
  const deleteItem = (id) => {
    const k = id.startsWith("pin_") ? "pins" : id.startsWith("terr_") ? "territories" : id.startsWith("route_") ? "routes" : id.startsWith("lbl_") ? "labels" : id.startsWith("fog_") ? "fogAreas" : null;
    if (!k) return;
    updateMap((m) => ({ ...m, [k]: m[k].filter((i) => i.id !== id) }));
    setEditPanel(null); setSelected(null);
  };

  const measureDistance = useMemo(() => {
    if (measurePoints.length < 2 || !activeMap) return null;
    const px = ptDist(measurePoints[0], measurePoints[1]) * activeMap.imageW;
    const units = (px / scale.pixelsPerUnit) * scale.unitDistance;
    return { px, units, label: `${Math.round(units * 10) / 10} ${scale.unitName}` };
  }, [measurePoints, activeMap, scale]);

  const centerOn = (nx, ny) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !activeMap) return;
    setPan({ x: rect.width / 2 - nx * activeMap.imageW * zoom, y: rect.height / 2 - ny * activeMap.imageH * zoom });
  };

  const TOOLS = [
    { id: "select", icon: "☝", tip: "Select / Pan" }, { id: "pin", icon: "📌", tip: "Place Marker" },
    { id: "territory", icon: "⬡", tip: "Draw Territory" }, { id: "route", icon: "〰", tip: "Draw Route" },
    { id: "label", icon: "Aa", tip: "Place Label" }, { id: "fog", icon: "☁", tip: "Fog of War" },
    { id: "measure", icon: "📏", tip: "Measure" }, { id: "erase", icon: "✕", tip: "Erase" },
  ];
  const PALETTE = [theme.accent, "#e07050", "#7ec8e3", "#8ec8a0", "#c084fc", "#d4a060", "#e0c878", "#a088d0", "#f472b6", "#64748b"];
  const ROUTE_STYLES = [{ id: "solid", label: "Road", dash: "none" }, { id: "dashed", label: "Trail", dash: "8,4" }, { id: "dotted", label: "Sea", dash: "3,5" }, { id: "dashdot", label: "Border", dash: "12,4,3,4" }];

  const iconCounts = useMemo(() => {
    if (!activeMap) return {};
    const c = {}; activeMap.pins.forEach((p) => { c[p.icon] = (c[p.icon] || 0) + 1; }); return c;
  }, [activeMap]);

  // ═══════════ RENDER ═══════════

  if (!activeMap && maps.length === 0) {
    return (
      <div style={{ margin: "0 -28px", height: "calc(100vh - 56px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20 }}>
        <div style={{ fontSize: 64, opacity: 0.25 }}>🗺</div>
        <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 24, color: theme.text, margin: 0 }}>Map Builder</h2>
        <p style={{ fontSize: 13, color: theme.textDim, maxWidth: 380, textAlign: "center", lineHeight: 1.7 }}>Create interactive maps of your world. Place markers, draw territories, plot routes, add fog of war, and more.</p>
        <button onClick={addMap} style={{ ...tBtnP, fontSize: 14 }}>+ Create First Map</button>
      </div>
    );
  }

  const iW = activeMap?.imageW || 0, iH = activeMap?.imageH || 0;
  const cur = tool === "pin" || tool === "territory" || tool === "route" || tool === "label" || tool === "fog" || tool === "measure" ? "crosshair" : tool === "erase" ? "not-allowed" : dragging ? "grabbing" : "grab";

  return (
    <div style={{ margin: "0 -28px", height: "calc(100vh - 56px)", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* ═══ HEADER ═══ */}
      <div style={{ padding: "8px 16px", borderBottom: "1px solid " + theme.divider, display: "flex", alignItems: "center", gap: 10, flexShrink: 0, background: ta(theme.surface, 0.3), flexWrap: "wrap" }}>
        <span style={{ fontSize: 18 }}>🗺</span>
        {renaming ? (
          <input autoFocus value={newMapName} onChange={(e) => setNewMapName(e.target.value)}
            onBlur={() => renameMap(newMapName || activeMap.name)} onKeyDown={(e) => { if (e.key === "Enter") renameMap(newMapName || activeMap.name); if (e.key === "Escape") setRenaming(false); }}
            style={{ ...S.input, width: 160, fontSize: 13, padding: "3px 8px", fontFamily: "'Cinzel', serif", fontWeight: 700 }} />
        ) : (
          <select value={activeMap?.id || ""} onChange={(e) => { setActiveMapId(e.target.value); setEditPanel(null); setSelected(null); setZoom(1); setPan({ x: 0, y: 0 }); }}
            style={{ ...S.input, padding: "3px 8px", fontSize: 13, fontFamily: "'Cinzel', serif", fontWeight: 700, minWidth: 120, cursor: "pointer" }}>
            {maps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
        <button onClick={() => { setRenaming(true); setNewMapName(activeMap?.name || ""); }} title="Rename" style={{ ...tBtnS, padding: "2px 7px", fontSize: 10 }}>✏</button>
        <button onClick={addMap} title="New map" style={{ ...tBtnS, padding: "2px 7px", fontSize: 10, color: "#8ec8a0" }}>+</button>
        {maps.length > 1 && <button onClick={deleteMap} title="Delete map" style={{ ...tBtnS, padding: "2px 7px", fontSize: 10, color: "#e07050" }}>🗑</button>}
        <div style={{ width: 1, height: 22, background: theme.border }} />
        <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          {TOOLS.map((t) => (
            <button key={t.id} title={t.tip} onClick={() => { setTool(t.id); if (drawing && t.id !== drawing?.type) setDrawing(null); if (t.id !== "measure") setMeasurePoints([]); }}
              style={{ padding: "4px 9px", fontSize: 12, background: tool === t.id ? ta(theme.accent, 0.2) : "transparent", border: "1px solid " + (tool === t.id ? ta(theme.accent, 0.5) : theme.border), borderRadius: 5, color: tool === t.id ? theme.accent : theme.textMuted, cursor: "pointer", transition: "all 0.15s", fontFamily: "inherit" }}>
              {t.icon}
            </button>
          ))}
        </div>
        <div style={{ width: 1, height: 22, background: theme.border }} />
        <button onClick={() => fileRef.current?.click()} style={{ ...tBtnS, fontSize: 10, padding: "4px 9px" }}>📷 Upload</button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleImageUpload} />
        <div style={{ display: "flex", alignItems: "center", gap: 3, marginLeft: "auto" }}>
          <button onClick={() => setLayerPanelOpen(!layerPanelOpen)} style={{ ...tBtnS, padding: "3px 9px", fontSize: 10, color: layerPanelOpen ? theme.accent : theme.textMuted, border: "1px solid " + (layerPanelOpen ? ta(theme.accent, 0.4) : theme.border) }}>☰ Layers</button>
          <span style={{ fontSize: 10, color: theme.textDim, minWidth: 34, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(8, z + 0.25))} style={{ ...tBtnS, padding: "2px 6px", fontSize: 12 }}>+</button>
          <button onClick={() => setZoom((z) => Math.max(0.15, z - 0.25))} style={{ ...tBtnS, padding: "2px 6px", fontSize: 12 }}>−</button>
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} style={{ ...tBtnS, padding: "2px 7px", fontSize: 9 }}>FIT</button>
        </div>
      </div>

      {/* ═══ STATUS BARS ═══ */}
      {drawing && (
        <div style={{ padding: "5px 16px", background: ta(theme.accent, 0.06), borderBottom: "1px solid " + ta(theme.accent, 0.2), display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: theme.accent }}>Drawing {drawing.type} — {drawing.points.length} pt{drawing.points.length !== 1 ? "s" : ""}</span>
          <button onClick={finishDrawing} disabled={drawing.points.length < (drawing.type === "route" ? 2 : 3)} style={{ ...tBtnP, fontSize: 9, padding: "3px 10px", opacity: drawing.points.length < (drawing.type === "route" ? 2 : 3) ? 0.4 : 1 }}>Finish</button>
          <button onClick={() => setDrawing(null)} style={{ ...tBtnS, fontSize: 9, padding: "3px 10px" }}>Cancel</button>
        </div>
      )}
      {tool === "measure" && (
        <div style={{ padding: "5px 16px", background: ta("#7ec8e3", 0.06), borderBottom: "1px solid " + ta("#7ec8e3", 0.2), display: "flex", alignItems: "center", gap: 10, flexShrink: 0, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "#7ec8e3" }}>📏 Measure</span>
          {measureDistance ? <span style={{ fontSize: 12, fontWeight: 700, color: theme.text, fontFamily: "'Cinzel', serif" }}>{measureDistance.label}</span> : <span style={{ fontSize: 10, color: theme.textDim }}>Click two points</span>}
          <button onClick={() => setMeasurePoints([])} style={{ ...tBtnS, fontSize: 9, padding: "2px 8px" }}>Clear</button>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, fontSize: 9, color: theme.textDim }}>
            <input type="number" value={scale.unitDistance} onChange={(e) => updateMap((m) => ({ ...m, scaleSettings: { ...m.scaleSettings, unitDistance: Number(e.target.value) || 1 } }))} style={{ ...S.input, width: 44, padding: "2px 4px", fontSize: 9 }} />
            <input value={scale.unitName} onChange={(e) => updateMap((m) => ({ ...m, scaleSettings: { ...m.scaleSettings, unitName: e.target.value } }))} style={{ ...S.input, width: 44, padding: "2px 4px", fontSize: 9 }} />
            <span>per</span>
            <input type="number" value={scale.pixelsPerUnit} onChange={(e) => updateMap((m) => ({ ...m, scaleSettings: { ...m.scaleSettings, pixelsPerUnit: Number(e.target.value) || 1 } }))} style={{ ...S.input, width: 44, padding: "2px 4px", fontSize: 9 }} />
            <span>px</span>
          </div>
        </div>
      )}

      {/* ═══ MAIN ═══ */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Layer panel */}
        {layerPanelOpen && (
          <div style={{ width: 190, borderRight: "1px solid " + theme.divider, padding: "10px 8px", overflowY: "auto", flexShrink: 0, background: ta(theme.surface, 0.3) }}>
            <h4 style={{ fontFamily: "'Cinzel', serif", fontSize: 11, color: theme.text, margin: "0 0 8px", letterSpacing: 0.5 }}>Layers</h4>
            {[
              { key: "pins", label: "Markers", icon: "📌", count: activeMap?.pins.length },
              { key: "territories", label: "Territories", icon: "⬡", count: activeMap?.territories.length },
              { key: "routes", label: "Routes", icon: "〰", count: activeMap?.routes.length },
              { key: "labels", label: "Labels", icon: "Aa", count: activeMap?.labels.length },
              { key: "grid", label: "Grid", icon: "▦" },
              { key: "fog", label: "Fog of War", icon: "☁", count: activeMap?.fogAreas.length },
              { key: "legend", label: "Legend", icon: "☰" },
            ].map((l) => (
              <div key={l.key} onClick={() => toggleLayer(l.key)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 6px", borderRadius: 5, cursor: "pointer", marginBottom: 1, background: layers[l.key] ? ta(theme.accent, 0.05) : "transparent" }}>
                <span style={{ fontSize: 12, width: 18, textAlign: "center", opacity: layers[l.key] ? 1 : 0.3 }}>{layers[l.key] ? "👁" : "🚫"}</span>
                <span style={{ fontSize: 10, flex: 1, color: layers[l.key] ? theme.text : theme.textDim }}>{l.icon} {l.label}</span>
                {l.count != null && <span style={{ fontSize: 8, color: theme.textDim }}>{l.count}</span>}
              </div>
            ))}
            <div style={{ marginTop: 10, borderTop: "1px solid " + theme.divider, paddingTop: 8 }}>
              <div style={{ fontSize: 9, color: theme.textDim, marginBottom: 6, letterSpacing: 0.5, textTransform: "uppercase" }}>Grid</div>
              <div style={{ display: "flex", gap: 3 }}>
                {["none", "square", "hex"].map((t) => (
                  <button key={t} onClick={() => updateMap((m) => ({ ...m, gridSettings: { ...m.gridSettings, type: t }, layerVisibility: { ...m.layerVisibility, grid: t !== "none" } }))}
                    style={{ ...tBtnS, fontSize: 9, padding: "2px 8px", flex: 1, color: grid.type === t ? theme.accent : theme.textDim, border: "1px solid " + (grid.type === t ? ta(theme.accent, 0.4) : theme.border) }}>
                    {t === "none" ? "Off" : t === "square" ? "□" : "⬡"}
                  </button>
                ))}
              </div>
              {grid.type !== "none" && (<>
                <label style={{ fontSize: 8, color: theme.textDim, display: "block", marginTop: 6 }}>Size: {grid.size}px</label>
                <input type="range" min="20" max="200" value={grid.size} onChange={(e) => updateMap((m) => ({ ...m, gridSettings: { ...m.gridSettings, size: Number(e.target.value) } }))} style={{ width: "100%", accentColor: theme.accent }} />
                <label style={{ fontSize: 8, color: theme.textDim, display: "block", marginTop: 4 }}>Opacity: {Math.round(grid.opacity * 100)}%</label>
                <input type="range" min="5" max="60" value={Math.round(grid.opacity * 100)} onChange={(e) => updateMap((m) => ({ ...m, gridSettings: { ...m.gridSettings, opacity: Number(e.target.value) / 100 } }))} style={{ width: "100%", accentColor: theme.accent }} />
              </>)}
            </div>
          </div>
        )}

        {/* Canvas */}
        <div ref={containerRef} style={{ flex: 1, overflow: "hidden", position: "relative", background: "#060a12", cursor: cur }}
          onClick={handleClick} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} onWheel={handleWheel}>

          {!activeMap?.image ? (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
              <div style={{ fontSize: 52, opacity: 0.2 }}>🗺</div>
              <p style={{ fontFamily: "'Cinzel', serif", fontSize: 17, color: theme.textDim }}>Upload a Map Image</p>
              <p style={{ fontSize: 11, color: "#334455", maxWidth: 360, textAlign: "center", lineHeight: 1.7 }}>Upload a PNG, JPG, or WebP of your world map. Then use the toolbar to place markers, draw territories, and more.</p>
              <button onClick={() => fileRef.current?.click()} style={{ ...tBtnP, fontSize: 12 }}>Choose Image</button>
            </div>
          ) : (
            <div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "0 0", position: "relative", width: iW, height: iH }}>
              <img src={activeMap.image} style={{ width: iW, height: iH, display: "block", userSelect: "none", pointerEvents: "none" }} draggable={false} alt="Map" />

              <svg style={{ position: "absolute", top: 0, left: 0, width: iW, height: iH, pointerEvents: "none" }}>
                {/* Grid */}
                {layers.grid && grid.type === "square" && (
                  <g opacity={grid.opacity}>
                    {Array.from({ length: Math.ceil(iW / grid.size) + 1 }, (_, i) => <line key={"gv" + i} x1={i * grid.size} y1={0} x2={i * grid.size} y2={iH} stroke={grid.color} strokeWidth={0.5} />)}
                    {Array.from({ length: Math.ceil(iH / grid.size) + 1 }, (_, i) => <line key={"gh" + i} x1={0} y1={i * grid.size} x2={iW} y2={i * grid.size} stroke={grid.color} strokeWidth={0.5} />)}
                  </g>
                )}
                {layers.grid && grid.type === "hex" && (
                  <g opacity={grid.opacity}>
                    {(() => { const s = grid.size, h = s * Math.sqrt(3), els = []; for (let row = 0; row < Math.ceil(iH / h) + 1; row++) for (let col = 0; col < Math.ceil(iW / (s * 1.5)) + 1; col++) { const cx = col * s * 1.5, cy = row * h + (col % 2 ? h / 2 : 0); const pts = Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 180) * (60 * i - 30); return `${cx + s * Math.cos(a)},${cy + s * Math.sin(a)}`; }).join(" "); els.push(<polygon key={`h${row}_${col}`} points={pts} fill="none" stroke={grid.color} strokeWidth={0.5} />); } return els; })()}
                  </g>
                )}

                {/* Territories */}
                {layers.territories && activeMap.territories.map((t) => (
                  <g key={t.id}>
                    <polygon points={t.points.map((p) => `${p.x * iW},${p.y * iH}`).join(" ")}
                      fill={selected?.id === t.id ? ta(theme.accent, 0.25) : (t.fill || ta(t.color, t.opacity || 0.15))}
                      stroke={selected?.id === t.id ? theme.accent : (t.color || theme.accent)}
                      strokeWidth={selected?.id === t.id ? 3 : 2} strokeDasharray={selected?.id === t.id ? "none" : "6,3"} />
                    {t.label && t.points.length > 0 && (
                      <text x={t.points.reduce((s, p) => s + p.x, 0) / t.points.length * iW} y={t.points.reduce((s, p) => s + p.y, 0) / t.points.length * iH}
                        textAnchor="middle" fill={t.color || theme.accent} fontSize={14 / Math.max(zoom, 0.3)} fontFamily="'Cinzel', serif" fontWeight="700"
                        stroke={theme.deepBg || "#0a0e1a"} strokeWidth={3 / Math.max(zoom, 0.3)} paintOrder="stroke">{t.label}</text>
                    )}
                  </g>
                ))}

                {/* Routes */}
                {layers.routes && activeMap.routes.map((r) => {
                  const rs = ROUTE_STYLES.find((s) => s.id === r.style) || ROUTE_STYLES[0];
                  return (<g key={r.id}>
                    <polyline points={r.points.map((p) => `${p.x * iW},${p.y * iH}`).join(" ")} fill="none"
                      stroke={selected?.id === r.id ? theme.accent : (r.color || "#d4a060")} strokeWidth={selected?.id === r.id ? r.width + 2 : r.width}
                      strokeDasharray={rs.dash} strokeLinecap="round" strokeLinejoin="round" />
                    {r.label && r.points.length >= 2 && (() => { const mp = r.points[Math.floor(r.points.length / 2)]; return (
                      <text x={mp.x * iW} y={mp.y * iH - 8 / zoom} textAnchor="middle" fill={r.color || "#d4a060"} fontSize={11 / Math.max(zoom, 0.3)} fontFamily="'Cinzel', serif" fontWeight="600"
                        stroke={theme.deepBg || "#0a0e1a"} strokeWidth={2.5 / Math.max(zoom, 0.3)} paintOrder="stroke">{r.label}</text>
                    ); })()}
                  </g>);
                })}

                {/* Drawing preview */}
                {drawing && drawing.points.length > 1 && (
                  <polyline points={drawing.points.map((p) => `${p.x * iW},${p.y * iH}`).join(" ")}
                    fill={drawing.type === "territory" || drawing.type === "fog" ? ta(theme.accent, 0.1) : "none"}
                    stroke={drawing.type === "fog" ? "#334455" : theme.accent} strokeWidth={2} strokeDasharray="4,4" opacity={0.7} />
                )}
                {drawing && drawing.points.map((p, i) => <circle key={i} cx={p.x * iW} cy={p.y * iH} r={4 / Math.max(zoom, 0.3)} fill={theme.accent} />)}

                {/* Fog */}
                {layers.fog && activeMap.fogAreas.map((f) => (
                  <polygon key={f.id} points={f.points.map((p) => `${p.x * iW},${p.y * iH}`).join(" ")} fill="rgba(6,10,18,0.85)" stroke="#1a2030" strokeWidth={1} />
                ))}

                {/* Measure */}
                {measurePoints.length === 2 && (<g>
                  <line x1={measurePoints[0].x * iW} y1={measurePoints[0].y * iH} x2={measurePoints[1].x * iW} y2={measurePoints[1].y * iH} stroke="#7ec8e3" strokeWidth={2} strokeDasharray="6,4" />
                  <circle cx={measurePoints[0].x * iW} cy={measurePoints[0].y * iH} r={5} fill="#7ec8e3" />
                  <circle cx={measurePoints[1].x * iW} cy={measurePoints[1].y * iH} r={5} fill="#7ec8e3" />
                  {measureDistance && <text x={(measurePoints[0].x + measurePoints[1].x) / 2 * iW} y={(measurePoints[0].y + measurePoints[1].y) / 2 * iH - 10 / zoom} textAnchor="middle" fill="#7ec8e3" fontSize={13 / Math.max(zoom, 0.3)} fontFamily="'Cinzel', serif" fontWeight="700" stroke="#060a12" strokeWidth={3 / Math.max(zoom, 0.3)} paintOrder="stroke">{measureDistance.label}</text>}
                </g>)}
                {measurePoints.length === 1 && <circle cx={measurePoints[0].x * iW} cy={measurePoints[0].y * iH} r={5} fill="#7ec8e3" opacity={0.7} />}
              </svg>

              {/* Pins */}
              {layers.pins && activeMap.pins.map((pin) => {
                const linked = pin.linkedArticleId ? articles.find((a) => a.id === pin.linkedArticleId) : null;
                const isSel = selected?.id === pin.id;
                const sz = pin.iconSize || 24;
                return (
                  <div key={pin.id} style={{ position: "absolute", left: pin.x * iW - sz / 2, top: pin.y * iH - sz, pointerEvents: "auto", cursor: "pointer", zIndex: isSel ? 10 : 1 }}>
                    <div style={{ filter: isSel ? `drop-shadow(0 0 8px ${ta(theme.accent, 0.9)})` : "drop-shadow(0 2px 4px rgba(0,0,0,0.7))", transform: isSel ? "scale(1.25)" : "scale(1)", transition: "all 0.15s" }}>
                      <MapIcon icon={pin.icon || "waypoint"} size={sz} color={pin.color || theme.accent} />
                    </div>
                    <div style={{ position: "absolute", top: -14 / Math.max(zoom, 0.4), left: "50%", transform: "translateX(-50%)", whiteSpace: "nowrap", fontSize: 10 / Math.max(zoom, 0.4), fontWeight: 700, color: pin.color || theme.accent, textShadow: "0 1px 3px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.8)", fontFamily: "'Cinzel', serif", letterSpacing: 0.5 }}>
                      {pin.label}{linked ? " ↗" : ""}
                    </div>
                  </div>
                );
              })}

              {/* Labels */}
              {layers.labels && activeMap.labels.map((lbl) => {
                const isSel = selected?.id === lbl.id;
                return (
                  <div key={lbl.id} style={{ position: "absolute", left: lbl.x * iW, top: lbl.y * iH, pointerEvents: "auto", cursor: tool === "select" ? "pointer" : "default",
                    transform: `translate(-50%, -50%) rotate(${lbl.rotation || 0}deg)`,
                    fontSize: (lbl.fontSize || 16) / Math.max(zoom, 0.2), fontFamily: "'Cinzel', serif", fontWeight: 700, letterSpacing: 2,
                    color: lbl.color || theme.accent, textShadow: "0 2px 6px rgba(0,0,0,0.9), 0 0 12px rgba(0,0,0,0.7)",
                    whiteSpace: "nowrap", zIndex: isSel ? 10 : 2, outline: isSel ? `2px dashed ${theme.accent}` : "none", outlineOffset: 4, textTransform: "uppercase" }}>
                    {lbl.text}
                  </div>
                );
              })}
            </div>
          )}

          {/* Legend */}
          {activeMap?.image && layers.legend && (activeMap.pins.length > 0 || activeMap.territories.length > 0 || activeMap.routes.length > 0) && (
            <div style={{ position: "absolute", bottom: 12, left: layerPanelOpen ? 202 : 12, background: ta(theme.deepBg || "#0a0e1a", 0.88), border: "1px solid " + theme.divider, borderRadius: 8, padding: "8px 12px", maxWidth: 200, backdropFilter: "blur(8px)", zIndex: 20 }}>
              <div style={{ fontFamily: "'Cinzel', serif", fontSize: 9, color: theme.textDim, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Legend</div>
              {Object.entries(iconCounts).map(([k, n]) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 5, padding: "1px 0" }}>
                  <MapIcon icon={k} size={12} color={theme.accent} />
                  <span style={{ fontSize: 9, color: theme.text }}>{MAP_ICONS[k]?.label || k}</span>
                  <span style={{ fontSize: 8, color: theme.textDim, marginLeft: "auto" }}>×{n}</span>
                </div>
              ))}
              {activeMap.territories.length > 0 && (
                <div style={{ marginTop: 3, paddingTop: 3, borderTop: "1px solid " + theme.divider }}>
                  {activeMap.territories.map((t) => (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 5, padding: "1px 0" }}>
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: t.fill || ta(t.color, 0.15), border: "1px solid " + (t.color || theme.accent) }} />
                      <span style={{ fontSize: 9, color: theme.text }}>{t.label}</span>
                    </div>
                  ))}
                </div>
              )}
              {activeMap.routes.length > 0 && (
                <div style={{ marginTop: 3, paddingTop: 3, borderTop: "1px solid " + theme.divider }}>
                  {activeMap.routes.map((r) => (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 5, padding: "1px 0" }}>
                      <svg width={16} height={3}><line x1={0} y1={1.5} x2={16} y2={1.5} stroke={r.color} strokeWidth={2} strokeDasharray={(ROUTE_STYLES.find((s) => s.id === r.style) || ROUTE_STYLES[0]).dash} /></svg>
                      <span style={{ fontSize: 9, color: theme.text }}>{r.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Edit panel */}
        {editPanel && (
          <div style={{ width: isMobile ? "100%" : 270, borderLeft: isMobile ? "none" : "1px solid " + theme.divider, padding: "12px 10px", overflowY: "auto", flexShrink: 0, background: ta(theme.surface, 0.3) }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 12, color: theme.text, margin: 0 }}>
                {editPanel.id?.startsWith("pin_") ? "📌 Marker" : editPanel.id?.startsWith("terr_") ? "⬡ Territory" : editPanel.id?.startsWith("route_") ? "〰 Route" : "Aa Label"}
              </h3>
              <span onClick={() => { setEditPanel(null); setSelected(null); }} style={{ cursor: "pointer", color: theme.textDim, fontSize: 13 }}>✕</span>
            </div>

            {/* Label/Text */}
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 8, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 2 }}>{editPanel.id?.startsWith("lbl_") ? "Text" : "Label"}</label>
              <input style={{ ...S.input, fontSize: 11 }} value={editPanel.id?.startsWith("lbl_") ? (editPanel.text || "") : (editPanel.label || "")}
                onChange={(e) => updateItem(editPanel.id, { [editPanel.id?.startsWith("lbl_") ? "text" : "label"]: e.target.value })} />
            </div>

            {/* Pin: icon picker */}
            {editPanel.id?.startsWith("pin_") && (<>
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 8, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 2 }}>Icon</label>
                <button onClick={() => setIconPickerOpen(!iconPickerOpen)} style={{ ...tBtnS, display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", width: "100%" }}>
                  <MapIcon icon={editPanel.icon || "waypoint"} size={16} color={editPanel.color || theme.accent} />
                  <span style={{ fontSize: 10, color: theme.text }}>{MAP_ICONS[editPanel.icon]?.label || "Waypoint"}</span>
                  <span style={{ marginLeft: "auto", fontSize: 9, color: theme.textDim }}>▾</span>
                </button>
                {iconPickerOpen && (
                  <div style={{ marginTop: 3, background: ta(theme.surface, 0.8), border: "1px solid " + theme.divider, borderRadius: 6, padding: 6, maxHeight: 220, overflowY: "auto" }}>
                    {ICON_CATEGORIES.map((cat) => (
                      <div key={cat.key} style={{ marginBottom: 5 }}>
                        <div style={{ fontSize: 8, color: theme.textDim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>{cat.label}</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                          {cat.icons.map((ik) => (
                            <div key={ik} title={MAP_ICONS[ik].label} onClick={() => { updateItem(editPanel.id, { icon: ik }); setIconPickerOpen(false); }}
                              style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 5, cursor: "pointer",
                                background: editPanel.icon === ik ? ta(theme.accent, 0.15) : "transparent", border: "1px solid " + (editPanel.icon === ik ? ta(theme.accent, 0.4) : "transparent") }}>
                              <MapIcon icon={ik} size={16} color={editPanel.color || theme.accent} />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 8, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 2 }}>Size: {editPanel.iconSize || 24}px</label>
                <input type="range" min="12" max="48" value={editPanel.iconSize || 24} onChange={(e) => updateItem(editPanel.id, { iconSize: Number(e.target.value) })} style={{ width: "100%", accentColor: theme.accent }} />
              </div>
            </>)}

            {/* Label: font size + rotation */}
            {editPanel.id?.startsWith("lbl_") && (<>
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 8, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 2 }}>Font Size: {editPanel.fontSize || 16}</label>
                <input type="range" min="8" max="72" value={editPanel.fontSize || 16} onChange={(e) => updateItem(editPanel.id, { fontSize: Number(e.target.value) })} style={{ width: "100%", accentColor: theme.accent }} />
              </div>
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 8, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 2 }}>Rotation: {editPanel.rotation || 0}°</label>
                <input type="range" min="-90" max="90" value={editPanel.rotation || 0} onChange={(e) => updateItem(editPanel.id, { rotation: Number(e.target.value) })} style={{ width: "100%", accentColor: theme.accent }} />
              </div>
            </>)}

            {/* Route: style + width */}
            {editPanel.id?.startsWith("route_") && (<>
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 8, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 2 }}>Style</label>
                <div style={{ display: "flex", gap: 3 }}>
                  {ROUTE_STYLES.map((s) => (
                    <button key={s.id} onClick={() => updateItem(editPanel.id, { style: s.id })}
                      style={{ ...tBtnS, flex: 1, fontSize: 8, padding: "3px 4px", color: editPanel.style === s.id ? theme.accent : theme.textDim, border: "1px solid " + (editPanel.style === s.id ? ta(theme.accent, 0.4) : theme.border) }}>{s.label}</button>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 8, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 2 }}>Width: {editPanel.width || 3}px</label>
                <input type="range" min="1" max="8" value={editPanel.width || 3} onChange={(e) => updateItem(editPanel.id, { width: Number(e.target.value) })} style={{ width: "100%", accentColor: theme.accent }} />
              </div>
            </>)}

            {/* Territory: opacity */}
            {editPanel.id?.startsWith("terr_") && (
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 8, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 2 }}>Opacity: {Math.round((editPanel.opacity || 0.15) * 100)}%</label>
                <input type="range" min="0" max="60" value={Math.round((editPanel.opacity || 0.15) * 100)}
                  onChange={(e) => { const op = Number(e.target.value) / 100; updateItem(editPanel.id, { opacity: op, fill: ta(editPanel.color || theme.accent, op) }); }}
                  style={{ width: "100%", accentColor: theme.accent }} />
              </div>
            )}

            {/* Color */}
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 8, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 2 }}>Color</label>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {PALETTE.map((c) => (
                  <div key={c} onClick={() => { const ch = { color: c }; if (editPanel.id?.startsWith("terr_")) ch.fill = ta(c, editPanel.opacity || 0.15); updateItem(editPanel.id, ch); }}
                    style={{ width: 20, height: 20, borderRadius: 3, background: c, cursor: "pointer", border: "2px solid " + (editPanel.color === c ? "#fff" : "transparent") }} />
                ))}
              </div>
            </div>

            {/* Description */}
            {(editPanel.id?.startsWith("pin_") || editPanel.id?.startsWith("terr_") || editPanel.id?.startsWith("route_")) && (
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 8, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 2 }}>Description</label>
                <textarea style={{ ...S.input, minHeight: 50, resize: "vertical", fontSize: 10 }} value={editPanel.description || ""} onChange={(e) => updateItem(editPanel.id, { description: e.target.value })} placeholder="Notes..." />
              </div>
            )}

            {/* Link to article */}
            {(editPanel.id?.startsWith("pin_") || editPanel.id?.startsWith("terr_")) && (
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 8, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 2 }}>Link to Article</label>
                <select style={{ ...S.input, padding: "6px 8px", fontSize: 10 }} value={editPanel.linkedArticleId || ""}
                  onChange={(e) => { const v = e.target.value || null; const ch = { linkedArticleId: v }; if (v) { const art = articles.find((a) => a.id === v); if (art && (editPanel.label === "New Pin" || editPanel.label === "New Territory")) ch.label = art.title; } updateItem(editPanel.id, ch); }}>
                  <option value="">— None —</option>
                  {articles.filter((a) => a.category === "location" || a.category === "organization" || a.category === "race").sort((a, b) => a.title.localeCompare(b.title)).map((a) => <option key={a.id} value={a.id}>{CATEGORIES[a.category]?.icon} {a.title}</option>)}
                  <optgroup label="All Articles">
                    {articles.filter((a) => a.category !== "location" && a.category !== "organization" && a.category !== "race").sort((a, b) => a.title.localeCompare(b.title)).map((a) => <option key={a.id} value={a.id}>{CATEGORIES[a.category]?.icon} {a.title}</option>)}
                  </optgroup>
                </select>
                {editPanel.linkedArticleId && (() => { const linked = articles.find((a) => a.id === editPanel.linkedArticleId); return linked ? (
                  <div onClick={() => navigate(linked.id)} style={{ marginTop: 4, padding: "6px 8px", background: ta(theme.accent, 0.06), border: "1px solid " + ta(theme.accent, 0.15), borderRadius: 5, cursor: "pointer" }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: theme.text }}>{CATEGORIES[linked.category]?.icon} {linked.title}</div>
                    {linked.summary && <div style={{ fontSize: 8, color: theme.textDim, marginTop: 1 }}>{linked.summary.slice(0, 60)}…</div>}
                    <div style={{ fontSize: 7, color: theme.accent, marginTop: 2 }}>View article →</div>
                  </div>
                ) : null; })()}
              </div>
            )}

            {/* Center */}
            {(editPanel.x != null && editPanel.y != null) && (
              <button onClick={() => centerOn(editPanel.x, editPanel.y)} style={{ ...tBtnS, fontSize: 9, width: "100%", marginBottom: 6 }}>◎ Center on Map</button>
            )}
            {editPanel.points?.length > 0 && !editPanel.x && (
              <button onClick={() => { const cx = editPanel.points.reduce((s, p) => s + p.x, 0) / editPanel.points.length; const cy = editPanel.points.reduce((s, p) => s + p.y, 0) / editPanel.points.length; centerOn(cx, cy); }}
                style={{ ...tBtnS, fontSize: 9, width: "100%", marginBottom: 6 }}>◎ Center on Map</button>
            )}

            {/* Delete */}
            <div style={{ borderTop: "1px solid " + theme.divider, paddingTop: 8 }}>
              <button onClick={() => deleteItem(editPanel.id)} style={{ ...tBtnS, fontSize: 9, color: "#e07050", border: "1px solid rgba(224,112,80,0.3)", width: "100%" }}>
                Delete {editPanel.id?.startsWith("pin_") ? "Marker" : editPanel.id?.startsWith("terr_") ? "Territory" : editPanel.id?.startsWith("route_") ? "Route" : "Label"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}