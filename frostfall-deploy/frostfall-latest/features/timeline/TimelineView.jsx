"use client";

import React, { useRef } from "react";
import { CATEGORIES, categoryPluralLabel, formatKey, SWIM_LANE_ORDER } from "@/lib/domain/categories";

/**
 * TimelineView — horizontal swim-lane timeline with zoom, era bands, and detail panel.
 * Extracted from FrostfallRealms.jsx renderTimeline.
 * Owns scroll-sync refs internally.
 */
export function TimelineView({
  theme,
  articles,
  activeWorld,
  activeEras,
  isMobile,
  navigate,
  goEdit,
  conflictsFor,
  // useTimeline returns
  tlZoom, setTlZoom, tlSelected, tlData, tlRange,
  yearToX, tlTotalWidth, tlTicks, tlSelectArticle,
  tlClosePanel, tlLaneHeights, tlPanelOpen,
  // Shared UI
  ta, tBtnS, tBtnP, tTag, Ornament, WarningBanner, RenderBody, S,
}) {
  // Scroll-sync refs (owned by this component)
  const tlRef = useRef(null);
  const tlLabelRef = useRef(null);
  const tlSyncing = useRef(false);

  return (
    <div style={{ margin: "0 -28px", height: "calc(100vh - 56px)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Timeline Header */}
      <div style={{ padding: "20px 28px 12px", borderBottom: "1px solid " + theme.divider, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div>
          <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: theme.text, margin: 0, letterSpacing: 1, display: "flex", alignItems: "center", gap: 10 }}>⏳ Timeline of {activeWorld?.name || "Your World"}</h2>
          <p style={{ fontSize: 12, color: theme.textDim, marginTop: 4 }}>{tlData.items.length} temporal entries across {Object.keys(tlData.lanes).length} categories</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: theme.textDim, letterSpacing: 0.5 }}>ZOOM</span>
          <button onClick={() => setTlZoom((z) => Math.max(0, z - 1))} style={{ ...tBtnS, padding: "4px 10px", fontSize: 14, lineHeight: 1 }} disabled={tlZoom <= 0}>−</button>
          <div style={{ width: 80, height: 4, background: theme.border, borderRadius: 2, position: "relative" }}>
            <div style={{ position: "absolute", left: `${(tlZoom / 6) * 100}%`, top: -4, width: 12, height: 12, background: theme.accent, borderRadius: "50%", transform: "translateX(-50%)", boxShadow: "0 0 8px " + ta(theme.accent, 0.4) }} />
          </div>
          <button onClick={() => setTlZoom((z) => Math.min(6, z + 1))} style={{ ...tBtnS, padding: "4px 10px", fontSize: 14, lineHeight: 1 }} disabled={tlZoom >= 6}>+</button>
        </div>
      </div>

      {/* Timeline Body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Swim Lane Labels */}
        <div ref={tlLabelRef} onScroll={(e) => { if (tlSyncing.current) return; tlSyncing.current = true; if (tlRef.current) tlRef.current.scrollTop = e.target.scrollTop; tlSyncing.current = false; }} style={{ width: 160, minWidth: 160, borderRight: "1px solid " + theme.divider, background: ta(theme.deepBg, 0.6), flexShrink: 0, overflowY: "auto" }}>
          {/* Era header spacer */}
          <div style={{ height: 52, borderBottom: "1px solid " + theme.divider, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 10, color: theme.textDim, letterSpacing: 2, textTransform: "uppercase" }}>Categories</span>
          </div>
          {/* Tick row spacer */}
          <div style={{ height: 28, borderBottom: "1px solid " + theme.divider }} />
          {SWIM_LANE_ORDER.map((cat) => {
            if (!tlData.lanes[cat]) return null;
            const c = CATEGORIES[cat];
            const h = tlLaneHeights[cat] || 50;
            return (
              <div key={cat} style={{ height: h, minHeight: 50, borderBottom: "1px solid " + theme.divider, display: "flex", alignItems: "center", gap: 8, padding: "0 16px" }}>
                <span style={{ fontSize: 16, color: c.color }}>{c.icon}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: c.color, letterSpacing: 0.5 }}>{categoryPluralLabel(cat)}</div>
                  <div style={{ fontSize: 10, color: theme.textDim }}>{tlData.lanes[cat].length} entries</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Scrollable Timeline Canvas */}
        <div ref={tlRef} onScroll={(e) => { if (tlSyncing.current) return; tlSyncing.current = true; if (tlLabelRef.current) tlLabelRef.current.scrollTop = e.target.scrollTop; tlSyncing.current = false; }} style={{ flex: 1, overflowX: "auto", overflowY: "auto", position: "relative" }}>
          <div style={{ width: Math.max(tlTotalWidth + 100, 800), minHeight: "100%", position: "relative" }}>
            {/* Era Bands */}
            <div style={{ height: 52, position: "sticky", top: 0, zIndex: 10, display: "flex", background: ta(theme.deepBg, 0.95), borderBottom: "1px solid " + theme.divider, backdropFilter: "blur(8px)" }}>
              {activeEras.map((era, ei) => {
                const x = yearToX(Math.max(era.start, tlRange.min));
                const xEnd = yearToX(Math.min(era.end, tlRange.max));
                const w = xEnd - x;
                if (w <= 0) return null;
                return (
                  <div key={era.id || "era_" + ei} style={{ position: "absolute", left: x, width: w, height: "100%", background: era.bg || era.color + "0f", borderRight: "1px solid " + era.color + "30", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                    <span style={{ fontFamily: "'Cinzel', serif", fontSize: w > 200 ? 12 : 9, color: era.color, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600, whiteSpace: "nowrap", opacity: w > 60 ? 1 : 0.5 }}>{w > 140 ? (era.label || era.name) : (era.label || era.name || "").split("—")[0]?.trim()}</span>
                  </div>
                );
              })}
            </div>

            {/* Year Ticks */}
            <div style={{ height: 28, position: "relative", borderBottom: "1px solid " + theme.divider }}>
              {tlTicks.ticks.map((y) => (
                <div key={y} style={{ position: "absolute", left: yearToX(y), top: 0, height: "100%" }}>
                  <div style={{ width: 1, height: "100%", background: theme.divider }} />
                  <span style={{ position: "absolute", top: 6, left: 4, fontSize: 9, color: theme.textDim, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{y < 0 ? `${Math.abs(y)} BA` : `Year ${y.toLocaleString()}`}</span>
                </div>
              ))}
            </div>

            {/* Swim Lanes */}
            {SWIM_LANE_ORDER.map((cat) => {
              if (!tlData.lanes[cat]) return null;
              const c = CATEGORIES[cat];
              const entries = tlData.lanes[cat];
              const placed = [];
              const entryRows = {};
              entries.forEach((a) => {
                const x = yearToX(a.temporal.active_start);
                const hasEnd = a.temporal.active_end != null && a.temporal.active_end !== a.temporal.active_start;
                const xEnd = hasEnd ? yearToX(a.temporal.active_end) : x + 28;
                let row = 0;
                while (placed.some((p) => p.row === row && p.xEnd > x - 4 && p.x < xEnd + 4)) row++;
                placed.push({ id: a.id, x, xEnd, row });
                entryRows[a.id] = row;
              });
              const maxRow = Math.max(0, ...Object.values(entryRows));
              const laneH = 40 + maxRow * 30;
              return (
                <div key={cat} style={{ height: laneH, minHeight: 50, borderBottom: "1px solid " + theme.divider, position: "relative" }}>
                  {tlTicks.ticks.map((y) => (
                    <div key={y} style={{ position: "absolute", left: yearToX(y), top: 0, width: 1, height: "100%", background: "rgba(30,42,58,0.4)" }} />
                  ))}
                  {entries.map((a) => {
                    const x = yearToX(a.temporal.active_start);
                    const hasEnd = a.temporal.active_end != null && a.temporal.active_end !== a.temporal.active_start;
                    const w = hasEnd ? Math.max(yearToX(a.temporal.active_end) - x, 8) : null;
                    const isSelected = tlSelected?.id === a.id;
                    const isDead = a.temporal.death_year != null;
                    const row = entryRows[a.id] || 0;
                    const topOff = 6 + row * 30;

                    if (w && w > 3) {
                      return (
                        <div key={a.id} onClick={() => tlSelectArticle(a)} title={a.title} style={{
                          position: "absolute", left: x, top: topOff, height: 26, width: w,
                          background: isSelected ? c.color + "40" : c.color + "18",
                          border: "1px solid " + (isSelected ? c.color : c.color + "50"),
                          borderRadius: 4, cursor: "pointer", transition: "all 0.2s",
                          display: "flex", alignItems: "center", overflow: "hidden", padding: "0 6px",
                          boxShadow: isSelected ? "0 0 12px " + c.color + "30" : "none",
                          zIndex: isSelected ? 5 : 1,
                        }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = c.color + "35"; e.currentTarget.style.border = "1px solid " + c.color; e.currentTarget.style.zIndex = "10"; }}
                          onMouseLeave={(e) => { if (!isSelected) { e.currentTarget.style.background = c.color + "18"; e.currentTarget.style.border = "1px solid " + c.color + "50"; e.currentTarget.style.zIndex = "1"; } }}>
                          <span style={{ fontSize: 10, color: isSelected ? "#e8dcc8" : c.color, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", letterSpacing: 0.3 }}>
                            {a.title}{isDead ? " †" : ""}
                          </span>
                        </div>
                      );
                    }
                    return (
                      <div key={a.id} onClick={() => tlSelectArticle(a)} className="tl-node" style={{
                        position: "absolute", left: x - 7, top: topOff, width: 28, height: 26,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        cursor: "pointer", zIndex: isSelected ? 5 : 1, transition: "all 0.2s",
                      }}>
                        <style>{`.tl-node .tl-tip { opacity: 0; transition: opacity 0.15s; pointer-events: none; } .tl-node:hover .tl-tip { opacity: 1; }`}</style>
                        <div style={{
                          width: isSelected ? 14 : 10, height: isSelected ? 14 : 10,
                          background: isSelected ? c.color : c.color + "80",
                          borderRadius: "50%", border: "2px solid " + c.color,
                          boxShadow: isSelected ? "0 0 12px " + c.color + "60" : "0 0 6px " + c.color + "20",
                          transition: "all 0.2s",
                        }}
                          onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.3)"; e.currentTarget.style.boxShadow = "0 0 12px " + c.color + "60"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; if (!isSelected) e.currentTarget.style.boxShadow = "0 0 6px " + c.color + "20"; }}
                        />
                        <div className="tl-tip" style={{ position: "absolute", top: -20, left: "50%", transform: "translateX(-50%)", fontSize: 9, color: theme.text, whiteSpace: "nowrap", background: ta(theme.deepBg, 0.95), padding: "2px 8px", borderRadius: 4, border: "1px solid " + c.color + "40", zIndex: 20 }}>{a.title}{isDead ? " †" : ""}</div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Side Panel */}
        <div style={{
          width: tlPanelOpen ? 320 : 0, minWidth: tlPanelOpen ? 320 : 0,
          borderLeft: tlPanelOpen ? "1px solid " + theme.divider : "none",
          background: ta(theme.deepBg, 0.95), backdropFilter: "blur(10px)",
          transition: "all 0.3s ease", overflow: "hidden", flexShrink: 0,
        }}>
          {tlSelected && (
            <div style={{ width: isMobile ? "100%" : 320, padding: "20px 18px 60px", overflowY: "auto", height: "100%", boxSizing: "border-box" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <span style={S.catBadge(CATEGORIES[tlSelected.category]?.color)}>
                  {CATEGORIES[tlSelected.category]?.icon} {CATEGORIES[tlSelected.category]?.label}
                </span>
                <span onClick={tlClosePanel} style={{ fontSize: 16, color: theme.textDim, cursor: "pointer", padding: "4px 8px", borderRadius: 4 }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = theme.text; }} onMouseLeave={(e) => { e.currentTarget.style.color = theme.textDim; }}>✕</span>
              </div>
              <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 18, color: theme.text, margin: "0 0 6px", letterSpacing: 0.5 }}>{tlSelected.title}</h3>
              <p style={{ fontSize: 12, color: theme.textMuted, fontStyle: "italic", lineHeight: 1.5, margin: "0 0 16px" }}>{tlSelected.summary}</p>
              <Ornament width={280} />

              {/* Temporal badge */}
              <div style={{ fontSize: 11, color: theme.textDim, margin: "14px 0", padding: "6px 10px", background: "rgba(85,102,119,0.08)", borderRadius: 6, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <span>⏳ {tlSelected.temporal?.type}</span>
                {tlSelected.temporal?.active_start != null && <span>From: Year {tlSelected.temporal.active_start}</span>}
                {tlSelected.temporal?.active_end != null && <span>To: Year {tlSelected.temporal.active_end}</span>}
                {tlSelected.temporal?.death_year && <span style={{ color: "#e07050" }}>† Year {tlSelected.temporal.death_year}</span>}
              </div>

              {/* Key fields */}
              {tlSelected.fields && Object.keys(tlSelected.fields).length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  {Object.entries(tlSelected.fields).slice(0, 4).map(([k, v]) => (
                    <div key={k} style={{ display: "flex", padding: "5px 0", borderBottom: "1px solid " + theme.surface }}>
                      <div style={{ width: 100, fontSize: 10, color: theme.textDim, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>{formatKey(k)}</div>
                      <div style={{ flex: 1, fontSize: 12, color: "#c8bda0", lineHeight: 1.4 }}>{v}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Conflict warnings */}
              {conflictsFor(tlSelected.id).map((c) => (
                <WarningBanner key={c.id} severity={c.severity} icon={c.severity === "error" ? "✕" : "⚠"} title="Canon Conflict" style={{ marginBottom: 8 }}>
                  <p style={{ margin: 0, fontSize: 11 }}>{c.message}</p>
                </WarningBanner>
              ))}

              {/* Body preview */}
              {tlSelected.body && (
                <div style={{ fontSize: 12, color: theme.textMuted, lineHeight: 1.7, marginTop: 12, maxHeight: 200, overflow: "hidden", position: "relative" }}>
                  <RenderBody text={tlSelected.body.split("\n")[0]} articles={articles} onNavigate={(id) => { tlClosePanel(); navigate(id); }} />
                  {tlSelected.body.split("\n").length > 1 && <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 40, background: "linear-gradient(transparent, " + ta(theme.deepBg, 0.95) + ")" }} />}
                </div>
              )}

              {/* Tags */}
              {tlSelected.tags?.length > 0 && (
                <div style={{ marginTop: 14 }}>{tlSelected.tags.map((t) => <span key={t} style={{ ...tTag, fontSize: 10, padding: "2px 8px" }}>#{t}</span>)}</div>
              )}

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
                <button onClick={() => { tlClosePanel(); navigate(tlSelected.id); }} style={{ ...tBtnP, padding: "8px 16px", fontSize: 11 }}>View Full Entry →</button>
                <button onClick={() => { tlClosePanel(); goEdit(tlSelected); }} style={{ ...tBtnS, padding: "7px 14px", fontSize: 11 }}>✎ Edit</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}