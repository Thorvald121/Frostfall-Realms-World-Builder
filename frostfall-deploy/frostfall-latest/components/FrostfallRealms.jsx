"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import _ from "lodash";
import * as mammoth from "mammoth";
import { supabase, fetchArticles, upsertArticle, deleteArticle as dbDeleteArticle, archiveArticle as dbArchiveArticle, uploadPortrait, createWorld, fetchWorlds } from "../lib/supabase";
import { THEMES } from "@/lib/themes";
import { findFuzzyMatches, checkArticleIntegrity, detectConflicts } from "@/lib/domain/integrity";
import { buildTemporalGraph } from "@/lib/domain/truth/temporalGraph";
import { checkSceneIntegrity } from "@/lib/domain/novelIntegrity";
import { useIntegrity } from "@/features/integrity/useIntegrity";
import { IntegrityPanel } from "@/features/integrity/IntegrityPanel";
import { SettingsPanel } from "@/features/settings/SettingsPanel";
import { TimelineView } from "@/features/timeline/TimelineView";
import { useTimeline } from "@/features/timeline/useTimeline";
import { NovelWorkspace } from "@/features/novel/NovelWorkspace";
import { CATEGORIES, categoryPluralLabel, ERAS, SWIM_LANE_ORDER, FIELD_LABELS, formatKey, TEMPLATE_FIELDS, FONT_SIZES, EDITOR_FONTS, DEFAULT_SETTINGS } from "@/lib/domain/categories";
import { ImportPage } from "@/features/import/ImportPage";
import { SupportPage } from "@/features/support/SupportPage";
import { CollaborationPanel } from "@/features/collab/CollaborationPanel";

// === SAFE STRING HELPERS ===
const safeText = (v) => (v == null ? "" : String(v));
const lower = (v) => safeText(v).toLowerCase();


// Theme-aware alpha helper: ta("#ff0000", 0.5) → "rgba(255,0,0,0.5)"
const ta = (hex, alpha) => {
  if (!hex || hex.startsWith("rgba")) return hex;
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

// === INTEGRITY ENGINES ===
function similarity(a, b) {
  if (!a || !b) return 0;
  a = lower(a).trim(); b = lower(b).trim();
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s) => { const r = new Set(); for (let i = 0; i < s.length - 1; i++) r.add(s.slice(i, i + 2)); return r; };
  const aB = bigrams(a), bB = bigrams(b);
  let inter = 0; aB.forEach((g) => { if (bB.has(g)) inter++; });
  return (2 * inter) / (aB.size + bB.size);
}

function findDuplicates(title, articles, excludeId = null) {
  if (!title || title.trim().length < 3) return [];
  return articles.filter((a) => a.id !== excludeId)
    .map((a) => ({ article: a, score: similarity(title, a.title) }))
    .filter((d) => d.score > 0.45).sort((a, b) => b.score - a.score).slice(0, 3);
}


function findUnlinkedMentions(text, fields, articles, existingLinks) {
  if (!text && !fields) return [];
  const suggestions = [];
  const allText = (text || "") + " " + Object.values(fields || {}).join(" ");
  const allTextLower = lower(allText);
  const bodyOnly = lower(text || "");
  const linked = new Set(existingLinks || []);
  // Also exclude rich mentions already in the text
  const richMentionIds = new Set((text?.match(/@\[([^\]]+)\]\(([^)]+)\)/g) || []).map((m) => { const match = m.match(/@\[([^\]]+)\]\(([^)]+)\)/); return match ? match[2] : null; }).filter(Boolean));
  const mentioned = new Set([...(text?.match(/@(?!\[)([\w]+)/g) || []).map((m) => m.slice(1)), ...richMentionIds]);
  articles.forEach((a) => {
    if (linked.has(a.id) || mentioned.has(a.id)) return;
    const tl = lower(a.title);
    // Find the actual position in body text where this name appears (for contextual insertion)
    let matchPosition = -1;
    let matchText = "";
    const titleIdx = bodyOnly.indexOf(tl);
    if (titleIdx !== -1) {
      matchPosition = titleIdx;
      matchText = (text || "").substring(titleIdx, titleIdx + a.title.length);
      suggestions.push({ article: a, confidence: "exact", label: "Exact title match", match: a.title, matchPosition, matchText });
      return;
    }
    const words = a.title.replace(/[()]/g, "").split(/[\s,\-\u2013\u2014]+/).filter((w) => w.length >= 4);
    const matched = words.filter((w) => allTextLower.includes(lower(w)));
    if (matched.length >= 2) {
      // Find longest matched word position for contextual placement
      const longest = matched.sort((a, b) => b.length - a.length)[0];
      const wIdx = bodyOnly.indexOf(lower(longest));
      if (wIdx !== -1) { matchPosition = wIdx; matchText = (text || "").substring(wIdx, wIdx + longest.length); }
      suggestions.push({ article: a, confidence: "strong", label: "Multiple word match", match: matched.join(", "), matchPosition, matchText });
    }
    else if (matched.length === 1 && matched[0].length >= 6) {
      const wIdx = bodyOnly.indexOf(lower(matched[0]));
      if (wIdx !== -1) { matchPosition = wIdx; matchText = (text || "").substring(wIdx, wIdx + matched[0].length); }
      suggestions.push({ article: a, confidence: "possible", label: "Partial word match", match: matched[0], matchPosition, matchText });
    }
  });
  return suggestions.sort((a, b) => ({ exact: 3, strong: 2, possible: 1 }[b.confidence] || 0) - ({ exact: 3, strong: 2, possible: 1 }[a.confidence] || 0));
}


// === HELPERS ===
const timeAgo = (iso) => {
  const d = new Date(iso), now = new Date(), hrs = Math.floor((now - d) / 36e5);
  if (hrs < 1) return "just now"; if (hrs < 24) return hrs + "h ago";
  const days = Math.floor(hrs / 24); return days === 1 ? "yesterday" : days + "d ago";
};

const Ornament = ({ width = 200 }) => (
  <svg width={width} height="12" viewBox="0 0 200 12" style={{ opacity: 0.4 }}>
    <line x1="0" y1="6" x2="70" y2="6" stroke="currentColor" strokeWidth="0.5" />
    <circle cx="80" cy="6" r="2" fill="currentColor" />
    <path d="M88 6 L100 1 L112 6 L100 11 Z" fill="none" stroke="currentColor" strokeWidth="0.5" />
    <circle cx="120" cy="6" r="2" fill="currentColor" />
    <line x1="130" y1="6" x2="200" y2="6" stroke="currentColor" strokeWidth="0.5" />
  </svg>
);

const RenderBody = ({ text, articles, onNavigate }) => {
  if (!text) return null;
  // Split on both @[Title](id) rich mentions and @id legacy mentions
  const regex = /(@\[[^\]]+\]\([^)]+\)|@[\w]+)/g;
  const parts = [];
  let last = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push({ type: "text", content: text.slice(last, match.index) });
    const raw = match[0];
    const richMatch = raw.match(/@\[([^\]]+)\]\(([^)]+)\)/);
    if (richMatch) {
      parts.push({ type: "mention", title: richMatch[1], id: richMatch[2] });
    } else {
      parts.push({ type: "mention", title: null, id: raw.slice(1) });
    }
    last = match.index + raw.length;
  }
  if (last < text.length) parts.push({ type: "text", content: text.slice(last) });

  return (<span>{parts.map((part, i) => {
    if (part.type === "text") return <span key={i}>{part.content}</span>;
    const target = articles.find((a) => a.id === part.id);
    const displayName = part.title || (target ? target.title : part.id);
    const catColor = target ? (CATEGORIES[target.category]?.color || "#f0c040") : "#888";
    const catIcon = target ? (CATEGORIES[target.category]?.icon || "") : "";
    if (target) return (
      <span key={i} onClick={(e) => { e.stopPropagation(); onNavigate(part.id); }}
        style={{ background: catColor + "15", border: "1px solid " + catColor + "35", borderRadius: 4, padding: "1px 6px", margin: "0 1px", color: catColor, cursor: "pointer", fontWeight: 600, fontSize: "0.92em", fontFamily: "'Cinzel', sans-serif", letterSpacing: 0.3, transition: "all 0.15s", display: "inline" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = catColor + "30"; e.currentTarget.style.border = "1px solid " + catColor + "60"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = catColor + "15"; e.currentTarget.style.border = "1px solid " + catColor + "35"; }}>
        {catIcon} {displayName}
      </span>
    );
    return <span key={i} style={{ color: "#e07050", fontStyle: "italic", fontSize: "0.92em" }} title="Not found in codex">⚠ {displayName}</span>;
  })}</span>);
};

const WarningBanner = ({ severity = "warning", icon = "⚠", title, children, style = {} }) => {
  const c = { error: { bg: "rgba(224,112,80,0.08)", border: "#e07050", accent: "#e07050", text: "#e8a090" }, warning: { bg: "rgba(240,192,64,0.08)", border: "#f0c040", accent: "#f0c040", text: "#e8dcc8" }, info: { bg: "rgba(126,200,227,0.08)", border: "#7ec8e3", accent: "#7ec8e3", text: "#a0d0e8" } }[severity] || { bg: "rgba(240,192,64,0.08)", border: "#f0c040", accent: "#f0c040", text: "#e8dcc8" };
  return (<div style={{ background: c.bg, borderTop: "1px solid " + c.border + "30", borderRight: "1px solid " + c.border + "30", borderBottom: "1px solid " + c.border + "30", borderLeft: "3px solid " + c.border, borderRadius: 6, padding: "12px 16px", marginBottom: 10, ...style }}>
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <span style={{ fontSize: 16, color: c.accent, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div style={{ flex: 1 }}>{title && <div style={{ fontSize: 12, fontWeight: 700, color: c.accent, marginBottom: 4, letterSpacing: 0.5, textTransform: "uppercase" }}>{title}</div>}<div style={{ fontSize: 12, color: c.text, lineHeight: 1.6 }}>{children}</div></div>
    </div>
  </div>);
};

// === MODALS ===
const DuplicateModal = ({ duplicates, onOverride, onCancel, onNavigate }) => (
  <div style={MS.overlay} role="dialog" aria-modal="true" aria-labelledby="dupe-modal-title">
    <div style={{ ...MS.box, border: "1px solid #e07050" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 28, color: "#e07050" }} aria-hidden="true">⚠</span>
        <div><h3 id="dupe-modal-title" style={{ fontFamily: "'Cinzel', serif", fontSize: 18, color: "#e07050", margin: 0 }}>Duplicate Detected</h3><p style={{ fontSize: 12, color: "#8899aa", margin: "4px 0 0" }}>This entry appears to match existing articles.</p></div>
      </div>
      <Ornament width={460} />
      <div style={{ margin: "16px 0" }}>{duplicates.map((d) => (
        <div key={d.article.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "rgba(224,112,80,0.06)", border: "1px solid rgba(224,112,80,0.15)", borderRadius: 6, marginBottom: 8, cursor: "pointer" }} onClick={() => { onCancel(); onNavigate(d.article.id); }}>
          <span style={{ fontSize: 18, color: CATEGORIES[d.article.category]?.color }}>{CATEGORIES[d.article.category]?.icon}</span>
          <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600, color: "#d4c9a8" }}>{d.article.title}</div><div style={{ fontSize: 11, color: "#6b7b8d", marginTop: 2 }}>{d.article.summary?.slice(0, 80)}...</div></div>
          <div style={{ fontSize: 12, color: "#e07050", fontWeight: 700, background: "rgba(224,112,80,0.12)", padding: "3px 10px", borderRadius: 10 }}>{Math.round(d.score * 100)}%</div>
        </div>
      ))}</div>
      <p style={{ fontSize: 12, color: "#8899aa", lineHeight: 1.6, margin: "12px 0 20px" }}>Click an entry to view it, or override to create anyway.</p>
      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
        <button style={S.btnS} onClick={onCancel}>Cancel</button>
        <button style={{ ...S.btnP, background: "linear-gradient(135deg, #e07050 0%, #c04030 100%)", color: "#fff" }} onClick={onOverride}>Override & Create</button>
      </div>
    </div>
  </div>
);

const DeleteModal = ({ article, onArchive, onPermanent, onCancel }) => (
  <div style={MS.overlay} role="dialog" aria-modal="true" aria-labelledby="delete-modal-title">
    <div style={{ ...MS.box, border: "1px solid #e07050" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 28, color: "#e07050" }} aria-hidden="true">🗑</span>
        <div><h3 id="delete-modal-title" style={{ fontFamily: "'Cinzel', serif", fontSize: 18, color: "#e07050", margin: 0 }}>Delete Entry</h3><p style={{ fontSize: 12, color: "#8899aa", margin: "4px 0 0" }}>Choose how to handle "{article.title}"</p></div>
      </div>
      <Ornament width={460} />
      <div style={{ margin: "20px 0", display: "flex", flexDirection: "column", gap: 10 }}>
        <div role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onArchive(); } }} onClick={onArchive} style={{ padding: "16px 20px", background: "rgba(240,192,64,0.06)", border: "1px solid rgba(240,192,64,0.2)", borderRadius: 8, cursor: "pointer", transition: "all 0.2s" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(240,192,64,0.12)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(240,192,64,0.06)"; }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 18 }} aria-hidden="true">📦</span>
            <span style={{ fontFamily: "'Cinzel', serif", fontSize: 14, color: "#f0c040", fontWeight: 600, letterSpacing: 0.5 }}>Archive</span>
          </div>
          <p style={{ fontSize: 12, color: "#8899aa", margin: 0, lineHeight: 1.5 }}>Move to the archives. Can be restored or permanently deleted later. Links and references are preserved.</p>
        </div>
        <div role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPermanent(); } }} onClick={onPermanent} style={{ padding: "16px 20px", background: "rgba(224,112,80,0.06)", border: "1px solid rgba(224,112,80,0.2)", borderRadius: 8, cursor: "pointer", transition: "all 0.2s" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(224,112,80,0.12)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(224,112,80,0.06)"; }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 18 }} aria-hidden="true">🔥</span>
            <span style={{ fontFamily: "'Cinzel', serif", fontSize: 14, color: "#e07050", fontWeight: 600, letterSpacing: 0.5 }}>Permanently Delete</span>
          </div>
          <p style={{ fontSize: 12, color: "#8899aa", margin: 0, lineHeight: 1.5 }}>Erase this entry forever. This cannot be undone. All links pointing to this article will break.</p>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}><button style={S.btnS} onClick={onCancel}>Cancel</button></div>
    </div>
  </div>
);

const ConfirmModal = ({ title, message, confirmLabel, confirmColor, onConfirm, onCancel }) => (
  <div style={MS.overlay} role="dialog" aria-modal="true" aria-label="Confirmation">
    <div style={{ ...MS.box, border: "1px solid " + (confirmColor || "#e07050") }}>
      <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 18, color: confirmColor || "#e07050", margin: "0 0 12px" }}>{title}</h3>
      <p style={{ fontSize: 13, color: "#8899aa", lineHeight: 1.6, margin: "0 0 24px" }}>{message}</p>
      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
        <button style={S.btnS} onClick={onCancel}>Cancel</button>
        <button style={{ ...S.btnP, background: `linear-gradient(135deg, ${confirmColor || "#e07050"} 0%, ${confirmColor || "#c04030"} 100%)`, color: "#fff" }} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </div>
  </div>
);

const ImportConflictModal = ({ conflicts, onResolve, onCancel }) => {
  const [choices, setChoices] = useState({});
  const allResolved = Object.keys(choices).length === conflicts.length;
  const choose = (id, val) => setChoices((p) => ({ ...p, [id]: val }));
  return (
    <div style={MS.overlay} role="dialog" aria-modal="true" aria-labelledby="import-conflict-title">
      <div style={{ ...MS.box, maxWidth: 700, maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexShrink: 0 }}>
          <span style={{ fontSize: 28, color: "#f0c040" }} aria-hidden="true">⚠</span>
          <div><h3 id="import-conflict-title" style={{ fontFamily: "'Cinzel', serif", fontSize: 18, color: "#f0c040", margin: 0 }}>Import Conflicts</h3>
            <p style={{ fontSize: 12, color: "#8899aa", margin: "4px 0 0" }}>{conflicts.length} article{conflicts.length > 1 ? "s" : ""} already exist. Choose which version to keep for each.</p></div>
        </div>
        <Ornament width={640} />
        <div style={{ flex: 1, overflowY: "auto", margin: "12px 0", paddingRight: 4 }}>
          {conflicts.map((c) => {
            const pick = choices[c.id];
            return (
              <div key={c.id} style={{ marginBottom: 14, borderRadius: 8, border: "1px solid " + (pick ? "#1e2a3a" : "rgba(240,192,64,0.3)"), overflow: "hidden" }}>
                <div style={{ padding: "10px 14px", background: "rgba(240,192,64,0.06)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14, color: CATEGORIES[c.existing.category]?.color }}>{CATEGORIES[c.existing.category]?.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#d4c9a8", flex: 1 }}>{c.existing.title}</span>
                  <span style={S.catBadge(CATEGORIES[c.existing.category]?.color)}>{CATEGORIES[c.existing.category]?.label}</span>
                </div>
                <div style={{ display: "flex", gap: 1 }}>
                  {/* Existing */}
                  <div onClick={() => choose(c.id, "keep")} style={{ flex: 1, padding: "12px 14px", cursor: "pointer", background: pick === "keep" ? "rgba(126,200,227,0.1)" : "rgba(17,24,39,0.5)", border: pick === "keep" ? "2px solid #7ec8e3" : "2px solid transparent", transition: "all 0.2s" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#7ec8e3", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>◀ Keep Existing</div>
                    <div style={{ fontSize: 11, color: "#8899aa", lineHeight: 1.5 }}>{c.existing.summary?.slice(0, 120)}{c.existing.summary?.length > 120 ? "…" : ""}</div>
                    <div style={{ marginTop: 6, fontSize: 10, color: "#556677" }}>Updated: {c.existing.updatedAt?.slice(0, 10)} · {c.existing.tags?.length || 0} tags · {c.existing.body?.split(/\s+/).length || 0} words</div>
                  </div>
                  {/* Imported */}
                  <div onClick={() => choose(c.id, "replace")} style={{ flex: 1, padding: "12px 14px", cursor: "pointer", background: pick === "replace" ? "rgba(240,192,64,0.1)" : "rgba(17,24,39,0.5)", border: pick === "replace" ? "2px solid #f0c040" : "2px solid transparent", transition: "all 0.2s" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#f0c040", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Use Imported ▶</div>
                    <div style={{ fontSize: 11, color: "#8899aa", lineHeight: 1.5 }}>{c.imported.summary?.slice(0, 120)}{c.imported.summary?.length > 120 ? "…" : ""}</div>
                    <div style={{ marginTop: 6, fontSize: 10, color: "#556677" }}>Updated: {c.imported.updatedAt?.slice(0, 10)} · {c.imported.tags?.length || 0} tags · {c.imported.body?.split(/\s+/).length || 0} words</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "center", flexShrink: 0, paddingTop: 12, borderTop: "1px solid #1a2435" }}>
          <span style={{ fontSize: 11, color: allResolved ? "#8ec8a0" : "#8899aa" }}>{Object.keys(choices).length}/{conflicts.length} resolved</span>
          <div style={{ display: "flex", gap: 12 }}>
            <button style={S.btnS} onClick={onCancel}>Cancel Import</button>
            <button style={{ ...S.btnP, opacity: allResolved ? 1 : 0.4, pointerEvents: allResolved ? "auto" : "none" }} onClick={() => onResolve(choices)}>Apply Import</button>
          </div>
        </div>
      </div>
    </div>
  );
};

// === MODAL STYLES ===
const MS = {
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" },
  box: { background: "linear-gradient(135deg, #111827 0%, #0d1117 100%)", borderRadius: 12, padding: "28px 32px", maxWidth: 520, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" },
};

// === STYLES ===
const S = {
  root: { fontFamily: "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif", background: "linear-gradient(170deg, #0a0e1a 0%, #111827 40%, #0f1420 100%)", color: "#d4c9a8", minHeight: "100vh", display: "flex", overflow: "hidden", height: "100vh" },
  sidebar: { width: 260, minWidth: 260, background: "linear-gradient(180deg, #0d1117 0%, #0a0e1a 100%)", borderRight: "1px solid #1e2a3a", display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" },
  navItem: (a, t) => ({ display: "flex", alignItems: "center", gap: 10, padding: "9px 20px", cursor: "pointer", background: a ? "linear-gradient(90deg, " + (t ? t.accentBg : "rgba(240,192,64,0.12)") + " 0%, transparent 100%)" : "transparent", borderLeft: a ? "2px solid " + (t ? t.accent : "#f0c040") : "2px solid transparent", color: a ? (t ? t.accent : "#f0c040") : (t ? t.textMuted : "#8899aa"), fontSize: 13, fontWeight: a ? 600 : 400, transition: "all 0.2s", letterSpacing: 0.5 }),
  topBar: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 28px", borderBottom: "1px solid #1a2435", background: "rgba(10,14,26,0.95)", backdropFilter: "blur(12px)", position: "relative", zIndex: 50, flexShrink: 0 },
  searchBox: { background: "#111827", border: "1px solid #1e2a3a", borderRadius: 6, padding: "7px 14px 7px 34px", color: "#d4c9a8", fontSize: 13, width: 320, outline: "none", fontFamily: "inherit" },
  content: { flex: 1, overflowY: "auto", padding: "0 28px 40px" },
  statCard: { flex: "1 1 100px", background: "linear-gradient(135deg, rgba(17,24,39,0.9) 0%, rgba(15,20,32,0.9) 100%)", border: "1px solid #1e2a3a", borderRadius: 8, padding: "16px 18px", position: "relative", overflow: "hidden" },
  sTitle: { fontFamily: "'Cinzel', 'Palatino Linotype', serif", fontSize: 16, fontWeight: 600, color: "#d4c9a8", marginTop: 32, marginBottom: 16, letterSpacing: 1 },
  catBadge: (c) => ({ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, color: c, background: c + "18", padding: "3px 10px", borderRadius: 12, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", whiteSpace: "nowrap" }),
  tag: { fontSize: 10, color: "#556677", background: "rgba(85,102,119,0.15)", padding: "2px 8px", borderRadius: 10, display: "inline-block", marginRight: 4, marginTop: 4 },
  relItem: { display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "rgba(17,24,39,0.5)", borderRadius: 6, marginBottom: 4, cursor: "pointer", fontSize: 12, color: "#8899aa", transition: "all 0.2s" },
  input: { width: "100%", background: "#0d1117", border: "1px solid #1e2a3a", borderRadius: 6, padding: "9px 14px", color: "#d4c9a8", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" },
  textarea: { width: "100%", background: "#0d1117", border: "1px solid #1e2a3a", borderRadius: 6, padding: "9px 14px", color: "#d4c9a8", fontSize: 13, fontFamily: "inherit", outline: "none", minHeight: 120, resize: "vertical", lineHeight: 1.6, boxSizing: "border-box" },
  btnP: { background: "linear-gradient(135deg, #f0c040 0%, #d4a020 100%)", color: "#0a0e1a", border: "none", borderRadius: 6, padding: "10px 24px", fontSize: 13, fontWeight: 700, fontFamily: "'Cinzel', serif", cursor: "pointer", letterSpacing: 1, textTransform: "uppercase" },
  btnS: { background: "transparent", color: "#8899aa", border: "1px solid #1e2a3a", borderRadius: 6, padding: "9px 20px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" },
};

// ╔══════════════════════════════════════════════════════════════╗
// ║                      CUSTOM HOOKS                          ║
// ╚══════════════════════════════════════════════════════════════╝

// --- useIntegrity: conflict detection, integrity scanning, sensitivity filter ---


// === MAIN APP ===
export default function FrostfallRealms({ user, onLogout }) {
  const [articles, setArticles] = useState([]);
  // Dedup helper — keeps the LAST entry for each id (newest wins)
  const dedup = (arr) => { const seen = new Map(); arr.forEach((a) => seen.set(a.id, a)); return [...seen.values()]; };
  const [archived, setArchived] = useState([]);
  const [view, setView] = useState("dashboard");
  const [activeArticle, setActiveArticle] = useState(null);
  const [codexFilter, setCodexFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [createCat, setCreateCat] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [fadeIn, setFadeIn] = useState(false);
  const [formData, setFormData] = useState({ title: "", summary: "", fields: {}, body: "", tags: "", temporal: null, portrait: null });
  const [showDupeModal, setShowDupeModal] = useState(false);
  const [pendingDupes, setPendingDupes] = useState([]);
  const [showDeleteModal, setShowDeleteModal] = useState(null);
  const [showMoveMenu, setShowMoveMenu] = useState(null);
  const [showConfirm, setShowConfirm] = useState(null);
  const [saveStatus, setSaveStatus] = useState("idle");
  const [importConflicts, setImportConflicts] = useState(null);
  const [importPending, setImportPending] = useState(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [activeWorld, setActiveWorld] = useState(null);
  const [allWorlds, setAllWorlds] = useState([]);
  const [showWorldCreate, setShowWorldCreate] = useState(false);
  const [worldForm, setWorldForm] = useState({ name: "", description: "" });
  const [worldSwitcherOpen, setWorldSwitcherOpen] = useState(false);

  // === RESPONSIVE ===
  const [screenW, setScreenW] = useState(1200);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useEffect(() => {
    // Ensure SSR + first client render match; update after mount.
    setScreenW(window.innerWidth);
    const onResize = () => setScreenW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const isMobile = screenW < 768;
  const isTablet = screenW >= 768 && screenW < 1024;
  const isCompact = screenW < 1024;
  // Close drawer on navigation
  const closeSidebar = useCallback(() => { if (isMobile) setSidebarOpen(false); }, [isMobile]);

  // === SETTINGS ===
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsTab, setSettingsTab] = useState("appearance"); // appearance | world | account
  const theme = THEMES[settings.theme] || THEMES.dark_arcane;
  // Theme-computed style overrides (shadow static S.* defaults)
  const tBtnP = { ...S.btnP, background: "linear-gradient(135deg, " + theme.accent + " 0%, " + ta(theme.accent, 0.7) + " 100%)", color: theme.deepBg || theme.deepBg };
  const tBtnS = { ...S.btnS, color: theme.textMuted, border: "1px solid " + theme.border };
  const tTag = { ...S.tag, color: theme.textDim, background: ta(theme.textDim, 0.15) };
  const tRelItem = { ...S.relItem, color: theme.textMuted, background: ta(theme.surface, 0.5) };
  const fontScale = FONT_SIZES[settings.fontSize] || 1.0;
  const editorFontFamily = EDITOR_FONTS[settings.editorFont] || EDITOR_FONTS.georgia;
  const sz = (base) => Math.round(base * fontScale); // UI-wide font scaler
  const activeEras = useMemo(() => settings.customEras?.length > 0 ? settings.customEras : ERAS, [settings.customEras]);
  const formatYear = useCallback((year) => {
    const label = settings.eraLabel || "Year";
    const era = activeEras.find((e) => year >= e.start && year < e.end);
    if (era) return `${era.label || era.name}, ${label} ${year}`;
    return `${label} ${year}`;
  }, [settings.eraLabel, activeEras]);

  // === CUSTOM HOOKS ===
  const { tlZoom, setTlZoom, tlSelected, setTlSelected, tlPanelOpen, setTlPanelOpen, tlData, tlRange, tlPxPerYear, yearToX, tlTotalWidth, tlTicks, tlSelectArticle, tlClosePanel, tlLaneHeights } = useTimeline(articles);
  const { allConflicts, visibleConflicts, conflictsFor, filterBySensitivity, globalIntegrity, totalIntegrityIssues, dismissedConflicts, setDismissedConflicts, dismissedTemporals, setDismissedTemporals, integrityGate, setIntegrityGate, integrityVisible, setIntegrityVisible, temporalGraph, INTEGRITY_PAGE } = useIntegrity(articles, settings, { detectConflicts, checkArticleIntegrity, buildTemporalGraph });

  const [codexSort, setCodexSort] = useState("recent");
  const [codexViewMode, setCodexViewMode] = useState("list"); // "list" or "grid"
  const [codexBulkMode, setCodexBulkMode] = useState(false);
  const [codexTagFilter, setCodexTagFilter] = useState(""); // tag to filter by
  const [codexRefFilter, setCodexRefFilter] = useState("all"); // "all"|"has_refs"|"orphans"|"no_outgoing"|"no_incoming"
  const [crossRefArticle, setCrossRefArticle] = useState(null); // article id for detail view
  const [codexSelected, setCodexSelected] = useState(new Set());
  // === PAGINATION ===
  const CODEX_PAGE = 30;
  const NOVEL_CODEX_PAGE = 25;
  const [codexVisible, setCodexVisible] = useState(CODEX_PAGE);
  const [novelCodexVisible, setNovelCodexVisible] = useState(NOVEL_CODEX_PAGE);


  const articleBodyRef = useRef(null);
  const articleImageRef = useRef(null);
  const articleLastTypedRef = useRef(null);
  const articleInitSessionRef = useRef(null);
  const [articlePreviewMode, setArticlePreviewMode] = useState(false);
  const [articleCollapsed, setArticleCollapsed] = useState(new Set());
  const [articleTablePicker, setArticleTablePicker] = useState(false);

  const importFileRef = useRef(null);
  const saveTimer = useRef(null);

  // === PERSISTENT STORAGE (Supabase → window.storage → localStorage fallback) ===
  useEffect(() => {
    const loadData = async () => {
      if (supabase && user) {
        try {
          const worlds = await fetchWorlds(user.id);
          setAllWorlds(worlds);
          if (worlds.length > 0) {
            const world = worlds[0];
            setActiveWorld(world);
            const dbArticles = await fetchArticles(world.id);
            if (dbArticles.length > 0) {
              setArticles(dedup(dbArticles.filter((a) => !a.isArchived)));
              setArchived(dedup(dbArticles.filter((a) => a.isArchived)));
            }
          }
          // If no worlds, the welcome screen will show
          setSaveStatus("saved");
        } catch (e) { console.error("Supabase load:", e); setSaveStatus("idle"); }
      } else {
        try {
          if (typeof window !== "undefined" && window.storage) {
            const result = await window.storage.get("frostfall-world-v2");
            const data = JSON.parse(result.value);
            if (data.articles?.length > 0) setArticles(dedup(data.articles));
            if (data.archived) setArchived(dedup(data.archived));
            if (data.worldName) setActiveWorld({ name: data.worldName, description: data.worldDesc || "" });
          }
          setSaveStatus("saved");
        } catch (e) { setSaveStatus("idle"); }
      }
      setDataLoaded(true);
      // Load settings
      try {
        if (typeof window !== "undefined" && window.storage) {
          const sr = await window.storage.get("frostfall-settings-v1");
          if (sr?.value) setSettings((prev) => ({ ...prev, ...JSON.parse(sr.value) }));
        } else {
          const ls = localStorage.getItem("frostfall-settings-v1");
          if (ls) setSettings((prev) => ({ ...prev, ...JSON.parse(ls) }));
        }
      } catch (_) {}
    };
    loadData();
  }, [user?.id]);

  // Check for invite code in URL (e.g. ?invite=AB3XK7QR)
  useEffect(() => {
    if (typeof window === "undefined" || !user) return;
    const params = new URLSearchParams(window.location.search);
    const inviteCode = params.get("invite");
    if (inviteCode) {
      // Clean the URL
      window.history.replaceState({}, "", window.location.pathname);
      // Navigate to collaboration page with the code pre-filled
      setView("collaboration");
    }
  }, [user]);

const handleCreateWorld = async () => {
    if (!worldForm.name.trim()) return;
    try {
      if (supabase && user) {
        const newWorld = await createWorld(user.id, worldForm.name.trim(), worldForm.description.trim());
        setAllWorlds((prev) => [...prev, newWorld]);
        setActiveWorld(newWorld);
        setArticles([]);
        setArchived([]);
      } else {
        setActiveWorld({ name: worldForm.name.trim(), description: worldForm.description.trim() });
      }
      setWorldForm({ name: "", description: "" });
      setShowWorldCreate(false);
      setView("dashboard");
    } catch (e) { console.error("Create world:", e); }
  };

  const switchWorld = async (world) => {
    if (world.id === activeWorld?.id) { setWorldSwitcherOpen(false); return; }
    setActiveWorld(world);
    setArticles([]);
    setArchived([]);
    setView("dashboard");
    setWorldSwitcherOpen(false);
    try {
      const dbArticles = await fetchArticles(world.id);
      setArticles(dedup(dbArticles.filter((a) => !a.isArchived)));
      setArchived(dedup(dbArticles.filter((a) => a.isArchived)));
    } catch (e) { console.error("Switch world:", e); }
  };

  useEffect(() => {
    if (!dataLoaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus("saving");
    saveTimer.current = setTimeout(async () => {
      try {
        if (supabase && user && activeWorld?.id) {
          const all = [...articles, ...archived.map((a) => ({ ...a, isArchived: true }))];
          for (const article of all) await upsertArticle(activeWorld.id, article);
        } else if (typeof window !== "undefined" && window.storage) {
          await window.storage.set("frostfall-world-v2", JSON.stringify({ articles, archived, worldName: activeWorld?.name, worldDesc: activeWorld?.description, version: 2, savedAt: new Date().toISOString() }));
        }
        setSaveStatus("saved");
      } catch (e) { setSaveStatus("error"); }
    }, 1200);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [articles, archived, dataLoaded, user, activeWorld]);

  // Save settings whenever they change
  useEffect(() => {
    if (!dataLoaded) return;
    const json = JSON.stringify(settings);
    try {
      if (typeof window !== "undefined" && window.storage) { window.storage.set("frostfall-settings-v1", json); }
      else { localStorage.setItem("frostfall-settings-v1", json); }
    } catch (_) {}
  }, [settings, dataLoaded]);

  // Save settings whenever they change
  useEffect(() => {
    if (!dataLoaded) return;
    const json = JSON.stringify(settings);
    try {
      if (typeof window !== "undefined" && window.storage) { window.storage.set("frostfall-settings-v1", json); }
      else { localStorage.setItem("frostfall-settings-v1", json); }
    } catch (_) {}
  }, [settings, dataLoaded]);

  // === EXPORT ===
  const exportWorld = () => {
    const data = {
      name: "Frostfall Realms Export",
      version: 1,
      exportedAt: new Date().toISOString(),
      articles,
      archived,
      stats: { totalArticles: articles.length, archivedArticles: archived.length, categories: Object.keys(CATEGORIES).length },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "frostfall-realms-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // === IMPORT ===
  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        const incoming = data.articles || [];
        const incomingArchived = data.archived || [];
        if (incoming.length === 0 && incomingArchived.length === 0) {
          setShowConfirm({ title: "Empty Import", message: "The file contains no articles to import.", confirmLabel: "OK", confirmColor: theme.accent, onConfirm: () => setShowConfirm(null) });
          return;
        }
        // Find conflicts (same ID exists in current articles)
        const conflicts = [];
        const newArticles = [];
        incoming.forEach((imp) => {
          const existing = articles.find((a) => a.id === imp.id);
          if (existing) conflicts.push({ id: imp.id, existing, imported: imp });
          else newArticles.push(imp);
        });
        const newArchived = incomingArchived.filter((imp) => !archived.find((a) => a.id === imp.id));

        if (conflicts.length > 0) {
          setImportPending({ newArticles, newArchived, conflicts });
          setImportConflicts(conflicts);
        } else {
          // No conflicts — direct merge
          setArticles((prev) => dedup([...prev, ...newArticles]));
          setArchived((prev) => [...prev, ...newArchived]);
          setShowConfirm({ title: "Import Complete", message: `Added ${newArticles.length} article${newArticles.length !== 1 ? "s" : ""}${newArchived.length > 0 ? " and " + newArchived.length + " archived entries" : ""}.`, confirmLabel: "OK", confirmColor: "#8ec8a0", onConfirm: () => setShowConfirm(null) });
        }
      } catch (err) {
        setShowConfirm({ title: "Import Failed", message: "Could not parse the file. Make sure it's a valid Frostfall Realms export (.json).", confirmLabel: "OK", confirmColor: "#e07050", onConfirm: () => setShowConfirm(null) });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const resolveImportConflicts = (choices) => {
    if (!importPending) return;
    const resolved = importPending.conflicts.map((c) => choices[c.id] === "replace" ? c.imported : null).filter(Boolean);
    const replaceIds = new Set(resolved.map((a) => a.id));
    setArticles((prev) => dedup([...prev.filter((a) => !replaceIds.has(a.id)), ...resolved, ...importPending.newArticles]));
    setArchived((prev) => [...prev, ...importPending.newArchived]);
    const added = importPending.newArticles.length;
    const replaced = resolved.length;
    const kept = importPending.conflicts.length - replaced;
    setImportConflicts(null); setImportPending(null);
    setShowConfirm({ title: "Import Complete", message: `${added} new article${added !== 1 ? "s" : ""} added, ${replaced} replaced, ${kept} kept existing.`, confirmLabel: "OK", confirmColor: "#8ec8a0", onConfirm: () => setShowConfirm(null) });
  };

  // === AI DOCUMENT IMPORT ===
  const [aiStaging, setAiStaging] = useState([]);
  const [aiParsing, setAiParsing] = useState(false);
  const [aiParseError, setAiParseError] = useState(null);
  const [aiSourceName, setAiSourceName] = useState("");
  const [aiProgress, setAiProgress] = useState({ current: 0, total: 0, entries: 0 });
  const [showDonate, setShowDonate] = useState(false);
  const [scratchpadOpen, setScratchpadOpen] = useState(false);
  const [scratchpadText, setScratchpadText] = useState("");
useEffect(() => {
  if (typeof window === "undefined") return;
  try { setScratchpadText(localStorage.getItem("ff_scratchpad") || ""); } catch {}
}, []);
const saveScratchpad = (text) => { setScratchpadText(text); try { localStorage.setItem("ff_scratchpad", text); } catch {} };
  const [showShortcuts, setShowShortcuts] = useState(false);
  // Phase B state
  const [graphFilter, setGraphFilter] = useState("all");
  const [graphHover, setGraphHover] = useState(null);
  const graphRef = useRef(null);
  const [generatorType, setGeneratorType] = useState("npc");
  const [generatorResults, setGeneratorResults] = useState([]);
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  // ═══ FAMILY TREE / LINEAGE ═══
  const RELATIONS_KEY = "ff_relationships";
  const [ftSelected, setFtSelected] = useState(null); // selected character ID
  const [ftAddingRel, setFtAddingRel] = useState(null); // { fromId, type }
  const loadRelations = () => {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(RELATIONS_KEY) || "{}"); } catch { return {}; }
};
// Hydration-safe: start deterministic, then load after mount
const [relations, setRelations] = useState({});
useEffect(() => {
  const r = loadRelations();
  setRelations(r);
}, []);
const saveRelations = (r) => { setRelations(r); try { localStorage.setItem(RELATIONS_KEY, JSON.stringify(r)); } catch {} };
  const addRelation = (fromId, toId, type) => {
    const r = { ...relations };
    if (!r[fromId]) r[fromId] = [];
    if (!r[toId]) r[toId] = [];
    // Prevent duplicates
    if (r[fromId].find((rel) => rel.targetId === toId && rel.type === type)) return;
    r[fromId].push({ targetId: toId, type });
    // Mirror relationship
    const mirror = type === "parent" ? "child" : type === "child" ? "parent" : type === "spouse" ? "spouse" : "sibling";
    if (!r[toId].find((rel) => rel.targetId === fromId && rel.type === mirror)) {
      r[toId].push({ targetId: fromId, type: mirror });
    }
    saveRelations(r);
  };
  const removeRelation = (fromId, toId, type) => {
    const r = { ...relations };
    if (r[fromId]) r[fromId] = r[fromId].filter((rel) => !(rel.targetId === toId && rel.type === type));
    const mirror = type === "parent" ? "child" : type === "child" ? "parent" : type === "spouse" ? "spouse" : "sibling";
    if (r[toId]) r[toId] = r[toId].filter((rel) => !(rel.targetId === fromId && rel.type === mirror));
    saveRelations(r);
  };
  const getRelationsFor = (id) => relations[id] || [];
  const characters = useMemo(() => articles.filter((a) => a.category === "character"), [articles]);

  // ═══ SESSION / CAMPAIGN NOTES ═══
  const SESSIONS_KEY = "ff_sessions";
  // Hydration-safe: start deterministic, then load after mount
const [sessions, setSessions] = useState([]);
useEffect(() => {
  if (typeof window === "undefined") return;
  try { setSessions(JSON.parse(localStorage.getItem(SESSIONS_KEY) || "[]")); } catch {}
}, []);
const [sessionEdit, setSessionEdit] = useState(null); // session id being edited
  const [sessionForm, setSessionForm] = useState({ title: "", date: "", summary: "", encounters: "", npcs: "", loot: "", notes: "", tags: "" });
  const saveSessions = (s) => { setSessions(s); try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(s)); } catch {} };
  const createSession = () => {
    const s = { id: "sess_" + Date.now(), ...sessionForm, tags: sessionForm.tags.split(",").map((t) => t.trim()).filter(Boolean), createdAt: new Date().toISOString() };
    saveSessions([s, ...sessions]); setSessionForm({ title: "", date: "", summary: "", encounters: "", npcs: "", loot: "", notes: "", tags: "" }); setSessionEdit(null);
  };
  const updateSession = (id) => {
    saveSessions(sessions.map((s) => s.id === id ? { ...s, ...sessionForm, tags: sessionForm.tags.split(",").map((t) => t.trim()).filter(Boolean) } : s));
    setSessionEdit(null); setSessionForm({ title: "", date: "", summary: "", encounters: "", npcs: "", loot: "", notes: "", tags: "" });
  };
  const deleteSession = (id) => { if (confirm("Delete this session log?")) saveSessions(sessions.filter((s) => s.id !== id)); };

  // ═══ DASHBOARD WIDGETS ═══
  const WIDGET_KEY = "ff_dashboard_widgets";
  const DEFAULT_WIDGETS = ["stats", "integrity", "quick_create", "recent", "writing_progress", "world_links"];
  // Hydration-safe: start deterministic, then load after mount
const [dashWidgets, setDashWidgets] = useState(DEFAULT_WIDGETS);
useEffect(() => {
  if (typeof window === "undefined") return;
  try { setDashWidgets(JSON.parse(localStorage.getItem(WIDGET_KEY)) || DEFAULT_WIDGETS); } catch {}
}, []);
const [dashCustomizing, setDashCustomizing] = useState(false);
  const saveDashWidgets = (w) => { setDashWidgets(w); try { localStorage.setItem(WIDGET_KEY, JSON.stringify(w)); } catch {} };
  const toggleWidget = (id) => { saveDashWidgets(dashWidgets.includes(id) ? dashWidgets.filter((w) => w !== id) : [...dashWidgets, id]); };
  const moveWidget = (id, dir) => {
    const i = dashWidgets.indexOf(id); if (i < 0) return;
    const n = [...dashWidgets]; const j = i + dir;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]]; saveDashWidgets(n);
  };
  const aiFileRef = useRef(null);
  const avatarFileRef = useRef(null);
  const portraitFileRef = useRef(null);

  // === NOVEL WRITING TOOL ===
  const [manuscripts, setManuscripts] = useState([]); // all manuscripts for active world
  const [activeMs, setActiveMs] = useState(null); // current manuscript object
  const [novelView, setNovelView] = useState("select"); // select, outline, write, corkboard
  const [novelActiveScene, setNovelActiveScene] = useState(null); // { actId, chId, scId }
  const [novelCodexSearch, setNovelCodexSearch] = useState("");
  const [novelCodexFilter, setNovelCodexFilter] = useState("all");
  const [novelCodexExpanded, setNovelCodexExpanded] = useState(null); // article id
  const [novelMention, setNovelMention] = useState(null); // { query, x, y, actId, chId, scId }
  const [novelOutlineCollapsed, setNovelOutlineCollapsed] = useState(new Set());
  const [novelMsForm, setNovelMsForm] = useState({ title: "", description: "" });
  const [showMsCreate, setShowMsCreate] = useState(false);
  const novelEditorRef = useRef(null);
  const activeMsIdRef = useRef(null);
  const prevActiveSceneRef = useRef(null);
  const prevFocusModeRef = useRef(false);
  const manuscriptsRef = useRef(manuscripts);
  // Enhanced features
  const [novelFocusMode, setNovelFocusMode] = useState(false); // composition/focus mode
  const [novelSplitPane, setNovelSplitPane] = useState("codex"); // "codex" | "notes" | "article" | "scene" | null
  const [novelSplitSceneId, setNovelSplitSceneId] = useState(null); // scene id for side-by-side writing
  const [novelEditorSettings, setNovelEditorSettings] = useState(false); // gear popover open
  const [novelExportOpen, setNovelExportOpen] = useState(false); // export format dropdown
  const [novelExportSettings, setNovelExportSettings] = useState({ frontMatter: true, chapterBreaks: true, sceneBreaks: "asterisks", includeNotes: false, includeSynopsis: false }); // compile options
  const [novelGoal, setNovelGoal] = useState({ daily: 0, session: 0, sessionStart: 0 }); // word targets
  const [novelGoalInput, setNovelGoalInput] = useState("");
  const [novelShowGoalSet, setNovelShowGoalSet] = useState(false);
  const [novelCompiling, setNovelCompiling] = useState(false);
  const [corkboardChapter, setCorkboardChapter] = useState(null); // { actId, chId } for corkboard focus
  const [corkboardDragId, setCorkboardDragId] = useState(null);
  const [novelSnapshotView, setNovelSnapshotView] = useState(null); // snapshot index to view

  // Scene color/label options
  const SCENE_COLORS = [
    { id: "none", color: "transparent", label: "None" },
    { id: "red", color: "#e07050", label: "Action" },
    { id: "blue", color: "#7ec8e3", label: "World Building" },
    { id: "green", color: "#8ec8a0", label: "Character Dev" },
    { id: "gold", color: theme.accent, label: "Plot Point" },
    { id: "purple", color: "#c084fc", label: "Dialogue" },
    { id: "pink", color: "#f472b6", label: "Romance" },
    { id: "teal", color: "#5eead4", label: "Mystery" },
  ];

  // Split text into sections at heading boundaries, respecting document structure
  const chunkText = (text, maxChunkSize = 6000) => {
    if (text.length <= maxChunkSize) return [text];
    // Split by top-level headings (# )
    const lines = text.split("\n");
    const sections = [];
    let current = "";
    let currentHeading = "";
    for (const line of lines) {
      const isHeading = /^#{1,2}\s/.test(line.trim()) || /^#{1,2}\s*\\?#/.test(line.trim());
      if (isHeading && current.length > 200) {
        sections.push(current.trim());
        current = line + "\n";
        currentHeading = line;
      } else {
        current += line + "\n";
      }
    }
    if (current.trim()) sections.push(current.trim());

    // Merge tiny sections together, split huge ones
    const chunks = [];
    let merged = "";
    for (const section of sections) {
      if (merged.length + section.length < maxChunkSize) {
        merged += (merged ? "\n\n" : "") + section;
      } else {
        if (merged) chunks.push(merged);
        if (section.length > maxChunkSize) {
          // Split huge section by paragraphs
          const paras = section.split(/\n\s*\n/);
          let sub = "";
          for (const p of paras) {
            if (sub.length + p.length > maxChunkSize && sub) {
              chunks.push(sub.trim());
              sub = p;
            } else {
              sub += (sub ? "\n\n" : "") + p;
            }
          }
          if (sub.trim()) merged = sub.trim();
          else merged = "";
        } else {
          merged = section;
        }
      }
    }
    if (merged.trim()) chunks.push(merged.trim());

    // Deduplicate chunks that are >80% similar (catches the duplicate Physical Characteristics)
    const dedupedChunks = [];
    for (const chunk of chunks) {
      const isDup = dedupedChunks.some((existing) => {
        const shorter = Math.min(chunk.length, existing.length);
        const longer = Math.max(chunk.length, existing.length);
        if (shorter / longer < 0.7) return false;
        // Quick check: compare first 500 chars
        const a = lower(chunk.slice(0, 500)).replace(/\s+/g, " ");
        const b = lower(existing.slice(0, 500)).replace(/\s+/g, " ");
        let matches = 0;
        const words = a.split(" ");
        for (const w of words) { if (b.includes(w)) matches++; }
        return matches / words.length > 0.8;
      });
      if (!isDup) dedupedChunks.push(chunk);
    }
    return dedupedChunks;
  };

  const parseDocumentWithAI = async (text, filename) => {
    setAiParsing(true); setAiParseError(null); setAiSourceName(filename);
    setAiProgress({ current: 0, total: 0, entries: 0 });

    const chunks = chunkText(text);
    setAiProgress({ current: 0, total: chunks.length, entries: 0 });
    let allEntries = [];
    let errors = [];
    let existingTitles = [...articles.map((a) => safeText(a?.title)), ...aiStaging.map((a) => safeText(a?.title))]; // Include current codex + staging titles

    for (let i = 0; i < chunks.length; i++) {
      setAiProgress((p) => ({ ...p, current: i + 1 }));
      try {
        const response = await fetch("/api/ai-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: chunks[i],
            filename,
            chunkIndex: i,
            totalChunks: chunks.length,
            existingTitles: existingTitles.slice(-50),
            provider: settings.aiProvider || "anthropic",
            model: settings.aiModel?.[settings.aiProvider || "anthropic"] || undefined,
            userApiKey: settings.aiKeys?.[settings.aiProvider || "anthropic"] || "",
          }),
        });
        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          errors.push("Section " + (i + 1) + ": API error " + response.status + (errText ? " — " + errText.slice(0, 100) : ""));
          continue;
        }
        const data = await response.json();
        if (data.error && !data.entries?.length) {
          errors.push("Section " + (i + 1) + ": " + data.error);
          continue;
        }
        if (data.entries && data.entries.length > 0) {
          // Client-side dedup: skip entries with titles that already exist
          const newEntries = data.entries.filter((e) => {
            const normalTitle = lower(e.title).trim();
            return !existingTitles.some((t) => lower(t).trim() === normalTitle);
          });
          const staged = newEntries.map((e, j) => ({
            ...e,
            _stagingId: Date.now() + "-" + i + "-" + j,
            _status: "pending",
            id: lower(e.title).replace(/[^a-z0-9]+/g, "_").replace(/_+$/, "") || "entry_" + i + "_" + j,
            fields: e.fields || {},
            tags: e.tags || [],
            linkedIds: (e.body?.match(/@([\w]+)/g) || []).map((m) => m.slice(1)),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }));
          allEntries = [...allEntries, ...staged];
          existingTitles = [...existingTitles, ...newEntries.map((e) => e.title)];
          setAiStaging((prev) => [...prev, ...staged]);
          setAiProgress((p) => ({ ...p, entries: allEntries.length }));
        }
        if (data.warning) errors.push("Section " + (i + 1) + ": " + data.warning);
      } catch (err) {
        errors.push("Section " + (i + 1) + ": " + (err.message || "Network error"));
      }
    }

    if (allEntries.length > 0) {
      setView("staging");
    }
    if (allEntries.length === 0 && errors.length > 0) {
      setAiParseError("Failed to parse document: " + errors.join("; "));
    } else if (errors.length > 0) {
      setAiParseError("Parsed " + allEntries.length + " entries with some warnings: " + errors.slice(0, 2).join("; "));
    }
    setAiParsing(false);
  };

  // File size estimate helper
  const estimateParseTime = (fileSize) => {
    const kb = fileSize / 1024;
    if (kb < 5) return "~10 seconds";
    if (kb < 20) return "~20–30 seconds";
    if (kb < 50) return "~30–60 seconds";
    if (kb < 100) return "~1–2 minutes";
    return "~2–5 minutes";
  };

  const handleAiFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAiParseError("");
    // File size warning
    if (file.size > 500000) {
      setAiParseError("⚠ Large file (" + (file.size / 1024).toFixed(0) + "KB). Estimated parse time: " + estimateParseTime(file.size) + ". The file will be split into chunks for processing.");
    }
    const ext = lower(file?.name?.split(".").pop());
    if (ext === "docx" || ext === "doc") {
      const reader = new FileReader();
      reader.onerror = () => { setAiParseError("Failed to read file. The file may be corrupted or inaccessible."); };
      reader.onload = async (ev) => {
        try {
          if (!mammoth) { setAiParseError("DOCX parser not loaded. Try a .txt or .md file instead."); return; }
          const arrayBuffer = ev.target.result;
          if (!arrayBuffer || arrayBuffer.byteLength === 0) { setAiParseError("File appears empty."); return; }
          const result = await mammoth.extractRawText({ arrayBuffer });
          const text = result?.value;
          if (!text || text.length < 20) { setAiParseError("Document appears empty or could not be read. Try saving as .txt and re-uploading."); return; }
          parseDocumentWithAI(text, file.name);
        } catch (err) {
          console.error("DOCX parse error:", err);
          setAiParseError("Failed to read .docx file: " + (err?.message || "Unknown error") + ". Try converting to .txt first.");
        }
      };
      reader.readAsArrayBuffer(file);
    } else if (ext === "pdf") {
      setAiParseError("PDF upload requires conversion. Please save your PDF as a .txt or .docx file and try again.");
    } else {
      const reader = new FileReader();
      reader.onerror = () => { setAiParseError("Failed to read file."); };
      reader.onload = (ev) => {
        const text = ev.target.result;
        if (!text || text.length < 20) { setAiParseError("File appears empty or too short."); return; }
        parseDocumentWithAI(text, file.name);
      };
      reader.readAsText(file);
    }
    e.target.value = "";
  };

  const stagingApprove = (stagingId) => setAiStaging((p) => p.map((e) => e._stagingId === stagingId ? { ...e, _status: "approved" } : e));
  const stagingReject = (stagingId) => setAiStaging((p) => p.map((e) => e._stagingId === stagingId ? { ...e, _status: "rejected" } : e));
  const stagingEdit = (stagingId, field, value) => setAiStaging((p) => p.map((e) => e._stagingId === stagingId ? { ...e, [field]: value, _status: "edited" } : e));
  const stagingApproveAll = () => setAiStaging((p) => p.map((e) => e._status === "pending" ? { ...e, _status: "approved" } : e));
  const stagingCommit = () => {
    const toAdd = aiStaging.filter((e) => e._status === "approved" || e._status === "edited");
    const cleaned = toAdd.map(({ _stagingId, _status, ...rest }) => rest);
    setArticles((prev) => dedup([...prev, ...cleaned]));
    const count = cleaned.length;
    // Keep pending and rejected items — only remove committed ones
    const committedIds = new Set(toAdd.map((e) => e._stagingId));
    setAiStaging((prev) => prev.filter((e) => !committedIds.has(e._stagingId)));
    if (count > 0) {
      setShowConfirm({ title: "Import Complete", message: `${count} entr${count === 1 ? "y" : "ies"} added to the codex from "${aiSourceName}".`, confirmLabel: "OK", confirmColor: "#8ec8a0", onConfirm: () => setShowConfirm(null) });
    }
  };
  const stagingDeleteRejected = () => setAiStaging((p) => p.filter((e) => e._status !== "rejected"));
  const stagingRejectAll = () => setAiStaging((p) => p.map((e) => e._status === "pending" ? { ...e, _status: "rejected" } : e));
  const stagingClearAll = () => { setAiStaging([]); setAiSourceName(""); };

  // === NOVEL WRITING FUNCTIONS ===
  const msKey = () => "frostfall-novels-" + (activeWorld?.id || "default");

  // Helper: save manuscripts to best available storage
  const saveNovelsNow = async (data) => {
    const key = msKey();
    const json = JSON.stringify(data);
    // Try window.storage (Claude artifacts)
    try { if (typeof window !== "undefined" && window.storage) { await window.storage.set(key, json); return; } } catch (_) {}
    // Fallback to localStorage
    try { if (typeof window !== "undefined" && window.localStorage) { localStorage.setItem(key, json); return; } } catch (_) {}
  };

  // Helper: load manuscripts from best available storage
  const loadNovels = async () => {
    const key = msKey();
    // Try window.storage first
    try {
      if (typeof window !== "undefined" && window.storage) {
        const r = await window.storage.get(key);
        if (r?.value) return JSON.parse(r.value);
      }
    } catch (_) {}
    // Fallback to localStorage
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const stored = localStorage.getItem(key);
        if (stored) return JSON.parse(stored);
      }
    } catch (_) {}
    return null;
  };

  // Load manuscripts when world changes
  useEffect(() => {
    if (!activeWorld) return;
    (async () => {
      try {
        const ms = await loadNovels();
        if (ms && ms.length > 0) setManuscripts(ms);
        else setManuscripts([]);
      } catch (_) { setManuscripts([]); }
    })();
    setActiveMs(null); setNovelView("select");
  }, [activeWorld]);

  // Save manuscripts with debounce
  const novelSaveTimer = useRef(null);
  useEffect(() => {
    if (!dataLoaded || !activeWorld || manuscripts.length === 0) return;
    if (novelSaveTimer.current) clearTimeout(novelSaveTimer.current);
    novelSaveTimer.current = setTimeout(() => saveNovelsNow(manuscripts), 800);
    return () => { if (novelSaveTimer.current) clearTimeout(novelSaveTimer.current); };
  }, [manuscripts, dataLoaded, activeWorld]);

  // Force save on page unload
  useEffect(() => {
    const handler = () => {
      if (activeWorld) {
        if (manuscripts.length > 0) { const key = msKey(); try { localStorage.setItem(key, JSON.stringify(manuscripts)); } catch (_) {} }
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [manuscripts, activeWorld]);

  // Keep activeMs in sync with manuscripts array
  useEffect(() => {
    if (activeMs) {
      const updated = manuscripts.find((m) => m.id === activeMs.id);
      if (updated) setActiveMs(updated);
    }
  }, [manuscripts]);

  // Keep refs in sync
  useEffect(() => {
    activeMsIdRef.current = activeMs?.id || null;
  }, [activeMs?.id]);

  manuscriptsRef.current = manuscripts;

  const createManuscript = () => {
    if (!novelMsForm.title.trim()) return;
    const ms = {
      id: "ms_" + Date.now(),
      title: novelMsForm.title.trim(),
      description: novelMsForm.description.trim(),
      acts: [{
        id: "act_" + Date.now(),
        title: "Act I",
        synopsis: "",
        order: 0,
        color: theme.accent,
        chapters: [{
          id: "ch_" + Date.now(),
          title: "Chapter 1",
          synopsis: "",
          order: 0,
          status: "draft",
          scenes: [{
            id: "sc_" + Date.now(),
            title: "Scene 1",
            body: "",
            order: 0,
            notes: "",
            color: "none",
            label: "",
            povCharacter: "",
            snapshots: [],
          }],
        }],
      }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setManuscripts((prev) => [...prev, ms]);
    setActiveMs(ms);
    setNovelView("outline");
    setNovelMsForm({ title: "", description: "" });
    setShowMsCreate(false);
  };

  const updateMs = (updater) => {
    const msId = activeMsIdRef.current;
    if (!msId) return;
    setManuscripts((prev) => prev.map((m) => m.id === msId ? { ...updater(m), updatedAt: new Date().toISOString() } : m));
  };

  const deleteManuscript = (msId) => {
    setManuscripts((prev) => prev.filter((m) => m.id !== msId));
    if (activeMs?.id === msId) { setActiveMs(null); setNovelView("select"); }
  };

  const addAct = () => {
    updateMs((m) => ({
      ...m,
      acts: [...m.acts, {
        id: "act_" + Date.now(), title: "Act " + (m.acts.length + 1), synopsis: "", order: m.acts.length,
        color: [theme.accent, "#7ec8e3", "#e07050", "#8ec8a0", "#c084fc"][m.acts.length % 5],
        chapters: [{
          id: "ch_" + Date.now(), title: "Chapter 1", synopsis: "", order: 0, status: "draft",
          scenes: [{ id: "sc_" + Date.now(), title: "Scene 1", body: "", order: 0, notes: "", color: "none", label: "", povCharacter: "", snapshots: [] }],
        }],
      }],
    }));
  };

  const addChapter = (actId) => {
    updateMs((m) => ({
      ...m,
      acts: m.acts.map((a) => a.id === actId ? {
        ...a,
        chapters: [...a.chapters, {
          id: "ch_" + Date.now(), title: "Chapter " + (a.chapters.length + 1), synopsis: "", order: a.chapters.length, status: "draft",
          scenes: [{ id: "sc_" + Date.now(), title: "Scene 1", body: "", order: 0, notes: "", color: "none", label: "", povCharacter: "", snapshots: [] }],
        }],
      } : a),
    }));
  };

  const addScene = (actId, chId) => {
    updateMs((m) => ({
      ...m,
      acts: m.acts.map((a) => a.id === actId ? {
        ...a,
        chapters: a.chapters.map((c) => c.id === chId ? {
          ...c,
          scenes: [...c.scenes, { id: "sc_" + Date.now(), title: "Scene " + (c.scenes.length + 1), body: "", order: c.scenes.length, notes: "", color: "none", label: "", povCharacter: "", snapshots: [] }],
        } : c),
      } : a),
    }));
  };

  const updateAct = (actId, updates) => {
    updateMs((m) => ({ ...m, acts: m.acts.map((a) => a.id === actId ? { ...a, ...updates } : a) }));
  };

  const updateChapter = (actId, chId, updates) => {
    updateMs((m) => ({
      ...m,
      acts: m.acts.map((a) => a.id === actId ? {
        ...a, chapters: a.chapters.map((c) => c.id === chId ? { ...c, ...updates } : c),
      } : a),
    }));
  };

  const updateScene = (actId, chId, scId, updates) => {
    updateMs((m) => ({
      ...m,
      acts: m.acts.map((a) => a.id === actId ? {
        ...a,
        chapters: a.chapters.map((c) => c.id === chId ? {
          ...c, scenes: c.scenes.map((s) => s.id === scId ? { ...s, ...updates } : s),
        } : c),
      } : a),
    }));
  };

  const deleteAct = (actId) => {
    updateMs((m) => ({ ...m, acts: m.acts.filter((a) => a.id !== actId) }));
    if (novelActiveScene?.actId === actId) setNovelActiveScene(null);
  };

  const deleteChapter = (actId, chId) => {
    updateMs((m) => ({
      ...m,
      acts: m.acts.map((a) => a.id === actId ? { ...a, chapters: a.chapters.filter((c) => c.id !== chId) } : a),
    }));
    if (novelActiveScene?.chId === chId) setNovelActiveScene(null);
  };

  const deleteScene = (actId, chId, scId) => {
    updateMs((m) => ({
      ...m,
      acts: m.acts.map((a) => a.id === actId ? {
        ...a, chapters: a.chapters.map((c) => c.id === chId ? { ...c, scenes: c.scenes.filter((s) => s.id !== scId) } : c),
      } : a),
    }));
    if (novelActiveScene?.scId === scId) setNovelActiveScene(null);
  };

  const stripTags = (html) => html ? html.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim() : "";
  const countWords = (body) => { const t = stripTags(body || ""); return t ? t.split(/\s+/).filter(Boolean).length : 0; };

  const getActiveScene = () => {
    if (!novelActiveScene) return null;
    const msId = activeMsIdRef.current;
    const ms = manuscripts.find((m) => m.id === msId) || activeMs;
    if (!ms) return null;
    const act = ms.acts.find((a) => a.id === novelActiveScene.actId);
    const ch = act?.chapters.find((c) => c.id === novelActiveScene.chId);
    return ch?.scenes.find((s) => s.id === novelActiveScene.scId) || null;
  };

  const msWordCount = useMemo(() => {
    if (!activeMs) return { total: 0, acts: {} };
    let total = 0;
    const acts = {};
    for (const act of activeMs.acts) {
      let actWords = 0;
      for (const ch of act.chapters) {
        for (const sc of ch.scenes) {
          const w = countWords(sc.body);
          actWords += w;
        }
      }
      acts[act.id] = actWords;
      total += actWords;
    }
    return { total, acts };
  }, [activeMs]);

  const chapterWordCount = (ch) => ch.scenes.reduce((sum, sc) => sum + (countWords(sc.body)), 0);

  // Navigate to next/prev scene
  const navigateScene = (dir) => {
    if (!activeMs || !novelActiveScene) return;
    const allScenes = [];
    for (const a of activeMs.acts) for (const c of a.chapters) for (const s of c.scenes) allScenes.push({ actId: a.id, chId: c.id, scId: s.id });
    const idx = allScenes.findIndex((s) => s.scId === novelActiveScene.scId);
    const next = allScenes[idx + dir];
    if (next) setNovelActiveScene(next);
  };

  // === SCENE SNAPSHOTS ===
  const saveSnapshot = (actId, chId, scId) => {
    updateMs((m) => ({
      ...m, acts: m.acts.map((a) => a.id !== actId ? a : {
        ...a, chapters: a.chapters.map((c) => c.id !== chId ? c : {
          ...c, scenes: c.scenes.map((s) => {
            if (s.id !== scId) return s;
            const snaps = s.snapshots || [];
            return { ...s, snapshots: [...snaps, { body: s.body || "", savedAt: new Date().toISOString(), wordCount: countWords(s.body) }].slice(-10) };
          }),
        }),
      }),
    }));
  };

  const restoreSnapshot = (actId, chId, scId, snapIdx) => {
    updateMs((m) => ({
      ...m, acts: m.acts.map((a) => a.id !== actId ? a : {
        ...a, chapters: a.chapters.map((c) => c.id !== chId ? c : {
          ...c, scenes: c.scenes.map((s) => {
            if (s.id !== scId || !s.snapshots?.[snapIdx]) return s;
            return { ...s, body: s.snapshots[snapIdx].body };
          }),
        }),
      }),
    }));
    if (novelEditorRef.current) {
      const ms = manuscriptsRef.current.find((m) => m.id === activeMsIdRef.current);
      const act = ms?.acts.find((a) => a.id === actId);
      const ch = act?.chapters.find((c) => c.id === chId);
      const sc = ch?.scenes.find((s) => s.id === scId);
      const snapBody = sc?.snapshots?.[snapIdx]?.body || "";
      novelEditorRef.current.innerHTML = textToMentionHTML(snapBody);
    }
  };

  // === SESSION WORD TRACKING ===
  useEffect(() => {
    if (novelView === "write" && novelGoal.sessionStart === 0 && msWordCount.total > 0) {
      setNovelGoal((g) => ({ ...g, sessionStart: msWordCount.total }));
    }
  }, [novelView, msWordCount.total]);
  const sessionWords = msWordCount.total - (novelGoal.sessionStart || msWordCount.total);
  const goalProgress = novelGoal.daily > 0 ? Math.min(100, Math.round((sessionWords / novelGoal.daily) * 100)) : 0;

  // === COMPILE / EXPORT MANUSCRIPT ===
  const buildManuscriptContent = () => {
    if (!activeMs) return { text: "", html: "" };
    const es = novelExportSettings;
    const cleanMentions = (body) => (body || "").replace(/@\[([^\]]+)\]\(([^)]+)\)/g, "$1");
    const toPlainText = (body) => stripTags(cleanMentions(body));
    const sceneBreak = es.sceneBreaks === "blank" ? "\n\n\n" : es.sceneBreaks === "dash" ? "\n\n— — —\n\n" : "\n\n* * *\n\n";
    const sceneBreakHtml = es.sceneBreaks === "blank" ? `<div style="height:30px"></div>` : es.sceneBreaks === "dash" ? `<p style="text-align:center;color:#999;margin:24px 0;letter-spacing:4px">— — —</p>` : `<p style="text-align:center;color:#999;margin:24px 0">* &nbsp; * &nbsp; *</p>`;
    const pageBreak = es.chapterBreaks ? `<div style="page-break-before:always"></div>` : "";
    let text = "";
    let html = "";
    // Front matter
    if (es.frontMatter) {
      text += activeMs.title + "\n";
      html += `<h1 style="text-align:center;font-family:'Cinzel',serif;font-size:28px;margin-bottom:4px">${activeMs.title}</h1>`;
      if (activeMs.description) { text += activeMs.description + "\n"; html += `<p style="text-align:center;color:#666;font-style:italic;margin-bottom:8px">${activeMs.description}</p>`; }
      if (settings.authorName) { text += "by " + settings.authorName + "\n"; html += `<p style="text-align:center;color:#888;margin-bottom:40px">by ${settings.authorName}</p>`; }
      text += "\n---\n\n";
      html += `<hr style="border:none;border-top:1px solid #ccc;margin:30px auto;width:40%"/>`;
    }
    for (const act of activeMs.acts) {
      text += act.title.toUpperCase() + "\n\n";
      html += `<h2 style="font-family:'Cinzel',serif;text-align:center;font-size:22px;margin:40px 0 20px;text-transform:uppercase;letter-spacing:2px">${act.title}</h2>`;
      for (let ci = 0; ci < act.chapters.length; ci++) {
        const ch = act.chapters[ci];
        if (ci > 0 && es.chapterBreaks) { html += pageBreak; text += "\n\n\n"; }
        text += ch.title + "\n\n";
        html += `<h3 style="font-family:'Cinzel',serif;font-size:18px;margin:30px 0 10px">${ch.title}</h3>`;
        if (es.includeSynopsis && ch.synopsis) { text += "[Synopsis: " + ch.synopsis + "]\n\n"; html += `<p style="color:#888;font-style:italic;margin-bottom:16px">${ch.synopsis}</p>`; }
        for (let si = 0; si < ch.scenes.length; si++) {
          const sc = ch.scenes[si];
          if (si > 0) { text += sceneBreak; html += sceneBreakHtml; }
          if (es.includeNotes && sc.notes) { text += "[Note: " + sc.notes + "]\n\n"; html += `<p style="color:#888;font-style:italic;font-size:12px;margin-bottom:8px">[${sc.notes}]</p>`; }
          if (sc.body) {
            text += toPlainText(sc.body) + "\n\n";
            html += `<div style="font-family:Georgia,serif;font-size:14px;line-height:1.8;margin:0 0 16px">${cleanMentions(sc.body)}</div>`;
          }
        }
      }
    }
    return { text, html };
  };

  const compileManuscript = async (format = "txt") => {
    if (!activeMs || novelCompiling) return;
    setNovelCompiling(true);
    setNovelExportOpen(false);
    try {
      const { text, html } = buildManuscriptContent();
      const filename = (activeMs.title || "manuscript").replace(/[^a-z0-9]+/gi, "_");
      const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${activeMs.title}</title><style>@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&display=swap');body{max-width:700px;margin:60px auto;padding:0 30px;font-family:Georgia,serif;color:#222;line-height:1.8}@media print{body{margin:0;padding:20px}}</style></head><body>${html}</body></html>`;

      if (format === "txt") {
        const blob = new Blob([text], { type: "text/plain" });
        const url = URL.createObjectURL(blob); const a = document.createElement("a");
        a.href = url; a.download = filename + ".txt"; a.click(); URL.revokeObjectURL(url);
      } else if (format === "docx") {
        // Word-compatible HTML document
        const wordHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><style>body{font-family:Georgia,serif;font-size:12pt;line-height:1.8;color:#000}h1{font-size:24pt;text-align:center}h2{font-size:18pt;text-align:center;text-transform:uppercase}h3{font-size:14pt}p{text-indent:0.5in;margin:0 0 6pt}@page{margin:1in}</style></head><body>${html}</body></html>`;
        const blob = new Blob([wordHtml], { type: "application/vnd.ms-word" });
        const url = URL.createObjectURL(blob); const a = document.createElement("a");
        a.href = url; a.download = filename + ".doc"; a.click(); URL.revokeObjectURL(url);
      } else if (format === "pdf") {
        // Open formatted HTML in new window for print-to-PDF
        const w = window.open("", "_blank");
        if (w) { w.document.write(fullHtml); w.document.close(); setTimeout(() => w.print(), 500); }
      } else if (format === "html") {
        // Clean HTML e-book format
        const blob = new Blob([fullHtml], { type: "text/html" });
        const url = URL.createObjectURL(blob); const a = document.createElement("a");
        a.href = url; a.download = filename + ".html"; a.click(); URL.revokeObjectURL(url);
      }
    } catch (e) { console.error("Compile error:", e); }
    setNovelCompiling(false);
  };

  // === CORKBOARD DRAG-AND-DROP ===
  const handleCorkDrop = (actId, chId, dragScId, dropScId) => {
    if (dragScId === dropScId) return;
    updateMs((m) => ({
      ...m, acts: m.acts.map((a) => a.id !== actId ? a : {
        ...a, chapters: a.chapters.map((c) => {
          if (c.id !== chId) return c;
          const scenes = [...c.scenes];
          const dragIdx = scenes.findIndex((s) => s.id === dragScId);
          const dropIdx = scenes.findIndex((s) => s.id === dropScId);
          if (dragIdx === -1 || dropIdx === -1) return c;
          const [moved] = scenes.splice(dragIdx, 1);
          scenes.splice(dropIdx, 0, moved);
          return { ...c, scenes };
        }),
      }),
    }));
  };

  // === OUTLINE REORDER (drag-and-drop) ===
  const reorderActs = (fromIdx, toIdx) => {
    if (fromIdx === toIdx) return;
    updateMs((m) => {
      const acts = [...m.acts];
      const [moved] = acts.splice(fromIdx, 1);
      acts.splice(toIdx, 0, moved);
      return { ...m, acts };
    });
  };
  const reorderChapters = (actId, fromIdx, toIdx) => {
    if (fromIdx === toIdx) return;
    updateMs((m) => ({
      ...m, acts: m.acts.map((a) => {
        if (a.id !== actId) return a;
        const chapters = [...a.chapters];
        const [moved] = chapters.splice(fromIdx, 1);
        chapters.splice(toIdx, 0, moved);
        return { ...a, chapters };
      }),
    }));
  };
  const reorderScenes = (actId, chId, fromIdx, toIdx) => {
    if (fromIdx === toIdx) return;
    updateMs((m) => ({
      ...m, acts: m.acts.map((a) => a.id !== actId ? a : {
        ...a, chapters: a.chapters.map((c) => {
          if (c.id !== chId) return c;
          const scenes = [...c.scenes];
          const [moved] = scenes.splice(fromIdx, 1);
          scenes.splice(toIdx, 0, moved);
          return { ...c, scenes };
        }),
      }),
    }));
  };

  // @mention detection in editor — uses @[Title](article_id) format for rich display
  // Convert raw text with @[Title](id) to HTML with styled mention spans
  const textToMentionHTML = useCallback((text) => {
    if (!text) return "";
    // Detect if body is already HTML (has tags) or is legacy plain text
    const isHTML = /<[a-z][\s\S]*>/i.test(text);
    let html = text;
    if (!isHTML) {
      // Legacy plain text — escape HTML entities
      html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      html = html.replace(/\n/g, "<br>");
    }
    // Replace @[Title](id) with styled mention spans (works on both formats)
    html = html.replace(/@\[([^\]]+)\]\(([^)]+)\)/g, (_, title, id) => {
      const art = articles.find((a) => a.id === id);
      const cat = art?.category;
      const icon = CATEGORIES[cat]?.icon || "?";
      const color = CATEGORIES[cat]?.color || theme.accent;
      const brokenStyle = !art ? "background:rgba(224,112,80,0.12);border:1px solid rgba(224,112,80,0.4);color:#e07050" : `background:${color}18;border:1px solid ${color}40;color:${color}`;
      return `<span contenteditable="false" data-mention-id="${id}" data-mention-title="${title.replace(/"/g, "&quot;")}" style="${brokenStyle};border-radius:4px;padding:1px 6px;margin:0 1px;font-family:'Cinzel',sans-serif;font-weight:600;font-size:13px;letter-spacing:0.3px;cursor:pointer;user-select:all;display:inline;white-space:nowrap">${!art ? "⚠" : icon} ${title}</span>`;
    });
    return html;
  }, [articles]);

  // Serialize contentEditable DOM back to HTML with @[Title](id) format for mentions
  // Preserves formatting tags (b, i, u, s, h2, h3, ul, ol, li, blockquote, hr)
  const FORMATTING_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "S", "STRIKE", "H1", "H2", "H3", "UL", "OL", "LI", "BLOCKQUOTE", "HR", "A"]);
  const serializeEditor = useCallback((node) => {
    let result = "";
    if (!node) return result;
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        // Escape HTML in text nodes to prevent injection
        result += child.textContent.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      } else if (child.nodeName === "BR") {
        result += "<br>";
      } else if (child.dataset?.mentionId) {
        // Serialize mention spans back to @[Title](id) marker
        const title = child.dataset.mentionTitle || child.textContent.replace(/^[^\s]*\s/, "");
        result += "@[" + title + "](" + child.dataset.mentionId + ")";
      } else if (child.nodeName === "HR") {
        result += "<hr>";
      } else if (FORMATTING_TAGS.has(child.nodeName)) {
        // Preserve formatting tag
        const tag = child.nodeName.toLowerCase();
        result += "<" + tag + ">" + serializeEditor(child) + "</" + tag + ">";
      } else if (child.nodeName === "DIV" || child.nodeName === "P") {
        // ContentEditable wraps lines in divs/p — convert to proper paragraphs
        const inner = serializeEditor(child);
        if (inner.trim()) result += "<p>" + inner + "</p>";
      } else {
        result += serializeEditor(child);
      }
    }
    return result;
  }, []);

  // Track which scene is rendered to avoid unnecessary innerHTML updates
  const lastRenderedSceneRef = useRef(null);
  const isComposingRef = useRef(false);

  // Save editor content before switching scenes, then load new scene content
  useEffect(() => {
    const prev = prevActiveSceneRef.current;
    const currentSceneKey = novelActiveScene?.scId;
    const isWriteView = novelView === "write";
    const focusChanged = prevFocusModeRef.current !== novelFocusMode;
    prevFocusModeRef.current = novelFocusMode;

    if (prev && prev.scId !== currentSceneKey && !focusChanged && novelEditorRef.current) {
      const raw = serializeEditor(novelEditorRef.current);
      if (raw) {
        const msId = activeMsIdRef.current;
        if (msId) {
          setManuscripts((ms) => ms.map((m) => m.id !== msId ? m : {
            ...m, updatedAt: new Date().toISOString(),
            acts: m.acts.map((a) => a.id !== prev.actId ? a : {
              ...a, chapters: a.chapters.map((c) => c.id !== prev.chId ? c : {
                ...c, scenes: c.scenes.map((s) => s.id !== prev.scId ? s : { ...s, body: raw }),
              }),
            }),
          }));
        }
      }
    }

    prevActiveSceneRef.current = isWriteView && novelActiveScene ? { ...novelActiveScene } : null;

    if (!isWriteView) {
      lastRenderedSceneRef.current = null;
      return;
    }

    if (focusChanged) {
      lastRenderedSceneRef.current = null;
    }

    if (!novelEditorRef.current || !novelActiveScene) return;

    if (lastRenderedSceneRef.current !== currentSceneKey) {
      lastRenderedSceneRef.current = currentSceneKey;
      const msId = activeMsIdRef.current;
      const ms = manuscriptsRef.current.find((m) => m.id === msId);
      let body = "";
      if (ms) {
        const act = ms.acts.find((a) => a.id === novelActiveScene.actId);
        const ch = act?.chapters.find((c) => c.id === novelActiveScene.chId);
        const scene = ch?.scenes.find((s) => s.id === novelActiveScene.scId);
        body = scene?.body || "";
      }
      novelEditorRef.current.innerHTML = textToMentionHTML(body);
    }
  }, [novelActiveScene?.scId, novelView, novelFocusMode, textToMentionHTML]);

  // Handle input in contentEditable editor
  const handleNovelInput = useCallback(() => {
    if (!novelEditorRef.current || !novelActiveScene || isComposingRef.current) return;
    const raw = serializeEditor(novelEditorRef.current);
    updateScene(novelActiveScene.actId, novelActiveScene.chId, novelActiveScene.scId, { body: raw });

    // Check for @mention trigger at cursor
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) { setNovelMention(null); return; }
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) { setNovelMention(null); return; }
    const textBefore = node.textContent.slice(0, range.startOffset);
    const atMatch = textBefore.match(/@(\w*)$/);
    if (atMatch) {
      // Position the dropdown near the cursor
      const rects = range.getClientRects();
      const rect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
      setNovelMention({
        query: atMatch[1],
        actId: novelActiveScene.actId, chId: novelActiveScene.chId, scId: novelActiveScene.scId,
        x: rect.left, y: rect.bottom + 6,
        textNode: node, atOffset: range.startOffset - atMatch[0].length,
        cursorOffset: range.startOffset,
      });
    } else {
      setNovelMention(null);
    }
  }, [novelActiveScene, serializeEditor, updateScene]);

  // Handle backspace/delete near mention spans
  const handleMentionKeyDown = useCallback((e) => {
    if (e.key !== "Backspace" && e.key !== "Delete") return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) return;
    const node = range.startContainer;
    const offset = range.startOffset;
    if (e.key === "Backspace") {
      if (node.nodeType === Node.TEXT_NODE && offset === 0) {
        const prev = node.previousSibling;
        if (prev && prev.dataset?.mentionId) {
          e.preventDefault();
          prev.parentNode.removeChild(prev);
          handleNovelInput();
          return;
        }
      }
      if (node.nodeType === Node.ELEMENT_NODE && offset > 0) {
        const prev = node.childNodes[offset - 1];
        if (prev && prev.dataset?.mentionId) {
          e.preventDefault();
          prev.parentNode.removeChild(prev);
          handleNovelInput();
          return;
        }
      }
    }
    if (e.key === "Delete") {
      if (node.nodeType === Node.TEXT_NODE && offset === node.textContent.length) {
        const next = node.nextSibling;
        if (next && next.dataset?.mentionId) {
          e.preventDefault();
          next.parentNode.removeChild(next);
          handleNovelInput();
          return;
        }
      }
      if (node.nodeType === Node.ELEMENT_NODE && offset < node.childNodes.length) {
        const next = node.childNodes[offset];
        if (next && next.dataset?.mentionId) {
          e.preventDefault();
          next.parentNode.removeChild(next);
          handleNovelInput();
          return;
        }
      }
    }
  }, [handleNovelInput]);

  const insertMention = useCallback((article) => {
    if (!novelMention || !novelEditorRef.current) return;
    const { textNode, atOffset, cursorOffset } = novelMention;

    // Create mention span
    const span = document.createElement("span");
    span.contentEditable = "false";
    span.dataset.mentionId = article.id;
    span.dataset.mentionTitle = article.title;
    const cat = article.category;
    const color = CATEGORIES[cat]?.color || theme.accent;
    const icon = CATEGORIES[cat]?.icon || "?";
    span.style.cssText = `background:${color}18;border:1px solid ${color}40;color:${color};border-radius:4px;padding:1px 6px;margin:0 1px;font-family:'Cinzel',sans-serif;font-weight:600;font-size:13px;letter-spacing:0.3px;cursor:pointer;user-select:all;display:inline;white-space:nowrap`;
    span.textContent = icon + " " + article.title;

    // Replace @query text with the mention span
    if (textNode && textNode.parentNode) {
      const fullText = textNode.textContent;
      const beforeAt = fullText.slice(0, atOffset);
      const afterCursor = fullText.slice(cursorOffset);

      const beforeNode = document.createTextNode(beforeAt);
      const afterNode = document.createTextNode(" " + afterCursor);
      const parent = textNode.parentNode;

      parent.insertBefore(beforeNode, textNode);
      parent.insertBefore(span, textNode);
      parent.insertBefore(afterNode, textNode);
      parent.removeChild(textNode);

      // Move cursor after the mention
      const sel = window.getSelection();
      const range = document.createRange();
      range.setStart(afterNode, 1);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    // Serialize and update state
    const raw = serializeEditor(novelEditorRef.current);
    updateScene(novelMention.actId, novelMention.chId, novelMention.scId, { body: raw });
    setNovelMention(null);
  }, [novelMention, serializeEditor, updateScene]);

  // Handle mention click in editor (event delegation)
  const handleEditorClick = useCallback((e) => {
    const mentionEl = e.target.closest("[data-mention-id]");
    if (mentionEl) {
      e.preventDefault();
      const artId = mentionEl.dataset.mentionId;
      const art = articles.find((a) => a.id === artId);
      if (art) {
        setActiveArticle(art);
        setView("article");
      }
    }
  }, [articles]);

  // Handle mention hover for tooltip
  const handleEditorMouseOver = useCallback((e) => {
    const mentionEl = e.target.closest("[data-mention-id]");
    if (mentionEl) {
      const artId = mentionEl.dataset.mentionId;
      const art = articles.find((a) => a.id === artId);
      if (art) {
        const r = mentionEl.getBoundingClientRect();
        setMentionTooltip({ article: art, x: r.left, y: r.bottom + 4 });
      }
    } else {
      setMentionTooltip(null);
    }
  }, [articles]);

  // Insert @mention from codex sidebar
  const insertMentionFromSidebar = useCallback((article) => {
    if (!novelEditorRef.current || !novelActiveScene) return;
    novelEditorRef.current.focus();
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const span = document.createElement("span");
      span.contentEditable = "false";
      span.dataset.mentionId = article.id;
      span.dataset.mentionTitle = article.title;
      const cat = article.category;
      const color = CATEGORIES[cat]?.color || theme.accent;
      const icon = CATEGORIES[cat]?.icon || "?";
      span.style.cssText = `background:${color}18;border:1px solid ${color}40;color:${color};border-radius:4px;padding:1px 6px;margin:0 1px;font-family:'Cinzel',sans-serif;font-weight:600;font-size:13px;letter-spacing:0.3px;cursor:pointer;user-select:all;display:inline;white-space:nowrap`;
      span.textContent = icon + " " + article.title;
      range.deleteContents();
      range.insertNode(span);
      // Move cursor after
      range.setStartAfter(span);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      // Add a space after
      const space = document.createTextNode(" ");
      span.parentNode.insertBefore(space, span.nextSibling);
      range.setStartAfter(space);
      range.collapse(true);
    }
    const raw = serializeEditor(novelEditorRef.current);
    updateScene(novelActiveScene.actId, novelActiveScene.chId, novelActiveScene.scId, { body: raw });
  }, [novelActiveScene, serializeEditor, updateScene]);

  // Text formatting commands for the editor
  const execFormat = useCallback((cmd, value) => {
    if (!novelEditorRef.current) return;
    novelEditorRef.current.focus();
    document.execCommand(cmd, false, value || null);
    // Trigger save after formatting
    const raw = serializeEditor(novelEditorRef.current);
    if (novelActiveScene) updateScene(novelActiveScene.actId, novelActiveScene.chId, novelActiveScene.scId, { body: raw });
  }, [novelActiveScene, serializeEditor, updateScene]);

  // Query format state for active button highlighting
  const [formatState, setFormatState] = useState({});
  const updateFormatState = useCallback(() => {
    setFormatState({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
      strikethrough: document.queryCommandState("strikeThrough"),
      ul: document.queryCommandState("insertUnorderedList"),
      ol: document.queryCommandState("insertOrderedList"),
    });
  }, []);

  // Hover tooltip state for mentions
  const [mentionTooltip, setMentionTooltip] = useState(null);

  // Codex articles filtered for sidebar
  const novelCodexArticles = useMemo(() => {
    let list = articles;
    if (novelCodexFilter !== "all") list = list.filter((a) => a.category === novelCodexFilter);
    if (novelCodexSearch) {
      const q = lower(novelCodexSearch);
      list = list.filter((a) => lower(a.title).includes(q) || lower(a.summary || "").includes(q) || a.tags?.some((t) => lower(t).includes(q)) || lower(stripTags(a.body || "")).includes(q) || (a.fields && Object.values(a.fields).some((v) => v && lower(String(v)).includes(q))));
    }
    return list.slice(0, 50);
  }, [articles, novelCodexFilter, novelCodexSearch]);

  const STATUS_COLORS = { draft: theme.textDim, revised: theme.accent, final: "#8ec8a0" };

  useEffect(() => { setFadeIn(false); const t = setTimeout(() => setFadeIn(true), 30); return () => clearTimeout(t); }, [view, activeArticle]);

  // Keep activeArticle in sync when articles array updates (e.g. inline fixes)
  useEffect(() => {
    if (activeArticle && view === "article") {
      const updated = articles.find((a) => a.id === activeArticle.id);
      if (updated && updated.updatedAt !== activeArticle.updatedAt) {
        setActiveArticle(updated);
      }
    }
  }, [articles]);

  const navigate = useCallback((id) => { const a = articles.find((x) => x.id === id); if (a) { setActiveArticle(a); setView("article"); } if (isMobile) setSidebarOpen(false); }, [articles, isMobile]);
  const goCodex = (f = "all") => { setCodexFilter(f); setView("codex"); closeSidebar(); };
  const goDash = () => { setView("dashboard"); closeSidebar(); };
  const goCreate = (cat) => { setCreateCat(cat); setEditingId(null); setArticlePreviewMode(false); setArticleTablePicker(false); articleInitSessionRef.current = null; articleLastTypedRef.current = null; setFormData({ title: "", summary: "", fields: {}, body: "", tags: "", temporal: null, portrait: null }); setView("create"); closeSidebar(); };
  const goEdit = (article) => {
    setCreateCat(article.category);
    setEditingId(article.id);
    setArticlePreviewMode(false);
    setArticleTablePicker(false);
    articleInitSessionRef.current = null; // force re-initialization
    articleLastTypedRef.current = null;
    // Convert plain text body to HTML on edit
    const bodyHtml = (article.body && !/<[a-z][\s\S]*?>/i.test(article.body))
      ? article.body.split("\n").map((line) => line.trim() ? "<p>" + line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</p>" : "<p><br></p>").join("")
      : (article.body || "");
    setFormData({
      title: article.title,
      summary: article.summary || "",
      fields: { ...article.fields },
      body: bodyHtml,
      tags: (article.tags || []).join(", "),
      temporal: article.temporal ? { ...article.temporal } : null,
      portrait: article.portrait || null,
    });
    setView("create");
  };

  // Duplicate: copy article data into create form with "(Copy)" suffix, no editingId
  const goDuplicate = (article) => {
    setCreateCat(article.category);
    setEditingId(null);
    setFormData({
      title: article.title + " (Copy)",
      summary: article.summary || "",
      fields: { ...article.fields },
      body: article.body || "",
      tags: (article.tags || []).join(", "),
      temporal: article.temporal ? { ...article.temporal } : null,
      portrait: article.portrait || null,
    });
    setView("create");
  };

  // === TEMPLATES ===
  const TEMPLATES_KEY = "ff_article_templates";
  const loadTemplates = () => {
    try { return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || "[]"); } catch { return []; }
  };
  const saveTemplateToStorage = (tmpl) => {
    const existing = loadTemplates();
    existing.push(tmpl);
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(existing));
  };
  const deleteTemplate = (tmplId) => {
    const existing = loadTemplates().filter((t) => t.id !== tmplId);
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(existing));
  };
  const saveAsTemplate = (article) => {
    const name = prompt("Template name:", article.title + " Template");
    if (!name) return;
    saveTemplateToStorage({
      id: Date.now() + "-tmpl",
      name,
      category: article.category,
      fields: { ...article.fields },
      body: article.body || "",
      tags: (article.tags || []).join(", "),
      temporal: article.temporal ? { ...article.temporal } : null,
      createdAt: new Date().toISOString(),
    });
  };
  const applyTemplate = (tmpl) => {
    setCreateCat(tmpl.category);
    setEditingId(null);
    setFormData({
      title: "",
      summary: "",
      fields: { ...tmpl.fields },
      body: tmpl.body || "",
      tags: tmpl.tags || "",
      temporal: tmpl.temporal ? { ...tmpl.temporal } : null,
      portrait: null,
    });
    setView("create");
  };

  // === EXPORT / IMPORT WORLD ===
  const exportWorldJSON = async () => {
    const data = { version: 1, exportedAt: new Date().toISOString(), world: activeWorld, articles, settings };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = (activeWorld?.name || "world") + "_export.json"; a.click();
    URL.revokeObjectURL(url);
  };
  const importWorldJSON = (file) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.articles || !Array.isArray(data.articles)) { alert("Invalid world file."); return; }
        if (!confirm("Import " + data.articles.length + " articles from \"" + (data.world?.name || "Unknown") + "\"? This will merge with your current data.")) return;
        setArticles((prev) => {
          const existingIds = new Set(prev.map((a) => a.id));
          const newOnes = data.articles.filter((a) => !existingIds.has(a.id));
          return dedup([...prev, ...newOnes]);
        });
        alert("Imported " + data.articles.length + " articles successfully.");
      } catch { alert("Failed to parse import file."); }
    };
    reader.readAsText(file);
  };

  // === ARTICLE VERSION HISTORY ===
  const HISTORY_KEY = "ff_article_history";
  const saveArticleSnapshot = (articleId, article) => {
    try {
      const all = JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}");
      const snaps = all[articleId] || [];
      snaps.unshift({ savedAt: new Date().toISOString(), title: article.title, summary: article.summary, fields: { ...article.fields }, body: article.body, tags: [...(article.tags || [])], category: article.category });
      if (snaps.length > 20) snaps.length = 20; // keep last 20
      all[articleId] = snaps;
      localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
    } catch {}
  };
  const getArticleHistory = (articleId) => {
    try { const all = JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}"); return all[articleId] || []; } catch { return []; }
  };
  const restoreArticleVersion = (articleId, snapshot) => {
    setArticles((prev) => prev.map((a) => a.id === articleId ? { ...a, title: snapshot.title, summary: snapshot.summary, fields: { ...snapshot.fields }, body: snapshot.body, tags: [...(snapshot.tags || [])], updatedAt: new Date().toISOString() } : a));
    setActiveArticle((prev) => prev && prev.id === articleId ? { ...prev, title: snapshot.title, summary: snapshot.summary, fields: { ...snapshot.fields }, body: snapshot.body, tags: [...(snapshot.tags || [])] } : prev);
  };
  const buildTemporal = (cat, fields, existingTemporal) => {
    if (cat === "character") {
      const by = parseInt(fields.birth_year), dy = parseInt(fields.death_year);
      if (!isNaN(by)) return { type: "mortal", active_start: by, active_end: isNaN(dy) ? null : dy, birth_year: isNaN(by) ? null : by, death_year: isNaN(dy) ? null : dy };
    }
    if (cat === "event") {
      const dr = fields.date_range || "";
      const nums = dr.match(/[\d,]+/g)?.map((n) => parseInt(n.replace(/,/g, ""))) || [];
      if (nums.length >= 1) return { type: "event", active_start: nums[0], active_end: nums[1] || nums[0] };
    }
    if (cat === "location") {
      const fy = parseInt(fields.founding_year);
      if (!isNaN(fy)) return { type: "location", active_start: fy, active_end: null };
    }
    if (cat === "organization") {
      const fy = parseInt(fields.founded);
      if (!isNaN(fy)) return { type: "organization", active_start: fy, active_end: null };
    }
    return existingTemporal || null;
  };

  const [expandedWarning, setExpandedWarning] = useState(null); // index of expanded broken_ref warning

  // Replace a broken @mention in the body with a proper rich mention to the selected article
  const resolveRef = (warning, selectedArticle) => {
    const richMention = "@[" + selectedArticle.title + "](" + selectedArticle.id + ")";
    // Read current body from editor DOM if available
    const currentBody = (articleBodyRef.current?.innerHTML) || formData.body || "";
    let newBody = currentBody;

    if (warning.rawMention && newBody.includes(warning.rawMention)) {
      newBody = newBody.replace(warning.rawMention, richMention);
    } else if (warning.refId) {
      const legacyPattern = "@" + warning.refId;
      if (newBody.includes(legacyPattern)) {
        newBody = newBody.replace(legacyPattern, richMention);
      }
    }
    if (newBody !== currentBody) {
      updateEditorBody(newBody);
    }
  };
    // Don't close expandedWarning — the fixed warning disappears naturally from the recalculated list,
    // and other expanded warnings remain visible for the user to continue fixing
  };

  // Smart insert a link suggestion — find where the name appears in body and wrap it in-place
  const smartInsertLink = (sug) => {
    const richMention = "@[" + sug.article.title + "](" + sug.article.id + ")";
    // Read current body from editor DOM if available, otherwise formData
    const currentBody = (articleBodyRef.current?.innerHTML) || formData.body || "";
    if (currentBody.includes(richMention) || currentBody.includes("@[" + sug.article.title + "]")) return;

    const titleToFind = sug.article.title;
    const matchText = sug?.matchText || sug?.match || titleToFind;
    let newBody = currentBody;

    if (isHtmlBody(currentBody)) {
      const div = document.createElement("div");
      div.innerHTML = currentBody;
      let replaced = false;
      const walkAndReplace = (node, searchText) => {
        if (replaced) return;
        if (node.nodeType === 3) {
          const idx = node.textContent.toLowerCase().indexOf(searchText.toLowerCase());
          if (idx !== -1) {
            const parent = node.parentElement;
            if (parent && (parent.classList?.contains("mention-chip") || parent.closest?.("[data-mention]"))) return;
            const before = node.textContent.substring(0, idx);
            const after = node.textContent.substring(idx + searchText.length);
            node.textContent = before + richMention + after;
            replaced = true;
          }
        }
        if (node.childNodes) for (const child of Array.from(node.childNodes)) { walkAndReplace(child, searchText); if (replaced) return; }
      };
      walkAndReplace(div, titleToFind);
      if (!replaced && matchText !== titleToFind) walkAndReplace(div, matchText);
      newBody = replaced ? div.innerHTML : currentBody + "<p>" + richMention + "</p>";
    } else {
      const bodyLower = lower(currentBody);
      const titleLower = lower(titleToFind);
      const exactIdx = bodyLower.indexOf(titleLower);
      if (exactIdx !== -1) {
        newBody = currentBody.substring(0, exactIdx) + richMention + currentBody.substring(exactIdx + titleToFind.length);
      } else {
        const searchLower = lower(matchText);
        const matchIdx = searchLower ? bodyLower.indexOf(searchLower) : -1;
        if (matchIdx !== -1) {
          newBody = currentBody.substring(0, matchIdx) + richMention + currentBody.substring(matchIdx + matchText.length);
        } else {
          newBody = currentBody + (currentBody ? "\n\n" : "") + richMention;
        }
      }
    }

    // Update editor DOM directly + sync formData
    updateEditorBody(newBody);
  };

  // ─── Article Editor Helpers ────────────────────────────────────
  const isHtmlBody = useCallback((text) => /<[a-z][\s\S]*?>/i.test(text || ""), []);

  const plainToHtml = useCallback((text) => {
    if (!text) return "";
    if (isHtmlBody(text)) return text;
    return text.split("\n").map((line) => line.trim() ? "<p>" + line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</p>" : "<p><br></p>").join("");
  }, [isHtmlBody]);

  // Strip HTML tags to get plain text (for search within body)
  const stripBodyHtml = useCallback((html) => {
    if (!html) return "";
    return html.replace(/<[^>]*>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  }, []);

  // Sync contentEditable → formData.body (debounced to prevent cursor resets)
  const articleBodyTimerRef = useRef(null);
  const handleArticleBodyInput = useCallback(() => {
    if (!articleBodyRef.current) return;
    // Debounce the state update — contentEditable is source of truth while typing
    clearTimeout(articleBodyTimerRef.current);
    articleBodyTimerRef.current = setTimeout(() => {
      if (!articleBodyRef.current) return;
      const html = articleBodyRef.current.innerHTML || "";
      articleLastTypedRef.current = html;
      setFormData((p) => ({ ...p, body: html }));
    }, 300);
  }, []);

  // Flush pending body changes immediately (called before save/preview)
  const flushArticleBody = useCallback(() => {
    clearTimeout(articleBodyTimerRef.current);
    if (articleBodyRef.current) {
      const html = articleBodyRef.current.innerHTML || "";
      articleLastTypedRef.current = html;
      setFormData((p) => ({ ...p, body: html }));
    }
  }, []);

  // Initialize editor content when starting a new edit session or switching out of preview
  useEffect(() => {
    if (view !== "create" || articlePreviewMode) return;
    const sessionKey = (editingId || "new") + "_" + (createCat || "");
    if (articleInitSessionRef.current === sessionKey) return;
    articleInitSessionRef.current = sessionKey;
    requestAnimationFrame(() => {
      if (articleBodyRef.current) {
        articleBodyRef.current.innerHTML = plainToHtml(formData.body);
        articleLastTypedRef.current = articleBodyRef.current.innerHTML;
      }
    });
  }, [view, editingId, createCat, articlePreviewMode]);

  // Re-initialize when switching from preview back to edit
  useEffect(() => {
    if (view !== "create" || articlePreviewMode) return;
    requestAnimationFrame(() => {
      if (articleBodyRef.current && !articleBodyRef.current.innerHTML) {
        articleBodyRef.current.innerHTML = plainToHtml(formData.body);
        articleLastTypedRef.current = articleBodyRef.current.innerHTML;
      }
    });
  }, [articlePreviewMode]);

  const execArticleCmd = useCallback((cmd, value) => {
    articleBodyRef.current?.focus();
    document.execCommand(cmd, false, value || null);
    handleArticleBodyInput();
  }, [handleArticleBodyInput]);

  const insertArticleTable = useCallback((rows, cols) => {
    let html = '<table style="width:100%;border-collapse:collapse;margin:12px 0"><tbody>';
    for (let r = 0; r < rows; r++) {
      html += "<tr>";
      for (let c = 0; c < cols; c++) {
        const tag = r === 0 ? "th" : "td";
        html += `<${tag}>${r === 0 ? "Header " + (c + 1) : ""}</${tag}>`;
      }
      html += "</tr>";
    }
    html += "</tbody></table><p><br></p>";
    articleBodyRef.current?.focus();
    document.execCommand("insertHTML", false, html);
    handleArticleBodyInput();
    setArticleTablePicker(false);
  }, [handleArticleBodyInput]);

  const handleArticleImageUpload = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 2 * 1024 * 1024) { alert("Image must be under 2MB"); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      articleBodyRef.current?.focus();
      document.execCommand("insertHTML", false, `<img src="${ev.target.result}" alt="Image" style="max-width:100%;border-radius:6px;margin:8px 0" />`);
      handleArticleBodyInput();
    };
    reader.readAsDataURL(file);
  }, [handleArticleBodyInput]);

  const handleArticlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        handleArticleImageUpload(item.getAsFile());
        return;
      }
    }
  }, [handleArticleImageUpload]);

  // Extract TOC headings from HTML body
  const getBodyToc = useCallback((html) => {
    if (!html || !isHtmlBody(html)) return [];
    const toc = [];
    const regex = /<(h[23])[^>]*>(.*?)<\/\1>/gi;
    let m;
    let idx = 0;
    while ((m = regex.exec(html)) !== null) {
      const level = m[1].toLowerCase() === "h2" ? 2 : 3;
      const text = m[2].replace(/<[^>]*>/g, "").trim();
      if (text) toc.push({ id: "toc-" + idx, level, text });
      idx++;
    }
    return toc;
  }, [isHtmlBody]);

  // Render body HTML with @mention replacement for article view
  const renderBodyWithMentions = useCallback((html) => {
    if (!html) return "";
    return html.replace(/@\[([^\]]+)\]\(([^)]+)\)/g, (_, title, id) => {
      const art = articles.find((a) => a.id === id);
      const color = art ? (CATEGORIES[art.category]?.color || "#f0c040") : "#e07050";
      const icon = art ? (CATEGORIES[art.category]?.icon || "") : "⚠";
      return `<span class="mention-chip" data-id="${id}" style="background:${color}15;border:1px solid ${color}35;border-radius:4px;padding:1px 6px;margin:0 1px;color:${color};cursor:pointer;font-weight:600;font-size:0.92em;font-family:'Cinzel',sans-serif;letter-spacing:0.3px">${icon} ${title}</span>`;
    });
  }, [articles]);

  // For EXTERNAL body changes (smartInsertLink, resolveRef), update the editor DOM directly
  const updateEditorBody = useCallback((newBody) => {
    articleLastTypedRef.current = newBody;
    setFormData((p) => ({ ...p, body: newBody }));
    // Also update the DOM if editor is mounted
    if (articleBodyRef.current) {
      articleBodyRef.current.innerHTML = newBody;
    }
  }, []);

  const attemptSave = () => {
    flushArticleBody(); // ensure editor content is synced to formData
    const dupes = findDuplicates(formData.title, articles, editingId);
    if (dupes.length > 0) { setPendingDupes(dupes); setShowDupeModal(true); return; }
    // Check integrity — gate on errors/warnings
    const data = { ...formData, id: editingId || lower(formData.title).replace(/[^a-z0-9]+/g, "_"), category: createCat };
    const warnings = checkArticleIntegrity(data, articles, temporalGraph, editingId);
    const serious = warnings.filter((w) => w.severity === "error" || w.severity === "warning");
    if (serious.length > 0) {
      setIntegrityGate({ warnings: serious, onProceed: doSave });
      return;
    }
    doSave();
  };
  const doSave = () => {
    const id = editingId || lower(formData.title).replace(/[^a-z0-9]+/g, "_").replace(/_+$/, "");
    // Extract both @[Title](id) rich mentions and legacy @id mentions
    const richMentions = (formData.body.match(/@\[([^\]]+)\]\(([^)]+)\)/g) || []).map((m) => { const match = m.match(/@\[([^\]]+)\]\(([^)]+)\)/); return match ? match[2] : null; }).filter(Boolean);
    const legacyMentions = (formData.body.match(/@(?!\[)([\w]+)/g) || []).map((m) => m.slice(1));
    const allMentions = [...new Set([...richMentions, ...legacyMentions])];
    const temporal = buildTemporal(createCat, formData.fields, formData.temporal);
    const now = new Date().toISOString();
    const a = {
      id, title: formData.title, category: createCat, summary: formData.summary,
      fields: formData.fields, body: formData.body,
      tags: formData.tags.split(",").map((t) => t.trim()).filter(Boolean),
      linkedIds: allMentions, temporal,
      portrait: formData.portrait || (editingId ? (articles.find((x) => x.id === editingId)?.portrait || null) : null),
      createdAt: editingId ? (articles.find((x) => x.id === editingId)?.createdAt || now) : now,
      updatedAt: now,
    };
    if (editingId) {
      // Save version history snapshot before overwriting
      const prev = articles.find((x) => x.id === editingId);
      if (prev) saveArticleSnapshot(editingId, prev);
      setArticles((prev) => prev.map((x) => x.id === editingId ? a : x));
    } else {
      setArticles((prev) => dedup([a, ...prev]));
    }
    setActiveArticle(a); setShowDupeModal(false); setPendingDupes([]); setEditingId(null); setIntegrityGate(null); setView("article");
  };

  // === DELETE / ARCHIVE ===
  const doArchive = (article) => {
    setArchived((prev) => [{ ...article, archivedAt: new Date().toISOString() }, ...prev]);
    setArticles((prev) => prev.filter((a) => a.id !== article.id));
    setShowDeleteModal(null); goDash();
  };
  const doPermanentDelete = (article) => {
    setShowDeleteModal(null);
    setShowConfirm({
      title: "Permanently Delete?",
      message: `"${article.title}" will be erased forever. All @mentions pointing to this entry will break. This cannot be undone.`,
      confirmLabel: "Delete Forever",
      confirmColor: "#e07050",
      onConfirm: () => {
        setArticles((prev) => prev.filter((a) => a.id !== article.id));
        setShowConfirm(null); goDash();
      },
    });
  };
  const restoreFromArchive = (article) => {
    const { archivedAt, ...clean } = article;
    setArticles((prev) => dedup([{ ...clean, updatedAt: new Date().toISOString() }, ...prev]));
    setArchived((prev) => prev.filter((a) => a.id !== article.id));
  };
  const permanentDeleteFromArchive = (article) => {
    setShowConfirm({
      title: "Permanently Delete from Archive?",
      message: `"${article.title}" will be erased forever. This cannot be undone.`,
      confirmLabel: "Delete Forever",
      confirmColor: "#e07050",
      onConfirm: () => { setArchived((prev) => prev.filter((a) => a.id !== article.id)); setShowConfirm(null); },
    });
  };

  const linkSugs = useMemo(() => view === "create" ? findUnlinkedMentions(formData.body + " " + formData.summary + " " + formData.title, formData.fields, articles, editingId ? (articles.find((a) => a.id === editingId)?.linkedIds || []) : []) : [], [view, formData, articles, editingId]);
  const liveDupes = useMemo(() => view === "create" ? findDuplicates(formData.title, articles, editingId) : [], [view, formData.title, articles, editingId]);
  const liveIntegrity = useMemo(() => {
    if (view !== "create") return [];
    const data = { ...formData, id: editingId || lower(formData.title).replace(/[^a-z0-9]+/g, "_"), category: createCat };
    return checkArticleIntegrity(data, articles, temporalGraph, editingId);
  }, [view, formData, articles, editingId, createCat]);

  // ─── Tag Explorer Data ─────
  const allTags = useMemo(() => {
    const tagMap = {};
    articles.forEach((a) => (a.tags || []).forEach((t) => { tagMap[t] = (tagMap[t] || 0) + 1; }));
    return Object.entries(tagMap).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
  }, [articles]);

  // ─── Cross-Reference Stats ─────
  const refStats = useMemo(() => {
    const stats = {};
    articles.forEach((a) => { stats[a.id] = { outgoing: [...(a.linkedIds || [])], incoming: [] }; });
    articles.forEach((a) => {
      (a.linkedIds || []).forEach((lid) => {
        if (stats[lid]) stats[lid].incoming.push(a.id);
      });
    });
    return stats;
  }, [articles]);

  const orphanArticles = useMemo(() =>
    articles.filter((a) => {
      const s = refStats[a.id];
      return s && s.outgoing.length === 0 && s.incoming.length === 0;
    }),
  [articles, refStats]);

  // ─── Related Articles Suggestion (shared tags + category proximity) ─────
  const getRelatedArticles = useCallback((articleId, limit = 6) => {
    const src = articles.find((a) => a.id === articleId);
    if (!src) return [];
    const srcTags = new Set(src.tags || []);
    const srcLinked = new Set(src.linkedIds || []);
    return articles
      .filter((a) => a.id !== articleId && !srcLinked.has(a.id))
      .map((a) => {
        let score = 0;
        const aTags = new Set(a.tags || []);
        srcTags.forEach((t) => { if (aTags.has(t)) score += 10; });
        if (a.category === src.category) score += 3;
        const aLinked = new Set(a.linkedIds || []);
        if (aLinked.has(articleId)) score += 8; // back-references
        return { article: a, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }, [articles]);

  const filtered = useMemo(() => {
    let l = articles;
    if (codexFilter !== "all") l = l.filter((a) => a.category === codexFilter);
    // Tag filter
    if (codexTagFilter) l = l.filter((a) => (a.tags || []).includes(codexTagFilter));
    // Reference filter
    if (codexRefFilter === "has_refs") l = l.filter((a) => { const s = refStats[a.id]; return s && (s.outgoing.length > 0 || s.incoming.length > 0); });
    else if (codexRefFilter === "orphans") l = l.filter((a) => { const s = refStats[a.id]; return s && s.outgoing.length === 0 && s.incoming.length === 0; });
    else if (codexRefFilter === "no_outgoing") l = l.filter((a) => { const s = refStats[a.id]; return s && s.outgoing.length === 0; });
    else if (codexRefFilter === "no_incoming") l = l.filter((a) => { const s = refStats[a.id]; return s && s.incoming.length === 0; });
    let matchMap = {};
    if (searchQuery.trim()) {
      const q = lower(searchQuery);
      l = l.filter((a) => {
        // Title match (highest priority)
        if (lower(a.title).includes(q)) { matchMap[a.id] = { where: "title" }; return true; }
        // Summary match
        if (lower(a.summary || "").includes(q)) { matchMap[a.id] = { where: "summary" }; return true; }
        // Tag match
        if (a.tags?.some((t) => lower(t).includes(q))) { matchMap[a.id] = { where: "tags", snippet: a.tags.filter((t) => lower(t).includes(q)).join(", ") }; return true; }
        // Fields match (search all field values)
        if (a.fields) {
          for (const [fk, fv] of Object.entries(a.fields)) {
            if (fv && lower(String(fv)).includes(q)) {
              matchMap[a.id] = { where: "fields", snippet: formatKey(fk) + ": " + String(fv).slice(0, 80) }; return true;
            }
          }
        }
        // Body match (search stripped text)
        const bodyText = stripTags ? stripTags((a.body || "").replace(/@\[([^\]]+)\]\([^)]+\)/g, "$1")) : (a.body || "").replace(/@\[([^\]]+)\]\([^)]+\)/g, "$1");
        if (lower(bodyText).includes(q)) {
          // Extract snippet around match
          const idx = lower(bodyText).indexOf(q);
          const start = Math.max(0, idx - 40);
          const end = Math.min(bodyText.length, idx + q.length + 60);
          const snippet = (start > 0 ? "…" : "") + bodyText.slice(start, end).trim() + (end < bodyText.length ? "…" : "");
          matchMap[a.id] = { where: "body", snippet }; return true;
        }
        // Linked article title match
        if (a.linkedIds?.length > 0) {
          for (const lid of a.linkedIds) {
            const linked = articles.find((x) => x.id === lid);
            if (linked && lower(linked.title).includes(q)) {
              matchMap[a.id] = { where: "linked", snippet: "Links to: " + linked.title }; return true;
            }
          }
        }
        return false;
      });
    }
    // Sort
    if (codexSort === "alpha_asc") l = [...l].sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    else if (codexSort === "alpha_desc") l = [...l].sort((a, b) => (b.title || "").localeCompare(a.title || ""));
    else if (codexSort === "oldest") l = [...l].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    else if (codexSort === "words") l = [...l].sort((a, b) => (b.body?.split(/\s+/).length || 0) - (a.body?.split(/\s+/).length || 0));
    else if (codexSort === "era") l = [...l].sort((a, b) => (a.temporal?.active_start ?? 99999) - (b.temporal?.active_start ?? 99999));
    else if (codexSort === "category") l = [...l].sort((a, b) => (a.category || "").localeCompare(b.category || ""));
    else l = [...l].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)); // recent (default)
    // If searching, boost title matches to top
    if (searchQuery.trim()) {
      l = [...l].sort((a, b) => {
        const aw = matchMap[a.id]?.where === "title" ? 0 : matchMap[a.id]?.where === "summary" ? 1 : 2;
        const bw = matchMap[b.id]?.where === "title" ? 0 : matchMap[b.id]?.where === "summary" ? 1 : 2;
        return aw - bw;
      });
    }
    return { list: l, matchMap };
  }, [articles, codexFilter, searchQuery, codexSort, codexTagFilter, codexRefFilter, refStats]);
  // Reset pagination when filters/sort/search change
  useEffect(() => { setCodexVisible(CODEX_PAGE); setShowCodexCreate(false); }, [codexFilter, searchQuery, codexSort, codexTagFilter, codexRefFilter]);
  useEffect(() => { setNovelCodexVisible(NOVEL_CODEX_PAGE); }, [novelCodexFilter, novelCodexSearch]);

  // Memoized integrity results for codex list view — avoids O(n²) per render
  const codexIntegrityMap = useMemo(() => {
    const map = {};
    articles.forEach((a) => {
      const warnings = filterBySensitivity(checkArticleIntegrity(a, articles, temporalGraph, a.id));
      map[a.id] = {
        errors: warnings.filter((w) => w.severity === "error"),
        warnings: warnings.filter((w) => w.severity === "warning"),
      };
    });
    return map;
  }, [articles, temporalGraph, filterBySensitivity]);

  const recent = useMemo(() => [...articles].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 6), [articles]);
  const catCounts = useMemo(() => {
    const c = {};
    Object.keys(CATEGORIES).forEach((k) => { c[k] = articles.filter((a) => a.category === k).length; });
    return c;
  }, [articles]);
  const stats = useMemo(() => ({
    total: articles.length, words: articles.reduce((s, a) => s + (a.body?.split(/\s+/).length || 0), 0),
    conflicts: allConflicts.length, archived: archived.length, ...catCounts,
  }), [articles, allConflicts, archived, catCounts]);

  const navItems = [
    { id: "dashboard", icon: "◈", label: "Dashboard", action: goDash },
    { id: "codex", icon: "📖", label: "Full Codex", action: () => goCodex("all") },
    { divider: true },
    ...Object.entries(CATEGORIES).filter(([k]) => !settings.disabledCategories.includes(k)).map(([k, c]) => ({
      id: k, icon: c.icon, label: k === "race" ? "Races & Species" : k === "magic" ? "Magic & Lore" : k === "item" ? "Items & Artifacts" : k === "flora_fauna" ? "Flora & Fauna" : k === "laws_customs" ? "Laws & Customs" : categoryPluralLabel(k),
      action: () => goCodex(k), count: catCounts[k] || undefined, isCategory: true,
    })),
    { divider: true },
    { id: "timeline", icon: "⏳", label: "Timeline", action: () => { setTlSelected(null); setTlPanelOpen(false); setView("timeline"); } },
    { id: "graph", icon: "◉", label: "Relationship Web", action: () => setView("graph") },
    { id: "cross_refs", icon: "🔗", label: "Cross-References", action: () => setView("cross_refs") },
    { id: "family_tree", icon: "🌳", label: "Family Tree", action: () => setView("family_tree") },
    { id: "novel", icon: "✒", label: "Novel Writing", action: () => setView("novel") },
    { id: "generator", icon: "🎲", label: "Generators", action: () => setView("generator") },
    { id: "sessions", icon: "📓", label: "Session Notes", action: () => setView("sessions"), count: sessions.length > 0 ? sessions.length : undefined },
    { id: "integrity", icon: "🛡", label: "Lore Integrity", action: () => setView("integrity"), count: totalIntegrityIssues > 0 ? totalIntegrityIssues : undefined, alert: totalIntegrityIssues > 0 },
    { id: "archives", icon: "📦", label: "Archives", action: () => setView("archives"), count: archived.length > 0 ? archived.length : undefined },
    { divider: true },
    { id: "ai_import", icon: "📄", label: "Document Import", action: () => setView("ai_import") },
    { id: "staging", icon: "📋", label: "Staging Area", action: () => setView("staging"), count: aiStaging.filter((e) => e._status === "pending").length > 0 ? aiStaging.filter((e) => e._status === "pending").length : undefined },
    { divider: true },
    { id: "settings", icon: "⚙", label: "Settings", action: () => setView("settings") },
    { id: "collaboration", icon: "👥", label: "Collaboration", action: () => setView("collaboration") },
    { id: "scratchpad", icon: "📝", label: "Quick Notes", action: () => setScratchpadOpen((v) => !v) },
    { id: "support_page", icon: "📬", label: "Support", action: () => setView("support_page") },
    { id: "donate", icon: "♥", label: "Donate", action: () => setShowDonate(true) },
  ];

  const isAct = (item) => {
    if (item.id === "dashboard" && view === "dashboard") return true;
    if (item.id === "codex" && view === "codex" && codexFilter === "all") return true;
    if (item.id === "integrity" && view === "integrity") return true;
    if (item.id === "timeline" && view === "timeline") return true;
    if (item.id === "graph" && view === "graph") return true;
    if (item.id === "cross_refs" && view === "cross_refs") return true;
    if (item.id === "family_tree" && view === "family_tree") return true;
    if (item.id === "generator" && view === "generator") return true;
    if (item.id === "sessions" && view === "sessions") return true;
    if (item.id === "novel" && view === "novel") return true;
    if (item.id === "archives" && view === "archives") return true;
    if (item.id === "ai_import" && view === "ai_import") return true;
    if (item.id === "staging" && view === "staging") return true;
    if (item.id === "settings" && view === "settings") return true;
    if (item.id === "collaboration" && view === "collaboration") return true;
    if (item.id === "support_page" && view === "support_page") return true;
    if (view === "codex" && codexFilter === item.id) return true;
    if ((view === "article" || view === "create") && (activeArticle?.category === item.id || createCat === item.id)) return true;
    return false;
  };

  // Top bar quick-create: only show first 4 + a "more" dropdown state
  const [showMoreCats, setShowMoreCats] = useState(false);
  const [showCodexCreate, setShowCodexCreate] = useState(false);
  const [showMobileFab, setShowMobileFab] = useState(false);
  const mainCats = Object.entries(CATEGORIES).slice(0, 4);
  const extraCats = Object.entries(CATEGORIES).slice(4);

  // Accessibility: Escape key closes open modals/dropdowns
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === "Escape") {
        if (showMoreCats) setShowMoreCats(false);
        else if (showCodexCreate) setShowCodexCreate(false);
        else if (showMobileFab) setShowMobileFab(false);
        else if (worldSwitcherOpen) setWorldSwitcherOpen(false);
        else if (showDupeModal) { setShowDupeModal(false); setPendingDupes([]); }
        else if (showDeleteModal) setShowDeleteModal(null);
        else if (showMoveMenu) setShowMoveMenu(null);
        else if (showShortcuts) setShowShortcuts(false);
        else if (showConfirm) setShowConfirm(null);
        else if (importConflicts) { setImportConflicts(null); setImportPending(null); }
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [showMoreCats, showCodexCreate, showMobileFab, worldSwitcherOpen, showDupeModal, showDeleteModal, showMoveMenu, showConfirm, importConflicts]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleShortcut = (e) => {
      // Skip when typing in inputs/textareas/contentEditable
      const tag = e.target.tagName;
      const isEditable = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key === "k") { e.preventDefault(); document.querySelector("[data-search-input]")?.focus(); }
      else if (mod && e.key === "/") { e.preventDefault(); setShowShortcuts((v) => !v); }
      else if (mod && e.key === "n" && !isEditable) { e.preventDefault(); if (activeWorld) goCreate(codexFilter !== "all" ? codexFilter : "character"); }
      else if (mod && e.key === "d" && !isEditable) { e.preventDefault(); goDash(); }
      else if (mod && e.key === "j" && !isEditable) { e.preventDefault(); setScratchpadOpen((v) => !v); }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [activeWorld, codexFilter]);


  // ╔══════════════════════════════════════════════════════════════╗
  // ║                     RENDER FUNCTIONS                        ║
  // ╚══════════════════════════════════════════════════════════════╝

  const renderWelcome = () => (<>
          {/* === WELCOME SCREEN — No world yet === */}
          {!activeWorld && dataLoaded && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", textAlign: "center", padding: 40 }}>
              <div style={{ fontSize: 64, marginBottom: 20 }}>🌍</div>
              <h1 style={{ fontFamily: "'Cinzel', serif", fontSize: 28, fontWeight: 700, color: theme.text, margin: 0, letterSpacing: 2 }}>Welcome to Frostfall Realms</h1>
              <p style={{ fontSize: 14, color: theme.textDim, marginTop: 8, maxWidth: 460, lineHeight: 1.7 }}>
                Create your first world to begin building your codex. Every world has its own articles, timeline, and lore — you can create as many as you need.
              </p>
              <Ornament width={300} />
              {!showWorldCreate ? (
                <button onClick={() => setShowWorldCreate(true)} style={{ ...tBtnP, fontSize: 15, padding: "14px 40px", marginTop: 24 }}>Create Your First World</button>
              ) : (
                <div style={{ marginTop: 24, background: ta(theme.surface, 0.6), border: "1px solid " + theme.border, borderRadius: 12, padding: "28px 32px", width: "100%", maxWidth: 440 }}>
                  <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 18, color: theme.accent, margin: "0 0 20px", letterSpacing: 1 }}>Create a New World</h3>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 5 }}>World Name *</label>
                    <input style={S.input} placeholder="e.g. Aelvarin, Middle-earth, Eberron" value={worldForm.name} onChange={(e) => setWorldForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
                  </div>
                  <div style={{ marginBottom: 20 }}>
                    <label style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 5 }}>Description (optional)</label>
                    <textarea style={{ ...S.textarea, minHeight: 60 }} placeholder="A brief description of your world…" value={worldForm.description} onChange={(e) => setWorldForm((f) => ({ ...f, description: e.target.value }))} />
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button onClick={handleCreateWorld} disabled={!worldForm.name.trim()} style={{ ...tBtnP, flex: 1, opacity: worldForm.name.trim() ? 1 : 0.4 }}>Create World</button>
                    <button onClick={() => setShowWorldCreate(false)} style={{ ...tBtnS }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}
  </>);

  const renderWorldCreate = () => (<>
          {/* === WORLD CREATE MODAL (from sidebar) === */}
          {showWorldCreate && activeWorld && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={(e) => { if (e.target === e.currentTarget) setShowWorldCreate(false); }}>
              <div style={{ background: theme.surface, border: "1px solid " + theme.border, borderRadius: 12, padding: "28px 32px", width: "100%", maxWidth: 440 }}>
                <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 18, color: theme.accent, margin: "0 0 20px", letterSpacing: 1 }}>Create a New World</h3>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 5 }}>World Name *</label>
                  <input style={S.input} placeholder="e.g. Aelvarin, Middle-earth, Eberron" value={worldForm.name} onChange={(e) => setWorldForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
                </div>
                <div style={{ marginBottom: 20 }}>
                  <label style={{ fontSize: 11, color: theme.textMuted, textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 5 }}>Description (optional)</label>
                  <textarea style={{ ...S.textarea, minHeight: 60 }} placeholder="A brief description of your world…" value={worldForm.description} onChange={(e) => setWorldForm((f) => ({ ...f, description: e.target.value }))} />
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={handleCreateWorld} disabled={!worldForm.name.trim()} style={{ ...tBtnP, flex: 1, opacity: worldForm.name.trim() ? 1 : 0.4 }}>Create World</button>
                  <button onClick={() => { setShowWorldCreate(false); setWorldForm({ name: "", description: "" }); }} style={{ ...tBtnS }}>Cancel</button>
                </div>
              </div>
            </div>
          )}
  </>);

  const renderDashboard = () => (<>
          {/* === DASHBOARD === */}
          {view === "dashboard" && activeWorld && (<div>
            <div style={{ marginTop: 28, marginBottom: 8, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div>
                <h1 style={{ fontFamily: "'Cinzel', serif", fontSize: 26, fontWeight: 700, color: theme.text, margin: 0, letterSpacing: 2 }}>The Archives of {activeWorld?.name || "Your World"}</h1>
                <p style={{ fontSize: 13, color: theme.textDim, marginTop: 4, fontStyle: "italic" }}>"Creation requires sacrifice. To give form costs essence."</p>
              </div>
              <button onClick={() => setDashCustomizing((v) => !v)} style={{ ...tBtnS, fontSize: 10, padding: "4px 12px", color: dashCustomizing ? theme.accent : theme.textDim, background: dashCustomizing ? ta(theme.accent, 0.08) : "transparent" }}>
                {dashCustomizing ? "✓ Done" : "⚙ Customize"}
              </button>
            </div>
            <Ornament width={300} />

            {/* Widget customization strip */}
            {dashCustomizing && (
              <div style={{ margin: "16px 0", padding: "12px 16px", background: ta(theme.surface, 0.5), border: "1px solid " + theme.divider, borderRadius: 10 }}>
                <div style={{ fontSize: 11, color: theme.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Dashboard Widgets</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {[
                    { id: "stats", label: "📊 World Stats" },
                    { id: "integrity", label: "🛡 Integrity" },
                    { id: "quick_create", label: "⚒ Quick Create" },
                    { id: "recent", label: "📜 Recent Edits" },
                    { id: "writing_progress", label: "✒ Writing Progress" },
                    { id: "world_links", label: "🔗 Quick Links" },
                    { id: "sessions_preview", label: "📓 Sessions" },
                    { id: "generators_preview", label: "🎲 Generators" },
                  ].map((w) => {
                    const on = dashWidgets.includes(w.id);
                    const idx = dashWidgets.indexOf(w.id);
                    return (
                      <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <button onClick={() => toggleWidget(w.id)}
                          style={{ fontSize: 11, padding: "4px 12px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", border: "1px solid " + (on ? ta(theme.accent, 0.3) : theme.border), background: on ? ta(theme.accent, 0.08) : "transparent", color: on ? theme.accent : theme.textDim, fontWeight: on ? 600 : 400 }}>
                          {w.label}
                        </button>
                        {on && idx > 0 && <span onClick={() => moveWidget(w.id, -1)} style={{ fontSize: 9, cursor: "pointer", color: theme.textDim, padding: "0 2px" }}>◀</span>}
                        {on && idx < dashWidgets.length - 1 && <span onClick={() => moveWidget(w.id, 1)} style={{ fontSize: 9, cursor: "pointer", color: theme.textDim, padding: "0 2px" }}>▶</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Render active widgets in order */}
            {dashWidgets.map((wid) => {
              switch (wid) {
                case "stats": return (
                  <div key={wid}>
                    <div style={{ display: "flex", gap: 12, marginTop: 24, flexWrap: "wrap" }}>
                      {[{ n: stats.total, l: "Total Articles", c: theme.accent }, ...Object.entries(CATEGORIES).map(([k, v]) => ({ n: catCounts[k] || 0, l: categoryPluralLabel(k), c: v.color })), { n: stats.words.toLocaleString(), l: "Total Words", c: "#8ec8a0" }].map((s, i) => (
                        <div key={i} style={S.statCard}><div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: s.c }} /><p style={{ fontSize: 22, fontWeight: 700, color: theme.text, fontFamily: "'Cinzel', serif", margin: 0 }}>{s.n}</p><p style={{ fontSize: 9, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1.5, marginTop: 4 }}>{s.l}</p></div>
                      ))}
                    </div>
                  </div>
                );
                case "integrity": return totalIntegrityIssues > 0 ? (
                  <div key={wid}>
                    <p style={S.sTitle}><span style={{ color: "#e07050" }} aria-hidden="true">🛡</span> Lore Integrity — <span style={{ color: "#e07050", fontSize: 14 }}>{totalIntegrityIssues} issue{totalIntegrityIssues !== 1 ? "s" : ""}</span></p>
                    <div style={{ background: "rgba(224,112,80,0.04)", border: "1px solid rgba(224,112,80,0.15)", borderRadius: 8, padding: 4 }}>
                      {allConflicts.slice(0, 3).map((c) => (
                        <div key={c.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px", borderBottom: "1px solid rgba(224,112,80,0.08)", cursor: "pointer" }} onClick={() => navigate(c.sourceId)}>
                          <span style={{ fontSize: 16, color: c.severity === "error" ? "#e07050" : theme.accent, marginTop: 1 }}>{c.severity === "error" ? "✕" : "⚠"}</span>
                          <div style={{ flex: 1 }}><div style={{ fontSize: 12, color: theme.text, fontWeight: 600, marginBottom: 3 }}>{c.message}</div><div style={{ fontSize: 11, color: theme.textDim, fontStyle: "italic" }}>💡 {c.suggestion}</div></div>
                          <span style={S.catBadge(c.severity === "error" ? "#e07050" : theme.accent)}>{c.severity}</span>
                        </div>
                      ))}
                      {globalIntegrity.slice(0, Math.max(0, 4 - allConflicts.length)).map(({ article: a, issues }) => (
                        <div key={a.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px", borderBottom: "1px solid rgba(224,112,80,0.08)", cursor: "pointer" }} onClick={() => navigate(a.id)}>
                          <span style={{ fontSize: 14, color: CATEGORIES[a.category]?.color }}>{CATEGORIES[a.category]?.icon}</span>
                          <div style={{ flex: 1 }}><div style={{ fontSize: 12, color: theme.text, fontWeight: 600, marginBottom: 3 }}>{a.title} — {issues.length} issue{issues.length !== 1 ? "s" : ""}</div><div style={{ fontSize: 11, color: theme.textDim }}>{issues[0].message}</div></div>
                          <span style={S.catBadge(issues.some((w) => w.severity === "error") ? "#e07050" : theme.accent)}>{issues.some((w) => w.severity === "error") ? "error" : "warning"}</span>
                        </div>
                      ))}
                      <div style={{ padding: "10px 14px", textAlign: "center", fontSize: 12, color: "#e07050", cursor: "pointer" }} onClick={() => setView("integrity")}>View full integrity report →</div>
                    </div>
                  </div>
                ) : null;
                case "quick_create": return (
                  <div key={wid}>
                    <p style={S.sTitle}>⚒ Quick Create</p>
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : isTablet ? "repeat(3, 1fr)" : "repeat(4, 1fr)", gap: 10 }}>
                      {Object.entries(CATEGORIES).map(([k, c]) => (
                        <div key={k} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goCreate(k); } }} style={{ background: ta(theme.surface, 0.7), border: "1px solid " + c.color + "33", borderRadius: 8, padding: "16px 12px", cursor: "pointer", textAlign: "center", transition: "all 0.25s" }} onClick={() => goCreate(k)}
                          onMouseEnter={(e) => { e.currentTarget.style.border = "1px solid " + c.color; e.currentTarget.style.transform = "translateY(-2px)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.border = "1px solid " + c.color + "33"; e.currentTarget.style.transform = "none"; }}>
                          <div style={{ fontSize: 22, marginBottom: 4 }}>{c.icon}</div><div style={{ fontSize: 11, color: c.color, fontWeight: 600 }}>New {c.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
                case "recent": return (
                  <div key={wid}>
                    <p style={S.sTitle}>📜 Recent Edits</p>
                    {recent.map((a) => { const ac = conflictsFor(a.id); return (
                      <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: ta(theme.surface, 0.5), border: "1px solid " + (ac.length > 0 ? "rgba(224,112,80,0.3)" : theme.divider), borderRadius: 6, marginBottom: 6, cursor: "pointer", transition: "all 0.2s" }} onClick={() => navigate(a.id)}
                        onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.surface, 0.8); }} onMouseLeave={(e) => { e.currentTarget.style.background = ta(theme.surface, 0.5); }}>
                        <span style={{ fontSize: 16, width: 24, textAlign: "center", color: CATEGORIES[a.category]?.color }}>{CATEGORIES[a.category]?.icon}</span>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "#c8bda0" }}>{a.title}</span>
                        {ac.length > 0 && <span style={{ fontSize: 12, color: "#e07050" }}>⚠ {ac.length}</span>}
                        <span style={S.catBadge(CATEGORIES[a.category]?.color)}>{CATEGORIES[a.category]?.label}</span>
                        <span style={{ fontSize: 11, color: theme.textDim, minWidth: 60, textAlign: "right" }}>{timeAgo(a.updatedAt)}</span>
                      </div>
                    ); })}
                  </div>
                );
                case "writing_progress": return (
                  <div key={wid}>
                    <p style={S.sTitle}>✒ Writing Progress</p>
                    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 12 }}>
                      {manuscripts.slice(0, 3).map((ms) => {
                        const wc = ms.acts?.reduce((s, a) => s + a.chapters?.reduce((s2, c) => s2 + c.scenes?.reduce((s3, sc) => { const div = document.createElement("div"); div.innerHTML = sc.body || ""; return s3 + (div.textContent || "").split(/\s+/).filter(Boolean).length; }, 0), 0), 0) || 0;
                        const sceneCount = ms.acts?.reduce((s, a) => s + a.chapters?.reduce((s2, c) => s2 + (c.scenes?.length || 0), 0), 0) || 0;
                        return (
                          <div key={ms.id} onClick={() => { setActiveMs(ms); setView("novel"); }} style={{ background: ta(theme.surface, 0.6), border: "1px solid " + theme.divider, borderRadius: 10, padding: "16px 18px", cursor: "pointer", transition: "all 0.2s" }}
                            onMouseEnter={(e) => { e.currentTarget.style.border = "1px solid " + theme.accent + "40"; }} onMouseLeave={(e) => { e.currentTarget.style.border = "1px solid " + theme.divider; }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: theme.text, fontFamily: "'Cinzel', serif", marginBottom: 6 }}>{ms.title}</div>
                            <div style={{ fontSize: 11, color: theme.textDim }}>{wc.toLocaleString()} words · {sceneCount} scenes</div>
                            <div style={{ marginTop: 8, height: 4, background: theme.divider, borderRadius: 2 }}>
                              <div style={{ height: "100%", width: Math.min(100, (wc / 50000) * 100) + "%", background: theme.accent, borderRadius: 2, transition: "width 0.3s" }} />
                            </div>
                            <div style={{ fontSize: 9, color: theme.textDim, marginTop: 4, textAlign: "right" }}>{Math.round((wc / 50000) * 100)}% of 50k goal</div>
                          </div>
                        );
                      })}
                      {manuscripts.length === 0 && <div style={{ fontSize: 12, color: theme.textDim, padding: 12 }}>No manuscripts yet. Start one in Novel Writing!</div>}
                    </div>
                  </div>
                );
                case "world_links": return (
                  <div key={wid}>
                    <p style={S.sTitle}>🔗 Quick Links</p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {[
                        { label: "Timeline", icon: "⏳", action: () => setView("timeline") },
                        { label: "Relationship Web", icon: "◉", action: () => setView("graph") },
                        { label: "Family Tree", icon: "🌳", action: () => setView("family_tree") },
                        { label: "Generators", icon: "🎲", action: () => setView("generator") },
                        { label: "Session Notes", icon: "📓", action: () => setView("sessions") },
                        { label: "Import Docs", icon: "📄", action: () => setView("ai_import") },
                      ].map((lnk, i) => (
                        <button key={i} onClick={lnk.action} style={{ ...tBtnS, fontSize: 11, padding: "6px 14px", display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 14 }}>{lnk.icon}</span> {lnk.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
                case "sessions_preview": return sessions.length > 0 ? (
                  <div key={wid}>
                    <p style={S.sTitle}>📓 Recent Sessions</p>
                    {sessions.slice(0, 3).map((s) => (
                      <div key={s.id} onClick={() => setView("sessions")} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: ta(theme.surface, 0.5), border: "1px solid " + theme.divider, borderRadius: 6, marginBottom: 6, cursor: "pointer" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.surface, 0.8); }} onMouseLeave={(e) => { e.currentTarget.style.background = ta(theme.surface, 0.5); }}>
                        <span style={{ fontSize: 14 }}>📓</span>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: theme.text }}>{s.title}</span>
                        {s.date && <span style={{ fontSize: 10, color: theme.textDim }}>{s.date}</span>}
                      </div>
                    ))}
                    <div style={{ textAlign: "center", fontSize: 11, color: theme.accent, cursor: "pointer", padding: 8 }} onClick={() => setView("sessions")}>View all sessions →</div>
                  </div>
                ) : null;
                case "generators_preview": return (
                  <div key={wid}>
                    <p style={S.sTitle}>🎲 Quick Generate</p>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {Object.entries(GENERATORS).map(([k, g]) => (
                        <button key={k} onClick={() => { setGeneratorType(k); setView("generator"); }} style={{ ...tBtnS, fontSize: 11, padding: "6px 14px" }}>{g.icon} {g.label}</button>
                      ))}
                    </div>
                  </div>
                );
                default: return null;
              }
            })}
          </div>)}
  </>);

  const renderIntegrity = () => {
  if (view !== "integrity") return null;
  return (
    <IntegrityPanel
      theme={theme}
      visibleConflicts={visibleConflicts}
      globalIntegrity={globalIntegrity}
      totalIntegrityIssues={totalIntegrityIssues}
      integrityVisible={integrityVisible}
      INTEGRITY_PAGE={INTEGRITY_PAGE}
      setIntegrityVisible={setIntegrityVisible}
      setDismissedConflicts={setDismissedConflicts}
      navigate={navigate}
      goEdit={goEdit}
      Ornament={Ornament}
      S={S}
      ta={ta}
      CATEGORIES={CATEGORIES}
      tBtnS={tBtnS}
    />
  );
};

const renderArchives = () => (<>
          {/* === ARCHIVES === */}
          {view === "archives" && (<div>
            <div style={{ marginTop: 24, marginBottom: 20 }}>
              <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: theme.accent, margin: 0, letterSpacing: 1, display: "flex", alignItems: "center", gap: 10 }}>📦 Archives</h2>
              <p style={{ fontSize: 13, color: theme.textDim, marginTop: 6 }}>Entries moved here can be restored to the codex or permanently deleted.</p>
            </div>
            <Ornament width={300} />
            {archived.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60, color: theme.textDim }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
                <p style={{ fontSize: 16, fontFamily: "'Cinzel', serif" }}>The Archives Are Empty</p>
                <p style={{ fontSize: 13, color: theme.textDim, marginTop: 4 }}>Archived entries will appear here.</p>
              </div>
            ) : (<div style={{ marginTop: 20 }}>
              {archived.map((a) => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 14, background: ta(theme.surface, 0.6), border: "1px solid " + theme.divider, borderRadius: 8, padding: "14px 18px", marginBottom: 8, opacity: 0.85 }}>
                  <div style={{ fontSize: 20, color: CATEGORIES[a.category]?.color, opacity: 0.6 }}>{CATEGORIES[a.category]?.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: theme.textMuted }}>{a.title}</span>
                      <span style={S.catBadge(CATEGORIES[a.category]?.color)}>{CATEGORIES[a.category]?.label}</span>
                    </div>
                    <p style={{ fontSize: 11, color: theme.textDim, margin: 0 }}>Archived {timeAgo(a.archivedAt)}</p>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => restoreFromArchive(a)} style={{ fontSize: 11, color: "#8ec8a0", background: "rgba(142,200,160,0.1)", border: "1px solid rgba(142,200,160,0.2)", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(142,200,160,0.2)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(142,200,160,0.1)"; }}>Restore</button>
                    <button onClick={() => permanentDeleteFromArchive(a)} style={{ fontSize: 11, color: "#e07050", background: "rgba(224,112,80,0.1)", border: "1px solid rgba(224,112,80,0.2)", borderRadius: 6, padding: "6px 14px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(224,112,80,0.2)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(224,112,80,0.1)"; }}>Delete</button>
                  </div>
                </div>
              ))}
            </div>)}
          </div>)}
  </>);

  const renderTimeline = () => (<>
          {view === "timeline" && (
            <TimelineView
              theme={theme} articles={articles} activeWorld={activeWorld}
              activeEras={activeEras} isMobile={isMobile} navigate={navigate}
              goEdit={goEdit} conflictsFor={conflictsFor}
              tlZoom={tlZoom} setTlZoom={setTlZoom} tlSelected={tlSelected}
              tlData={tlData} tlRange={tlRange} yearToX={yearToX}
              tlTotalWidth={tlTotalWidth} tlTicks={tlTicks}
              tlSelectArticle={tlSelectArticle} tlClosePanel={tlClosePanel}
              tlLaneHeights={tlLaneHeights} tlPanelOpen={tlPanelOpen}
              ta={ta} tBtnS={tBtnS} tBtnP={tBtnP} tTag={tTag}
              Ornament={Ornament} WarningBanner={WarningBanner}
              RenderBody={RenderBody} S={S}
            />
          )}
  </>);

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  RELATIONSHIP GRAPH                                        ║
  // ╚══════════════════════════════════════════════════════════════╝
  const renderGraph = () => (<>
          {view === "graph" && (<div style={{ margin: "0 -28px", height: "calc(100vh - 56px)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "16px 28px 12px", borderBottom: "1px solid " + theme.divider, display: "flex", alignItems: isMobile ? "flex-start" : "center", justifyContent: "space-between", flexShrink: 0, flexDirection: isMobile ? "column" : "row", gap: 10 }}>
              <div>
                <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: theme.text, margin: 0, letterSpacing: 1 }}>◉ Relationship Web</h2>
                <p style={{ fontSize: 12, color: theme.textDim, marginTop: 4 }}>{articles.length} entries · {articles.reduce((s, a) => s + (a.linkedIds?.length || 0), 0)} connections — click a node to view</p>
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {[{ key: "all", label: "All", color: theme.accent }, ...Object.entries(CATEGORIES).map(([k, v]) => ({ key: k, label: v.label, color: v.color }))].map((f) => (
                  <div key={f.key} onClick={() => setGraphFilter(f.key)} style={{ fontSize: 10, padding: "3px 10px", borderRadius: 14, cursor: "pointer", fontWeight: graphFilter === f.key ? 600 : 400, background: graphFilter === f.key ? f.color + "20" : "transparent", color: graphFilter === f.key ? f.color : theme.textDim, border: "1px solid " + (graphFilter === f.key ? f.color + "40" : "transparent"), transition: "all 0.15s" }}>{f.label}</div>
                ))}
              </div>
            </div>
            <div ref={graphRef} style={{ flex: 1, overflow: "hidden", position: "relative" }}>
              {(() => {
                const gArticles = graphFilter === "all" ? articles : articles.filter((a) => a.category === graphFilter);
                const ids = new Set(gArticles.map((a) => a.id));
                const svgW = 900;
                const svgH = 650;
                const cx = svgW / 2;
                const cy = svgH / 2;
                const nodes = gArticles.map((a, i) => {
                  const angle = i * 2.39996; // golden angle in radians
                  const r = 60 + Math.sqrt(i) * 42;
                  return { ...a, gx: cx + r * Math.cos(angle), gy: cy + r * Math.sin(angle) };
                });
                const nodeMap = {};
                nodes.forEach((n) => { nodeMap[n.id] = n; });
                const edges = [];
                nodes.forEach((n) => {
                  (n.linkedIds || []).forEach((lid) => {
                    if (nodeMap[lid]) edges.push({ from: n.id, to: lid });
                  });
                });
                const hNode = graphHover ? nodeMap[graphHover] : null;
                const hConnected = hNode ? new Set([...(hNode.linkedIds || []), ...articles.filter((a) => a.linkedIds?.includes(hNode.id)).map((a) => a.id)]) : new Set();
                return (
                  <svg viewBox={"0 0 " + svgW + " " + svgH} style={{ width: "100%", height: "100%", background: ta(theme.deepBg, 0.5) }} preserveAspectRatio="xMidYMid meet">
                    <defs>
                      <radialGradient id="graph-glow"><stop offset="0%" stopColor={theme.accent} stopOpacity="0.1" /><stop offset="100%" stopColor={theme.accent} stopOpacity="0" /></radialGradient>
                    </defs>
                    <circle cx={cx} cy={cy} r={280} fill="url(#graph-glow)" />
                    {edges.map((e, i) => {
                      const from = nodeMap[e.from];
                      const to = nodeMap[e.to];
                      if (!from || !to) return null;
                      const isHovered = graphHover && (graphHover === e.from || graphHover === e.to);
                      return <line key={i} x1={from.gx} y1={from.gy} x2={to.gx} y2={to.gy}
                        stroke={isHovered ? theme.accent : theme.textDim} strokeWidth={isHovered ? 1.8 : 0.6} opacity={isHovered ? 0.8 : (graphHover ? 0.08 : 0.2)} />;
                    })}
                    {nodes.map((n) => {
                      const cat = CATEGORIES[n.category] || {};
                      const isH = graphHover === n.id;
                      const isConn = graphHover && hConnected.has(n.id);
                      const linkCount = (n.linkedIds || []).filter((l) => nodeMap[l]).length;
                      const backLinks = nodes.filter((o) => o.linkedIds?.includes(n.id)).length;
                      const totalConns = linkCount + backLinks;
                      const r = Math.max(7, Math.min(22, 5 + totalConns * 1.5));
                      const dimmed = graphHover && !isH && !isConn;
                      return (
                        <g key={n.id} style={{ cursor: "pointer" }}
                          onMouseEnter={() => setGraphHover(n.id)}
                          onMouseLeave={() => setGraphHover(null)}
                          onClick={() => navigate(n.id)}>
                          {isH && <circle cx={n.gx} cy={n.gy} r={r + 8} fill={cat.color || theme.accent} opacity={0.15} />}
                          <circle cx={n.gx} cy={n.gy} r={r}
                            fill={isH ? (cat.color || theme.accent) : (cat.color || theme.accent) + (dimmed ? "20" : "50")}
                            stroke={isH ? "#fff" : isConn ? cat.color || theme.accent : (cat.color || theme.accent) + (dimmed ? "30" : "80")}
                            strokeWidth={isH ? 2.5 : isConn ? 1.5 : 0.8} />
                          <text x={n.gx} y={n.gy + r + 13} textAnchor="middle"
                            fill={isH ? theme.text : dimmed ? theme.textDim + "40" : theme.textMuted}
                            fontSize={isH ? 11 : 9} fontWeight={isH ? 700 : 400}
                            fontFamily="'Cinzel', serif">{n.title.length > 20 ? n.title.slice(0, 18) + "…" : n.title}</text>
                        </g>
                      );
                    })}
                    {hNode && (
                      <foreignObject x={Math.min(hNode.gx + 24, svgW - 210)} y={Math.max(hNode.gy - 70, 10)} width="200" height="90">
                        <div xmlns="http://www.w3.org/1999/xhtml" style={{ background: theme.surface, border: "1px solid " + theme.border, borderRadius: 8, padding: "8px 12px", boxShadow: "0 4px 20px rgba(0,0,0,0.4)", pointerEvents: "none" }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 3 }}>{(CATEGORIES[hNode.category]?.icon || "") + " " + hNode.title}</div>
                          <div style={{ fontSize: 10, color: CATEGORIES[hNode.category]?.color || theme.textDim }}>{CATEGORIES[hNode.category]?.label} · {(hNode.linkedIds || []).length} outgoing · {articles.filter((a) => a.linkedIds?.includes(hNode.id)).length} incoming</div>
                          {hNode.summary && <div style={{ fontSize: 9, color: theme.textDim, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hNode.summary}</div>}
                        </div>
                      </foreignObject>
                    )}
                    {nodes.length === 0 && <text x={cx} y={cy} textAnchor="middle" fill={theme.textDim} fontSize="14" fontFamily="'Cinzel', serif">No entries to graph</text>}
                  </svg>
                );
              })()}
            </div>
          </div>)}
  </>);

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  CROSS-REFERENCE BROWSER                                   ║
  // ╚══════════════════════════════════════════════════════════════╝
  const [crossRefTab, setCrossRefTab] = useState("map"); // "map" | "orphans" | "tags"

  const renderCrossRefs = () => (<>
          {view === "cross_refs" && (<div style={{ marginTop: 24, maxWidth: 900 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
              <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: theme.text, margin: 0, letterSpacing: 1 }}>🔗 Cross-Reference Browser</h2>
              <Ornament width={120} />
              <span style={{ fontSize: 12, color: theme.textMuted }}>{articles.length} entries · {orphanArticles.length} orphans</span>
            </div>
            {/* Tab bar */}
            <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
              {[
                { id: "map", label: "Reference Map", icon: "🗺" },
                { id: "orphans", label: "Orphan Finder", icon: "⚠", count: orphanArticles.length },
                { id: "tags", label: "Tag Explorer", icon: "🏷", count: allTags.length },
              ].map((tab) => (
                <button key={tab.id} onClick={() => setCrossRefTab(tab.id)}
                  style={{ fontSize: 12, padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontFamily: "'Cinzel', serif", fontWeight: crossRefTab === tab.id ? 600 : 400, letterSpacing: 0.5, border: "1px solid " + (crossRefTab === tab.id ? ta(theme.accent, 0.4) : theme.border), background: crossRefTab === tab.id ? ta(theme.accent, 0.1) : "transparent", color: crossRefTab === tab.id ? theme.accent : theme.textMuted, transition: "all 0.15s", display: "flex", alignItems: "center", gap: 6 }}>
                  <span>{tab.icon}</span> {tab.label}
                  {tab.count != null && <span style={{ fontSize: 10, opacity: 0.7 }}>({tab.count})</span>}
                </button>
              ))}
            </div>

            {/* REFERENCE MAP TAB */}
            {crossRefTab === "map" && (
              <div>
                <p style={{ fontSize: 12, color: theme.textDim, marginBottom: 16 }}>Click any article to see its outgoing and incoming references at a glance.</p>
                {crossRefArticle ? (() => {
                  const art = articles.find((a) => a.id === crossRefArticle);
                  if (!art) return null;
                  const stats = refStats[art.id] || { outgoing: [], incoming: [] };
                  const related = getRelatedArticles(art.id);
                  const catColor = CATEGORIES[art.category]?.color || theme.accent;
                  return (
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                        <button onClick={() => setCrossRefArticle(null)} style={{ fontSize: 10, color: theme.textDim, background: "none", border: "1px solid " + theme.border, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit" }}>← Back</button>
                        <span style={{ fontSize: 18, color: catColor }}>{CATEGORIES[art.category]?.icon}</span>
                        <span style={{ fontFamily: "'Cinzel', serif", fontSize: 18, color: theme.text, fontWeight: 600 }}>{art.title}</span>
                        <span style={S.catBadge(catColor)}>{CATEGORIES[art.category]?.label}</span>
                        <button onClick={() => navigate(art.id)} style={{ fontSize: 10, color: theme.accent, background: ta(theme.accent, 0.08), border: "1px solid " + ta(theme.accent, 0.2), borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit", marginLeft: "auto" }}>Open Article →</button>
                      </div>
                      {/* Outgoing references */}
                      <div style={{ marginBottom: 20 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#8ec8a0", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 }}>→ Outgoing References ({stats.outgoing.length})</div>
                        {stats.outgoing.length === 0 && <p style={{ fontSize: 12, color: theme.textDim, fontStyle: "italic" }}>This article doesn't link to any other articles.</p>}
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {stats.outgoing.map((lid) => {
                            const la = articles.find((a) => a.id === lid);
                            if (!la) return <div key={lid} style={{ fontSize: 12, color: "#e07050", padding: "6px 10px", background: "rgba(224,112,80,0.06)", borderRadius: 6 }}>⚠ {lid} (missing)</div>;
                            return (
                              <div key={lid} onClick={() => setCrossRefArticle(lid)}
                                style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: ta(theme.surface, 0.5), border: "1px solid " + theme.divider, borderRadius: 6, cursor: "pointer", transition: "all 0.15s" }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.accent, 0.08); }} onMouseLeave={(e) => { e.currentTarget.style.background = ta(theme.surface, 0.5); }}>
                                <span style={{ fontSize: 14, color: CATEGORIES[la.category]?.color }}>{CATEGORIES[la.category]?.icon}</span>
                                <div style={{ flex: 1 }}><div style={{ fontWeight: 500, color: theme.text, fontSize: 12 }}>{la.title}</div><div style={{ fontSize: 10, color: theme.textDim }}>{CATEGORIES[la.category]?.label}</div></div>
                                <span style={{ fontSize: 10, color: "#8ec8a0" }}>→</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      {/* Incoming references */}
                      <div style={{ marginBottom: 20 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#7ec8e3", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 }}>← Incoming References ({stats.incoming.length})</div>
                        {stats.incoming.length === 0 && <p style={{ fontSize: 12, color: theme.textDim, fontStyle: "italic" }}>No other articles link to this one.</p>}
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {stats.incoming.map((lid) => {
                            const la = articles.find((a) => a.id === lid);
                            if (!la) return null;
                            return (
                              <div key={lid} onClick={() => setCrossRefArticle(lid)}
                                style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: ta(theme.surface, 0.5), border: "1px solid " + theme.divider, borderRadius: 6, cursor: "pointer", transition: "all 0.15s" }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = ta("#7ec8e3", 0.08); }} onMouseLeave={(e) => { e.currentTarget.style.background = ta(theme.surface, 0.5); }}>
                                <span style={{ fontSize: 10, color: "#7ec8e3" }}>←</span>
                                <span style={{ fontSize: 14, color: CATEGORIES[la.category]?.color }}>{CATEGORIES[la.category]?.icon}</span>
                                <div style={{ flex: 1 }}><div style={{ fontWeight: 500, color: theme.text, fontSize: 12 }}>{la.title}</div><div style={{ fontSize: 10, color: theme.textDim }}>{CATEGORIES[la.category]?.label}</div></div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      {/* Related articles (by shared tags/category) */}
                      {related.length > 0 && (
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "#c084fc", textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 8 }}>✦ Suggested Related ({related.length})</div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {related.map((r) => (
                              <div key={r.article.id} onClick={() => setCrossRefArticle(r.article.id)}
                                style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: ta(theme.surface, 0.5), border: "1px solid " + theme.divider, borderRadius: 6, cursor: "pointer", transition: "all 0.15s" }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = ta("#c084fc", 0.08); }} onMouseLeave={(e) => { e.currentTarget.style.background = ta(theme.surface, 0.5); }}>
                                <span style={{ fontSize: 14, color: CATEGORIES[r.article.category]?.color }}>{CATEGORIES[r.article.category]?.icon}</span>
                                <div style={{ flex: 1 }}><div style={{ fontWeight: 500, color: theme.text, fontSize: 12 }}>{r.article.title}</div><div style={{ fontSize: 10, color: theme.textDim }}>{CATEGORIES[r.article.category]?.label} · relevance: {r.score}</div></div>
                                <span style={{ fontSize: 10, color: "#c084fc" }}>✦</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })() : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {articles.map((a) => {
                      const stats = refStats[a.id] || { outgoing: [], incoming: [] };
                      const catColor = CATEGORIES[a.category]?.color || theme.accent;
                      return (
                        <div key={a.id} onClick={() => setCrossRefArticle(a.id)}
                          style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: ta(theme.surface, 0.5), border: "1px solid " + theme.divider, borderRadius: 8, cursor: "pointer", transition: "all 0.15s" }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.surface, 0.85); }} onMouseLeave={(e) => { e.currentTarget.style.background = ta(theme.surface, 0.5); }}>
                          <span style={{ fontSize: 16, color: catColor }}>{CATEGORIES[a.category]?.icon}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, color: theme.text, fontSize: 13 }}>{a.title}</div>
                            <div style={{ fontSize: 10, color: theme.textDim }}>{CATEGORIES[a.category]?.label}</div>
                          </div>
                          <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "center" }}>
                            <span style={{ fontSize: 10, color: "#8ec8a0", background: "rgba(142,200,160,0.1)", padding: "2px 8px", borderRadius: 10 }}>→ {stats.outgoing.length}</span>
                            <span style={{ fontSize: 10, color: "#7ec8e3", background: "rgba(126,200,227,0.1)", padding: "2px 8px", borderRadius: 10 }}>← {stats.incoming.length}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ORPHAN FINDER TAB */}
            {crossRefTab === "orphans" && (
              <div>
                <p style={{ fontSize: 12, color: theme.textDim, marginBottom: 16 }}>Articles with <strong style={{ color: "#e07050" }}>zero</strong> incoming and outgoing references — disconnected from the rest of your lore.</p>
                {orphanArticles.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 40, color: theme.textDim }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>✨</div>
                    <p>No orphans! Every article is connected.</p>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {orphanArticles.map((a) => {
                      const catColor = CATEGORIES[a.category]?.color || theme.accent;
                      return (
                        <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: ta(theme.surface, 0.5), borderTop: "1px solid rgba(224,112,80,0.15)", borderRight: "1px solid rgba(224,112,80,0.15)", borderBottom: "1px solid rgba(224,112,80,0.15)", borderLeft: "3px solid rgba(224,112,80,0.4)", borderRadius: 8 }}>
                          <span style={{ fontSize: 16, color: catColor }}>{CATEGORIES[a.category]?.icon}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, color: theme.text, fontSize: 13, cursor: "pointer" }} onClick={() => navigate(a.id)}>{a.title}</div>
                            <div style={{ fontSize: 10, color: theme.textDim }}>{CATEGORIES[a.category]?.label}{a.summary ? " · " + a.summary.slice(0, 60) + (a.summary.length > 60 ? "…" : "") : ""}</div>
                          </div>
                          <button onClick={() => goEdit(a)} style={{ fontSize: 10, color: theme.accent, background: ta(theme.accent, 0.08), border: "1px solid " + ta(theme.accent, 0.2), borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit" }}>✎ Add Links</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAG EXPLORER TAB */}
            {crossRefTab === "tags" && (
              <div>
                <p style={{ fontSize: 12, color: theme.textDim, marginBottom: 16 }}>Visual overview of all tags across your codex. Click a tag to filter the codex by it.</p>
                {allTags.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 40, color: theme.textDim }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>🏷</div>
                    <p>No tags yet. Add tags to your codex entries to see them here.</p>
                  </div>
                ) : (
                  <div>
                    {/* Tag cloud */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 24, padding: "16px 20px", background: ta(theme.surface, 0.4), border: "1px solid " + theme.divider, borderRadius: 10 }}>
                      {allTags.map((t) => {
                        const maxCount = allTags[0]?.count || 1;
                        const scale = 0.7 + (t.count / maxCount) * 0.8;
                        const opacity = 0.5 + (t.count / maxCount) * 0.5;
                        return (
                          <span key={t.tag} onClick={() => { setCodexTagFilter(t.tag); setView("codex"); setCodexFilter("all"); }}
                            style={{ fontSize: Math.round(12 * scale), padding: "4px 12px", borderRadius: 12, cursor: "pointer", background: ta(theme.accent, 0.06 + (t.count / maxCount) * 0.12), border: "1px solid " + ta(theme.accent, 0.1 + (t.count / maxCount) * 0.2), color: theme.accent, opacity, fontWeight: t.count > maxCount * 0.5 ? 600 : 400, transition: "all 0.15s", lineHeight: 1.3 }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.accent, 0.2); e.currentTarget.style.opacity = "1"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = ta(theme.accent, 0.06 + (t.count / maxCount) * 0.12); e.currentTarget.style.opacity = String(opacity); }}
                            title={t.count + " article" + (t.count !== 1 ? "s" : "")}>
                            #{t.tag}
                          </span>
                        );
                      })}
                    </div>
                    {/* Tag list with counts and co-occurring tags */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {allTags.slice(0, 30).map((t) => {
                        const tagArticles = articles.filter((a) => (a.tags || []).includes(t.tag));
                        const coTags = {};
                        tagArticles.forEach((a) => (a.tags || []).forEach((ct) => { if (ct !== t.tag) coTags[ct] = (coTags[ct] || 0) + 1; }));
                        const topCoTags = Object.entries(coTags).sort((a, b) => b[1] - a[1]).slice(0, 5);
                        return (
                          <div key={t.tag} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", background: ta(theme.surface, 0.5), border: "1px solid " + theme.divider, borderRadius: 8 }}>
                            <span onClick={() => { setCodexTagFilter(t.tag); setView("codex"); setCodexFilter("all"); }}
                              style={{ fontSize: 13, color: theme.accent, fontWeight: 600, cursor: "pointer", minWidth: 100 }}>#{t.tag}</span>
                            <span style={{ fontSize: 11, color: theme.textDim, minWidth: 60 }}>{t.count} article{t.count !== 1 ? "s" : ""}</span>
                            <div style={{ flex: 1, display: "flex", gap: 4, flexWrap: "wrap" }}>
                              {topCoTags.map(([ct, cc]) => (
                                <span key={ct} style={{ fontSize: 9, padding: "2px 6px", borderRadius: 8, background: ta(theme.textDim, 0.08), color: theme.textDim }}>
                                  {ct} ×{cc}
                                </span>
                              ))}
                            </div>
                            <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                              {tagArticles.slice(0, 4).map((a) => (
                                <span key={a.id} onClick={() => navigate(a.id)} title={a.title}
                                  style={{ fontSize: 12, width: 22, height: 22, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: ta(CATEGORIES[a.category]?.color || theme.accent, 0.1), color: CATEGORIES[a.category]?.color }}>
                                  {CATEGORIES[a.category]?.icon}
                                </span>
                              ))}
                              {tagArticles.length > 4 && <span style={{ fontSize: 9, color: theme.textDim, alignSelf: "center" }}>+{tagArticles.length - 4}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>)}
  </>);

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  FAMILY TREE / LINEAGE                                     ║
  // ╚══════════════════════════════════════════════════════════════╝
  const renderFamilyTree = () => (<>
          {view === "family_tree" && (<div style={{ marginTop: 24 }}>
            <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "center", justifyContent: "space-between", gap: 12, marginBottom: 16, flexDirection: isMobile ? "column" : "row" }}>
              <div>
                <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: theme.text, margin: 0, letterSpacing: 1 }}>🌳 Family Tree & Lineage</h2>
                <p style={{ fontSize: 12, color: theme.textDim, marginTop: 4 }}>{characters.length} characters · {Object.values(relations).reduce((s, r) => s + r.length, 0)} relationships</p>
              </div>
            </div>
            <Ornament width={300} />

            {characters.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60, color: theme.textDim }}><div style={{ fontSize: 36, marginBottom: 12 }}>🌳</div><p>No characters yet. Create some character entries in the Codex first.</p></div>
            ) : (
              <div style={{ display: "flex", gap: 20, marginTop: 20, flexDirection: isMobile ? "column" : "row" }}>
                {/* Character list panel */}
                <div style={{ width: isMobile ? "100%" : 260, flexShrink: 0 }}>
                  <div style={{ fontSize: 11, color: theme.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Characters</div>
                  <div style={{ maxHeight: 500, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                    {characters.map((ch) => {
                      const rels = getRelationsFor(ch.id);
                      const relCount = rels.length;
                      return (
                        <div key={ch.id} onClick={() => { setFtSelected(ftSelected === ch.id ? null : ch.id); setFtAddingRel(null); }}
                          style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, cursor: "pointer", background: ftSelected === ch.id ? ta(theme.accent, 0.1) : ta(theme.surface, 0.5), border: "1px solid " + (ftSelected === ch.id ? ta(theme.accent, 0.3) : theme.divider), transition: "all 0.15s" }}
                          onMouseEnter={(e) => { if (ftSelected !== ch.id) e.currentTarget.style.background = ta(theme.surface, 0.7); }}
                          onMouseLeave={(e) => { if (ftSelected !== ch.id) e.currentTarget.style.background = ta(theme.surface, 0.5); }}>
                          {ch.portrait ? (
                            <div style={{ width: 28, height: 28, borderRadius: "50%", overflow: "hidden", border: "1px solid " + CATEGORIES.character.color + "40", flexShrink: 0 }}><img src={ch.portrait} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
                          ) : (
                            <div style={{ width: 28, height: 28, borderRadius: "50%", background: ta(CATEGORIES.character.color, 0.15), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: CATEGORIES.character.color, flexShrink: 0 }}>🧙</div>
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: ftSelected === ch.id ? theme.accent : theme.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ch.title}</div>
                            <div style={{ fontSize: 10, color: theme.textDim }}>{ch.fields?.char_race || "Unknown"}{ch.fields?.role ? " · " + ch.fields.role : ""}</div>
                          </div>
                          {relCount > 0 && <span style={{ fontSize: 9, color: theme.textDim, background: ta(theme.accent, 0.06), padding: "2px 6px", borderRadius: 8 }}>{relCount}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Detail / relationship panel */}
                <div style={{ flex: 1 }}>
                  {ftSelected ? (() => {
                    const ch = articles.find((a) => a.id === ftSelected);
                    if (!ch) return <div style={{ color: theme.textDim }}>Character not found.</div>;
                    const rels = getRelationsFor(ch.id);
                    const parents = rels.filter((r) => r.type === "parent").map((r) => articles.find((a) => a.id === r.targetId)).filter(Boolean);
                    const children = rels.filter((r) => r.type === "child").map((r) => articles.find((a) => a.id === r.targetId)).filter(Boolean);
                    const spouses = rels.filter((r) => r.type === "spouse").map((r) => articles.find((a) => a.id === r.targetId)).filter(Boolean);
                    const siblings = rels.filter((r) => r.type === "sibling").map((r) => articles.find((a) => a.id === r.targetId)).filter(Boolean);
                    const REL_TYPES = [
                      { key: "parent", label: "Parents", icon: "👑", list: parents, color: "#d4a060" },
                      { key: "spouse", label: "Spouses", icon: "💍", list: spouses, color: "#f472b6" },
                      { key: "sibling", label: "Siblings", icon: "👥", list: siblings, color: "#7ec8e3" },
                      { key: "child", label: "Children", icon: "🌱", list: children, color: "#8ec8a0" },
                    ];

                    return (
                      <div>
                        {/* Character header */}
                        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
                          {ch.portrait ? (
                            <div style={{ width: 56, height: 56, borderRadius: "50%", overflow: "hidden", border: "2px solid " + CATEGORIES.character.color + "40" }}><img src={ch.portrait} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
                          ) : (
                            <div style={{ width: 56, height: 56, borderRadius: "50%", background: ta(CATEGORIES.character.color, 0.1), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, color: CATEGORIES.character.color }}>🧙</div>
                          )}
                          <div>
                            <div style={{ fontSize: 18, fontWeight: 700, color: theme.text, fontFamily: "'Cinzel', serif" }}>{ch.title}</div>
                            <div style={{ fontSize: 12, color: theme.textMuted }}>{ch.fields?.char_race || ""}{ch.fields?.titles ? " · " + ch.fields.titles : ""}{ch.fields?.role ? " · " + ch.fields.role : ""}</div>
                          </div>
                          <button onClick={() => navigate(ch.id)} style={{ ...tBtnS, fontSize: 10, padding: "4px 12px", marginLeft: "auto" }}>View Article</button>
                        </div>

                        {/* Relationship groups */}
                        {REL_TYPES.map((rt) => (
                          <div key={rt.key} style={{ marginBottom: 16 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                              <span style={{ fontSize: 14 }}>{rt.icon}</span>
                              <span style={{ fontFamily: "'Cinzel', serif", fontSize: 12, fontWeight: 600, color: rt.color, letterSpacing: 0.5 }}>{rt.label}</span>
                              <span style={{ fontSize: 10, color: theme.textDim }}>({rt.list.length})</span>
                              <button onClick={() => setFtAddingRel(ftAddingRel?.type === rt.key ? null : { fromId: ch.id, type: rt.key })}
                                style={{ fontSize: 10, color: rt.color, background: ftAddingRel?.type === rt.key ? ta(rt.color, 0.15) : ta(rt.color, 0.06), border: "1px solid " + ta(rt.color, 0.2), borderRadius: 6, padding: "2px 10px", cursor: "pointer", fontFamily: "inherit", marginLeft: "auto" }}>
                                {ftAddingRel?.type === rt.key ? "Cancel" : "+ Add"}
                              </button>
                            </div>
                            {/* Add relationship picker */}
                            {ftAddingRel?.type === rt.key && (
                              <div style={{ marginBottom: 10, padding: "8px 12px", background: ta(theme.surface, 0.5), border: "1px solid " + ta(rt.color, 0.2), borderRadius: 8, maxHeight: 180, overflowY: "auto" }}>
                                <div style={{ fontSize: 10, color: theme.textDim, marginBottom: 6 }}>Select a character:</div>
                                {characters.filter((c) => c.id !== ch.id && !rt.list.find((r) => r.id === c.id)).map((c) => (
                                  <div key={c.id} onClick={() => { addRelation(ch.id, c.id, rt.key); setFtAddingRel(null); }}
                                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 6, cursor: "pointer", transition: "background 0.1s" }}
                                    onMouseEnter={(e) => { e.currentTarget.style.background = ta(rt.color, 0.1); }}
                                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                                    <span style={{ fontSize: 12, color: CATEGORIES.character.color }}>🧙</span>
                                    <span style={{ fontSize: 12, color: theme.text }}>{c.title}</span>
                                    <span style={{ fontSize: 10, color: theme.textDim }}>{c.fields?.char_race || ""}</span>
                                  </div>
                                ))}
                                {characters.filter((c) => c.id !== ch.id && !rt.list.find((r) => r.id === c.id)).length === 0 && (
                                  <div style={{ fontSize: 11, color: theme.textDim, padding: 4 }}>No available characters.</div>
                                )}
                              </div>
                            )}
                            {/* Listed relations */}
                            {rt.list.length > 0 ? (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {rt.list.map((rel) => (
                                  <div key={rel.id} style={{ display: "flex", alignItems: "center", gap: 6, background: ta(rt.color, 0.06), border: "1px solid " + ta(rt.color, 0.15), borderRadius: 8, padding: "6px 10px" }}>
                                    {rel.portrait ? (
                                      <div style={{ width: 22, height: 22, borderRadius: "50%", overflow: "hidden", flexShrink: 0 }}><img src={rel.portrait} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
                                    ) : (
                                      <span style={{ fontSize: 12, color: rt.color }}>🧙</span>
                                    )}
                                    <span onClick={() => setFtSelected(rel.id)} style={{ fontSize: 12, color: theme.text, fontWeight: 500, cursor: "pointer" }}
                                      onMouseEnter={(e) => { e.currentTarget.style.color = rt.color; }} onMouseLeave={(e) => { e.currentTarget.style.color = theme.text; }}>{rel.title}</span>
                                    <span onClick={(e) => { e.stopPropagation(); removeRelation(ch.id, rel.id, rt.key); }} title="Remove relationship" style={{ fontSize: 10, color: "#e07050", cursor: "pointer", opacity: 0.5, marginLeft: 2 }}
                                      onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }} onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}>✕</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div style={{ fontSize: 11, color: theme.textDim, fontStyle: "italic", padding: "4px 0" }}>None</div>
                            )}
                          </div>
                        ))}

                        {/* Mini visual tree */}
                        {(parents.length > 0 || children.length > 0 || spouses.length > 0) && (
                          <div style={{ marginTop: 24, padding: "16px 20px", background: ta(theme.surface, 0.4), border: "1px solid " + theme.divider, borderRadius: 10 }}>
                            <div style={{ fontFamily: "'Cinzel', serif", fontSize: 11, color: theme.textMuted, letterSpacing: 1, textTransform: "uppercase", marginBottom: 12 }}>Lineage View</div>
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
                              {/* Parents row */}
                              {parents.length > 0 && (<>
                                <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
                                  {parents.map((p) => (
                                    <div key={p.id} onClick={() => setFtSelected(p.id)} style={{ textAlign: "center", cursor: "pointer", padding: "6px 12px", borderRadius: 8, background: ta("#d4a060", 0.06), border: "1px solid " + ta("#d4a060", 0.15), transition: "all 0.15s" }}
                                      onMouseEnter={(e) => { e.currentTarget.style.border = "1px solid " + "#d4a060"; }} onMouseLeave={(e) => { e.currentTarget.style.border = "1px solid " + ta("#d4a060", 0.15); }}>
                                      <div style={{ fontSize: 11, fontWeight: 600, color: "#d4a060" }}>{p.title}</div>
                                      <div style={{ fontSize: 9, color: theme.textDim }}>{p.fields?.char_race || "Parent"}</div>
                                    </div>
                                  ))}
                                </div>
                                <div style={{ width: 2, height: 20, background: theme.divider }} />
                              </>)}

                              {/* Center: selected character + spouses */}
                              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                {spouses.length > 0 && spouses.map((sp) => (<React.Fragment key={sp.id}>
                                  <div onClick={() => setFtSelected(sp.id)} style={{ textAlign: "center", cursor: "pointer", padding: "6px 12px", borderRadius: 8, background: ta("#f472b6", 0.06), border: "1px solid " + ta("#f472b6", 0.15) }}
                                    onMouseEnter={(e) => { e.currentTarget.style.border = "1px solid " + "#f472b6"; }} onMouseLeave={(e) => { e.currentTarget.style.border = "1px solid " + ta("#f472b6", 0.15); }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, color: "#f472b6" }}>{sp.title}</div>
                                    <div style={{ fontSize: 9, color: theme.textDim }}>Spouse</div>
                                  </div>
                                  <span style={{ fontSize: 12, color: "#f472b6" }}>💍</span>
                                </React.Fragment>))}
                                <div style={{ textAlign: "center", padding: "10px 20px", borderRadius: 10, background: ta(theme.accent, 0.12), border: "2px solid " + ta(theme.accent, 0.4) }}>
                                  <div style={{ fontSize: 14, fontWeight: 700, color: theme.accent, fontFamily: "'Cinzel', serif" }}>{ch.title}</div>
                                  <div style={{ fontSize: 10, color: theme.textMuted }}>{ch.fields?.char_race || ""}{ch.fields?.role ? " · " + ch.fields.role : ""}</div>
                                </div>
                              </div>

                              {/* Children row */}
                              {children.length > 0 && (<>
                                <div style={{ width: 2, height: 20, background: theme.divider }} />
                                <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
                                  {children.map((kid) => (
                                    <div key={kid.id} onClick={() => setFtSelected(kid.id)} style={{ textAlign: "center", cursor: "pointer", padding: "6px 12px", borderRadius: 8, background: ta("#8ec8a0", 0.06), border: "1px solid " + ta("#8ec8a0", 0.15), transition: "all 0.15s" }}
                                      onMouseEnter={(e) => { e.currentTarget.style.border = "1px solid " + "#8ec8a0"; }} onMouseLeave={(e) => { e.currentTarget.style.border = "1px solid " + ta("#8ec8a0", 0.15); }}>
                                      <div style={{ fontSize: 11, fontWeight: 600, color: "#8ec8a0" }}>{kid.title}</div>
                                      <div style={{ fontSize: 9, color: theme.textDim }}>{kid.fields?.char_race || "Child"}</div>
                                    </div>
                                  ))}
                                </div>
                              </>)}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })() : (
                    <div style={{ textAlign: "center", padding: 60, color: theme.textDim }}>
                      <div style={{ fontSize: 36, marginBottom: 12 }}>🌳</div>
                      <p>Select a character to view and manage their family relationships.</p>
                      <p style={{ fontSize: 11 }}>Click a name, then use the + Add buttons to link parents, spouses, siblings, and children.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>)}
  </>);

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  RANDOM GENERATORS                                         ║
  // ╚══════════════════════════════════════════════════════════════╝
  const GENERATORS = {
    npc: {
      label: "NPC Generator", icon: "👤", category: "character",
      generate: () => {
        const pick = (arr) => arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;
        const firstNames = ["Aldric","Brenna","Cedric","Dahlia","Eira","Fenris","Gwendolyn","Hadrian","Isolde","Jareth","Kira","Lysander","Mira","Nyx","Orin","Priya","Quintus","Ravenna","Soren","Thalia","Ulric","Vesper","Wren","Xara","Ysbel","Zephyr"];
        const surnames = ["Ashford","Blackwood","Crowley","Duskwalker","Emberheart","Frostwind","Grimshaw","Holloway","Ironforge","Jadecrest","Kindlefire","Loreweaver","Moonbane","Nightshade","Oathkeeper","Pellagor","Quicksilver","Ravenmark","Shadowmere","Thornwall","Underwood","Vexmire","Winterborn","Yarrow"];
        const traits = ["scarred face","missing finger","speaks in riddles","carries a locket","nervous laugh","one glass eye","tattooed arms","whispers when angry","hoards books","afraid of water","obsessed with honor","pathological liar","former noble","ex-convict","poet at heart","silent observer","haunted by visions","collects teeth","never sits down","hums constantly"];
        const motivations = ["seeks revenge for a lost sibling","hunts a legendary beast","protects a dangerous secret","owes a debt to a powerful mage","searching for a cure","building a new guild","atoning for past crimes","trying to find a lost city","collecting ancient relics","fleeing a prophecy"];
        const roles = ["blacksmith","herbalist","sellsword","scholar","innkeeper","ranger","spy","priest","merchant","bard","alchemist","bounty hunter","diplomat","scribe","smuggler","healer","assassin","cartographer","shepherd","gravedigger"];
        // Pull from codex
        const codexRaces = articles.filter((a) => a.category === "race").map((a) => a.title);
        const codexOrgs = articles.filter((a) => a.category === "organization").map((a) => a.title);
        const codexLocations = articles.filter((a) => a.category === "location").map((a) => a.title);
        const fallbackRaces = ["Human","Elf","Dwarf","Halfling","Orc","Gnome","Tiefling","Dragonborn"];
        const racePool = codexRaces.length > 0 ? codexRaces : fallbackRaces;
        const name = pick(firstNames) + " " + pick(surnames);
        const race = pick(racePool);
        const role = pick(roles);
        const trait1 = pick(traits);
        let trait2 = pick(traits); while (trait2 === trait1) trait2 = pick(traits);
        const motivation = pick(motivations);
        const affiliation = codexOrgs.length > 0 ? pick(codexOrgs) : null;
        const homeland = codexLocations.length > 0 ? pick(codexLocations) : null;
        return {
          display: name + " — " + role + "\nRace: " + race + (affiliation ? "\nAffiliation: " + affiliation : "") + (homeland ? "\nFrom: " + homeland : "") + "\nTraits: " + trait1 + ", " + trait2 + "\nMotivation: " + motivation,
          fields: { char_race: race, role, titles: "", affiliations: affiliation || "", },
          title: name,
          summary: race + " " + role + ". " + trait1 + ", " + trait2 + ".",
          body: "Motivation: " + motivation + (homeland ? "\n\nHails from " + homeland + "." : ""),
        };
      }
    },
    location: {
      label: "Location Generator", icon: "🏰", category: "location",
      generate: () => {
        const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
        const prefixes = ["The","Old","Lost","Fallen","Shadow","Iron","Crystal","Hollow","Crimson","Silver","Storm","Ember","Frost","Dark","Golden","Whispering","Ancient","Cursed","Hidden","Sacred"];
        const cores = ["Tower","Keep","Gate","Vale","Bridge","Crossing","Hollow","Peak","Cavern","Ruins","Falls","Shore","Grove","Hearth","Spire","Throne","Forge","Sanctum","Den","Reach"];
        const features = ["shrouded in perpetual mist","built upon the bones of an older civilization","home to a secretive order","known for its healing springs","surrounded by petrified trees","where the veil between worlds is thin","abandoned after a great plague","carved into a living glacier","floating on an underground lake","overrun with luminous fungi","guarded by ancient wards","a crossroads for smugglers and spies"];
        const statuses = ["thriving","in decline","recently abandoned","under siege","hidden from maps","contested territory","sacred ground","quarantined"];
        const codexRegions = articles.filter((a) => a.category === "location").map((a) => a.title);
        const name = pick(prefixes) + " " + pick(cores);
        const feature = pick(features);
        const status = pick(statuses);
        const region = codexRegions.length > 0 ? pick(codexRegions) : null;
        return {
          display: name + "\n" + feature + "\nStatus: " + status + (region ? "\nNear: " + region : ""),
          fields: { region: region || "", notable_features: feature, status, ruler: "", population: "" },
          title: name,
          summary: feature,
          body: "Status: " + status + "." + (region ? "\n\nLocated near " + region + "." : ""),
        };
      }
    },
    tavern: {
      label: "Tavern Name", icon: "🍺", category: "location",
      generate: () => {
        const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
        const adj = ["Drunken","Golden","Rusty","Prancing","Wailing","Jolly","Crimson","Silver","Laughing","Wandering","Broken","Lucky","Dancing","Sleeping","Howling","Leaky","Gilded","Shattered","Merry"];
        const nouns = ["Dragon","Griffin","Stag","Raven","Serpent","Unicorn","Bear","Fox","Kraken","Wolf","Basilisk","Phoenix","Owl","Goat","Badger","Troll","Imp","Wyvern","Pegasus"];
        const extras = ["Inn","Tavern","Alehouse","Lodge","Brewhouse","Taproom","Rest","Hearth","Hall"];
        const vibes = ["rowdy and warm, popular with adventurers","quiet and dimly lit, favored by locals","upscale with an elven wine list","cramped but legendary for its stew","built inside a hollowed-out tree","floating on a barge that never docks","run by a retired war hero","haunted by its previous owner"];
        const codexLocations = articles.filter((a) => a.category === "location").map((a) => a.title);
        const name = "The " + pick(adj) + " " + pick(nouns) + " " + pick(extras);
        const vibe = pick(vibes);
        const region = codexLocations.length > 0 ? pick(codexLocations) : null;
        return {
          display: name + "\n" + vibe + (region ? "\nLocated in: " + region : ""),
          fields: { region: region || "", notable_features: vibe, status: "thriving" },
          title: name,
          summary: vibe,
          body: "A tavern " + vibe + "." + (region ? "\n\nLocated in " + region + "." : ""),
        };
      }
    },
    plot_hook: {
      label: "Plot Hook", icon: "📜", category: "event",
      generate: () => {
        const pick = (arr) => arr.length ? arr[Math.floor(Math.random() * arr.length)] : null;
        // Pull from codex
        const chars = articles.filter((a) => a.category === "character").map((a) => a.title);
        const locs = articles.filter((a) => a.category === "location").map((a) => a.title);
        const orgs = articles.filter((a) => a.category === "organization").map((a) => a.title);
        const items = articles.filter((a) => a.category === "item").map((a) => a.title);
        const deities = articles.filter((a) => a.category === "deity").map((a) => a.title);
        const races = articles.filter((a) => a.category === "race").map((a) => a.title);
        // Fallbacks
        const fChar = ["a wandering stranger","the innkeeper's daughter","a scarred mercenary","a hooded scholar","an exiled noble","a street urchin"];
        const fLoc = ["the old ruins","the capital city","the northern wastes","the merchant quarter","the forbidden forest","the harbor district"];
        const fOrg = ["a secretive guild","the king's council","a band of rebels","the merchant consortium","a religious order","the thieves' network"];
        const fItem = ["an ancient relic","a cursed amulet","a sealed tome","a shattered crown","a black dagger","a glowing shard"];
        const fDeity = ["the Sleeping God","the Weaver of Fate","the Lord of Ash","the Lady of Thorns","the Void Mother"];
        const fRace = ["elven","dwarven","orcish","fey","draconic","human"];
        const c = () => pick(chars) || pick(fChar);
        const l = () => pick(locs) || pick(fLoc);
        const o = () => pick(orgs) || pick(fOrg);
        const it = () => pick(items) || pick(fItem);
        const d = () => pick(deities) || pick(fDeity);
        const r = () => pick(races) || pick(fRace);
        const adj = () => pick(["ancient","bloodstained","whispering","shattered","sealed","burning","frozen","cursed","golden","silver","iron","crystal","shadowed","forgotten","living"]);
        const obj = () => pick(["letter","map","blade","mask","coin","ring","skull","mirror","key","book","pendant","scroll","compass","bell","lantern"]);
        // Themed templates: [tag, template_fn, outcome_fn]
        const templates = [
          // Mystery
          ["Mystery", () => c() + " has vanished from " + l() + ". The only clue: a " + adj() + " " + obj() + " left where they slept.", () => "The disappearance is connected to " + o() + " and a plot that reaches far deeper than anyone suspects."],
          ["Mystery", () => "Bodies are appearing in " + l() + ", each holding a " + adj() + " " + obj() + " and a smile on their face.", () => "A " + r() + " ritual gone wrong is binding souls to objects of power."],
          ["Mystery", () => "Every mirror in " + l() + " has begun showing the same face — and no one recognizes it.", () => "The face belongs to a prisoner trapped between worlds by " + d() + "."],
          // Betrayal
          ["Betrayal", () => c() + " has been secretly feeding intelligence to " + o() + ", and the evidence points to someone close to power.", () => "The betrayal was orchestrated to expose a far greater traitor within the ranks."],
          ["Betrayal", () => "A trusted advisor to the ruler of " + l() + " is found dead clutching a " + adj() + " " + obj() + " — and the killer left a calling card from " + o() + ".", () => "The advisor discovered something they shouldn't have about " + d() + "'s true nature."],
          ["Betrayal", () => o() + " has offered a fortune for " + it() + ", but " + c() + " knows the item's real purpose — and it's nothing good.", () => "The item can break the seal on something ancient and dangerous beneath " + l() + "."],
          // Prophecy
          ["Prophecy", () => "A " + r() + " seer in " + l() + " has spoken a prophecy naming " + c() + " as the one who will either save or destroy " + l() + ".", () => "The prophecy is a manipulation by " + d() + ", who needs a mortal pawn."],
          ["Prophecy", () => "An " + adj() + " " + obj() + " unearthed in " + l() + " bears an inscription that matches a verse from a lost " + r() + " prophecy.", () => "The artifact is one of several needed to prevent — or cause — a cataclysm."],
          // Discovery
          ["Discovery", () => "Miners in " + l() + " broke through into a vast chamber containing a " + adj() + " " + obj() + " and the remains of a " + r() + " civilization.", () => "The civilization didn't die — they're in stasis, and something is waking them."],
          ["Discovery", () => c() + " found a " + adj() + " " + obj() + " in a shipwreck near " + l() + ". Since touching it, they've been hearing " + d() + "'s voice.", () => "The item is a shard of " + d() + "'s broken prison, and each piece found weakens the seal."],
          ["Discovery", () => "A new island has appeared overnight off the coast of " + l() + ". " + o() + " has already sent an expedition.", () => "The island is alive — a slumbering titan that rises every thousand years."],
          // War
          ["War", () => o() + " has blockaded " + l() + " and is demanding the surrender of " + it() + ". " + c() + " is the only one who knows where it's hidden.", () => "The item is the only thing keeping " + d() + " from walking the mortal world."],
          ["War", () => "Refugees from " + l() + " are flooding into neighboring territories, whispering of " + r() + " soldiers who fight without breathing.", () => "A necromancer allied with " + o() + " has raised an undead army from ancient battlefields."],
          // Supernatural
          ["Supernatural", () => "Every night for a week, " + c() + " has woken with a new " + adj() + " mark on their skin. The marks form a map to " + l() + ".", () => d() + " is guiding a chosen vessel toward a ritual site."],
          ["Supernatural", () => "The dead in " + l() + "'s graveyard have started whispering. Those who listen too long don't come back the same.", () => "A rift between the living and the dead has cracked open, and " + o() + " is exploiting it."],
          ["Supernatural", () => "Rain hasn't fallen on " + l() + " in months, yet a single garden owned by " + c() + " flourishes. Locals are getting suspicious.", () => c() + " unknowingly made a pact with " + d() + " as a child."],
          // Political
          ["Political", () => "The leader of " + o() + " has publicly accused " + c() + " of treason during a summit in " + l() + ". No trial — just exile.", () => "The accusation is a cover. The real crime is what was discovered inside " + it() + "."],
          ["Political", () => "Three factions are vying for control of " + l() + " after its ruler vanished. " + o() + " claims rightful succession, but " + c() + " holds a " + adj() + " " + obj() + " that proves otherwise.", () => "The ruler didn't vanish — they were transformed by " + r() + " magic and are hiding in plain sight."],
          ["Political", () => "A marriage alliance between " + c() + " and a noble of " + l() + " threatens to shift the balance of power. " + o() + " wants it stopped at any cost.", () => "The marriage would unite bloodlines that fulfill an ancient " + r() + " prophecy."],
          // Heist
          ["Heist", () => it() + " is locked inside " + o() + "'s vault beneath " + l() + ". " + c() + " knows the way in — but the price they're asking is steep.", () => "The item isn't what it appears. It's a key to something far more valuable — and far more dangerous."],
          ["Heist", () => c() + " needs " + it() + " stolen from " + l() + " before the next full moon, or " + d() + "'s curse will claim them.", () => "The curse is a test. " + d() + " is searching for a mortal worthy of a divine task."],
        ];
        const [tag, textFn, outcomeFn] = pick(templates);
        const text = textFn();
        const outcome = outcomeFn();
        const keyFigure = pick(chars) || "";
        return {
          display: "⟨" + tag + "⟩ " + text + "\n\nPossible outcome: " + outcome + (keyFigure ? "\nKey figure: " + keyFigure : ""),
          tag,
          fields: { key_figures: keyFigure, outcome },
          title: text.split(/[.!?]/)[0].slice(0, 60),
          summary: text,
          body: text + "\n\nPossible outcome: " + outcome,
        };
      }
    },
    name_list: {
      label: "Name List", icon: "📋", category: "character",
      generate: () => {
        const sets = [
          ["Aelindra","Boreas","Caelum","Draven","Eirlys","Faolan","Gael","Hesper","Ivor","Jorah"],
          ["Kaelen","Liora","Maelis","Niamh","Odhran","Phaedra","Quillan","Rhiannon","Sable","Theron"],
          ["Ursa","Vaelen","Wynter","Xanthis","Ysabel","Zarek","Arden","Briar","Cressida","Dune"],
          ["Ashwin","Bethany","Corvin","Delara","Emeric","Fianna","Garrick","Helene","Idris","Jessamine"],
        ];
        const codexRaces = articles.filter((a) => a.category === "race").map((a) => a.title);
        const set = sets[Math.floor(Math.random() * sets.length)];
        return {
          display: set.join(", "),
          names: set, // individual names for per-name creation
          defaultRace: codexRaces.length > 0 ? codexRaces[Math.floor(Math.random() * codexRaces.length)] : "",
        };
      }
    }
  };

  // Helper: create entry from structured generator result
  const createFromGenerator = (result, genType) => {
    const gen = GENERATORS[genType];
    if (!gen) return;
    goCreate(gen.category);
    // Use setTimeout to let goCreate's setFormData run first, then override
    setTimeout(() => {
      setFormData((p) => ({
        ...p,
        title: result.title || "",
        summary: result.summary || "",
        body: result.body || "",
        fields: { ...p.fields, ...(result.fields || {}) },
      }));
    }, 0);
  };

  const createNameEntry = (name, defaultRace) => {
    goCreate("character");
    setTimeout(() => {
      setFormData((p) => ({
        ...p,
        title: name,
        summary: "",
        body: "",
        fields: { ...p.fields, char_race: defaultRace || "" },
      }));
    }, 0);
  };

  const renderGenerator = () => (<>
          {view === "generator" && (<div style={{ marginTop: 24, maxWidth: 700 }}>
            <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: theme.text, margin: 0, letterSpacing: 1 }}>🎲 Random Generators</h2>
            <p style={{ fontSize: 13, color: theme.textDim, marginTop: 6 }}>
              Spark ideas for your world. Results pull from your codex
              {articles.filter((a) => a.category === "race").length > 0 ? " (" + articles.filter((a) => a.category === "race").length + " races" : " (no races yet"}
              {articles.filter((a) => a.category === "organization").length > 0 ? ", " + articles.filter((a) => a.category === "organization").length + " orgs" : ""}
              {articles.filter((a) => a.category === "location").length > 0 ? ", " + articles.filter((a) => a.category === "location").length + " locations" : ""}
              ).
            </p>
            <Ornament width={300} />
            <div style={{ display: "flex", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
              {Object.entries(GENERATORS).map(([k, g]) => (
                <button key={k} onClick={() => setGeneratorType(k)}
                  style={{ padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "'Cinzel', serif", fontWeight: generatorType === k ? 700 : 400, border: "1px solid " + (generatorType === k ? theme.accent + "50" : theme.border), background: generatorType === k ? theme.accentBg : ta(theme.surface, 0.5), color: generatorType === k ? theme.accent : theme.textMuted, transition: "all 0.15s", letterSpacing: 0.5 }}>
                  {g.icon} {g.label}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 24 }}>
              <button onClick={() => {
                const gen = GENERATORS[generatorType];
                if (!gen) return;
                setGeneratorResults((prev) => [{ id: Date.now(), result: gen.generate(), type: generatorType }, ...prev].slice(0, 20));
              }} style={{ ...tBtnP, fontSize: 14, padding: "12px 32px", letterSpacing: 1 }}>🎲 Generate</button>
            </div>
            <div style={{ marginTop: 24 }}>
              {generatorResults.filter((r) => r.type === generatorType).map((r) => (
                <div key={r.id} style={{ background: ta(theme.surface, 0.6), border: "1px solid " + theme.divider, borderRadius: 8, padding: "14px 18px", marginBottom: 10 }}>
                  {/* Name list: special rendering with per-name buttons */}
                  {r.type === "name_list" && r.result.names ? (<>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {r.result.names.map((name, ni) => (
                        <div key={ni} style={{ display: "flex", alignItems: "center", gap: 4, background: ta(theme.accent, 0.06), border: "1px solid " + ta(theme.accent, 0.15), borderRadius: 8, padding: "6px 10px" }}>
                          <span style={{ fontSize: 13, color: theme.text, fontWeight: 500 }}>{name}</span>
                          <span onClick={() => createNameEntry(name, r.result.defaultRace)} title={"Create " + name + " as character entry"} style={{ fontSize: 11, color: "#8ec8a0", cursor: "pointer", fontWeight: 700, marginLeft: 2, padding: "0 2px" }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = "#a0e8c0"; }} onMouseLeave={(e) => { e.currentTarget.style.color = "#8ec8a0"; }}>+</span>
                        </div>
                      ))}
                    </div>
                    {r.result.defaultRace && <div style={{ fontSize: 10, color: theme.textDim, marginTop: 8 }}>Default race: {r.result.defaultRace}</div>}
                    <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                      <button onClick={() => { navigator.clipboard?.writeText(r.result.names.join(", ")); }} style={{ ...tBtnS, fontSize: 10, padding: "3px 10px" }}>📋 Copy All</button>
                      <button onClick={() => {
                        if (!confirm("Create " + r.result.names.length + " character entries?")) return;
                        r.result.names.forEach((name, i) => {
                          setTimeout(() => {
                            const id = lower(name).replace(/[^a-z0-9]+/g, "_").replace(/_+$/, "");
                            if (articles.find((a) => a.id === id)) return;
                            const a = { id, title: name, category: "character", summary: "", fields: { char_race: r.result.defaultRace || "" }, body: "", tags: [], linkedIds: [], portrait: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
                            setArticles((prev) => prev.find((x) => x.id === id) ? prev : dedup([a, ...prev]));
                          }, i * 50);
                        });
                      }} style={{ ...tBtnS, fontSize: 10, padding: "3px 10px", color: "#8ec8a0", border: "1px solid rgba(142,200,160,0.2)" }}>↑ Create All ({r.result.names.length})</button>
                    </div>
                  </>) : (<>
                    {/* Standard generators: structured display */}
                    <div style={{ whiteSpace: "pre-line", fontSize: 13, color: theme.text, lineHeight: 1.6 }}>
                      {r.result.tag && <span style={{ fontSize: 10, fontWeight: 700, color: theme.accent, background: ta(theme.accent, 0.08), padding: "2px 8px", borderRadius: 10, marginRight: 8, letterSpacing: 0.5 }}>{r.result.tag}</span>}
                      {r.result.display || r.result}
                    </div>
                    <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                      <button onClick={() => { navigator.clipboard?.writeText(r.result.display || r.result); }} style={{ ...tBtnS, fontSize: 10, padding: "3px 10px" }}>📋 Copy</button>
                      <button onClick={() => createFromGenerator(r.result, r.type)} style={{ ...tBtnS, fontSize: 10, padding: "3px 10px", color: "#8ec8a0", border: "1px solid rgba(142,200,160,0.2)" }}>↑ Create {CATEGORIES[GENERATORS[r.type]?.category]?.label || "Entry"}</button>
                    </div>
                  </>)}
                </div>
              ))}
              {generatorResults.filter((r) => r.type === generatorType).length === 0 && (
                <div style={{ textAlign: "center", padding: 40, color: theme.textDim }}><div style={{ fontSize: 32, marginBottom: 8 }}>🎲</div><p>Click Generate to roll results</p></div>
              )}
            </div>
          </div>)}
  </>);

  // ╔══════════════════════════════════════════════════════════════╗
  // ║  SESSION / CAMPAIGN NOTES                                  ║
  // ╚══════════════════════════════════════════════════════════════╝
  const renderSessions = () => (<>
          {view === "sessions" && (<div style={{ marginTop: 24, maxWidth: 800 }}>
            <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "center", justifyContent: "space-between", gap: 12, flexDirection: isMobile ? "column" : "row" }}>
              <div>
                <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: theme.text, margin: 0, letterSpacing: 1 }}>📓 Session Notes</h2>
                <p style={{ fontSize: 12, color: theme.textDim, marginTop: 4 }}>{sessions.length} session{sessions.length !== 1 ? "s" : ""} logged</p>
              </div>
              <button onClick={() => { setSessionEdit("new"); setSessionForm({ title: "Session " + (sessions.length + 1), date: new Date().toISOString().split("T")[0], summary: "", encounters: "", npcs: "", loot: "", notes: "", tags: "" }); }}
                style={{ ...tBtnP, fontSize: 12, padding: "8px 20px" }}>+ New Session</button>
            </div>
            <Ornament width={300} />

            {/* Session form (create or edit) */}
            {sessionEdit && (
              <div style={{ marginTop: 20, padding: "20px 24px", background: ta(theme.surface, 0.6), border: "1px solid " + theme.divider, borderRadius: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: theme.text, fontFamily: "'Cinzel', serif", marginBottom: 16 }}>{sessionEdit === "new" ? "New Session Log" : "Edit Session"}</div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 10, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Title</label>
                    <input value={sessionForm.title} onChange={(e) => setSessionForm((p) => ({ ...p, title: e.target.value }))} style={{ ...S.input, width: "100%", boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 10, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Date</label>
                    <input type="date" value={sessionForm.date} onChange={(e) => setSessionForm((p) => ({ ...p, date: e.target.value }))} style={{ ...S.input, width: "100%", boxSizing: "border-box" }} />
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <label style={{ display: "block", fontSize: 10, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Summary</label>
                  <textarea value={sessionForm.summary} onChange={(e) => setSessionForm((p) => ({ ...p, summary: e.target.value }))} rows={3} style={{ ...S.input, width: "100%", boxSizing: "border-box", resize: "vertical" }} placeholder="What happened this session?" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginTop: 12 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 10, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>⚔ Encounters</label>
                    <textarea value={sessionForm.encounters} onChange={(e) => setSessionForm((p) => ({ ...p, encounters: e.target.value }))} rows={2} style={{ ...S.input, width: "100%", boxSizing: "border-box", resize: "vertical" }} placeholder="Combat, puzzles, challenges..." />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 10, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>👤 NPCs Met</label>
                    <textarea value={sessionForm.npcs} onChange={(e) => setSessionForm((p) => ({ ...p, npcs: e.target.value }))} rows={2} style={{ ...S.input, width: "100%", boxSizing: "border-box", resize: "vertical" }} placeholder="Names and roles..." />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 10, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>💎 Loot & Rewards</label>
                    <textarea value={sessionForm.loot} onChange={(e) => setSessionForm((p) => ({ ...p, loot: e.target.value }))} rows={2} style={{ ...S.input, width: "100%", boxSizing: "border-box", resize: "vertical" }} placeholder="Items, gold, information..." />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 10, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>📝 DM Notes (private)</label>
                    <textarea value={sessionForm.notes} onChange={(e) => setSessionForm((p) => ({ ...p, notes: e.target.value }))} rows={2} style={{ ...S.input, width: "100%", boxSizing: "border-box", resize: "vertical" }} placeholder="Foreshadowing, hooks planted, player reactions..." />
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <label style={{ display: "block", fontSize: 10, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Tags (comma-separated)</label>
                  <input value={sessionForm.tags} onChange={(e) => setSessionForm((p) => ({ ...p, tags: e.target.value }))} style={{ ...S.input, width: "100%", boxSizing: "border-box" }} placeholder="combat, mystery, arc-2..." />
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                  <button onClick={() => { sessionEdit === "new" ? createSession() : updateSession(sessionEdit); }}
                    style={{ ...tBtnP, fontSize: 12, padding: "8px 24px" }}>{sessionEdit === "new" ? "Create Session" : "Save Changes"}</button>
                  <button onClick={() => { setSessionEdit(null); setSessionForm({ title: "", date: "", summary: "", encounters: "", npcs: "", loot: "", notes: "", tags: "" }); }}
                    style={{ ...tBtnS, fontSize: 12, padding: "8px 16px" }}>Cancel</button>
                </div>
              </div>
            )}

            {/* Session list */}
            <div style={{ marginTop: 24 }}>
              {sessions.length === 0 && !sessionEdit && (
                <div style={{ textAlign: "center", padding: 60, color: theme.textDim }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>📓</div>
                  <p style={{ fontSize: 16, fontFamily: "'Cinzel', serif" }}>No Sessions Logged</p>
                  <p style={{ fontSize: 12 }}>Click "+ New Session" to record your first session.</p>
                </div>
              )}
              {sessions.map((s) => (
                <div key={s.id} style={{ background: ta(theme.surface, 0.6), border: "1px solid " + theme.divider, borderRadius: 10, padding: "16px 20px", marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: theme.text, fontFamily: "'Cinzel', serif" }}>{s.title}</div>
                      {s.date && <div style={{ fontSize: 11, color: theme.textDim, marginTop: 2 }}>📅 {s.date}</div>}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => { setSessionEdit(s.id); setSessionForm({ title: s.title, date: s.date || "", summary: s.summary || "", encounters: s.encounters || "", npcs: s.npcs || "", loot: s.loot || "", notes: s.notes || "", tags: (s.tags || []).join(", ") }); }}
                        style={{ ...tBtnS, fontSize: 10, padding: "3px 10px" }}>✎ Edit</button>
                      <button onClick={() => deleteSession(s.id)} style={{ ...tBtnS, fontSize: 10, padding: "3px 10px", color: "#e07050", border: "1px solid rgba(224,112,80,0.2)" }}>✕</button>
                    </div>
                  </div>
                  {s.summary && <div style={{ fontSize: 13, color: theme.text, lineHeight: 1.6, marginBottom: 10, whiteSpace: "pre-line" }}>{s.summary}</div>}
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)", gap: 10 }}>
                    {s.encounters && (
                      <div style={{ padding: "8px 12px", background: ta("#e07050", 0.04), border: "1px solid " + ta("#e07050", 0.12), borderRadius: 8 }}>
                        <div style={{ fontSize: 10, color: "#e07050", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>⚔ Encounters</div>
                        <div style={{ fontSize: 12, color: theme.textMuted, whiteSpace: "pre-line" }}>{s.encounters}</div>
                      </div>
                    )}
                    {s.npcs && (
                      <div style={{ padding: "8px 12px", background: ta(CATEGORIES.character.color, 0.04), border: "1px solid " + ta(CATEGORIES.character.color, 0.12), borderRadius: 8 }}>
                        <div style={{ fontSize: 10, color: CATEGORIES.character.color, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>👤 NPCs Met</div>
                        <div style={{ fontSize: 12, color: theme.textMuted, whiteSpace: "pre-line" }}>{s.npcs}</div>
                      </div>
                    )}
                    {s.loot && (
                      <div style={{ padding: "8px 12px", background: ta("#d4a060", 0.04), border: "1px solid " + ta("#d4a060", 0.12), borderRadius: 8 }}>
                        <div style={{ fontSize: 10, color: "#d4a060", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>💎 Loot & Rewards</div>
                        <div style={{ fontSize: 12, color: theme.textMuted, whiteSpace: "pre-line" }}>{s.loot}</div>
                      </div>
                    )}
                    {s.notes && (
                      <div style={{ padding: "8px 12px", background: ta("#c084fc", 0.04), border: "1px solid " + ta("#c084fc", 0.12), borderRadius: 8 }}>
                        <div style={{ fontSize: 10, color: "#c084fc", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>📝 DM Notes</div>
                        <div style={{ fontSize: 12, color: theme.textMuted, whiteSpace: "pre-line" }}>{s.notes}</div>
                      </div>
                    )}
                  </div>
                  {s.tags?.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 10 }}>
                      {s.tags.map((t) => <span key={t} style={{ ...tTag, fontSize: 10, padding: "2px 8px" }}>#{t}</span>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>)}
  </>);

  const renderNovel = () => (<>
          {view === "novel" && (
            <NovelWorkspace
              theme={theme} articles={articles} settings={settings} setSettings={setSettings}
              isMobile={isMobile} isTablet={isTablet} activeWorld={activeWorld}
              navigate={navigate} goEdit={goEdit} setView={setView} setActiveArticle={setActiveArticle}
              view={view} novelView={novelView} setNovelView={setNovelView}
              novelFocusMode={novelFocusMode} setNovelFocusMode={setNovelFocusMode}
              novelSplitPane={novelSplitPane} setNovelSplitPane={setNovelSplitPane}
              novelSplitSceneId={novelSplitSceneId} setNovelSplitSceneId={setNovelSplitSceneId}
              novelActiveScene={novelActiveScene} setNovelActiveScene={setNovelActiveScene}
              novelCodexSearch={novelCodexSearch} setNovelCodexSearch={setNovelCodexSearch}
              novelCodexFilter={novelCodexFilter} setNovelCodexFilter={setNovelCodexFilter}
              novelCodexExpanded={novelCodexExpanded} setNovelCodexExpanded={setNovelCodexExpanded}
              novelCodexVisible={novelCodexVisible} setNovelCodexVisible={setNovelCodexVisible}
              novelMention={novelMention} setNovelMention={setNovelMention}
              novelOutlineCollapsed={novelOutlineCollapsed} setNovelOutlineCollapsed={setNovelOutlineCollapsed}
              novelMsForm={novelMsForm} setNovelMsForm={setNovelMsForm}
              novelEditorSettings={novelEditorSettings} setNovelEditorSettings={setNovelEditorSettings}
              novelExportOpen={novelExportOpen} setNovelExportOpen={setNovelExportOpen}
              novelExportSettings={novelExportSettings} setNovelExportSettings={setNovelExportSettings}
              novelGoal={novelGoal} setNovelGoal={setNovelGoal}
              novelGoalInput={novelGoalInput} setNovelGoalInput={setNovelGoalInput}
              novelShowGoalSet={novelShowGoalSet} setNovelShowGoalSet={setNovelShowGoalSet}
              novelSnapshotView={novelSnapshotView} setNovelSnapshotView={setNovelSnapshotView}
              novelCompiling={novelCompiling}
              corkboardChapter={corkboardChapter} setCorkboardChapter={setCorkboardChapter}
              corkboardDragId={corkboardDragId} setCorkboardDragId={setCorkboardDragId}
              mentionTooltip={mentionTooltip} setMentionTooltip={setMentionTooltip}
              showMsCreate={showMsCreate} setShowMsCreate={setShowMsCreate}
              manuscripts={manuscripts} setManuscripts={setManuscripts}
              activeMs={activeMs} setActiveMs={setActiveMs}
              msWordCount={msWordCount} goalProgress={goalProgress} sessionWords={sessionWords}
              editorFontFamily={editorFontFamily} novelCodexArticles={novelCodexArticles}
              countWords={countWords} stripTags={stripTags} chapterWordCount={chapterWordCount}
              getActiveScene={getActiveScene} navigateScene={navigateScene}
              saveSnapshot={saveSnapshot} restoreSnapshot={restoreSnapshot}
              createManuscript={createManuscript} deleteManuscript={deleteManuscript}
              addChapter={addChapter} addScene={addScene} addAct={addAct}
              updateAct={updateAct} updateChapter={updateChapter} updateScene={updateScene}
              deleteAct={deleteAct} deleteChapter={deleteChapter} deleteScene={deleteScene}
              compileManuscript={compileManuscript} handleCorkDrop={handleCorkDrop}
              reorderActs={reorderActs} reorderChapters={reorderChapters} reorderScenes={reorderScenes}
              handleEditorClick={handleEditorClick}
              handleNovelInput={handleNovelInput} handleMentionKeyDown={handleMentionKeyDown}
              handleEditorMouseOver={handleEditorMouseOver}
              insertMention={insertMention} insertMentionFromSidebar={insertMentionFromSidebar}
              execFormat={execFormat} updateFormatState={updateFormatState} formatState={formatState}
              checkSceneIntegrity={checkSceneIntegrity}
              novelEditorRef={novelEditorRef} isComposingRef={isComposingRef}
              ta={ta} tBtnS={tBtnS} tBtnP={tBtnP} tTag={tTag}
              Ornament={Ornament} WarningBanner={WarningBanner} RenderBody={RenderBody} S={S}
              lower={lower} formatYear={formatYear} timeAgo={timeAgo}
            />
          )}
  </>);

  const renderSettings = () => (<>
          {view === "settings" && (<>
            <SettingsPanel
              theme={theme} settings={settings} setSettings={setSettings}
              settingsTab={settingsTab} setSettingsTab={setSettingsTab}
              isMobile={isMobile} articles={articles} archived={archived}
              manuscripts={manuscripts} setArticles={setArticles}
              setArchived={setArchived} setManuscripts={setManuscripts}
              activeWorld={activeWorld} user={user}
              setShowConfirm={setShowConfirm} setView={setView}
              avatarFileRef={avatarFileRef} uploadPortrait={uploadPortrait}
              supabase={supabase} formatYear={formatYear}
              ta={ta} tBtnS={tBtnS} tBtnP={tBtnP} Ornament={Ornament} S={S}
            />
            {/* Export/Import World Data */}
            {settingsTab === "world" && (
              <div style={{ maxWidth: 640, marginTop: 24, padding: "20px 24px", background: ta(theme.surface, 0.5), border: "1px solid " + theme.divider, borderRadius: 10 }}>
                <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 14, color: theme.text, margin: "0 0 12px", letterSpacing: 1 }}>📦 Export / Import World</h3>
                <p style={{ fontSize: 12, color: theme.textDim, marginBottom: 16, lineHeight: 1.5 }}>Back up your entire world as JSON, or import data from another export.</p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button onClick={exportWorldJSON} style={{ ...tBtnP, fontSize: 12, padding: "10px 20px" }}>⬇ Export World JSON</button>
                  <label style={{ ...tBtnS, fontSize: 12, padding: "10px 20px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                    ⬆ Import World JSON
                    <input type="file" accept=".json" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) importWorldJSON(e.target.files[0]); e.target.value = ""; }} />
                  </label>
                </div>
              </div>
            )}
          </>)}
  </>);

  const renderAIImport = () => (<>
          {view === "ai_import" && (
            <ImportPage
              theme={theme} settings={settings} isMobile={isMobile}
              aiParsing={aiParsing} aiParseError={aiParseError} setAiParseError={setAiParseError}
              aiSourceName={aiSourceName} aiProgress={aiProgress}
              aiFileRef={aiFileRef} handleAiFileUpload={handleAiFileUpload}
              parseDocumentWithAI={parseDocumentWithAI}
              setAiStaging={setAiStaging} setView={setView} setAiSourceName={setAiSourceName}
              ta={ta} tBtnS={tBtnS} tBtnP={tBtnP} Ornament={Ornament} WarningBanner={WarningBanner} S={S}
            />
          )}
  </>);

  const renderStaging = () => (<>
          {/* === STAGING AREA === */}
          {view === "staging" && (<div>
            <div style={{ marginTop: 24, marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: theme.text, margin: 0, letterSpacing: 1, display: "flex", alignItems: "center", gap: 10 }}>📋 Staging Area</h2>
                  <p style={{ fontSize: 13, color: theme.textDim, marginTop: 6 }}>{aiStaging.length} entries parsed{aiSourceName ? " from \"" + aiSourceName + "\"" : ""}</p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={stagingApproveAll} style={{ ...tBtnS, fontSize: 11, padding: "7px 14px", color: "#8ec8a0", border: "1px solid rgba(142,200,160,0.3)" }}>✓ Approve All Pending</button>
                  <button onClick={stagingRejectAll} style={{ ...tBtnS, fontSize: 11, padding: "7px 14px", color: "#e07050", border: "1px solid rgba(224,112,80,0.3)" }}>✕ Reject All Pending</button>
                  <button onClick={stagingCommit} disabled={!aiStaging.some((e) => e._status === "approved" || e._status === "edited")} style={{ ...tBtnP, fontSize: 11, padding: "8px 16px", opacity: aiStaging.some((e) => e._status === "approved" || e._status === "edited") ? 1 : 0.4 }}>Commit to Codex</button>
                  <button onClick={stagingDeleteRejected} disabled={!aiStaging.some((e) => e._status === "rejected")} style={{ ...tBtnS, fontSize: 11, padding: "7px 14px", color: "#e07050", border: "1px solid rgba(224,112,80,0.2)", opacity: aiStaging.some((e) => e._status === "rejected") ? 1 : 0.3 }}>🗑 Remove Rejected</button>
                  {aiStaging.length > 0 && <button onClick={stagingClearAll} style={{ ...tBtnS, fontSize: 11, padding: "7px 14px", color: theme.textDim }}>Clear All</button>}
                </div>
              </div>
            </div>
            <Ornament width={300} />

            {/* Status summary */}
            <div style={{ display: "flex", gap: 12, margin: "16px 0 20px" }}>
              {[
                { n: aiStaging.filter((e) => e._status === "pending").length, l: "Pending", c: theme.accent },
                { n: aiStaging.filter((e) => e._status === "approved" || e._status === "edited").length, l: "Approved", c: "#8ec8a0" },
                { n: aiStaging.filter((e) => e._status === "rejected").length, l: "Rejected", c: "#e07050" },
              ].map((s, i) => (
                <div key={i} style={{ padding: "8px 18px", background: s.c + "0c", border: "1px solid " + s.c + "25", borderRadius: 6, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: s.c, fontFamily: "'Cinzel', serif" }}>{s.n}</span>
                  <span style={{ fontSize: 11, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1 }}>{s.l}</span>
                </div>
              ))}
            </div>

            {aiStaging.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60, color: theme.textDim }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                <p style={{ fontSize: 16, fontFamily: "'Cinzel', serif" }}>No Entries in Staging</p>
                <p style={{ fontSize: 13, color: theme.textDim, marginTop: 4 }}>Use Document Import to parse a lore document.</p>
                <button onClick={() => setView("ai_import")} style={{ ...tBtnP, marginTop: 16, fontSize: 12 }}>Go to Document Import</button>
              </div>
            ) : (
              <div>{aiStaging.map((entry) => {
                const c = CATEGORIES[entry.category] || { label: "Unknown", icon: "?", color: "#888" };
                const stColor = entry._status === "approved" || entry._status === "edited" ? "#8ec8a0" : entry._status === "rejected" ? "#e07050" : theme.accent;
                return (
                  <div key={entry._stagingId} style={{ background: ta(theme.surface, 0.6), borderTop: "1px solid " + (entry._status === "rejected" ? "rgba(224,112,80,0.2)" : theme.divider), borderRight: "1px solid " + (entry._status === "rejected" ? "rgba(224,112,80,0.2)" : theme.divider), borderBottom: "1px solid " + (entry._status === "rejected" ? "rgba(224,112,80,0.2)" : theme.divider), borderLeft: "3px solid " + stColor, borderRadius: 8, padding: "16px 20px", marginBottom: 10, opacity: entry._status === "rejected" ? 0.5 : 1, transition: "all 0.3s" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                      <span style={{ fontSize: 20, color: c.color, marginTop: 2 }}>{c.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>{entry.title}</span>
                          {/* Category reassignment dropdown */}
                          <select
                            value={entry.category}
                            onChange={(e) => stagingEdit(entry._stagingId, "category", e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            style={{ fontSize: 10, fontFamily: "inherit", fontWeight: 600, padding: "2px 6px", borderRadius: 10, cursor: "pointer", color: c.color, background: c.color + "18", border: "1px solid " + c.color + "40", letterSpacing: 0.5, appearance: "auto" }}
                            title="Change category"
                          >
                            {Object.entries(CATEGORIES).map(([k, cat]) => (
                              <option key={k} value={k}>{cat.icon} {cat.label}</option>
                            ))}
                          </select>
                          <span style={{ ...S.catBadge(stColor), textTransform: "capitalize" }}>{entry._status === "edited" ? "✎ edited" : entry._status}</span>
                        </div>
                        <p style={{ fontSize: 12, color: theme.textMuted, margin: "0 0 8px", lineHeight: 1.5 }}>{entry.summary}</p>
                        {entry.fields && Object.keys(entry.fields).length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                            {Object.entries(entry.fields).slice(0, 4).map(([k, v]) => v ? (
                              <span key={k} style={{ fontSize: 10, color: theme.textDim, background: "rgba(85,102,119,0.1)", padding: "2px 8px", borderRadius: 8 }}>{formatKey(k)}: {typeof v === "string" ? v.slice(0, 40) : v}{typeof v === "string" && v.length > 40 ? "…" : ""}</span>
                            ) : null)}
                          </div>
                        )}
                        {entry.body && <p style={{ fontSize: 11, color: theme.textDim, margin: 0, lineHeight: 1.5 }}>{entry.body.slice(0, 200)}{entry.body.length > 200 ? "…" : ""}</p>}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                        {entry._status !== "approved" && entry._status !== "edited" && (
                          <button onClick={() => stagingApprove(entry._stagingId)} style={{ fontSize: 10, color: "#8ec8a0", background: "rgba(142,200,160,0.1)", border: "1px solid rgba(142,200,160,0.2)", borderRadius: 5, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>✓ Approve</button>
                        )}
                        {entry._status !== "rejected" && (
                          <button onClick={() => stagingReject(entry._stagingId)} style={{ fontSize: 10, color: "#e07050", background: "rgba(224,112,80,0.1)", border: "1px solid rgba(224,112,80,0.2)", borderRadius: 5, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>✕ Reject</button>
                        )}
                        {entry._status === "rejected" && (
                          <button onClick={() => stagingApprove(entry._stagingId)} style={{ fontSize: 10, color: theme.accent, background: ta(theme.accent, 0.1), border: "1px solid " + ta(theme.accent, 0.2), borderRadius: 5, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>↩ Restore</button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}</div>
            )}
          </div>)}
  </>);

  const renderSupportPage = () => (<>
          {view === "support_page" && (
            <SupportPage theme={theme} ta={ta} tBtnP={tBtnP} tBtnS={tBtnS} S={S} Ornament={Ornament} isMobile={isMobile} />
          )}
  </>);

  const renderCollaboration = () => (<>
          {view === "collaboration" && (
            <CollaborationPanel theme={theme} ta={ta} tBtnP={tBtnP} tBtnS={tBtnS} S={S} Ornament={Ornament}
              activeWorld={activeWorld} user={user} isMobile={isMobile}
              onWorldsRefresh={async () => {
                if (supabase && user) {
                  const worlds = await fetchWorlds(user.id);
                  setAllWorlds(worlds);
                }
              }} />
          )}
  </>);

  const renderCodex = () => (<>
          {/* === CODEX === */}
          {view === "codex" && (<div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 24, marginBottom: 16 }}>
              <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 20, color: theme.text, margin: 0, letterSpacing: 1 }}>{codexFilter === "all" ? "The Full Codex" : categoryPluralLabel(codexFilter)}</h2>
              <Ornament width={120} /><span style={{ fontSize: 12, color: theme.textMuted }}>{filtered.list.length} entries{searchQuery.trim() ? " matching \"" + searchQuery + "\"" : ""}{filtered.list.length > codexVisible ? " · showing " + Math.min(codexVisible, filtered.list.length) : ""}</span>
              <div style={{ marginLeft: "auto", flexShrink: 0, display: "flex", gap: 6, alignItems: "center" }}>
                <button onClick={() => { setCodexBulkMode((v) => !v); setCodexSelected(new Set()); }} style={{ ...tBtnS, fontSize: 11, padding: "7px 14px", color: codexBulkMode ? theme.accent : theme.textDim, border: "1px solid " + (codexBulkMode ? ta(theme.accent, 0.4) : theme.border), background: codexBulkMode ? ta(theme.accent, 0.08) : "transparent" }}>
                  {codexBulkMode ? "✓ Selecting" : "☐ Select"}
                </button>
                {codexFilter !== "all" ? (
                  <button onClick={() => goCreate(codexFilter)} style={{ ...tBtnP, fontSize: 11, padding: "7px 16px", display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> New {CATEGORIES[codexFilter]?.label}
                  </button>
                ) : (
                  <div style={{ position: "relative" }}>
                    <button onClick={() => setShowCodexCreate((v) => !v)} style={{ ...tBtnP, fontSize: 11, padding: "7px 16px", display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> New Entry <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
                    </button>
                    {showCodexCreate && (
                      <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: theme.cardBg, border: "1px solid " + theme.divider, borderRadius: 8, padding: "6px 0", zIndex: 50, minWidth: 180, boxShadow: "0 8px 24px rgba(0,0,0,0.3)" }}>
                        {Object.entries(CATEGORIES).filter(([k]) => !settings.disabledCategories.includes(k)).map(([k, c]) => (
                          <div key={k} role="menuitem" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowCodexCreate(false); goCreate(k); } }}
                            onClick={() => { setShowCodexCreate(false); goCreate(k); }}
                            style={{ fontSize: 12, color: c.color, padding: "8px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, transition: "background 0.1s" }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = ta(c.color, 0.1); }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                            <span style={{ fontSize: 14, width: 20, textAlign: "center" }}>{c.icon}</span> {c.label}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            {/* Category filter pills */}
            <div style={{ display: "flex", gap: 5, marginBottom: 12, flexWrap: "wrap" }}>
              {[{ key: "all", label: "All", color: theme.accent }, ...Object.entries(CATEGORIES).filter(([k]) => !settings.disabledCategories.includes(k)).map(([k, v]) => ({ key: k, label: v.label, color: v.color }))].map((f) => (
                <div key={f.key} role="button" tabIndex={0} aria-pressed={codexFilter === f.key} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCodexFilter(f.key); } }} onClick={() => setCodexFilter(f.key)} style={{ fontSize: 11, padding: "4px 12px", borderRadius: 20, cursor: "pointer", letterSpacing: 0.5, fontWeight: codexFilter === f.key ? 600 : 400, background: codexFilter === f.key ? f.color + "20" : "transparent", color: codexFilter === f.key ? f.color : theme.textDim, border: "1px solid " + (codexFilter === f.key ? f.color + "40" : theme.border), transition: "all 0.15s" }}>{f.label}</div>
              ))}
            </div>
            {/* Sort options bar */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, padding: "8px 14px", background: theme.cardBg, border: "1px solid " + theme.border, borderRadius: 8 }}>
              <span style={{ fontSize: 10, color: theme.textMuted, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", flexShrink: 0 }}>Sort</span>
              <div style={{ width: 1, height: 16, background: theme.border, flexShrink: 0 }} />
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {[
                  { id: "recent", label: "Most Recent" },
                  { id: "alpha_asc", label: "A → Z" },
                  { id: "alpha_desc", label: "Z → A" },
                  { id: "oldest", label: "Oldest" },
                  { id: "words", label: "Word Count" },
                  { id: "era", label: "Time Period" },
                  { id: "category", label: "Category" },
                ].map((s) => (
                  <button key={s.id} onClick={() => setCodexSort(s.id)}
                    style={{ padding: "5px 14px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "inherit", fontWeight: codexSort === s.id ? 600 : 400, letterSpacing: 0.3, border: "1px solid " + (codexSort === s.id ? theme.accent + "50" : "transparent"), background: codexSort === s.id ? theme.accentBg : "transparent", color: codexSort === s.id ? theme.accent : theme.textMuted, transition: "all 0.15s" }}>
                    {s.label}
                  </button>
                ))}
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 2, flexShrink: 0 }}>
                <button onClick={() => setCodexViewMode("list")} title="List view" style={{ padding: "5px 8px", borderRadius: "6px 0 0 6px", cursor: "pointer", fontSize: 13, fontFamily: "inherit", border: "1px solid " + (codexViewMode === "list" ? theme.accent + "50" : theme.border), background: codexViewMode === "list" ? theme.accentBg : "transparent", color: codexViewMode === "list" ? theme.accent : theme.textDim, transition: "all 0.15s" }}>☰</button>
                <button onClick={() => setCodexViewMode("grid")} title="Card view" style={{ padding: "5px 8px", borderRadius: "0 6px 6px 0", cursor: "pointer", fontSize: 13, fontFamily: "inherit", border: "1px solid " + (codexViewMode === "grid" ? theme.accent + "50" : theme.border), background: codexViewMode === "grid" ? theme.accentBg : "transparent", color: codexViewMode === "grid" ? theme.accent : theme.textDim, transition: "all 0.15s" }}>⊞</button>
              </div>
            </div>

            {/* Advanced filters bar — tag + reference filters */}
            {(codexTagFilter || codexRefFilter !== "all" || allTags.length > 0) && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, padding: "8px 14px", background: ta(theme.surface, 0.5), border: "1px solid " + theme.border, borderRadius: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, color: theme.textMuted, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", flexShrink: 0 }}>Filter</span>
                <div style={{ width: 1, height: 16, background: theme.border, flexShrink: 0 }} />
                {/* Tag filter */}
                <select value={codexTagFilter} onChange={(e) => setCodexTagFilter(e.target.value)}
                  style={{ background: theme.inputBg, border: "1px solid " + (codexTagFilter ? ta("#7ec8e3", 0.4) : theme.border), borderRadius: 6, fontSize: 11, color: codexTagFilter ? "#7ec8e3" : theme.textMuted, padding: "4px 8px", cursor: "pointer", outline: "none", fontFamily: "inherit" }}>
                  <option value="">All Tags</option>
                  {allTags.slice(0, 50).map((t) => (
                    <option key={t.tag} value={t.tag}>#{t.tag} ({t.count})</option>
                  ))}
                </select>
                {/* Reference filter */}
                <select value={codexRefFilter} onChange={(e) => setCodexRefFilter(e.target.value)}
                  style={{ background: theme.inputBg, border: "1px solid " + (codexRefFilter !== "all" ? ta("#c084fc", 0.4) : theme.border), borderRadius: 6, fontSize: 11, color: codexRefFilter !== "all" ? "#c084fc" : theme.textMuted, padding: "4px 8px", cursor: "pointer", outline: "none", fontFamily: "inherit" }}>
                  <option value="all">All References</option>
                  <option value="has_refs">Has Links</option>
                  <option value="orphans">Orphans (No Links)</option>
                  <option value="no_outgoing">No Outgoing Links</option>
                  <option value="no_incoming">No Incoming Links</option>
                </select>
                {/* Clear all filters */}
                {(codexTagFilter || codexRefFilter !== "all") && (
                  <button onClick={() => { setCodexTagFilter(""); setCodexRefFilter("all"); }}
                    style={{ fontSize: 10, color: "#e07050", background: "rgba(224,112,80,0.08)", border: "1px solid rgba(224,112,80,0.2)", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontFamily: "inherit" }}>
                    ✕ Clear Filters
                  </button>
                )}
                {/* Active filter count indicator */}
                {(codexTagFilter || codexRefFilter !== "all") && (
                  <span style={{ fontSize: 10, color: theme.accent, marginLeft: "auto" }}>
                    {[codexTagFilter ? "tag:" + codexTagFilter : "", codexRefFilter !== "all" ? "refs:" + codexRefFilter : ""].filter(Boolean).join(" + ")}
                  </span>
                )}
              </div>
            )}

            {/* Bulk action bar */}
            {codexBulkMode && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "8px 14px", background: ta(theme.accent, 0.06), border: "1px solid " + ta(theme.accent, 0.2), borderRadius: 8 }}>
                <span style={{ fontSize: 11, color: theme.accent, fontWeight: 600 }}>{codexSelected.size} selected</span>
                <button onClick={() => { const all = new Set(filtered.list.slice(0, codexVisible).map((a) => a.id)); setCodexSelected(codexSelected.size === all.size ? new Set() : all); }} style={{ ...tBtnS, fontSize: 10, padding: "4px 10px" }}>{codexSelected.size === filtered.list.slice(0, codexVisible).length ? "Deselect All" : "Select All"}</button>
                <div style={{ width: 1, height: 16, background: theme.border }} />
                {/* Bulk re-categorize */}
                <select disabled={codexSelected.size === 0} onChange={(e) => {
                  if (!e.target.value || codexSelected.size === 0) return;
                  const cat = e.target.value;
                  setArticles((prev) => prev.map((a) => codexSelected.has(a.id) ? { ...a, category: cat, updatedAt: new Date().toISOString() } : a));
                  setCodexSelected(new Set()); e.target.value = "";
                }} style={{ fontSize: 10, padding: "4px 8px", background: theme.inputBg, color: theme.text, border: "1px solid " + theme.border, borderRadius: 6, fontFamily: "inherit", cursor: "pointer", opacity: codexSelected.size === 0 ? 0.4 : 1 }}>
                  <option value="">↷ Move to…</option>
                  {Object.entries(CATEGORIES).map(([k, c]) => <option key={k} value={k}>{c.icon} {c.label}</option>)}
                </select>
                <button disabled={codexSelected.size === 0} onClick={() => {
                  const tag = prompt("Add tag to selected entries:");
                  if (!tag?.trim()) return;
                  setArticles((prev) => prev.map((a) => codexSelected.has(a.id) ? { ...a, tags: [...new Set([...(a.tags || []), tag.trim().toLowerCase()])], updatedAt: new Date().toISOString() } : a));
                }} style={{ ...tBtnS, fontSize: 10, padding: "4px 10px", opacity: codexSelected.size === 0 ? 0.4 : 1 }}>🏷 Tag</button>
                <button disabled={codexSelected.size === 0} onClick={() => {
                  if (!confirm("Archive " + codexSelected.size + " entries?")) return;
                  setArticles((prev) => prev.map((a) => codexSelected.has(a.id) ? { ...a, archived: true, updatedAt: new Date().toISOString() } : a));
                  setCodexSelected(new Set());
                }} style={{ ...tBtnS, fontSize: 10, padding: "4px 10px", color: theme.textDim, opacity: codexSelected.size === 0 ? 0.4 : 1 }}>📦 Archive</button>
                <button disabled={codexSelected.size === 0} onClick={() => {
                  if (!confirm("Delete " + codexSelected.size + " entries? This cannot be undone.")) return;
                  setArticles((prev) => prev.filter((a) => !codexSelected.has(a.id)));
                  setCodexSelected(new Set());
                }} style={{ ...tBtnS, fontSize: 10, padding: "4px 10px", color: "#e07050", opacity: codexSelected.size === 0 ? 0.4 : 1 }}>🗑 Delete</button>
              </div>
            )}

            {/* === LIST VIEW === */}
            {codexViewMode === "list" && filtered.list.slice(0, codexVisible).map((a) => { const ac = conflictsFor(a.id); const ci = codexIntegrityMap[a.id] || { errors: [], warnings: [] }; const aiErrors = ci.errors; const aiWarns = ci.warnings; const match = filtered.matchMap[a.id]; return (
              <div key={a.id} style={{ display: "flex", alignItems: "flex-start", gap: codexBulkMode ? 8 : 14, background: codexSelected.has(a.id) ? ta(theme.accent, 0.1) : ta(theme.surface, 0.6), border: "1px solid " + (codexSelected.has(a.id) ? ta(theme.accent, 0.3) : ac.length > 0 || aiErrors.length > 0 ? "rgba(224,112,80,0.3)" : aiWarns.length > 0 ? ta(theme.accent, 0.2) : theme.divider), borderRadius: 8, padding: "16px 20px", marginBottom: 8, cursor: "pointer", transition: "all 0.2s" }} role="link" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") { if (codexBulkMode) { setCodexSelected((prev) => { const next = new Set(prev); next.has(a.id) ? next.delete(a.id) : next.add(a.id); return next; }); } else navigate(a.id); } }} onClick={() => { if (codexBulkMode) { setCodexSelected((prev) => { const next = new Set(prev); next.has(a.id) ? next.delete(a.id) : next.add(a.id); return next; }); } else navigate(a.id); }}
                onMouseEnter={(e) => { e.currentTarget.style.background = codexSelected.has(a.id) ? ta(theme.accent, 0.15) : ta(theme.surface, 0.85); }} onMouseLeave={(e) => { e.currentTarget.style.background = codexSelected.has(a.id) ? ta(theme.accent, 0.1) : ta(theme.surface, 0.6); }}>
                {codexBulkMode && (
                  <div style={{ width: 20, height: 20, borderRadius: 4, border: "2px solid " + (codexSelected.has(a.id) ? theme.accent : theme.border), background: codexSelected.has(a.id) ? theme.accent : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2, transition: "all 0.15s" }}>
                    {codexSelected.has(a.id) && <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>✓</span>}
                  </div>
                )}
                {a.portrait ? (
                  <div style={{ width: 36, height: 36, borderRadius: 6, overflow: "hidden", border: "1px solid " + (CATEGORIES[a.category]?.color || "#888") + "40", flexShrink: 0, marginTop: 2 }}><img src={a.portrait} alt={a.title + " portrait"} style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
                ) : (
                  <div style={{ fontSize: 22, color: CATEGORIES[a.category]?.color, marginTop: 2 }}>{CATEGORIES[a.category]?.icon}</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>{searchQuery.trim() && lower(a.title).includes(lower(searchQuery)) ? (() => { const q = lower(searchQuery); const t = a.title; const idx = lower(t).indexOf(q); return <>{t.slice(0, idx)}<mark style={{ background: ta(theme.accent, 0.25), color: theme.accent, borderRadius: 2, padding: "0 1px" }}>{t.slice(idx, idx + searchQuery.length)}</mark>{t.slice(idx + searchQuery.length)}</>; })() : a.title}</span>
                    <span style={S.catBadge(CATEGORIES[a.category]?.color)}>{CATEGORIES[a.category]?.label}</span>
                    {ac.length > 0 && <span style={{ ...S.catBadge("#e07050"), gap: 3 }}>⚠ {ac.length} conflict{ac.length > 1 ? "s" : ""}</span>}
                    {aiErrors.length > 0 && <span style={{ ...S.catBadge("#e07050"), gap: 3 }}>🛡 {aiErrors.length} error{aiErrors.length > 1 ? "s" : ""}</span>}
                    {aiWarns.length > 0 && ac.length === 0 && aiErrors.length === 0 && <span style={{ ...S.catBadge(theme.accent), gap: 3 }}>🛡 {aiWarns.length} warning{aiWarns.length > 1 ? "s" : ""}</span>}
                  </div>
                  <p style={{ fontSize: 12, color: theme.textMuted, margin: 0, lineHeight: 1.5 }}>{searchQuery.trim() && a.summary && lower(a.summary).includes(lower(searchQuery)) ? (() => { const q = lower(searchQuery); const s = a.summary; const idx = lower(s).indexOf(q); return <>{s.slice(0, idx)}<mark style={{ background: ta(theme.accent, 0.25), color: theme.accent, borderRadius: 2, padding: "0 1px" }}>{s.slice(idx, idx + searchQuery.length)}</mark>{s.slice(idx + searchQuery.length)}</>; })() : a.summary}</p>
                  {/* Search match context */}
                  {match && match.where !== "title" && match.where !== "summary" && match.snippet && (
                    <div style={{ marginTop: 6, padding: "4px 10px", background: ta(theme.accent, 0.06), borderRadius: 4, borderLeft: "2px solid " + ta(theme.accent, 0.4) }}>
                      <span style={{ fontSize: 10, color: theme.accent, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginRight: 6 }}>
                        {match.where === "body" ? "📄 Body" : match.where === "fields" ? "📋 Fields" : match.where === "tags" ? "🏷 Tags" : match.where === "linked" ? "🔗 Linked" : ""}
                      </span>
                      <span style={{ fontSize: 11, color: theme.textMuted }}>
                        {(() => {
                          if (!searchQuery.trim()) return match.snippet;
                          const q = lower(searchQuery);
                          const snip = match.snippet;
                          const idx = lower(snip).indexOf(q);
                          if (idx === -1) return snip;
                          return <>{snip.slice(0, idx)}<mark style={{ background: ta(theme.accent, 0.25), color: theme.accent, borderRadius: 2, padding: "0 1px" }}>{snip.slice(idx, idx + searchQuery.length)}</mark>{snip.slice(idx + searchQuery.length)}</>;
                        })()}
                      </span>
                    </div>
                  )}
                  <div style={{ marginTop: 6 }}>{a.tags?.slice(0, 5).map((t) => <span key={t} style={tTag}>#{t}</span>)}</div>
                </div>
                <span style={{ fontSize: 11, color: theme.textDim, whiteSpace: "nowrap" }}>{timeAgo(a.updatedAt)}</span>
              </div>
            ); })}

            {/* === GRID / CARD VIEW === */}
            {codexViewMode === "grid" && (
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : isTablet ? "repeat(3, 1fr)" : "repeat(4, 1fr)", gap: 12 }}>
                {filtered.list.slice(0, codexVisible).map((a) => {
                  const catColor = CATEGORIES[a.category]?.color || theme.accent;
                  return (
                    <div key={a.id} role="link" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") navigate(a.id); }} onClick={() => navigate(a.id)}
                      style={{ background: ta(theme.surface, 0.6), border: "1px solid " + theme.divider, borderRadius: 10, overflow: "hidden", cursor: "pointer", transition: "all 0.25s", display: "flex", flexDirection: "column" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.surface, 0.85); e.currentTarget.style.border = "1px solid " + catColor + "60"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = ta(theme.surface, 0.6); e.currentTarget.style.border = "1px solid " + theme.divider; e.currentTarget.style.transform = "none"; }}>
                      {/* Card top accent */}
                      <div style={{ height: 3, background: catColor }} />
                      {/* Portrait or icon */}
                      {a.portrait ? (
                        <div style={{ width: "100%", height: 120, overflow: "hidden", background: ta(catColor, 0.06) }}>
                          <img src={a.portrait} alt={a.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        </div>
                      ) : (
                        <div style={{ width: "100%", height: 80, display: "flex", alignItems: "center", justifyContent: "center", background: ta(catColor, 0.06) }}>
                          <span style={{ fontSize: 36, color: catColor, opacity: 0.6 }}>{CATEGORIES[a.category]?.icon}</span>
                        </div>
                      )}
                      {/* Card body */}
                      <div style={{ padding: "10px 12px", flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, lineHeight: 1.3 }}>{a.title}</div>
                        <span style={{ ...S.catBadge(catColor), alignSelf: "flex-start", fontSize: 9 }}>{CATEGORIES[a.category]?.label}</span>
                        {a.summary && <p style={{ fontSize: 11, color: theme.textMuted, margin: 0, lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{a.summary}</p>}
                        <div style={{ marginTop: "auto", paddingTop: 6, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          {a.tags?.length > 0 && <span style={{ fontSize: 9, color: theme.textDim }}>#{a.tags[0]}{a.tags.length > 1 ? " +" + (a.tags.length - 1) : ""}</span>}
                          <span style={{ fontSize: 10, color: theme.textDim }}>{timeAgo(a.updatedAt)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {filtered.list.length > codexVisible && (
              <div style={{ textAlign: "center", padding: "16px 0" }}>
                <button onClick={() => setCodexVisible((v) => v + CODEX_PAGE)}
                  style={{ ...tBtnS, padding: "10px 32px", fontSize: 12, borderRadius: 8 }}>
                  Show more ({filtered.list.length - codexVisible} remaining)
                </button>
              </div>
            )}
            {filtered.list.length === 0 && <div style={{ textAlign: "center", padding: 60, color: theme.textDim }}><div style={{ fontSize: 32, marginBottom: 12 }}>⌕</div><p>{searchQuery.trim() ? "No entries matching \"" + searchQuery + "\"" : "No entries found."}</p></div>}
          </div>)}
  </>);

  const renderArticle = () => (<>
          {/* === ARTICLE VIEW === */}
          {view === "article" && activeArticle && (
            <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 0, overflow: isMobile ? "auto" : "hidden", margin: isMobile ? 0 : "0 -28px", height: isMobile ? "auto" : "calc(100vh - 56px)" }}>
              <div style={{ flex: 1, overflowY: isMobile ? "visible" : "auto", padding: isMobile ? "0 0 24px" : "0 28px 40px" }}>
                {/* Breadcrumbs */}
                <div style={{ fontSize: 11, color: theme.textDim, marginTop: 20, marginBottom: 16, display: "flex", alignItems: "center", gap: 6 }}>
                  <span role="link" tabIndex={0} style={{ cursor: "pointer", color: theme.textDim }} onKeyDown={(e) => { if (e.key === "Enter") goDash(); }} onClick={goDash}>Dashboard</span><span>›</span>
                  <span style={{ cursor: "pointer", color: theme.textDim }} onClick={() => goCodex(activeArticle.category)}>{categoryPluralLabel(activeArticle.category)}</span><span>›</span>
                  <span style={{ color: CATEGORIES[activeArticle.category]?.color }}>{activeArticle.title}</span>
                </div>

                {/* Hero header */}
                <div style={{ position: "relative", marginBottom: 24 }}>
                  <div style={{ display: "flex", alignItems: isMobile ? "center" : "flex-start", gap: isMobile ? 12 : 16, flexWrap: isMobile ? "wrap" : "nowrap" }}>
                    {activeArticle.portrait ? (
                      <div style={{ width: 80, height: 80, borderRadius: 8, overflow: "hidden", border: "2px solid " + (CATEGORIES[activeArticle.category]?.color || theme.accent) + "40", boxShadow: "0 4px 20px rgba(0,0,0,0.4)", flexShrink: 0 }}>
                        <img src={activeArticle.portrait} alt={activeArticle.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      </div>
                    ) : (
                      <div style={{ width: 64, height: 64, borderRadius: 8, background: ta(CATEGORIES[activeArticle.category]?.color || theme.accent, 0.1), border: "1px solid " + ta(CATEGORIES[activeArticle.category]?.color || theme.accent, 0.25), display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <span style={{ fontSize: 30, color: CATEGORIES[activeArticle.category]?.color }}>{CATEGORIES[activeArticle.category]?.icon}</span>
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h1 style={{ fontFamily: "'Cinzel', serif", fontSize: isMobile ? 20 : 24, fontWeight: 700, color: theme.text, margin: 0, letterSpacing: 1 }}>{activeArticle.title}</h1>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                        <span style={S.catBadge(CATEGORIES[activeArticle.category]?.color)}>{CATEGORIES[activeArticle.category]?.label}</span>
                        {activeArticle.temporal && <span style={{ fontSize: 10, color: theme.textDim, padding: "2px 8px", background: ta(theme.textDim, 0.08), borderRadius: 10 }}>⏳ {activeArticle.temporal.type}{activeArticle.temporal.active_start != null ? " · Year " + activeArticle.temporal.active_start : ""}{activeArticle.temporal.active_end != null ? "–" + activeArticle.temporal.active_end : ""}{activeArticle.temporal.death_year ? " · † " + activeArticle.temporal.death_year : ""}</span>}
                      </div>
                      <p style={{ fontSize: 14, color: theme.textMuted, fontStyle: "italic", lineHeight: 1.6, margin: "8px 0 0" }}>{activeArticle.summary}</p>
                    </div>
                  </div>
                  {/* Action buttons — own row to prevent squishing title/summary */}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 14, position: "relative" }}>
                    <button onClick={() => goEdit(activeArticle)} style={{ fontSize: 11, color: theme.accent, background: ta(theme.accent, 0.1), border: "1px solid " + ta(theme.accent, 0.25), borderRadius: 6, padding: "7px 16px", cursor: "pointer", fontFamily: "'Cinzel', serif", fontWeight: 600, letterSpacing: 0.5 }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.accent, 0.2); }} onMouseLeave={(e) => { e.currentTarget.style.background = ta(theme.accent, 0.1); }}>✎ Edit</button>
                    <button onClick={() => setShowMoveMenu(showMoveMenu === activeArticle.id ? null : activeArticle.id)} style={{ fontSize: 11, color: "#7ec8e3", background: "rgba(126,200,227,0.1)", border: "1px solid rgba(126,200,227,0.25)", borderRadius: 6, padding: "7px 16px", cursor: "pointer", fontFamily: "'Cinzel', serif", fontWeight: 600, letterSpacing: 0.5 }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(126,200,227,0.2)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(126,200,227,0.1)"; }}>↷ Move</button>
                    <button onClick={() => goDuplicate(activeArticle)} style={{ fontSize: 11, color: "#c084fc", background: "rgba(192,132,252,0.1)", border: "1px solid rgba(192,132,252,0.25)", borderRadius: 6, padding: "7px 16px", cursor: "pointer", fontFamily: "'Cinzel', serif", fontWeight: 600, letterSpacing: 0.5 }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(192,132,252,0.2)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(192,132,252,0.1)"; }}>⧉ Duplicate</button>
                    <button onClick={() => saveAsTemplate(activeArticle)} style={{ fontSize: 11, color: "#d4a060", background: "rgba(212,160,96,0.1)", border: "1px solid rgba(212,160,96,0.25)", borderRadius: 6, padding: "7px 16px", cursor: "pointer", fontFamily: "'Cinzel', serif", fontWeight: 600, letterSpacing: 0.5 }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(212,160,96,0.2)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(212,160,96,0.1)"; }}>📄 Template</button>
                    {showMoveMenu === activeArticle.id && (<>
                      <div style={{ position: "fixed", inset: 0, zIndex: 900 }} onClick={() => setShowMoveMenu(null)} />
                      <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: theme.surface, border: "1px solid " + theme.border, borderRadius: 10, padding: 6, minWidth: 200, zIndex: 901, boxShadow: "0 12px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)" }}>
                        <div style={{ padding: "6px 12px 8px", fontSize: 9, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 600 }}>Move to Category</div>
                        {Object.entries(CATEGORIES).filter(([k]) => k !== activeArticle.category).map(([k, cat]) => (
                          <div key={k} role="menuitem" tabIndex={0}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setArticles((prev) => prev.map((a) => a.id === activeArticle.id ? { ...a, category: k, updatedAt: new Date().toISOString() } : a)); setActiveArticle((prev) => ({ ...prev, category: k })); setShowMoveMenu(null); } }}
                            onClick={() => { setArticles((prev) => prev.map((a) => a.id === activeArticle.id ? { ...a, category: k, updatedAt: new Date().toISOString() } : a)); setActiveArticle((prev) => ({ ...prev, category: k })); setShowMoveMenu(null); }}
                            style={{ fontSize: 12, color: cat.color, padding: "9px 14px", cursor: "pointer", borderRadius: 6, display: "flex", alignItems: "center", gap: 10, transition: "background 0.1s" }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = cat.color + "18"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                            <span style={{ fontSize: 15, width: 20, textAlign: "center" }}>{cat.icon}</span> <span>{cat.label}</span>
                          </div>
                        ))}
                      </div>
                    </>)}
                    <button onClick={() => setShowDeleteModal(activeArticle)} style={{ fontSize: 11, color: "#e07050", background: "rgba(224,112,80,0.1)", border: "1px solid rgba(224,112,80,0.25)", borderRadius: 6, padding: "7px 16px", cursor: "pointer", fontFamily: "'Cinzel', serif", fontWeight: 600, letterSpacing: 0.5 }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(224,112,80,0.2)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(224,112,80,0.1)"; }}>🗑 Delete</button>
                  </div>
                  <Ornament width={260} />
                </div>

                {/* Conflicts & integrity warnings */}
                {conflictsFor(activeArticle.id).map((c) => (
                  <WarningBanner key={c.id} severity={c.severity} icon={c.severity === "error" ? "✕" : "⚠"} title="Canon Conflict Detected" style={{ marginTop: 16 }}>
                    <p style={{ margin: "0 0 6px" }}>{c.message}</p>
                    <p style={{ margin: 0, color: theme.textDim, fontStyle: "italic" }}>💡 {c.suggestion}</p>
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <span style={{ fontSize: 11, color: theme.accent, cursor: "pointer", textDecoration: "underline" }} onClick={() => navigate(c.targetId)}>View {c.targetTitle}</span>
                      <span style={{ fontSize: 11, color: theme.textDim, cursor: "pointer" }} onClick={() => setDismissedConflicts((p) => new Set([...p, c.id]))}>Dismiss</span>
                    </div>
                  </WarningBanner>
                ))}

                {/* Expanded integrity check */}
                {(() => {
                  const artWarnings = checkArticleIntegrity(activeArticle, articles, temporalGraph, activeArticle.id)
                    .filter((w) => w.type !== "orphan");
                  const actionable = artWarnings.filter((w) => w.severity === "error" || w.severity === "warning");
                  if (actionable.length === 0) return null;
                  return (
                    <WarningBanner severity={artWarnings.some((w) => w.severity === "error") ? "error" : "warning"} icon="🛡" title={"Lore Integrity: " + actionable.length + " issue" + (actionable.length !== 1 ? "s" : "")} style={{ marginTop: 12 }}>
                      {actionable.map((w, i) => {
                        const wKey = "av_" + i + "_" + (w.refId || "");
                        return (
                        <div key={wKey} style={{ padding: "4px 0", fontSize: 12 }}>
                          <div style={{ display: "flex", gap: 6, alignItems: "flex-start", color: w.severity === "error" ? "#e07050" : theme.accent, cursor: w.type === "broken_ref" && w.fuzzyMatches?.length > 0 ? "pointer" : "default" }}
                            onClick={() => { if (w.type === "broken_ref" && w.fuzzyMatches?.length > 0) setExpandedWarning(expandedWarning === wKey ? null : wKey); }}>
                            <span>{w.severity === "error" ? "⛔" : "⚠"}</span>
                            <div style={{ flex: 1 }}>
                              <div>{w.message}</div>
                              {w.type === "broken_ref" && w.fuzzyMatches?.length > 0 ? (
                                <div style={{ fontSize: 10, color: "#7ec8e3", marginTop: 3 }}>
                                  <span style={{ background: "rgba(126,200,227,0.15)", padding: "2px 8px", borderRadius: 8 }}>
                                    {expandedWarning === wKey ? "▾" : "▸"} {w.fuzzyMatches.length} possible match{w.fuzzyMatches.length !== 1 ? "es" : ""} — click to fix
                                  </span>
                                </div>
                              ) : (
                                w.suggestion && <div style={{ fontSize: 10, color: theme.textDim, marginTop: 1 }}>💡 {w.suggestion}</div>
                              )}
                            </div>
                          </div>
                          {expandedWarning === wKey && w.fuzzyMatches && (
                            <div style={{ marginLeft: 24, marginTop: 6, background: ta(theme.deepBg, 0.6), border: "1px solid " + theme.divider, borderRadius: 8, padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                              <div style={{ fontSize: 10, color: theme.textDim, marginBottom: 2 }}>Replace <span style={{ color: "#e07050", fontFamily: "monospace" }}>{(w.rawMention || "").replace(/_/g, " ")}</span> with:</div>
                              {w.fuzzyMatches.map((fm) => (
                                <div key={fm.article.id}
                                  onClick={() => {
                                    const richMention = "@[" + fm.article.title + "](" + fm.article.id + ")";
                                    setArticles((prev) => prev.map((a) => {
                                      if (a.id !== activeArticle.id) return a;
                                      let newBody = a.body || "";
                                      let replaced = false;

                                      // Try replacing the raw mention in the body
                                      if (w.rawMention) {
                                        // rawMention may be "@some_id" or "@[Title](id)" — use it directly
                                        if (newBody.includes(w.rawMention)) {
                                          newBody = newBody.replace(w.rawMention, richMention);
                                          replaced = true;
                                        }
                                        // Also try without leading @ if rawMention doesn't start with @
                                        if (!replaced) {
                                          const withAt = w.rawMention.startsWith("@") ? w.rawMention : "@" + w.rawMention;
                                          if (newBody.includes(withAt)) {
                                            newBody = newBody.replace(withAt, richMention);
                                            replaced = true;
                                          }
                                        }
                                      }
                                      // Fallback: try @refId pattern
                                      if (!replaced && w.refId) {
                                        const patterns = ["@" + w.refId, "@[" + w.refId + "]"];
                                        for (const pat of patterns) {
                                          if (newBody.includes(pat)) {
                                            newBody = newBody.replace(pat, richMention);
                                            replaced = true;
                                            break;
                                          }
                                        }
                                      }
                                      // HTML body fallback: DOM-based text node replacement
                                      if (!replaced && isHtmlBody(newBody) && w.refId) {
                                        const div = document.createElement("div");
                                        div.innerHTML = newBody;
                                        const searchTerms = [w.rawMention, "@" + w.refId, w.refId.replace(/_/g, " ")].filter(Boolean);
                                        let found = false;
                                        const walk = (node, term) => {
                                          if (found) return;
                                          if (node.nodeType === 3) {
                                            const idx = node.textContent.indexOf(term);
                                            if (idx !== -1) {
                                              node.textContent = node.textContent.substring(0, idx) + richMention + node.textContent.substring(idx + term.length);
                                              found = true;
                                            }
                                          }
                                          if (node.childNodes) for (const child of Array.from(node.childNodes)) walk(child, term);
                                        };
                                        for (const term of searchTerms) {
                                          walk(div, term);
                                          if (found) { newBody = div.innerHTML; replaced = true; break; }
                                        }
                                      }

                                      const newLinked = [...new Set([...(a.linkedIds || []), fm.article.id])];
                                      const updated = { ...a, body: newBody, linkedIds: newLinked, updatedAt: new Date().toISOString() };
                                      return updated;
                                    }));
                                    // Sync activeArticle so the view re-renders immediately
                                    setActiveArticle((prev) => {
                                      if (!prev || prev.id !== activeArticle.id) return prev;
                                      let newBody = prev.body || "";
                                      if (w.rawMention && newBody.includes(w.rawMention)) {
                                        newBody = newBody.replace(w.rawMention, richMention);
                                      } else if (w.rawMention) {
                                        const withAt = w.rawMention.startsWith("@") ? w.rawMention : "@" + w.rawMention;
                                        if (newBody.includes(withAt)) newBody = newBody.replace(withAt, richMention);
                                      }
                                      if (w.refId && newBody === (prev.body || "")) {
                                        const patterns = ["@" + w.refId, "@[" + w.refId + "]"];
                                        for (const pat of patterns) {
                                          if (newBody.includes(pat)) { newBody = newBody.replace(pat, richMention); break; }
                                        }
                                      }
                                      const newLinked = [...new Set([...(prev.linkedIds || []), fm.article.id])];
                                      return { ...prev, body: newBody, linkedIds: newLinked, updatedAt: new Date().toISOString() };
                                    });
                                    setExpandedWarning(null);
                                  }}
                                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", cursor: "pointer", borderRadius: 6, background: ta(theme.surface, 0.5), border: "1px solid " + theme.divider, transition: "all 0.15s" }}
                                  onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.accent, 0.1); e.currentTarget.style.border = "1px solid " + ta(theme.accent, 0.3); }}
                                  onMouseLeave={(e) => { e.currentTarget.style.background = ta(theme.surface, 0.5); e.currentTarget.style.border = "1px solid " + theme.divider; }}>
                                  <span style={{ fontSize: 14, color: CATEGORIES[fm.article.category]?.color }}>{CATEGORIES[fm.article.category]?.icon}</span>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 12, fontWeight: 600, color: theme.text }}>{fm.article.title}</div>
                                    <div style={{ fontSize: 10, color: theme.textDim }}>{CATEGORIES[fm.article.category]?.label} · {Math.round(fm.score * 100)}% match</div>
                                  </div>
                                  <span style={{ fontSize: 11, color: "#8ec8a0" }}>✓ Apply</span>
                                </div>
                              ))}
                              <span onClick={() => goEdit(activeArticle)} style={{ fontSize: 10, color: "#7ec8e3", cursor: "pointer", marginTop: 4, textDecoration: "underline" }}>
                                ✎ Edit in full editor
                              </span>
                            </div>
                          )}
                        </div>
                        );
                      })}
                    </WarningBanner>
                  );
                })()}

                {/* Body content */}
                <div className="article-body" style={{ fontSize: 14, color: theme.textMuted, lineHeight: 1.8, marginTop: 16 }}>
                  {isHtmlBody(activeArticle.body) ? (() => {
                    // HTML body — render with mention chips and collapsible sections
                    const mentionHtml = renderBodyWithMentions(activeArticle.body);
                    // Split by H2/H3 for collapsible sections
                    const sectionRegex = /(<h[23][^>]*>.*?<\/h[23]>)/gi;
                    const parts = mentionHtml.split(sectionRegex).filter(Boolean);
                    let tocIdx = 0;
                    return parts.map((part, i) => {
                      const headingMatch = part.match(/^<(h[23])[^>]*>(.*?)<\/\1>$/i);
                      if (headingMatch) {
                        const sectionId = "toc-" + tocIdx;
                        tocIdx++;
                        const isCollapsed = articleCollapsed.has(sectionId);
                        // Find the next part (the content after this heading)
                        const nextPart = parts[i + 1] && !parts[i + 1].match(/^<h[23]/i) ? parts[i + 1] : null;
                        return (
                          <div key={i} id={sectionId}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", userSelect: "none" }}
                              onClick={() => setArticleCollapsed((prev) => { const n = new Set(prev); n.has(sectionId) ? n.delete(sectionId) : n.add(sectionId); return n; })}>
                              <span style={{ fontSize: 10, color: theme.textDim, transition: "transform 0.2s", transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▾</span>
                              <span dangerouslySetInnerHTML={{ __html: part }} style={{ flex: 1 }} />
                            </div>
                            {nextPart && !isCollapsed && (
                              <div dangerouslySetInnerHTML={{ __html: nextPart }}
                                onClick={(e) => { const chip = e.target.closest(".mention-chip"); if (chip) navigate(chip.dataset.id); }}
                                style={{ cursor: "default" }} />
                            )}
                            {nextPart && isCollapsed && (
                              <div style={{ padding: "4px 0 4px 18px", fontSize: 11, color: theme.textDim, fontStyle: "italic" }}>Section collapsed — click heading to expand</div>
                            )}
                          </div>
                        );
                      }
                      // Skip parts that are consumed as "nextPart" by a heading
                      if (i > 0 && parts[i - 1]?.match(/^<h[23]/i)) return null;
                      return (
                        <div key={i} dangerouslySetInnerHTML={{ __html: part }}
                          onClick={(e) => { const chip = e.target.closest(".mention-chip"); if (chip) navigate(chip.dataset.id); }}
                          style={{ cursor: "default" }} />
                      );
                    });
                  })() : (
                    activeArticle.body?.split("\n").map((p, i) => <p key={i} style={{ margin: "0 0 14px" }}><RenderBody text={p} articles={articles} onNavigate={navigate} /></p>)
                  )}
                </div>

                {/* Tags */}
                {activeArticle.tags?.length > 0 && (
                  <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid " + theme.divider }}>
                    <span style={{ fontSize: 10, color: theme.textDim, marginRight: 8, textTransform: "uppercase", letterSpacing: 1 }}>Tags:</span>
                    {activeArticle.tags.map((t) => <span key={t} style={{ ...tTag, fontSize: 11, padding: "3px 10px" }}>#{t}</span>)}
                  </div>
                )}
                <div style={{ marginTop: 16, fontSize: 11, color: theme.textDim }}>Created {new Date(activeArticle.createdAt).toLocaleDateString()} · Updated {timeAgo(activeArticle.updatedAt)}</div>
              </div>

              {/* WORLD ANVIL–STYLE SIDEBAR */}
              <aside aria-label="Article details" style={{ width: isMobile ? "100%" : 300, minWidth: isMobile ? "auto" : 300, borderLeft: isMobile ? "none" : "1px solid " + theme.divider, borderTop: isMobile ? "1px solid " + theme.divider : "none", overflowY: "auto", padding: 0, background: ta(theme.deepBg, 0.4) }}>

                {/* Portrait (large, in sidebar) */}
                {activeArticle.portrait && (
                  <div style={{ padding: "16px 16px 0" }}>
                    <div style={{ borderRadius: 8, overflow: "hidden", border: "2px solid " + (CATEGORIES[activeArticle.category]?.color || theme.accent) + "40", boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }}>
                      <img src={activeArticle.portrait} alt={activeArticle.title} style={{ width: "100%", height: "auto", display: "block" }} />
                    </div>
                    <p style={{ fontSize: 9, color: theme.textDim, textAlign: "center", margin: "6px 0 0", textTransform: "uppercase", letterSpacing: 1 }}>{activeArticle.title}</p>
                  </div>
                )}

                {/* Table of Contents — generated from H2/H3 in body */}
                {(() => {
                  const toc = getBodyToc(activeArticle.body);
                  if (toc.length === 0) return null;
                  return (
                    <div style={{ margin: "12px 12px 0", borderRadius: 8, border: "1px solid " + theme.divider, overflow: "hidden" }}>
                      <div style={{ padding: "8px 14px", background: ta("#c084fc", 0.06), borderBottom: "1px solid " + theme.divider }}>
                        <span style={{ fontFamily: "'Cinzel', serif", fontSize: 11, fontWeight: 600, color: "#c084fc", letterSpacing: 1, textTransform: "uppercase" }}>Contents</span>
                      </div>
                      {toc.map((h) => (
                        <div key={h.id} onClick={() => { const el = document.getElementById(h.id); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                          style={{ padding: h.level === 3 ? "5px 14px 5px 28px" : "5px 14px", cursor: "pointer", fontSize: 11, color: theme.textMuted, borderBottom: "1px solid " + ta(theme.divider, 0.4), transition: "all 0.15s" }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = ta("#c084fc", 0.06); e.currentTarget.style.color = "#c084fc"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = theme.textMuted; }}>
                          {h.level === 3 ? "› " : ""}{h.text}
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* At a Glance — fields panel */}
                {activeArticle.fields && Object.entries(activeArticle.fields).filter(([_, v]) => v).length > 0 && (
                  <div style={{ margin: "12px 12px 0", borderRadius: 8, border: "1px solid " + theme.divider, overflow: "hidden" }}>
                    <div style={{ padding: "8px 14px", background: ta(theme.accent, 0.06), borderBottom: "1px solid " + theme.divider }}>
                      <span style={{ fontFamily: "'Cinzel', serif", fontSize: 11, fontWeight: 600, color: theme.accent, letterSpacing: 1, textTransform: "uppercase" }}>At a Glance</span>
                    </div>
                    {Object.entries(activeArticle.fields).filter(([_, v]) => v).map(([k, v], fi) => (
                      <div key={k} style={{ padding: "7px 14px", borderBottom: fi < Object.entries(activeArticle.fields).filter(([_, v]) => v).length - 1 ? "1px solid " + ta(theme.divider, 0.5) : "none", display: "flex", flexDirection: "column", gap: 1 }}>
                        <span style={{ fontSize: 9, color: theme.textDim, textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>{formatKey(k)}</span>
                        <span style={{ fontSize: 12, color: theme.text, lineHeight: 1.4, wordBreak: "break-word" }}>{v}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Temporal info */}
                {activeArticle.temporal && (
                  <div style={{ margin: "12px 12px 0", padding: "8px 12px", borderRadius: 8, background: ta(theme.textDim, 0.06), border: "1px solid " + theme.divider }}>
                    <span style={{ fontFamily: "'Cinzel', serif", fontSize: 9, fontWeight: 600, color: theme.textDim, letterSpacing: 1, textTransform: "uppercase" }}>Timeline</span>
                    <div style={{ marginTop: 4, fontSize: 11, color: theme.textMuted, lineHeight: 1.6 }}>
                      <div>⏳ {activeArticle.temporal.type}</div>
                      {activeArticle.temporal.active_start != null && <div>Active from: <span style={{ color: theme.text }}>Year {activeArticle.temporal.active_start}</span></div>}
                      {activeArticle.temporal.active_end != null && <div>Until: <span style={{ color: theme.text }}>Year {activeArticle.temporal.active_end}</span></div>}
                      {activeArticle.temporal.death_year && <div style={{ color: "#e07050" }}>† Year {activeArticle.temporal.death_year}</div>}
                    </div>
                  </div>
                )}

                {/* Related Articles */}
                <div style={{ padding: "12px 12px 0" }}>
                  <div style={{ padding: "8px 0 6px", borderBottom: "1px solid " + theme.divider, marginBottom: 8 }}>
                    <span style={{ fontFamily: "'Cinzel', serif", fontSize: 11, fontWeight: 600, color: theme.textMuted, letterSpacing: 1, textTransform: "uppercase" }}>Related Articles</span>
                    {activeArticle.linkedIds?.length > 0 && <span style={{ fontSize: 10, color: theme.textDim, marginLeft: 6 }}>({activeArticle.linkedIds.length})</span>}
                  </div>
                  {(!activeArticle.linkedIds || activeArticle.linkedIds.length === 0) && (
                    <p style={{ fontSize: 11, color: theme.textDim, fontStyle: "italic", margin: "4px 0 12px" }}>No linked articles yet.</p>
                  )}
                  {activeArticle.linkedIds?.map((lid) => { const lk = articles.find((a) => a.id === lid); if (!lk) return <div key={lid} style={{ ...tRelItem, opacity: 0.5, cursor: "default" }}><span style={{ fontSize: 12, color: theme.textDim }}>✦</span><span style={{ fontStyle: "italic" }}>{lid.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} (unwritten)</span></div>;
                    return <div key={lid} role="link" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") navigate(lid); }} style={tRelItem} onClick={() => navigate(lid)} onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.surface, 0.8); }} onMouseLeave={(e) => { e.currentTarget.style.background = ta(theme.surface, 0.5); }}><span style={{ fontSize: 14, color: CATEGORIES[lk.category]?.color }}>{CATEGORIES[lk.category]?.icon}</span><div style={{ flex: 1 }}><div style={{ fontWeight: 500, color: theme.text, fontSize: 12 }}>{lk.title}</div><div style={{ fontSize: 10, color: theme.textDim, marginTop: 1 }}>{CATEGORIES[lk.category]?.label}</div></div></div>;
                  })}
                </div>

                {/* Suggested Links */}
                {(() => { const sugs = findUnlinkedMentions(activeArticle.body, activeArticle.fields, articles, activeArticle.linkedIds || []); if (!sugs.length) return null; return (
                  <div style={{ padding: "0 12px" }}>
                    <div style={{ padding: "12px 0 6px", borderBottom: "1px solid " + theme.divider, marginBottom: 8 }}>
                      <span style={{ fontFamily: "'Cinzel', serif", fontSize: 11, fontWeight: 600, color: "#7ec8e3", letterSpacing: 1, textTransform: "uppercase" }}>💡 Suggested Links</span>
                    </div>
                    <p style={{ fontSize: 10, color: theme.textDim, margin: "0 0 8px" }}>Names found in text that may refer to codex entries. Click ✓ to link.</p>
                    {sugs.map((s) => <div key={s.article.id} style={{ ...tRelItem, borderLeft: "2px solid " + (s.confidence === "exact" ? "rgba(142,200,160,0.4)" : s.confidence === "strong" ? "rgba(126,200,227,0.3)" : ta(theme.accent, 0.2)), display: "flex", alignItems: "center" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(126,200,227,0.08)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = ta(theme.surface, 0.5); }}>
                      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => navigate(s.article.id)}>
                        <span style={{ fontSize: 14, color: CATEGORIES[s.article.category]?.color }}>{CATEGORIES[s.article.category]?.icon}</span>
                        <div><div style={{ fontWeight: 500, color: theme.text, fontSize: 12 }}>{s.article.title}</div><div style={{ fontSize: 10, color: s.confidence === "exact" ? "#8ec8a0" : s.confidence === "strong" ? "#7ec8e3" : theme.accent, marginTop: 1 }}>{s.label}</div></div>
                      </div>
                      <span title={"Link \"" + s.match + "\" to " + s.article.title + " in body text"}
                        onClick={(e) => {
                          e.stopPropagation();
                          const richMention = "@[" + s.article.title + "](" + s.article.id + ")";

                          const replaceInBody = (body) => {
                            if (!body) return richMention;
                            if (body.includes(richMention)) return body;

                            if (isHtmlBody(body)) {
                              // DOM-safe replacement for HTML bodies
                              const div = document.createElement("div");
                              div.innerHTML = body;
                              let replaced = false;
                              const searchTerms = [s.article.title, s?.matchText || s?.match || ""].filter(Boolean);
                              const walk = (node, term) => {
                                if (replaced) return;
                                if (node.nodeType === 3) {
                                  const idx = node.textContent.toLowerCase().indexOf(term.toLowerCase());
                                  if (idx !== -1) {
                                    const parent = node.parentElement;
                                    if (parent && parent.closest?.("[data-id]")) return; // skip existing mentions
                                    node.textContent = node.textContent.substring(0, idx) + richMention + node.textContent.substring(idx + term.length);
                                    replaced = true;
                                  }
                                }
                                if (node.childNodes) for (const child of Array.from(node.childNodes)) walk(child, term);
                              };
                              for (const term of searchTerms) {
                                if (term) walk(div, term);
                                if (replaced) return div.innerHTML;
                              }
                              return body + "<p>" + richMention + "</p>";
                            }

                            // Plain text body
                            const titleLower = lower(s?.article?.title);
                            const bodyLower = lower(body);
                            const titleIdx = bodyLower.indexOf(titleLower);
                            if (titleIdx !== -1) return body.substring(0, titleIdx) + richMention + body.substring(titleIdx + s.article.title.length);
                            const searchText = lower(s?.matchText || s?.match || "");
                            const matchIdx = searchText ? bodyLower.indexOf(searchText) : -1;
                            if (matchIdx !== -1) return body.substring(0, matchIdx) + richMention + body.substring(matchIdx + searchText.length);
                            return body + "\n\n" + richMention;
                          };

                          setArticles((prev) => prev.map((a) => {
                            if (a.id !== activeArticle.id) return a;
                            const newBody = replaceInBody(a.body);
                            return { ...a, body: newBody, linkedIds: [...new Set([...(a.linkedIds || []), s.article.id])], updatedAt: new Date().toISOString() };
                          }));
                          // Sync activeArticle
                          setActiveArticle((prev) => {
                            if (!prev || prev.id !== activeArticle.id) return prev;
                            const newBody = replaceInBody(prev.body);
                            return { ...prev, body: newBody, linkedIds: [...new Set([...(prev.linkedIds || []), s.article.id])], updatedAt: new Date().toISOString() };
                          });
                        }}
                        style={{ fontSize: 11, color: "#8ec8a0", cursor: "pointer", padding: "3px 8px", borderRadius: 6, background: "rgba(142,200,160,0.1)", border: "1px solid rgba(142,200,160,0.2)", fontWeight: 600, whiteSpace: "nowrap" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(142,200,160,0.25)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(142,200,160,0.1)"; }}>
                        ✓ Link
                      </span>
                    </div>)}
                  </div>
                ); })()}

                {/* Referenced By (back-links) */}
                {(() => { const br = articles.filter((a) => a.id !== activeArticle.id && a.linkedIds?.includes(activeArticle.id)); if (!br.length) return null; return (
                  <div style={{ padding: "0 12px" }}>
                    <div style={{ padding: "12px 0 6px", borderBottom: "1px solid " + theme.divider, marginBottom: 8 }}>
                      <span style={{ fontFamily: "'Cinzel', serif", fontSize: 11, fontWeight: 600, color: theme.textMuted, letterSpacing: 1, textTransform: "uppercase" }}>Referenced By</span>
                      <span style={{ fontSize: 10, color: theme.textDim, marginLeft: 6 }}>({br.length})</span>
                    </div>
                    {br.map((r) => <div key={r.id} role="link" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") navigate(r.id); }} style={tRelItem} onClick={() => navigate(r.id)} onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.surface, 0.8); }} onMouseLeave={(e) => { e.currentTarget.style.background = ta(theme.surface, 0.5); }}>
                      <span style={{ fontSize: 14, color: CATEGORIES[r.category]?.color }}>{CATEGORIES[r.category]?.icon}</span>
                      <div><div style={{ fontWeight: 500, color: theme.text, fontSize: 12 }}>{r.title}</div><div style={{ fontSize: 10, color: theme.textDim, marginTop: 1 }}>{CATEGORIES[r.category]?.label}</div></div>
                    </div>)}
                  </div>
                ); })()}

                {/* Suggested Related Articles (by shared tags/category) */}
                {(() => {
                  const related = getRelatedArticles(activeArticle.id);
                  if (related.length === 0) return null;
                  return (
                    <div style={{ padding: "0 12px" }}>
                      <div style={{ padding: "12px 0 6px", borderBottom: "1px solid " + theme.divider, marginBottom: 8 }}>
                        <span style={{ fontFamily: "'Cinzel', serif", fontSize: 11, fontWeight: 600, color: "#c084fc", letterSpacing: 1, textTransform: "uppercase" }}>✦ Related</span>
                        <span style={{ fontSize: 10, color: theme.textDim, marginLeft: 6 }}>({related.length})</span>
                      </div>
                      <p style={{ fontSize: 10, color: theme.textDim, margin: "0 0 6px" }}>Based on shared tags and category</p>
                      {related.map((r) => (
                        <div key={r.article.id} role="link" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") navigate(r.article.id); }}
                          style={tRelItem} onClick={() => navigate(r.article.id)}
                          onMouseEnter={(e) => { e.currentTarget.style.background = ta("#c084fc", 0.08); }} onMouseLeave={(e) => { e.currentTarget.style.background = ta(theme.surface, 0.5); }}>
                          <span style={{ fontSize: 14, color: CATEGORIES[r.article.category]?.color }}>{CATEGORIES[r.article.category]?.icon}</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 500, color: theme.text, fontSize: 12 }}>{r.article.title}</div>
                            <div style={{ fontSize: 10, color: theme.textDim, marginTop: 1 }}>{CATEGORIES[r.article.category]?.label}</div>
                          </div>
                          <span style={{ fontSize: 9, color: "#c084fc", opacity: 0.6 }}>✦</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Tags (clickable) */}
                {activeArticle.tags?.length > 0 && (
                  <div style={{ padding: "0 12px 16px" }}>
                    <div style={{ padding: "12px 0 6px", borderBottom: "1px solid " + theme.divider, marginBottom: 8 }}>
                      <span style={{ fontFamily: "'Cinzel', serif", fontSize: 11, fontWeight: 600, color: theme.textMuted, letterSpacing: 1, textTransform: "uppercase" }}>Tags</span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{activeArticle.tags.map((t) => <span key={t} role="link" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") { setSearchQuery(t); goCodex("all"); } }} style={{ ...tTag, cursor: "pointer", fontSize: 11, padding: "3px 10px" }} onClick={() => { setSearchQuery(t); goCodex("all"); }}>#{t}</span>)}</div>
                  </div>
                )}

                {/* Version History */}
                {(() => {
                  const history = getArticleHistory(activeArticle.id);
                  if (history.length === 0) return null;
                  return (
                    <div style={{ padding: "0 12px 16px" }}>
                      <div style={{ padding: "12px 0 6px", borderBottom: "1px solid " + theme.divider, marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
                        onClick={() => setShowVersionHistory((v) => !v)}>
                        <span style={{ fontFamily: "'Cinzel', serif", fontSize: 11, fontWeight: 600, color: theme.textMuted, letterSpacing: 1, textTransform: "uppercase" }}>Version History</span>
                        <span style={{ fontSize: 10, color: theme.textDim }}>{showVersionHistory ? "▾" : "▸"} {history.length}</span>
                      </div>
                      {showVersionHistory && history.slice(0, 10).map((snap, i) => (
                        <div key={i} style={{ padding: "6px 8px", marginBottom: 4, background: ta(theme.surface, 0.4), borderRadius: 6, border: "1px solid " + theme.divider, fontSize: 11 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ color: theme.textMuted }}>{timeAgo(snap.savedAt)}</span>
                            <button onClick={() => {
                              if (confirm("Restore this version? Current content will be saved as a new snapshot first.")) {
                                saveArticleSnapshot(activeArticle.id, activeArticle);
                                restoreArticleVersion(activeArticle.id, snap);
                              }
                            }} style={{ fontSize: 9, color: "#8ec8a0", background: "rgba(142,200,160,0.1)", border: "1px solid rgba(142,200,160,0.15)", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontFamily: "inherit" }}>Restore</button>
                          </div>
                          <div style={{ color: theme.textDim, fontSize: 10, marginTop: 2 }}>{snap.title}{snap.body ? " · " + snap.body.slice(0, 60) + (snap.body.length > 60 ? "…" : "") : ""}</div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </aside>
            </div>
          )}
  </>);

  const renderCreateEdit = () => (<>
          {/* === CREATE / EDIT === */}
          {view === "create" && createCat && (<div style={{ maxWidth: 680, marginTop: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <span style={{ fontSize: 24, color: CATEGORIES[createCat]?.color }}>{CATEGORIES[createCat]?.icon}</span>
              <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 20, color: theme.text, margin: 0 }}>{editingId ? "Edit" : "New"} {CATEGORIES[createCat]?.label}</h2>
              {editingId && <span style={{ fontSize: 11, color: theme.textDim, background: "rgba(85,102,119,0.15)", padding: "3px 10px", borderRadius: 10 }}>Editing: {editingId}</span>}
            </div>
            <Ornament width={260} />
            <div style={{ marginTop: 20 }}>
              {/* Template picker — only when creating new */}
              {!editingId && (() => {
                const templates = loadTemplates().filter((t) => t.category === createCat);
                if (templates.length === 0) return null;
                return (
                  <div style={{ marginBottom: 20, padding: "12px 16px", background: ta(theme.surface, 0.5), border: "1px solid " + ta("#d4a060", 0.2), borderRadius: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <span style={{ fontFamily: "'Cinzel', serif", fontSize: 11, fontWeight: 600, color: "#d4a060", letterSpacing: 1, textTransform: "uppercase" }}>📄 Templates</span>
                      <span style={{ fontSize: 10, color: theme.textDim }}>{templates.length} available</span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {templates.map((tmpl) => (
                        <div key={tmpl.id} style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(212,160,96,0.08)", border: "1px solid rgba(212,160,96,0.2)", borderRadius: 8, padding: "6px 10px", cursor: "pointer", transition: "all 0.2s" }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(212,160,96,0.18)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(212,160,96,0.08)"; }}>
                          <span onClick={() => applyTemplate(tmpl)} style={{ fontSize: 12, color: "#d4a060", fontWeight: 500 }}>{tmpl.name}</span>
                          <span onClick={(e) => { e.stopPropagation(); deleteTemplate(tmpl.id); }} title="Delete template" style={{ fontSize: 10, color: "#e07050", cursor: "pointer", opacity: 0.6, marginLeft: 4 }}
                            onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }} onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.6"; }}>✕</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 11, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Title</label>
                <input style={{ ...S.input, ...(liveDupes.length > 0 ? { border: "1px solid #e07050" } : {}) }} value={formData.title} onChange={(e) => setFormData((p) => ({ ...p, title: e.target.value }))} placeholder={`Name this ${safeText(CATEGORIES?.[createCat]?.label ?? CATEGORIES?.[createCat] ?? "")}...`} />
                {liveDupes.length > 0 && <WarningBanner severity="error" icon="⚠" title="Potential Duplicates Found" style={{ marginTop: 8 }}>
                  <p style={{ margin: "0 0 8px" }}>Saving will require confirmation. Similar entries:</p>
                  {liveDupes.map((d) => <div key={d.article.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                    <span style={{ color: CATEGORIES[d.article.category]?.color }}>{CATEGORIES[d.article.category]?.icon}</span>
                    <span style={{ color: theme.text, fontWeight: 500, cursor: "pointer" }} onClick={() => navigate(d.article.id)}>{d.article.title}</span>
                    <span style={{ color: "#e07050", fontSize: 11 }}>({Math.round(d.score * 100)}%)</span>
                  </div>)}
                </WarningBanner>}
              </div>
              <div style={{ marginBottom: 16 }}><label style={{ display: "block", fontSize: 11, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Summary</label><input style={S.input} value={formData.summary} onChange={(e) => setFormData((p) => ({ ...p, summary: e.target.value }))} placeholder="A brief description..." /></div>

              {/* Portrait Upload */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: 11, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Portrait / Image <span style={{ fontWeight: 400, color: theme.textDim }}>— optional</span></label>
                <input ref={portraitFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 2 * 1024 * 1024) { alert("Image must be under 2MB"); return; }
                  const reader = new FileReader();
                  reader.onload = (ev) => setFormData((p) => ({ ...p, portrait: ev.target.result }));
                  reader.readAsDataURL(file);
                  e.target.value = "";
                }} />
                <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                  {formData.portrait ? (
                    <div style={{ position: "relative" }}>
                      <div style={{ width: 120, height: 120, borderRadius: 8, overflow: "hidden", border: "2px solid " + (CATEGORIES[createCat]?.color || theme.accent) + "40" }}>
                        <img src={formData.portrait} alt="Portrait" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      </div>
                      <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                        <button type="button" onClick={() => portraitFileRef.current?.click()} style={{ fontSize: 10, color: "#7ec8e3", background: "rgba(126,200,227,0.1)", border: "1px solid rgba(126,200,227,0.2)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontFamily: "inherit" }}>Replace</button>
                        <button type="button" onClick={() => setFormData((p) => ({ ...p, portrait: null }))} style={{ fontSize: 10, color: "#e07050", background: "rgba(224,112,80,0.1)", border: "1px solid rgba(224,112,80,0.2)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontFamily: "inherit" }}>Remove</button>
                      </div>
                    </div>
                  ) : (
                    <div onClick={() => portraitFileRef.current?.click()} style={{
                      width: 120, height: 120, borderRadius: 8, border: "2px dashed " + ta(theme.accent, 0.2),
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", background: ta(theme.surface, 0.4), transition: "all 0.2s",
                    }}
                      onMouseEnter={(e) => { e.currentTarget.style.border = "1px solid " + ta(theme.accent, 0.5); e.currentTarget.style.background = ta(theme.accent, 0.04); }}
                      onMouseLeave={(e) => { e.currentTarget.style.border = "1px solid " + ta(theme.accent, 0.2); e.currentTarget.style.background = ta(theme.surface, 0.4); }}>
                      <span style={{ fontSize: 24, color: theme.textDim, marginBottom: 4 }}>📷</span>
                      <span style={{ fontSize: 10, color: theme.textDim }}>Add Image</span>
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: theme.textDim, lineHeight: 1.5, paddingTop: 4 }}>
                    Upload a portrait, depiction, map, or symbol for this entry.<br />
                    Supports JPG, PNG, GIF, WebP. Max 2MB.
                  </div>
                </div>
              </div>

              <p style={{ fontFamily: "'Cinzel', serif", fontSize: 13, fontWeight: 600, color: theme.text, marginTop: 24, marginBottom: 16, letterSpacing: 1 }}>◈ Template Fields</p>
              {TEMPLATE_FIELDS[createCat]?.map((fk) => (
                <div key={fk} style={{ marginBottom: 16 }}><label style={{ display: "block", fontSize: 11, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>{formatKey(fk)}</label><input style={S.input} value={formData.fields[fk] || ""} onChange={(e) => setFormData((p) => ({ ...p, fields: { ...p.fields, [fk]: e.target.value } }))} placeholder={`Enter ${lower(formatKey(fk))}...`} /></div>
              ))}

              {/* Temporal override for deity/magic/race */}
              {(createCat === "deity" || createCat === "magic" || createCat === "race") && (<>
                <p style={{ fontFamily: "'Cinzel', serif", fontSize: 13, fontWeight: 600, color: theme.text, marginTop: 24, marginBottom: 16, letterSpacing: 1 }}>⏳ Temporal Data <span style={{ fontWeight: 400, fontSize: 11, color: theme.textDim }}>— for conflict detection</span></p>
                <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: 11, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Type</label>
                    <select style={{ ...S.input, cursor: "pointer" }} value={formData.temporal?.type || ""} onChange={(e) => setFormData((p) => ({ ...p, temporal: { ...(p.temporal || {}), type: e.target.value } }))}>
                      <option value="">None</option><option value="immortal">Immortal</option><option value="race">Race</option><option value="concept">Concept</option><option value="mortal">Mortal</option>
                    </select>
                  </div>
                  <div style={{ flex: 1 }}><label style={{ display: "block", fontSize: 11, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Active From (Year)</label><input style={S.input} type="number" value={formData.temporal?.active_start ?? ""} onChange={(e) => setFormData((p) => ({ ...p, temporal: { ...(p.temporal || {}), active_start: e.target.value ? parseInt(e.target.value) : null } }))} /></div>
                  <div style={{ flex: 1 }}><label style={{ display: "block", fontSize: 11, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Active Until (Year)</label><input style={S.input} type="number" value={formData.temporal?.active_end ?? ""} onChange={(e) => setFormData((p) => ({ ...p, temporal: { ...(p.temporal || {}), active_end: e.target.value ? parseInt(e.target.value) : null } }))} /></div>
                </div>
              </>)}

              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <label style={{ fontSize: 11, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>Body <span style={{ fontWeight: 400, color: theme.textDim }}>— rich text editor</span></label>
                  <button onClick={() => { flushArticleBody(); setArticlePreviewMode((p) => !p); }}
                    style={{ fontSize: 10, padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", background: articlePreviewMode ? ta("#c084fc", 0.15) : "transparent", border: "1px solid " + (articlePreviewMode ? "rgba(192,132,252,0.3)" : theme.border), color: articlePreviewMode ? "#c084fc" : theme.textDim }}>
                    {articlePreviewMode ? "✎ Edit" : "👁 Preview"}
                  </button>
                </div>
                {/* Formatting toolbar */}
                {!articlePreviewMode && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 2, padding: "6px 8px", background: ta(theme.surface, 0.6), borderTop: "1px solid " + theme.border, borderRight: "1px solid " + theme.border, borderLeft: "1px solid " + theme.border, borderBottom: "none", borderRadius: "8px 8px 0 0", alignItems: "center" }}>
                    {[
                      { cmd: "bold", icon: "B", title: "Bold", style: { fontWeight: 700 } },
                      { cmd: "italic", icon: "I", title: "Italic", style: { fontStyle: "italic" } },
                      { cmd: "strikeThrough", icon: "S̶", title: "Strikethrough" },
                    ].map((b) => (
                      <button key={b.cmd} title={b.title} onClick={() => execArticleCmd(b.cmd)}
                        style={{ background: "none", border: "1px solid transparent", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 12, color: theme.textMuted, fontFamily: "inherit", minWidth: 28, ...b.style }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.accent, 0.1); e.currentTarget.style.borderColor = ta(theme.accent, 0.2); }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.borderColor = "transparent"; }}>
                        {b.icon}
                      </button>
                    ))}
                    <div style={{ width: 1, height: 18, background: theme.divider, margin: "0 4px" }} />
                    <button title="Heading 2" onClick={() => execArticleCmd("formatBlock", "h2")}
                      style={{ background: "none", border: "1px solid transparent", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11, color: theme.textMuted, fontFamily: "'Cinzel', serif", fontWeight: 700 }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.accent, 0.1); }} onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}>H2</button>
                    <button title="Heading 3" onClick={() => execArticleCmd("formatBlock", "h3")}
                      style={{ background: "none", border: "1px solid transparent", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11, color: theme.textMuted, fontFamily: "'Cinzel', serif", fontWeight: 600 }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.accent, 0.1); }} onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}>H3</button>
                    <button title="Normal paragraph" onClick={() => execArticleCmd("formatBlock", "p")}
                      style={{ background: "none", border: "1px solid transparent", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 10, color: theme.textDim, fontFamily: "inherit" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.accent, 0.1); }} onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}>¶</button>
                    <div style={{ width: 1, height: 18, background: theme.divider, margin: "0 4px" }} />
                    <button title="Blockquote" onClick={() => execArticleCmd("formatBlock", "blockquote")}
                      style={{ background: "none", border: "1px solid transparent", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 13, color: theme.textMuted }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.accent, 0.1); }} onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}>❝</button>
                    <button title="Bullet list" onClick={() => execArticleCmd("insertUnorderedList")}
                      style={{ background: "none", border: "1px solid transparent", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 12, color: theme.textMuted }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.accent, 0.1); }} onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}>•≡</button>
                    <button title="Numbered list" onClick={() => execArticleCmd("insertOrderedList")}
                      style={{ background: "none", border: "1px solid transparent", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 12, color: theme.textMuted }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.accent, 0.1); }} onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}>1.</button>
                    <button title="Horizontal rule" onClick={() => execArticleCmd("insertHorizontalRule")}
                      style={{ background: "none", border: "1px solid transparent", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 12, color: theme.textMuted }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.accent, 0.1); }} onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}>─</button>
                    <div style={{ width: 1, height: 18, background: theme.divider, margin: "0 4px" }} />
                    <button title="Insert image" onClick={() => articleImageRef.current?.click()}
                      style={{ background: "none", border: "1px solid transparent", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 12, color: theme.textMuted }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.accent, 0.1); }} onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}>🖼</button>
                    <div style={{ position: "relative" }}>
                      <button title="Insert table" onClick={() => setArticleTablePicker((p) => !p)}
                        style={{ background: articleTablePicker ? ta(theme.accent, 0.1) : "none", border: "1px solid " + (articleTablePicker ? ta(theme.accent, 0.2) : "transparent"), borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 12, color: theme.textMuted }}
                        onMouseEnter={(e) => { if (!articleTablePicker) e.currentTarget.style.background = ta(theme.accent, 0.1); }} onMouseLeave={(e) => { if (!articleTablePicker) e.currentTarget.style.background = "none"; }}>⊞</button>
                      {articleTablePicker && (<>
                        <div style={{ position: "fixed", inset: 0, zIndex: 900 }} onClick={() => setArticleTablePicker(false)} />
                        <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, background: theme.surface, border: "1px solid " + theme.border, borderRadius: 8, padding: 10, zIndex: 901, boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
                          <div style={{ fontSize: 10, color: theme.textDim, marginBottom: 6, fontWeight: 600 }}>Table Size</div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 20px)", gap: 2 }}>
                            {Array.from({ length: 25 }, (_, i) => {
                              const r = Math.floor(i / 5) + 1;
                              const c = (i % 5) + 1;
                              return (
                                <div key={i} onClick={() => insertArticleTable(r, c)}
                                  style={{ width: 20, height: 20, borderRadius: 3, border: "1px solid " + theme.border, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, color: theme.textDim, transition: "all 0.1s" }}
                                  onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.accent, 0.2); e.currentTarget.style.borderColor = theme.accent; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = theme.border; }}
                                  title={r + "×" + c}>
                                </div>
                              );
                            })}
                          </div>
                          <div style={{ fontSize: 9, color: theme.textDim, marginTop: 4, textAlign: "center" }}>Click to insert</div>
                        </div>
                      </>)}
                    </div>
                    <button title="Insert @mention link" onClick={() => {
                      const title = prompt("Enter the codex entry title to link:");
                      if (!title) return;
                      const match = articles.find((a) => lower(a.title) === lower(title));
                      if (match) {
                        articleBodyRef.current?.focus();
                        document.execCommand("insertHTML", false, `@[${match.title}](${match.id})`);
                        handleArticleBodyInput();
                      } else {
                        articleBodyRef.current?.focus();
                        document.execCommand("insertText", false, "@" + title);
                        handleArticleBodyInput();
                      }
                    }}
                      style={{ background: "none", border: "1px solid transparent", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 12, color: theme.textMuted, fontWeight: 700 }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.accent, 0.1); }} onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}>@</button>
                  </div>
                )}
                {/* Hidden image file input */}
                <input ref={articleImageRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleArticleImageUpload(file);
                  e.target.value = "";
                }} />
                {/* Editor or Preview */}
                {articlePreviewMode ? (
                  <div className="article-body" style={{ ...S.textarea, minHeight: 200, fontFamily: editorFontFamily, fontSize: 13, lineHeight: 1.8, padding: "16px 20px", borderRadius: "8px" }}>
                    {isHtmlBody(formData.body) ? (
                      <div dangerouslySetInnerHTML={{ __html: renderBodyWithMentions(formData.body) }}
                        onClick={(e) => { const chip = e.target.closest(".mention-chip"); if (chip) navigate(chip.dataset.id); }}
                        style={{ cursor: "default" }} />
                    ) : formData.body ? (
                      formData.body.split("\n").map((p, i) => <p key={i} style={{ margin: "0 0 10px" }}><RenderBody text={p} articles={articles} onNavigate={navigate} /></p>)
                    ) : null}
                    {!formData.body && <span style={{ color: theme.textDim, opacity: 0.5 }}>Nothing to preview yet...</span>}
                  </div>
                ) : (
                  <div ref={articleBodyRef} contentEditable suppressContentEditableWarning
                    onInput={handleArticleBodyInput}
                    onPaste={handleArticlePaste}
                    data-placeholder={`Write about this ${lower(CATEGORIES?.[createCat]?.label ?? CATEGORIES?.[createCat] ?? "")}...\n\nUse the toolbar above for formatting.`}
                    style={{ ...S.textarea, minHeight: 200, fontFamily: editorFontFamily, fontSize: 13, lineHeight: 1.8, whiteSpace: "pre-wrap", wordWrap: "break-word", overflowWrap: "break-word", borderRadius: "0 0 8px 8px", padding: "12px 16px" }} />
                )}
              </div>

              {linkSugs.length > 0 && <WarningBanner severity="info" icon="🔗" title="Possible Codex Links" style={{ marginBottom: 16 }}>
                <p style={{ margin: "0 0 8px" }}>Names found in your text that match codex entries. Click to link them in-place:</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{linkSugs.map((s) => (
                  <span key={s.article.id} onClick={() => smartInsertLink(s)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, padding: "4px 10px", background: s.confidence === "exact" ? "rgba(142,200,160,0.1)" : s.confidence === "strong" ? "rgba(126,200,227,0.1)" : ta(theme.accent, 0.08), border: "1px solid " + (s.confidence === "exact" ? "rgba(142,200,160,0.25)" : s.confidence === "strong" ? "rgba(126,200,227,0.2)" : ta(theme.accent, 0.15)), borderRadius: 12, cursor: "pointer", color: CATEGORIES[s.article.category]?.color, transition: "all 0.2s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(126,200,227,0.2)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = s.confidence === "exact" ? "rgba(142,200,160,0.1)" : "rgba(126,200,227,0.1)"; }}
                    title={s.label + ': "' + s.match + '" — will replace in-place if found in text'}>
                    <span>{CATEGORIES[s.article.category]?.icon}</span><span>{s.article.title}</span><span style={{ color: s.confidence === "exact" ? "#8ec8a0" : s.confidence === "strong" ? "#7ec8e3" : theme.accent, fontSize: 9 }}>● {s.confidence === "exact" ? "exact" : s.confidence === "strong" ? "likely" : "possible"}</span>
                  </span>
                ))}</div>
              </WarningBanner>}

              {liveIntegrity.length > 0 && <WarningBanner severity={liveIntegrity.some((w) => w.severity === "error") ? "error" : "warning"} icon="🛡" title={"Lore Integrity — " + liveIntegrity.length + " issue" + (liveIntegrity.length !== 1 ? "s" : "")} style={{ marginBottom: 16 }}>
                {liveIntegrity.filter((w) => w.severity === "error").map((w, i) => (
                  <div key={"e" + i} style={{ padding: "4px 0", fontSize: 12, color: "#e07050", display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <span>⛔</span><div style={{ flex: 1 }}><div>{w.message}</div><div style={{ fontSize: 10, color: "#a07060", marginTop: 2 }}>{w.suggestion}</div></div>
                  </div>
                ))}
                {liveIntegrity.filter((w) => w.severity === "warning").map((w, i) => {
                  const warnKey = w.refId || ("w" + i);
                  return (
                  <div key={warnKey} style={{ padding: "6px 0", fontSize: 12, color: theme.accent }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "flex-start", cursor: w.type === "broken_ref" && w.fuzzyMatches?.length > 0 ? "pointer" : "default" }}
                      onClick={() => { if (w.type === "broken_ref" && w.fuzzyMatches?.length > 0) setExpandedWarning(expandedWarning === warnKey ? null : warnKey); }}>
                      <span aria-hidden="true">⚠</span>
                      <div style={{ flex: 1 }}>
                        <div>{w.message}</div>
                        {w.type === "broken_ref" && w.fuzzyMatches?.length > 0 ? (
                          <div style={{ fontSize: 10, color: "#7ec8e3", marginTop: 3, display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{ background: "rgba(126,200,227,0.15)", padding: "2px 8px", borderRadius: 8, cursor: "pointer" }}>
                              {expandedWarning === warnKey ? "▾" : "▸"} {w.fuzzyMatches.length} possible match{w.fuzzyMatches.length !== 1 ? "es" : ""} — click to fix
                            </span>
                          </div>
                        ) : (
                          <div style={{ fontSize: 10, color: "#a09060", marginTop: 2 }}>{w.suggestion}</div>
                        )}
                      </div>
                    </div>
                    {/* Inline suggestion dropdown */}
                    {expandedWarning === warnKey && w.fuzzyMatches && (
                      <div style={{ marginLeft: 24, marginTop: 6, background: ta(theme.deepBg, 0.6), border: "1px solid " + theme.divider, borderRadius: 8, padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ fontSize: 10, color: theme.textDim, marginBottom: 2 }}>Replace <span style={{ color: "#e07050", fontFamily: "monospace" }}>{(w.rawMention || "").replace(/_/g, " ")}</span> with:</div>
                        {w.fuzzyMatches.map((fm) => (
                          <div key={fm.article.id}
                            onClick={() => resolveRef(w, fm.article)}
                            style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 6, cursor: "pointer", background: "rgba(126,200,227,0.05)", border: "1px solid rgba(126,200,227,0.1)", transition: "all 0.2s" }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(126,200,227,0.15)"; e.currentTarget.style.border = "1px solid " + "rgba(126,200,227,0.3)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(126,200,227,0.05)"; e.currentTarget.style.border = "1px solid " + "rgba(126,200,227,0.1)"; }}>
                            <span style={{ fontSize: 14, color: CATEGORIES[fm.article.category]?.color }}>{CATEGORIES[fm.article.category]?.icon}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, color: "#c8bda0", fontWeight: 500 }}>{fm.article.title}</div>
                              <div style={{ fontSize: 10, color: theme.textDim }}>{CATEGORIES[fm.article.category]?.label} · match score: {fm.score}</div>
                            </div>
                            <span style={{ fontSize: 10, color: "#8ec8a0", fontWeight: 600 }}>✓ Apply</span>
                          </div>
                        ))}
                        {w.type === "broken_ref" && (
                          <div style={{ display: "flex", gap: 8, marginTop: 4, paddingTop: 4, borderTop: "1px solid " + theme.divider }}>
                            <span style={{ fontSize: 10, color: "#e07050", cursor: "pointer", opacity: 0.7 }}
                              onClick={() => { setFormData((p) => ({ ...p, body: p.body.replace(w.rawMention, "") })); }}>
                              🗑 Remove mention
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  );
                })}
                {liveIntegrity.filter((w) => w.severity === "info").slice(0, 3).map((w, i) => (
                  <div key={"i" + i} style={{ padding: "4px 0", fontSize: 12, color: "#7ec8e3", display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <span>ℹ</span><div>{w.message}</div>
                  </div>
                ))}
              </WarningBanner>}

              <div style={{ marginBottom: 16 }}><label htmlFor="tags-input" style={{ display: "block", fontSize: 11, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Tags <span style={{ fontWeight: 400, color: theme.textDim }}>— comma separated</span></label><input style={S.input} id="tags-input" value={formData.tags} onChange={(e) => setFormData((p) => ({ ...p, tags: e.target.value }))} placeholder="war, second-age, dragons..." /></div>
              <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
                <button style={tBtnP} onClick={attemptSave}>{editingId ? "Save Changes" : "Create Entry"}</button>
                <button style={tBtnS} onClick={() => editingId ? navigate(editingId) : goDash()}>Cancel</button>
              </div>
            </div>
          </div>)}
  </>);

    

  return (
    <div style={{ ...S.root, background: theme.rootBg, color: theme.text, fontSize: 13, zoom: fontScale }}>
      {/* Editor formatting + Accessibility styles */}
      <style suppressHydrationWarning dangerouslySetInnerHTML={{ __html: `
        [contenteditable] h2 { font-family: 'Cinzel', serif; font-size: 1.4em; font-weight: 700; margin: 0.8em 0 0.4em; color: ${theme.text}; letter-spacing: 0.5px; border-bottom: 1px solid ${theme.border}; padding-bottom: 4px; }
        [contenteditable] h3 { font-family: 'Cinzel', serif; font-size: 1.15em; font-weight: 600; margin: 0.6em 0 0.3em; color: ${theme.text}; letter-spacing: 0.3px; }
        [contenteditable] blockquote { border-left: 3px solid ${theme.accent}; margin: 0.5em 0; padding: 4px 16px; color: ${theme.textMuted}; font-style: italic; background: ${ta(theme.accent, 0.04)}; border-radius: 0 6px 6px 0; }
        [contenteditable] ul, [contenteditable] ol { margin: 0.3em 0; padding-left: 1.5em; }
        [contenteditable] li { margin: 2px 0; }
        [contenteditable] hr { border: none; border-top: 1px solid ${theme.border}; margin: 1em 0; }
        [contenteditable] strong, [contenteditable] b { color: ${theme.text}; }
        [contenteditable]:empty::before { content: attr(data-placeholder); color: ${theme.textDim}; opacity: 0.5; white-space: pre-line; pointer-events: none; }
        /* Tables in editor and article view */
        [contenteditable] table, .article-body table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
        [contenteditable] th, .article-body th { background: ${ta(theme.accent, 0.08)}; padding: 8px 12px; border: 1px solid ${theme.border}; text-align: left; font-weight: 600; color: ${theme.text}; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
        [contenteditable] td, .article-body td { padding: 6px 12px; border: 1px solid ${theme.border}; color: ${theme.textMuted}; }
        [contenteditable] tr:hover td, .article-body tr:hover td { background: ${ta(theme.accent, 0.03)}; }
        /* Article view HTML body */
        .article-body h2 { font-family: 'Cinzel', serif; font-size: 1.4em; font-weight: 700; margin: 0.8em 0 0.4em; color: ${theme.text}; letter-spacing: 0.5px; border-bottom: 1px solid ${theme.border}; padding-bottom: 4px; }
        .article-body h3 { font-family: 'Cinzel', serif; font-size: 1.15em; font-weight: 600; margin: 0.6em 0 0.3em; color: ${theme.text}; letter-spacing: 0.3px; }
        .article-body blockquote { border-left: 3px solid ${theme.accent}; margin: 0.5em 0; padding: 4px 16px; color: ${theme.textMuted}; font-style: italic; background: ${ta(theme.accent, 0.04)}; border-radius: 0 6px 6px 0; }
        .article-body ul, .article-body ol { margin: 0.3em 0; padding-left: 1.5em; }
        .article-body li { margin: 2px 0; }
        .article-body hr { border: none; border-top: 1px solid ${theme.border}; margin: 1em 0; }
        .article-body strong, .article-body b { color: ${theme.text}; }
        .article-body img { max-width: 100%; border-radius: 6px; margin: 8px 0; }
        .article-body p { margin: 0 0 14px; }
        .mention-chip:hover { filter: brightness(1.2); }
        /* Accessibility: focus-visible outlines */
        :focus-visible { outline: 2px solid ${theme.accent}; outline-offset: 2px; border-radius: 4px; }
        button:focus-visible, [role="button"]:focus-visible, [tabindex]:focus-visible { outline: 2px solid ${theme.accent}; outline-offset: 2px; }
        input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid ${theme.accent}; outline-offset: 0px; }
        /* Skip to content link */
        .sr-skip { position: absolute; left: -9999px; top: auto; width: 1px; height: 1px; overflow: hidden; z-index: 99999; }
        .sr-skip:focus { position: fixed; top: 8px; left: 8px; width: auto; height: auto; padding: 8px 16px; background: ${theme.accent}; color: ${theme.deepBg || '#000'}; font-size: 14px; font-weight: 700; border-radius: 6px; z-index: 99999; text-decoration: none; }
        /* Screen reader only utility */
        .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
        /* Reduced motion */
        @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }
        /* Responsive overrides */
        @media (max-width: 1023px) {
          .fr-topbar-cats { display: none !important; }
          .fr-search-box { width: 200px !important; }
        }
        @media (max-width: 767px) {
          .fr-search-box { width: 100% !important; max-width: 100% !important; flex: 1 !important; }
          .fr-topbar { padding: 10px 14px !important; }
          .fr-content { padding: 0 14px 24px !important; }
        }
      ` }} />
      <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&display=swap" rel="stylesheet" />
      {/* Skip to content for keyboard users */}
      <a href="#main-content" className="sr-skip">Skip to main content</a>
      {showDupeModal && <DuplicateModal duplicates={pendingDupes} onOverride={doSave} onCancel={() => { setShowDupeModal(false); setPendingDupes([]); }} onNavigate={navigate} />}
      {showDeleteModal && <DeleteModal article={showDeleteModal} onArchive={() => doArchive(showDeleteModal)} onPermanent={() => doPermanentDelete(showDeleteModal)} onCancel={() => setShowDeleteModal(null)} />}
      {showConfirm && <ConfirmModal {...showConfirm} onCancel={() => setShowConfirm(null)} />}
      {/* Integrity gate modal — shown when saving an article with lore conflicts */}
      {integrityGate && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
          <div style={{ background: theme.surface, border: "1px solid " + theme.border, borderRadius: 12, padding: "28px 32px", maxWidth: 480, width: "90%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 24 }} aria-hidden="true">🛡</span>
              <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 18, color: "#e07050", margin: 0 }}>Lore Integrity Warning</h3>
            </div>
            <p style={{ fontSize: 13, color: theme.textMuted, marginBottom: 16, lineHeight: 1.5 }}>
              This entry has {integrityGate.warnings.length} integrity issue{integrityGate.warnings.length !== 1 ? "s" : ""} that may conflict with existing canon:
            </p>
            <div style={{ maxHeight: 200, overflowY: "auto", marginBottom: 20 }}>
              {integrityGate.warnings.map((w, i) => (
                <div key={i} style={{ display: "flex", gap: 8, padding: "8px 10px", marginBottom: 4, borderRadius: 6, background: w.severity === "error" ? "rgba(224,112,80,0.08)" : ta(theme.accent, 0.06), border: "1px solid " + (w.severity === "error" ? "rgba(224,112,80,0.2)" : ta(theme.accent, 0.15)) }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>{w.severity === "error" ? "🔴" : "🟡"}</span>
                  <div>
                    <div style={{ fontSize: 12, color: w.severity === "error" ? "#e07050" : theme.accent, lineHeight: 1.4 }}>{w.message}</div>
                    {w.suggestion && <div style={{ fontSize: 10, color: theme.textDim, marginTop: 3 }}>{w.suggestion}</div>}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setIntegrityGate(null)} style={{ ...tBtnS, fontSize: 12 }}>Go Back & Fix</button>
              <button onClick={() => { integrityGate.onProceed(); setIntegrityGate(null); }} style={{ ...tBtnP, fontSize: 12, background: "rgba(224,112,80,0.15)", border: "1px solid rgba(224,112,80,0.4)", color: "#e07050" }}>Save Anyway</button>
            </div>
          </div>
        </div>
      )}
      {importConflicts && <ImportConflictModal conflicts={importConflicts} onResolve={resolveImportConflicts} onCancel={() => { setImportConflicts(null); setImportPending(null); }} />}
      <input ref={importFileRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleImportFile} />
      <input ref={aiFileRef} type="file" accept=".txt,.md,.doc,.docx,.pdf" style={{ display: "none" }} onChange={handleAiFileUpload} />

      {/* DONATION MODAL */}
      {/* === KEYBOARD SHORTCUTS OVERLAY === */}
      {showShortcuts && (<>
        <div style={MS.overlay} onClick={() => setShowShortcuts(false)} />
        <div style={{ ...MS.modal, maxWidth: 420, padding: 0 }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid " + theme.divider, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 16, color: theme.text, margin: 0 }}>⌨ Keyboard Shortcuts</h3>
            <span onClick={() => setShowShortcuts(false)} style={{ cursor: "pointer", color: theme.textDim, fontSize: 16 }}>✕</span>
          </div>
          <div style={{ padding: "12px 20px 20px" }}>
            {[
              { keys: "Ctrl + K", desc: "Focus search bar" },
              { keys: "Ctrl + N", desc: "New codex entry" },
              { keys: "Ctrl + D", desc: "Go to dashboard" },
              { keys: "Ctrl + J", desc: "Toggle quick notes" },
              { keys: "Ctrl + /", desc: "Show this help" },
              { keys: "Escape", desc: "Close modals / menus" },
            ].map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: i < 5 ? "1px solid " + ta(theme.divider, 0.4) : "none" }}>
                <span style={{ fontSize: 12, color: theme.textMuted }}>{s.desc}</span>
                <kbd style={{ fontSize: 11, fontFamily: "monospace", color: theme.accent, background: ta(theme.accent, 0.08), border: "1px solid " + ta(theme.accent, 0.2), borderRadius: 4, padding: "2px 8px", letterSpacing: 0.5 }}>{s.keys}</kbd>
              </div>
            ))}
            <p style={{ fontSize: 11, color: theme.textDim, marginTop: 12, textAlign: "center", fontStyle: "italic" }}>On Mac, use ⌘ instead of Ctrl</p>
          </div>
        </div>
      </>)}

      {/* === SCRATCHPAD / QUICK NOTES === */}
      {scratchpadOpen && (
        <div style={{ position: "fixed", bottom: isMobile ? 10 : 20, right: isMobile ? 10 : 20, width: isMobile ? "calc(100% - 20px)" : 340, height: 380, background: theme.surface, border: "1px solid " + theme.border, borderRadius: 12, boxShadow: "0 12px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)", zIndex: 1200, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid " + theme.divider, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, background: ta(theme.deepBg, 0.5) }}>
            <span style={{ fontFamily: "'Cinzel', serif", fontSize: 12, fontWeight: 600, color: theme.text, letterSpacing: 1 }}>📝 Quick Notes</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => {
                if (!scratchpadText.trim()) return;
                const title = scratchpadText.split("\n")[0].slice(0, 60).trim() || "Quick Note";
                goCreate("character");
                setFormData((p) => ({ ...p, title, body: scratchpadText, summary: scratchpadText.slice(0, 200) }));
                setScratchpadOpen(false);
              }} title="Promote to codex entry" style={{ fontSize: 10, color: "#8ec8a0", background: "rgba(142,200,160,0.1)", border: "1px solid rgba(142,200,160,0.2)", borderRadius: 5, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>↑ Promote</button>
              <span onClick={() => setScratchpadOpen(false)} style={{ cursor: "pointer", color: theme.textDim, fontSize: 14, padding: "0 4px" }}>✕</span>
            </div>
          </div>
          <textarea
            value={scratchpadText}
            onChange={(e) => saveScratchpad(e.target.value)}
            placeholder="Jot down ideas, names, plot threads...&#10;&#10;First line becomes the title if you promote to a codex entry."
            style={{ flex: 1, resize: "none", border: "none", outline: "none", padding: "12px 14px", fontSize: 13, lineHeight: 1.6, color: theme.text, background: "transparent", fontFamily: "inherit" }}
          />
          <div style={{ padding: "6px 14px", borderTop: "1px solid " + theme.divider, display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
            <span style={{ fontSize: 10, color: theme.textDim }}>{scratchpadText.trim() ? scratchpadText.trim().split(/\s+/).length + " words" : "Empty"}</span>
            {scratchpadText.trim() && <span onClick={() => { if (confirm("Clear all notes?")) saveScratchpad(""); }} style={{ fontSize: 10, color: "#e07050", cursor: "pointer", opacity: 0.6 }}>Clear</span>}
          </div>
        </div>
      )}

      {showDonate && (
        <div style={MS.overlay} onClick={() => setShowDonate(false)}>
          <div style={{ ...MS.box, maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <span style={{ fontSize: 36 }}>♥</span>
              <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 20, color: theme.accent, margin: "8px 0 4px", letterSpacing: 1 }}>Support Frostfall Realms</h3>
              <p style={{ fontSize: 12, color: theme.textMuted, lineHeight: 1.6, margin: 0 }}>If you enjoy this worldbuilding engine, consider supporting its development.</p>
            </div>
            <Ornament width={420} />
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
              {[
                { name: "Buy Me a Coffee", icon: "☕", color: "#FFDD00", textColor: theme.deepBg, url: "https://buymeacoffee.com/viktor.13", desc: "Quick one-time support" },
                { name: "Ko-fi", icon: "🎨", color: "#FF5E5B", textColor: "#fff", url: "https://ko-fi.com/viktor13", desc: "Support with no platform fees" },
                
              ].map((p) => (
                <div key={p.name} onClick={() => window.open(p.url, "_blank")} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", background: p.color + "12", border: "1px solid " + p.color + "30", borderRadius: 8, cursor: "pointer", transition: "all 0.2s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = p.color + "25"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = p.color + "12"; e.currentTarget.style.transform = "none"; }}>
                  <span style={{ fontSize: 24, width: 36, textAlign: "center" }}>{p.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: theme.text }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: theme.textDim, marginTop: 2 }}>{p.desc}</div>
                  </div>
                  <span style={{ fontSize: 11, color: p.color, fontWeight: 600 }}>→</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 10, color: theme.textDim, textAlign: "center", marginTop: 16, lineHeight: 1.5 }}>Links will be configured when the platform is deployed. Thank you for your support!</p>
            <div style={{ textAlign: "center", marginTop: 12 }}><button style={tBtnS} onClick={() => setShowDonate(false)}>Close</button></div>
          </div>
        </div>
      )}

      {/* SIDEBAR — drawer on mobile */}
      {isMobile && sidebarOpen && <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 998 }} onClick={() => setSidebarOpen(false)} />}
      <nav aria-label="Main navigation" style={{
        ...S.sidebar,
        background: theme.sidebarBg,
        borderRight: "1px solid " + theme.border,
        ...(isMobile ? { position: "fixed", left: 0, top: 0, zIndex: 999, transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)", transition: "transform 0.25s ease", boxShadow: sidebarOpen ? "4px 0 24px rgba(0,0,0,0.5)" : "none" } : {}),
        ...(isTablet ? { width: 220, minWidth: 220 } : {}),
      }}>
        <div style={{ padding: "20px 16px 12px", borderBottom: "1px solid " + theme.divider }}>
          <p style={{ fontFamily: "'Cinzel', serif", fontSize: 18, fontWeight: 700, color: theme.accent, letterSpacing: 2, textTransform: "uppercase", margin: 0, textAlign: "center" }}>Frostfall Realms</p>
          <p style={{ fontSize: 10, color: theme.textDim, letterSpacing: 3, textAlign: "center", marginTop: 2, textTransform: "uppercase" }}>Worldbuilding Engine</p>
          <Ornament width={228} />
        </div>
        {/* User info bar */}
        {user && (
          <div style={{ padding: "8px 16px", borderBottom: "1px solid " + theme.divider, display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: "linear-gradient(135deg, #f0c040 0%, #d4a020 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: theme.deepBg }}>
              {(user.user_metadata?.display_name || user.email || "U")[0].toUpperCase()}
            </div>
            <span style={{ flex: 1, fontSize: 11, color: theme.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {user.user_metadata?.display_name || user.email?.split("@")[0]}
            </span>
            <button onClick={onLogout} title="Sign out" style={{ background: "none", border: "none", color: theme.textDim, cursor: "pointer", fontSize: 12, padding: "2px 6px" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#e07050"; }} onMouseLeave={(e) => { e.currentTarget.style.color = theme.textDim; }}>⏻</button>
          </div>
        )}
        {/* World switcher */}
        {activeWorld && (
          <div style={{ padding: "8px 16px", borderBottom: "1px solid " + theme.divider }}>
            <div role="button" tabIndex={0} aria-expanded={worldSwitcherOpen} aria-label="Switch world" onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setWorldSwitcherOpen(!worldSwitcherOpen); } }} onClick={() => setWorldSwitcherOpen(!worldSwitcherOpen)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "4px 0" }}>
              <span style={{ fontSize: 14, color: theme.accent }} aria-hidden="true">🌍</span>
              <span style={{ flex: 1, fontSize: 12, color: theme.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeWorld.name}</span>
              <span style={{ fontSize: 10, color: theme.textDim, transition: "transform 0.2s", transform: worldSwitcherOpen ? "rotate(180deg)" : "none" }}>▾</span>
            </div>
            {worldSwitcherOpen && (
              <div style={{ marginTop: 4, background: ta(theme.surface, 0.5), borderRadius: 6, border: "1px solid " + theme.border, overflow: "hidden" }}>
                {allWorlds.map((w) => (
                  <div key={w.id} role="option" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); switchWorld(w); } }} onClick={() => switchWorld(w)} style={{ padding: "8px 12px", fontSize: 11, color: w.id === activeWorld?.id ? theme.accent : theme.textMuted, cursor: "pointer", borderBottom: "1px solid " + theme.surface, display: "flex", alignItems: "center", gap: 8, background: w.id === activeWorld?.id ? ta(theme.accent, 0.06) : "transparent" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.accent, 0.1); }} onMouseLeave={(e) => { e.currentTarget.style.background = w.id === activeWorld?.id ? ta(theme.accent, 0.06) : "transparent"; }}>
                    <span style={{ fontSize: 10 }}>{w.id === activeWorld?.id ? "●" : "○"}</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.name}</span>
                  </div>
                ))}
                <div onClick={() => { setWorldSwitcherOpen(false); setShowWorldCreate(true); }} style={{ padding: "8px 12px", fontSize: 11, color: "#8ec8a0", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(142,200,160,0.1)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                  <span>+</span> <span>Create New World</span>
                </div>
              </div>
            )}
          </div>
        )}
        <div style={{ padding: "12px 0", flex: 1, overflowY: "auto" }}>
          {navItems.map((item, i) => item.divider ? <div key={i} style={{ height: 1, background: theme.divider, margin: "8px 16px" }} /> : (
            <div key={item.id} className="nav-row" style={{ ...S.navItem(isAct(item), theme), fontSize: sz(13), ...(item.alert && !isAct(item) ? { color: "#e07050" } : {}), position: "relative" }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); item.action(); } }} onClick={item.action}
              onMouseEnter={(e) => { if (!isAct(item)) e.currentTarget.style.background = ta(theme.accent, 0.05); }}
              onMouseLeave={(e) => { if (!isAct(item)) e.currentTarget.style.background = "transparent"; }}>
              <span style={{ fontSize: 16, width: 20, textAlign: "center" }}>{item.icon}</span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.count != null && <span style={{ fontSize: 11, color: item.alert ? "#e07050" : theme.textDim, background: item.alert ? "rgba(224,112,80,0.15)" : "transparent", padding: item.alert ? "1px 8px" : 0, borderRadius: 10, fontWeight: item.alert ? 700 : 400 }}>{item.count}</span>}
              {item.isCategory && (
                <span className="nav-create-btn" title={"New " + CATEGORIES[item.id]?.label} onClick={(e) => { e.stopPropagation(); goCreate(item.id); }}
                  style={{ fontSize: 15, width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4, color: CATEGORIES[item.id]?.color || theme.accent, opacity: 0.4, transition: "all 0.15s", cursor: "pointer", flexShrink: 0, marginLeft: 4, background: "transparent", fontWeight: 700 }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = ta(CATEGORIES[item.id]?.color || theme.accent, 0.15); e.currentTarget.style.opacity = "1"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.opacity = "0.4"; }}>+</span>
              )}
            </div>
          ))}
          <style>{`.nav-row:hover .nav-create-btn { opacity: 1 !important; background: ${ta(theme.accent, 0.08)} !important; }`}</style>
        </div>
        <div style={{ padding: "10px 16px", borderTop: "1px solid " + theme.divider }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <button onClick={exportWorld} style={{ flex: 1, fontSize: 10, color: "#8ec8a0", background: "rgba(142,200,160,0.08)", border: "1px solid rgba(142,200,160,0.2)", borderRadius: 5, padding: "6px 0", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, letterSpacing: 0.5 }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(142,200,160,0.18)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(142,200,160,0.08)"; }}>⬇ Export</button>
            <button onClick={() => importFileRef.current?.click()} style={{ flex: 1, fontSize: 10, color: "#7ec8e3", background: "rgba(126,200,227,0.08)", border: "1px solid rgba(126,200,227,0.2)", borderRadius: 5, padding: "6px 0", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, letterSpacing: 0.5 }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(126,200,227,0.18)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(126,200,227,0.08)"; }}>⬆ Import</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: saveStatus === "saved" ? "#8ec8a0" : saveStatus === "saving" ? theme.accent : saveStatus === "error" ? "#e07050" : "#445566", transition: "background 0.3s", boxShadow: saveStatus === "saving" ? "0 0 6px " + ta(theme.accent, 0.4) : "none" }} />
            <span aria-live="polite" role="status" style={{ fontSize: 9, color: theme.textDim, letterSpacing: 1 }}>{saveStatus === "saved" ? "SAVED" : saveStatus === "saving" ? "SAVING…" : saveStatus === "error" ? "SAVE ERROR" : (activeWorld?.name?.toUpperCase() || "NO WORLD")}</span>
          </div>
        </div>
      </nav>

      {/* MAIN */}
      <main id="main-content" style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div className="fr-topbar" style={{ ...S.topBar, borderBottom: "1px solid " + theme.border, background: theme.topBarBg, ...(isMobile ? { padding: "10px 14px", gap: 8 } : {}) }}>
          {/* Hamburger — mobile only */}
          {isMobile && (
            <button onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle navigation menu" aria-expanded={sidebarOpen}
              style={{ background: "none", border: "none", color: theme.textMuted, fontSize: 20, cursor: "pointer", padding: "4px 8px", lineHeight: 1, flexShrink: 0 }}>☰</button>
          )}
          <div style={{ position: "relative", ...(isMobile ? { flex: 1 } : {}) }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: theme.textDim, fontSize: 14 }} aria-hidden="true">⌕</span>
            <div style={{ position: "relative" }}>
              <input data-search-input className="fr-search-box" style={{ ...S.searchBox, ...(isMobile ? { width: "100%" } : isTablet ? { width: 200 } : {}) }} aria-label="Search the codex" placeholder={isMobile ? "Search…" : "Search titles, body, fields, tags…"} value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); if (view !== "codex") { setView("codex"); setCodexFilter("all"); } }} />
              {searchQuery && <span role="button" tabIndex={0} aria-label="Clear search" onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSearchQuery(""); } }} onClick={() => setSearchQuery("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", cursor: "pointer", fontSize: 12, color: theme.textDim, lineHeight: 1 }}>✕</span>}
            </div>
          </div>
          {!isCompact && <div className="fr-topbar-cats" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {mainCats.map(([k, c]) => (
              <div key={k} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goCreate(k); } }} onClick={() => goCreate(k)} style={{ fontSize: 11, color: c.color, cursor: "pointer", padding: "5px 10px", border: "1px solid " + c.color + "30", borderRadius: 6, transition: "all 0.2s", letterSpacing: 0.5 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = c.color + "15"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>+ {c.label}</div>
            ))}
            <div role="button" tabIndex={0} aria-expanded={showMoreCats} aria-haspopup="true" onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowMoreCats(!showMoreCats); } }} onClick={(e) => { e.stopPropagation(); setShowMoreCats(!showMoreCats); }} style={{ fontSize: 11, color: theme.textMuted, cursor: "pointer", padding: "5px 10px", border: "1px solid " + theme.border, borderRadius: 6, transition: "all 0.2s" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = theme.accentBg; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>+ More ▾</div>
          </div>}
          {/* More+ dropdown — fixed position so it floats above all content */}
          {showMoreCats && (<>
            <div style={{ position: "fixed", inset: 0, zIndex: 900 }} onClick={() => setShowMoreCats(false)} onKeyDown={(e) => { if (e.key === "Escape") setShowMoreCats(false); }} />
            <div style={{ position: "fixed", top: 54, right: 30, background: theme.surface, border: "1px solid " + theme.border, borderRadius: 10, padding: 6, minWidth: 200, zIndex: 901, boxShadow: "0 12px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)" }}>
              <div style={{ padding: "6px 12px 8px", fontSize: 9, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 600 }}>Create New Entry</div>
              {extraCats.map(([k, c]) => (
                <div key={k} role="menuitem" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowMoreCats(false); goCreate(k); } }} onClick={() => { setShowMoreCats(false); goCreate(k); }} style={{ fontSize: 12, color: c.color, padding: "9px 14px", cursor: "pointer", borderRadius: 6, display: "flex", alignItems: "center", gap: 10, transition: "background 0.1s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = c.color + "18"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                  <span style={{ fontSize: 15, width: 20, textAlign: "center" }}>{c.icon}</span> <span>{c.label}</span>
                </div>
              ))}
            </div>
          </>)}
        </div>

        <div className="fr-content" style={{ ...S.content, opacity: fadeIn ? 1 : 0, transition: "opacity 0.3s ease", ...(isMobile ? { padding: "0 14px 24px" } : {}) }}>




          {/* ═══ VIEW SWITCHBOARD ═══ */}
          {renderWelcome()}
          {renderWorldCreate()}
          {renderDashboard()}
          {renderIntegrity()}
          {renderArchives()}
          {renderTimeline()}
          {renderGraph()}
          {renderFamilyTree()}
          {renderCrossRefs()}
          {renderGenerator()}
          {renderSessions()}
          {renderNovel()}
          {renderSettings()}
          {renderAIImport()}
          {renderStaging()}
          {renderSupportPage()}
          {renderCollaboration()}
          {renderCodex()}
          {renderArticle()}
          {renderCreateEdit()}


        </div>

        {/* Mobile FAB — create entry on compact screens */}
        {isCompact && activeWorld && (view === "dashboard" || view === "codex" || view === "article") && (
          <>
            {showMobileFab && <div style={{ position: "fixed", inset: 0, zIndex: 950 }} onClick={() => setShowMobileFab(false)} />}
            {showMobileFab && (
              <div style={{ position: "fixed", bottom: 80, right: 20, background: theme.surface, border: "1px solid " + theme.border, borderRadius: 12, padding: 8, minWidth: 200, zIndex: 951, boxShadow: "0 12px 48px rgba(0,0,0,0.7)" }}>
                {Object.entries(CATEGORIES).map(([k, c]) => (
                  <div key={k} onClick={() => { setShowMobileFab(false); goCreate(k); }}
                    style={{ fontSize: 12, color: c.color, padding: "9px 14px", cursor: "pointer", borderRadius: 6, display: "flex", alignItems: "center", gap: 10 }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = c.color + "18"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                    <span style={{ fontSize: 15 }}>{c.icon}</span> {c.label}
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => setShowMobileFab(!showMobileFab)} aria-label="Create new entry"
              style={{ position: "fixed", bottom: 24, right: 20, width: 52, height: 52, borderRadius: "50%", background: "linear-gradient(135deg, " + theme.accent + " 0%, " + ta(theme.accent, 0.7) + " 100%)", color: theme.deepBg, border: "none", fontSize: 24, cursor: "pointer", zIndex: 951, boxShadow: "0 4px 20px " + ta(theme.accent, 0.4), display: "flex", alignItems: "center", justifyContent: "center", transition: "transform 0.2s", transform: showMobileFab ? "rotate(45deg)" : "none" }}>+</button>
          </>
        )}
      </main>
    </div>
  );
}