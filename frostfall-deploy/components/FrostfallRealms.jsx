"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import _ from "lodash";
import * as mammoth from "mammoth";
import { supabase, fetchArticles, upsertArticle, deleteArticle as dbDeleteArticle, archiveArticle as dbArchiveArticle, uploadPortrait, createWorld, fetchWorlds } from "../lib/supabase";

const CATEGORIES = {
  deity: { label: "Deity", icon: "☀", color: "#f0c040" },
  race: { label: "Race / Species", icon: "🜃", color: "#7ec8e3" },
  character: { label: "Character", icon: "👤", color: "#e8a050" },
  event: { label: "Historical Event", icon: "⚔", color: "#e07050" },
  location: { label: "Location", icon: "📍", color: "#8ec8a0" },
  organization: { label: "Organization", icon: "🏛", color: "#a088d0" },
  item: { label: "Item / Artifact", icon: "⚒", color: "#d4a060" },
  magic: { label: "Magic / Lore", icon: "✦", color: "#c084fc" },
  language: { label: "Language", icon: "🗣", color: "#e0c878" },
  flora_fauna: { label: "Flora & Fauna", icon: "🌿", color: "#6db88f" },
  laws_customs: { label: "Laws & Customs", icon: "📜", color: "#c8a878" },
};

const ERAS = [
  { id: "primordial", label: "Primordial Era", start: -10000, end: 0, color: "#c084fc", bg: "rgba(192,132,252,0.06)" },
  { id: "first_age", label: "First Age — Awakening", start: 0, end: 1000, color: "#f0c040", bg: "rgba(240,192,64,0.06)" },
  { id: "second_age", label: "Second Age — Kingdoms", start: 1000, end: 2817, color: "#7ec8e3", bg: "rgba(126,200,227,0.06)" },
  { id: "third_age", label: "Third Age — Division", start: 2817, end: 4500, color: "#e07050", bg: "rgba(224,112,80,0.06)" },
];

const SWIM_LANE_ORDER = ["deity", "magic", "race", "character", "event", "location", "organization", "item", "language", "flora_fauna", "laws_customs"];

const SEED_ARTICLES = [];

// === INTEGRITY ENGINES ===
function similarity(a, b) {
  if (!a || !b) return 0;
  a = a.toLowerCase().trim(); b = b.toLowerCase().trim();
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

function detectConflicts(articles) {
  const conflicts = [];
  const entityMap = {};
  articles.forEach((a) => { entityMap[a.id] = a; });
  articles.forEach((source) => {
    const st = source.temporal;
    if (!st || st.active_start == null) return;
    const mentions = (source.body?.match(/@([\w]+)/g) || []).map((m) => m.slice(1));
    mentions.forEach((refId) => {
      const target = entityMap[refId];
      if (!target?.temporal) return;
      const tt = target.temporal;
      if (tt.type === "concept") return;
      if (tt.type === "immortal" && !tt.active_end && !tt.faded) return;
      if (tt.active_end != null && st.active_start > tt.active_end) {
        conflicts.push({
          id: source.id + "->" + refId + "-post", type: "temporal", severity: "error",
          sourceId: source.id, sourceTitle: source.title,
          targetId: refId, targetTitle: target.title,
          message: target.title + " is referenced in \"" + source.title + "\" (Year " + st.active_start + "+) but " + (tt.death_year ? "died in Year " + tt.death_year : "ceased to be active after Year " + tt.active_end) + ".",
          suggestion: tt.death_year ? target.title + " died ~" + (st.active_start - tt.death_year) + " years before this event. Consider removing or noting it as legacy/memory." : target.title + " was no longer active by this time period.",
        });
      }
    });
    const kf = source.fields?.key_figures || "";
    if (kf && st.active_start != null) {
      articles.forEach((target) => {
        if (!target.temporal || target.id === source.id) return;
        const tt = target.temporal;
        if (tt.death_year && st.active_start > tt.death_year) {
          const words = target.title.toLowerCase().split(/\s+/);
          const kfL = kf.toLowerCase();
          const match = words.some((w) => w.length > 3 && kfL.includes(w));
          if (match && !conflicts.find((c) => c.sourceId === source.id && c.targetId === target.id)) {
            conflicts.push({
              id: source.id + "->" + target.id + "-kf", type: "temporal", severity: "warning",
              sourceId: source.id, sourceTitle: source.title,
              targetId: target.id, targetTitle: target.title,
              message: "\"" + source.title + "\" lists a figure matching \"" + target.title + "\" in Key Figures, but they died in Year " + tt.death_year + " — " + (st.active_start - tt.death_year) + " years before.",
              suggestion: "Verify if this is the same person or perhaps a descendant/namesake.",
            });
          }
        }
      });
    }
  });
  return conflicts;
}

function findUnlinkedMentions(text, fields, articles, existingLinks) {
  if (!text && !fields) return [];
  const suggestions = [];
  const allText = (text || "") + " " + Object.values(fields || {}).join(" ");
  const allTextLower = allText.toLowerCase();
  const linked = new Set(existingLinks || []);
  const mentioned = new Set((text?.match(/@([\w]+)/g) || []).map((m) => m.slice(1)));
  articles.forEach((a) => {
    if (linked.has(a.id) || mentioned.has(a.id)) return;
    const tl = a.title.toLowerCase();
    if (allTextLower.includes(tl)) { suggestions.push({ article: a, confidence: "high", match: a.title }); return; }
    const words = a.title.replace(/[()]/g, "").split(/[\s,\-\u2013\u2014]+/).filter((w) => w.length >= 4);
    const matched = words.filter((w) => allTextLower.includes(w.toLowerCase()));
    if (matched.length >= 2) suggestions.push({ article: a, confidence: "medium", match: matched.join(", ") });
    else if (matched.length === 1 && matched[0].length >= 6) suggestions.push({ article: a, confidence: "low", match: matched[0] });
  });
  return suggestions.sort((a, b) => ({ high: 3, medium: 2, low: 1 }[b.confidence] || 0) - ({ high: 3, medium: 2, low: 1 }[a.confidence] || 0));
}

// === HELPERS ===
const FIELD_LABELS = {
  domain: "Domain", symbol: "Holy Symbol", court: "Divine Court", sacred_time: "Sacred Time",
  worshippers: "Worshippers", gift_to_mortals: "Gift to Mortals", creators: "Creator Gods",
  lifespan: "Lifespan", population: "Population", magic_affinity: "Magic Affinity",
  homeland: "Homeland", capital: "Capital", major_clans: "Major Clans",
  defining_trait: "Defining Trait", date_range: "Date Range", age: "Age / Era",
  casualties: "Casualties", key_figures: "Key Figures", outcome: "Outcome",
  type: "Type", origin: "Origin", scope: "Scope", cost_types: "Cost Types",
  violation_consequence: "Violation Consequence", counterpart: "Counterpart",
  current_state: "Current State", legacy: "Legacy", current_age: "Current Age",
  notable_regions: "Notable Regions",
  // Character fields
  char_race: "Race", birth_year: "Birth Year", death_year: "Death Year",
  titles: "Titles", affiliations: "Affiliations", role: "Role",
  // Location fields
  region: "Region", ruler: "Ruler", founding_year: "Founded", notable_features: "Notable Features", status: "Status",
  // Organization fields
  founded: "Founded", leader: "Leader", headquarters: "Headquarters", purpose: "Purpose", members: "Key Members",
  // Item fields
  creator: "Creator", current_location: "Current Location", power: "Power / Ability", history: "History",
  // Language fields
  speakers: "Speakers", script: "Script / Writing System", lang_origin: "Origin", sample_phrases: "Sample Phrases", grammar_notes: "Grammar Notes", lang_status: "Status",
  // Flora & Fauna fields
  species_type: "Type", habitat: "Habitat", rarity: "Rarity", uses: "Uses / Properties", danger_level: "Danger Level", description: "Description",
  // Laws & Customs fields
  custom_type: "Type", enforced_by: "Enforced By", applies_to: "Applies To", penalties: "Penalties", cultural_significance: "Cultural Significance", exceptions: "Exceptions",
};
const TEMPLATE_FIELDS = {
  deity: ["domain", "symbol", "court", "sacred_time", "worshippers", "gift_to_mortals"],
  race: ["creators", "lifespan", "population", "magic_affinity", "homeland", "capital"],
  character: ["char_race", "birth_year", "death_year", "titles", "affiliations", "role"],
  event: ["date_range", "age", "casualties", "key_figures", "outcome"],
  location: ["region", "ruler", "population", "founding_year", "notable_features", "status"],
  organization: ["type", "founded", "leader", "headquarters", "purpose", "members"],
  item: ["type", "creator", "current_location", "power", "history"],
  magic: ["type", "origin", "scope", "cost_types", "violation_consequence"],
  language: ["speakers", "script", "lang_origin", "sample_phrases", "grammar_notes", "lang_status"],
  flora_fauna: ["species_type", "habitat", "rarity", "uses", "danger_level", "description"],
  laws_customs: ["custom_type", "enforced_by", "applies_to", "penalties", "cultural_significance", "exceptions"],
};
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
  return (<span>{text.split(/(@[\w]+)/g).map((part, i) => {
    if (part.startsWith("@")) {
      const id = part.slice(1), target = articles.find((a) => a.id === id);
      if (target) return <span key={i} onClick={(e) => { e.stopPropagation(); onNavigate(id); }} style={{ color: CATEGORIES[target.category]?.color || "#f0c040", cursor: "pointer", borderBottom: "1px dotted currentColor", fontWeight: 500 }}>{target.title}</span>;
      return <span key={i} style={{ color: "#888", fontStyle: "italic" }}>{id}</span>;
    }
    return <span key={i}>{part}</span>;
  })}</span>);
};

const WarningBanner = ({ severity = "warning", icon = "⚠", title, children, style = {} }) => {
  const c = { error: { bg: "rgba(224,112,80,0.08)", border: "#e07050", accent: "#e07050", text: "#e8a090" }, warning: { bg: "rgba(240,192,64,0.08)", border: "#f0c040", accent: "#f0c040", text: "#e8dcc8" }, info: { bg: "rgba(126,200,227,0.08)", border: "#7ec8e3", accent: "#7ec8e3", text: "#a0d0e8" } }[severity] || { bg: "rgba(240,192,64,0.08)", border: "#f0c040", accent: "#f0c040", text: "#e8dcc8" };
  return (<div style={{ background: c.bg, border: "1px solid " + c.border + "30", borderLeft: "3px solid " + c.border, borderRadius: 6, padding: "12px 16px", marginBottom: 10, ...style }}>
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <span style={{ fontSize: 16, color: c.accent, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div style={{ flex: 1 }}>{title && <div style={{ fontSize: 12, fontWeight: 700, color: c.accent, marginBottom: 4, letterSpacing: 0.5, textTransform: "uppercase" }}>{title}</div>}<div style={{ fontSize: 12, color: c.text, lineHeight: 1.6 }}>{children}</div></div>
    </div>
  </div>);
};

// === MODALS ===
const DuplicateModal = ({ duplicates, onOverride, onCancel, onNavigate }) => (
  <div style={MS.overlay}>
    <div style={{ ...MS.box, border: "1px solid #e07050" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 28, color: "#e07050" }}>⚠</span>
        <div><h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 18, color: "#e07050", margin: 0 }}>Duplicate Detected</h3><p style={{ fontSize: 12, color: "#8899aa", margin: "4px 0 0" }}>This entry appears to match existing articles.</p></div>
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
  <div style={MS.overlay}>
    <div style={{ ...MS.box, border: "1px solid #e07050" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 28, color: "#e07050" }}>🗑</span>
        <div><h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 18, color: "#e07050", margin: 0 }}>Delete Entry</h3><p style={{ fontSize: 12, color: "#8899aa", margin: "4px 0 0" }}>Choose how to handle "{article.title}"</p></div>
      </div>
      <Ornament width={460} />
      <div style={{ margin: "20px 0", display: "flex", flexDirection: "column", gap: 10 }}>
        <div onClick={onArchive} style={{ padding: "16px 20px", background: "rgba(240,192,64,0.06)", border: "1px solid rgba(240,192,64,0.2)", borderRadius: 8, cursor: "pointer", transition: "all 0.2s" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(240,192,64,0.12)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(240,192,64,0.06)"; }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 18 }}>📦</span>
            <span style={{ fontFamily: "'Cinzel', serif", fontSize: 14, color: "#f0c040", fontWeight: 600, letterSpacing: 0.5 }}>Archive</span>
          </div>
          <p style={{ fontSize: 12, color: "#8899aa", margin: 0, lineHeight: 1.5 }}>Move to the archives. Can be restored or permanently deleted later. Links and references are preserved.</p>
        </div>
        <div onClick={onPermanent} style={{ padding: "16px 20px", background: "rgba(224,112,80,0.06)", border: "1px solid rgba(224,112,80,0.2)", borderRadius: 8, cursor: "pointer", transition: "all 0.2s" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(224,112,80,0.12)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(224,112,80,0.06)"; }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 18 }}>🔥</span>
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
  <div style={MS.overlay}>
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
    <div style={MS.overlay}>
      <div style={{ ...MS.box, maxWidth: 700, maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexShrink: 0 }}>
          <span style={{ fontSize: 28, color: "#f0c040" }}>⚠</span>
          <div><h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 18, color: "#f0c040", margin: 0 }}>Import Conflicts</h3>
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
  navItem: (a) => ({ display: "flex", alignItems: "center", gap: 10, padding: "9px 20px", cursor: "pointer", background: a ? "linear-gradient(90deg, rgba(240,192,64,0.12) 0%, transparent 100%)" : "transparent", borderLeft: a ? "2px solid #f0c040" : "2px solid transparent", color: a ? "#f0c040" : "#8899aa", fontSize: 13, fontWeight: a ? 600 : 400, transition: "all 0.2s", letterSpacing: 0.5 }),
  topBar: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 28px", borderBottom: "1px solid #1a2435", background: "rgba(10,14,26,0.6)", backdropFilter: "blur(10px)" },
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

// === MAIN APP ===
export default function FrostfallRealms({ user, onLogout }) {
  const [articles, setArticles] = useState(SEED_ARTICLES);
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
  const [showConfirm, setShowConfirm] = useState(null);
  const [dismissedConflicts, setDismissedConflicts] = useState(new Set());
  const [tlZoom, setTlZoom] = useState(3);
  const [tlSelected, setTlSelected] = useState(null);
  const [tlPanelOpen, setTlPanelOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState("idle");
  const [importConflicts, setImportConflicts] = useState(null);
  const [importPending, setImportPending] = useState(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [activeWorld, setActiveWorld] = useState(null);
  const tlRef = useRef(null);
  const tlLabelRef = useRef(null);
  const tlSyncing = useRef(false);
  const importFileRef = useRef(null);
  const saveTimer = useRef(null);

  // === PERSISTENT STORAGE (Supabase → window.storage → localStorage fallback) ===
  useEffect(() => {
    const loadData = async () => {
      if (supabase && user) {
        try {
          const worlds = await fetchWorlds(user.id);
          let world = worlds[0];
          if (!world) world = await createWorld(user.id, "Aelvarin", "The world of Frostfall Realms");
          setActiveWorld(world);
          const dbArticles = await fetchArticles(world.id);
          if (dbArticles.length > 0) {
            setArticles(dbArticles.filter((a) => !a.isArchived));
            setArchived(dbArticles.filter((a) => a.isArchived));
          }
          setSaveStatus("saved");
        } catch (e) { console.error("Supabase load:", e); setSaveStatus("idle"); }
      } else {
        try {
          if (typeof window !== "undefined" && window.storage) {
            const result = await window.storage.get("frostfall-world-data");
            const data = JSON.parse(result.value);
            if (data.articles?.length > 0) setArticles(data.articles);
            if (data.archived) setArchived(data.archived);
          }
          setSaveStatus("saved");
        } catch (e) { setSaveStatus("idle"); }
      }
      setDataLoaded(true);
    };
    loadData();
  }, [user]);

  useEffect(() => {
    if (!dataLoaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus("saving");
    saveTimer.current = setTimeout(async () => {
      try {
        if (supabase && user && activeWorld) {
          const all = [...articles, ...archived.map((a) => ({ ...a, isArchived: true }))];
          for (const article of all) await upsertArticle(activeWorld.id, article);
        } else if (typeof window !== "undefined" && window.storage) {
          await window.storage.set("frostfall-world-data", JSON.stringify({ articles, archived, version: 1, savedAt: new Date().toISOString() }));
        }
        setSaveStatus("saved");
      } catch (e) { setSaveStatus("error"); }
    }, 1200);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [articles, archived, dataLoaded, user, activeWorld]);

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
          setShowConfirm({ title: "Empty Import", message: "The file contains no articles to import.", confirmLabel: "OK", confirmColor: "#f0c040", onConfirm: () => setShowConfirm(null) });
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
          setArticles((prev) => [...prev, ...newArticles]);
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
    setArticles((prev) => [...prev.filter((a) => !replaceIds.has(a.id)), ...resolved, ...importPending.newArticles]);
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
  const [showDonate, setShowDonate] = useState(false);
  const [authView, setAuthView] = useState(null); // null | "login" | "register"
  const aiFileRef = useRef(null);
  const portraitFileRef = useRef(null);

  const parseDocumentWithAI = async (text, filename) => {
    setAiParsing(true); setAiParseError(null); setAiSourceName(filename);
    try {
      const response = await fetch("/api/ai-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 30000), filename }),
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || "API request failed");
      }
      const entries = data.entries;
      const staged = entries.map((e, i) => ({
        ...e,
        _stagingId: Date.now() + "-" + i,
        _status: "pending",
        id: e.title?.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/_+$/, "") || "entry_" + i,
        fields: e.fields || {},
        tags: e.tags || [],
        linkedIds: (e.body?.match(/@([\w]+)/g) || []).map((m) => m.slice(1)),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
      setAiStaging(staged);
      setView("staging");
    } catch (err) {
      setAiParseError("Failed to parse document: " + (err.message || "Unknown error"));
    }
    setAiParsing(false);
  };

  const handleAiFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "docx" || ext === "doc") {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const arrayBuffer = ev.target.result;
          const result = await mammoth.extractRawText({ arrayBuffer });
          const text = result.value;
          if (!text || text.length < 20) { setAiParseError("Document appears empty or could not be read."); return; }
          parseDocumentWithAI(text, file.name);
        } catch (err) {
          setAiParseError("Failed to read .docx file: " + (err.message || "Unknown error"));
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
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
    setArticles((prev) => [...prev, ...cleaned]);
    const count = cleaned.length;
    setAiStaging([]);
    setView("dashboard");
    setShowConfirm({ title: "Import Complete", message: `${count} entr${count === 1 ? "y" : "ies"} added to the codex from "${aiSourceName}".`, confirmLabel: "OK", confirmColor: "#8ec8a0", onConfirm: () => setShowConfirm(null) });
  };

  useEffect(() => { setFadeIn(false); const t = setTimeout(() => setFadeIn(true), 30); return () => clearTimeout(t); }, [view, activeArticle]);

  const navigate = useCallback((id) => { const a = articles.find((x) => x.id === id); if (a) { setActiveArticle(a); setView("article"); } }, [articles]);
  const goCodex = (f = "all") => { setCodexFilter(f); setView("codex"); };
  const goDash = () => setView("dashboard");
  const goCreate = (cat) => { setCreateCat(cat); setEditingId(null); setFormData({ title: "", summary: "", fields: {}, body: "", tags: "", temporal: null, portrait: null }); setView("create"); };
  const goEdit = (article) => {
    setCreateCat(article.category);
    setEditingId(article.id);
    setFormData({
      title: article.title,
      summary: article.summary || "",
      fields: { ...article.fields },
      body: article.body || "",
      tags: (article.tags || []).join(", "),
      temporal: article.temporal ? { ...article.temporal } : null,
      portrait: article.portrait || null,
    });
    setView("create");
  };

  // === TEMPORAL BUILDER ===
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

  const attemptSave = () => {
    const dupes = findDuplicates(formData.title, articles, editingId);
    if (dupes.length > 0) { setPendingDupes(dupes); setShowDupeModal(true); return; }
    doSave();
  };
  const doSave = () => {
    const id = editingId || formData.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/_+$/, "");
    const mentions = (formData.body.match(/@([\w]+)/g) || []).map((m) => m.slice(1));
    const temporal = buildTemporal(createCat, formData.fields, formData.temporal);
    const now = new Date().toISOString();
    const a = {
      id, title: formData.title, category: createCat, summary: formData.summary,
      fields: formData.fields, body: formData.body,
      tags: formData.tags.split(",").map((t) => t.trim()).filter(Boolean),
      linkedIds: [...new Set(mentions)], temporal,
      portrait: formData.portrait || (editingId ? (articles.find((x) => x.id === editingId)?.portrait || null) : null),
      createdAt: editingId ? (articles.find((x) => x.id === editingId)?.createdAt || now) : now,
      updatedAt: now,
    };
    if (editingId) {
      setArticles((prev) => prev.map((x) => x.id === editingId ? a : x));
    } else {
      setArticles((prev) => [a, ...prev]);
    }
    setActiveArticle(a); setShowDupeModal(false); setPendingDupes([]); setEditingId(null); setView("article");
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
    setArticles((prev) => [{ ...clean, updatedAt: new Date().toISOString() }, ...prev]);
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

  const allConflicts = useMemo(() => detectConflicts(articles), [articles]);
  const conflictsFor = useCallback((id) => allConflicts.filter((c) => c.sourceId === id && !dismissedConflicts.has(c.id)), [allConflicts, dismissedConflicts]);
  const linkSugs = useMemo(() => view === "create" ? findUnlinkedMentions(formData.body + " " + formData.summary + " " + formData.title, formData.fields, articles, editingId ? (articles.find((a) => a.id === editingId)?.linkedIds || []) : []) : [], [view, formData, articles, editingId]);
  const liveDupes = useMemo(() => view === "create" ? findDuplicates(formData.title, articles, editingId) : [], [view, formData.title, articles, editingId]);

  const filtered = useMemo(() => {
    let l = articles;
    if (codexFilter !== "all") l = l.filter((a) => a.category === codexFilter);
    if (searchQuery.trim()) { const q = searchQuery.toLowerCase(); l = l.filter((a) => a.title.toLowerCase().includes(q) || a.summary.toLowerCase().includes(q) || a.tags?.some((t) => t.includes(q))); }
    return l;
  }, [articles, codexFilter, searchQuery]);

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

  // === TIMELINE COMPUTATIONS ===
  const tlData = useMemo(() => {
    const items = articles.filter((a) => a.temporal && a.temporal.active_start != null);
    const lanes = {};
    SWIM_LANE_ORDER.forEach((cat) => {
      const catItems = items.filter((a) => a.category === cat);
      if (catItems.length > 0) lanes[cat] = catItems.sort((a, b) => a.temporal.active_start - b.temporal.active_start);
    });
    return { items, lanes };
  }, [articles]);

  const tlRange = useMemo(() => {
    if (tlData.items.length === 0) return { min: -500, max: 5000 };
    const starts = tlData.items.map((a) => a.temporal.active_start);
    const ends = tlData.items.map((a) => a.temporal.active_end ?? a.temporal.active_start);
    const min = Math.min(...starts), max = Math.max(...ends);
    const pad = Math.max((max - min) * 0.05, 200);
    return { min: min - pad, max: max + pad };
  }, [tlData]);

  const tlPxPerYear = useMemo(() => [0.02, 0.05, 0.12, 0.3, 0.6, 1.2, 2.5][tlZoom] || 0.3, [tlZoom]);
  const yearToX = useCallback((year) => (year - tlRange.min) * tlPxPerYear, [tlRange, tlPxPerYear]);
  const tlTotalWidth = useMemo(() => (tlRange.max - tlRange.min) * tlPxPerYear, [tlRange, tlPxPerYear]);

  const tlTicks = useMemo(() => {
    const range = tlRange.max - tlRange.min;
    const idealCount = tlTotalWidth / 120;
    const rawStep = range / idealCount;
    const magnitudes = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
    const step = magnitudes.find((m) => m >= rawStep) || 5000;
    const ticks = [];
    const start = Math.ceil(tlRange.min / step) * step;
    for (let y = start; y <= tlRange.max; y += step) ticks.push(y);
    return { ticks, step };
  }, [tlRange, tlTotalWidth]);

  const tlSelectArticle = useCallback((a) => { setTlSelected(a); setTlPanelOpen(true); }, []);
  const tlClosePanel = useCallback(() => { setTlPanelOpen(false); setTimeout(() => setTlSelected(null), 300); }, []);

  const tlLaneHeights = useMemo(() => {
    const heights = {};
    SWIM_LANE_ORDER.forEach((cat) => {
      if (!tlData.lanes[cat]) return;
      const entries = tlData.lanes[cat];
      const placed = [];
      entries.forEach((a) => {
        const x = yearToX(a.temporal.active_start);
        const hasEnd = a.temporal.active_end != null && a.temporal.active_end !== a.temporal.active_start;
        const xEnd = hasEnd ? yearToX(a.temporal.active_end) : x + 28;
        let row = 0;
        while (placed.some((p) => p.row === row && p.xEnd > x - 4 && p.x < xEnd + 4)) row++;
        placed.push({ id: a.id, x, xEnd, row });
      });
      const maxRow = Math.max(0, ...placed.map((p) => p.row));
      heights[cat] = 40 + maxRow * 30;
    });
    return heights;
  }, [tlData, yearToX]);

  const navItems = [
    { id: "dashboard", icon: "◈", label: "Dashboard", action: goDash },
    { id: "codex", icon: "📖", label: "Full Codex", action: () => goCodex("all") },
    { divider: true },
    ...Object.entries(CATEGORIES).map(([k, c]) => ({
      id: k, icon: c.icon, label: k === "race" ? "Races & Species" : k === "magic" ? "Magic & Lore" : k === "item" ? "Items & Artifacts" : k === "flora_fauna" ? "Flora & Fauna" : k === "laws_customs" ? "Laws & Customs" : c.label + "s",
      action: () => goCodex(k), count: catCounts[k] || undefined,
    })),
    { divider: true },
    { id: "timeline", icon: "⏳", label: "Timeline", action: () => { setTlSelected(null); setTlPanelOpen(false); setView("timeline"); } },
    { id: "integrity", icon: "🛡", label: "Lore Integrity", action: () => setView("integrity"), count: stats.conflicts > 0 ? stats.conflicts : undefined, alert: stats.conflicts > 0 },
    { id: "archives", icon: "📦", label: "Archives", action: () => setView("archives"), count: archived.length > 0 ? archived.length : undefined },
    { divider: true },
    { id: "ai_import", icon: "🧠", label: "AI Document Import", action: () => setView("ai_import") },
    { id: "staging", icon: "📋", label: "Staging Area", action: () => setView("staging"), count: aiStaging.filter((e) => e._status === "pending").length > 0 ? aiStaging.filter((e) => e._status === "pending").length : undefined },
    { divider: true },
    { id: "support", icon: "♥", label: "Support", action: () => setShowDonate(true) },
  ];

  const isAct = (item) => {
    if (item.id === "dashboard" && view === "dashboard") return true;
    if (item.id === "codex" && view === "codex" && codexFilter === "all") return true;
    if (item.id === "integrity" && view === "integrity") return true;
    if (item.id === "timeline" && view === "timeline") return true;
    if (item.id === "archives" && view === "archives") return true;
    if (item.id === "ai_import" && view === "ai_import") return true;
    if (item.id === "staging" && view === "staging") return true;
    if (view === "codex" && codexFilter === item.id) return true;
    if ((view === "article" || view === "create") && (activeArticle?.category === item.id || createCat === item.id)) return true;
    return false;
  };

  // Top bar quick-create: only show first 4 + a "more" dropdown state
  const [showMoreCats, setShowMoreCats] = useState(false);
  const mainCats = Object.entries(CATEGORIES).slice(0, 4);
  const extraCats = Object.entries(CATEGORIES).slice(4);

  return (
    <div style={S.root}>
      <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&display=swap" rel="stylesheet" />
      {showDupeModal && <DuplicateModal duplicates={pendingDupes} onOverride={doSave} onCancel={() => { setShowDupeModal(false); setPendingDupes([]); }} onNavigate={navigate} />}
      {showDeleteModal && <DeleteModal article={showDeleteModal} onArchive={() => doArchive(showDeleteModal)} onPermanent={() => doPermanentDelete(showDeleteModal)} onCancel={() => setShowDeleteModal(null)} />}
      {showConfirm && <ConfirmModal {...showConfirm} onCancel={() => setShowConfirm(null)} />}
      {importConflicts && <ImportConflictModal conflicts={importConflicts} onResolve={resolveImportConflicts} onCancel={() => { setImportConflicts(null); setImportPending(null); }} />}
      <input ref={importFileRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleImportFile} />
      <input ref={aiFileRef} type="file" accept=".txt,.md,.doc,.docx,.pdf" style={{ display: "none" }} onChange={handleAiFileUpload} />

      {/* DONATION MODAL */}
      {showDonate && (
        <div style={MS.overlay} onClick={() => setShowDonate(false)}>
          <div style={{ ...MS.box, maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
              <span style={{ fontSize: 36 }}>♥</span>
              <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 20, color: "#f0c040", margin: "8px 0 4px", letterSpacing: 1 }}>Support Frostfall Realms</h3>
              <p style={{ fontSize: 12, color: "#8899aa", lineHeight: 1.6, margin: 0 }}>If you enjoy this worldbuilding engine, consider supporting its development.</p>
            </div>
            <Ornament width={420} />
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
              {[
                { name: "Buy Me a Coffee", icon: "☕", color: "#FFDD00", textColor: "#0a0e1a", url: "https://buymeacoffee.com", desc: "Quick one-time support" },
                { name: "Ko-fi", icon: "🎨", color: "#FF5E5B", textColor: "#fff", url: "https://ko-fi.com", desc: "Support with no platform fees" },
                { name: "Stripe", icon: "💳", color: "#635BFF", textColor: "#fff", url: "https://stripe.com", desc: "Flexible payment options" },
              ].map((p) => (
                <div key={p.name} onClick={() => window.open(p.url, "_blank")} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", background: p.color + "12", border: "1px solid " + p.color + "30", borderRadius: 8, cursor: "pointer", transition: "all 0.2s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = p.color + "25"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = p.color + "12"; e.currentTarget.style.transform = "none"; }}>
                  <span style={{ fontSize: 24, width: 36, textAlign: "center" }}>{p.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#d4c9a8" }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: "#6b7b8d", marginTop: 2 }}>{p.desc}</div>
                  </div>
                  <span style={{ fontSize: 11, color: p.color, fontWeight: 600 }}>→</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 10, color: "#445566", textAlign: "center", marginTop: 16, lineHeight: 1.5 }}>Links will be configured when the platform is deployed. Thank you for your support!</p>
            <div style={{ textAlign: "center", marginTop: 12 }}><button style={S.btnS} onClick={() => setShowDonate(false)}>Close</button></div>
          </div>
        </div>
      )}

      {/* SIDEBAR */}
      <div style={S.sidebar}>
        <div style={{ padding: "20px 16px 12px", borderBottom: "1px solid #1a2435" }}>
          <p style={{ fontFamily: "'Cinzel', serif", fontSize: 18, fontWeight: 700, color: "#f0c040", letterSpacing: 2, textTransform: "uppercase", margin: 0, textAlign: "center" }}>Frostfall Realms</p>
          <p style={{ fontSize: 10, color: "#6b7b8d", letterSpacing: 3, textAlign: "center", marginTop: 2, textTransform: "uppercase" }}>Worldbuilding Engine</p>
          <Ornament width={228} />
        </div>
        {/* User info bar */}
        {user && (
          <div style={{ padding: "8px 16px", borderBottom: "1px solid #1a2435", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: "linear-gradient(135deg, #f0c040 0%, #d4a020 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#0a0e1a" }}>
              {(user.user_metadata?.display_name || user.email || "U")[0].toUpperCase()}
            </div>
            <span style={{ flex: 1, fontSize: 11, color: "#8899aa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {user.user_metadata?.display_name || user.email?.split("@")[0]}
            </span>
            <button onClick={onLogout} title="Sign out" style={{ background: "none", border: "none", color: "#556677", cursor: "pointer", fontSize: 12, padding: "2px 6px" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#e07050"; }} onMouseLeave={(e) => { e.currentTarget.style.color = "#556677"; }}>⏻</button>
          </div>
        )}
        <div style={{ padding: "12px 0", flex: 1, overflowY: "auto" }}>
          {navItems.map((item, i) => item.divider ? <div key={i} style={{ height: 1, background: "#1a2435", margin: "8px 16px" }} /> : (
            <div key={item.id} style={{ ...S.navItem(isAct(item)), ...(item.alert && !isAct(item) ? { color: "#e07050" } : {}) }} onClick={item.action}
              onMouseEnter={(e) => { if (!isAct(item)) e.currentTarget.style.background = "rgba(240,192,64,0.05)"; }}
              onMouseLeave={(e) => { if (!isAct(item)) e.currentTarget.style.background = "transparent"; }}>
              <span style={{ fontSize: 16, width: 20, textAlign: "center" }}>{item.icon}</span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.count != null && <span style={{ fontSize: 11, color: item.alert ? "#e07050" : "#556677", background: item.alert ? "rgba(224,112,80,0.15)" : "transparent", padding: item.alert ? "1px 8px" : 0, borderRadius: 10, fontWeight: item.alert ? 700 : 400 }}>{item.count}</span>}
            </div>
          ))}
        </div>
        <div style={{ padding: "10px 16px", borderTop: "1px solid #1a2435" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <button onClick={exportWorld} style={{ flex: 1, fontSize: 10, color: "#8ec8a0", background: "rgba(142,200,160,0.08)", border: "1px solid rgba(142,200,160,0.2)", borderRadius: 5, padding: "6px 0", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, letterSpacing: 0.5 }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(142,200,160,0.18)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(142,200,160,0.08)"; }}>⬇ Export</button>
            <button onClick={() => importFileRef.current?.click()} style={{ flex: 1, fontSize: 10, color: "#7ec8e3", background: "rgba(126,200,227,0.08)", border: "1px solid rgba(126,200,227,0.2)", borderRadius: 5, padding: "6px 0", cursor: "pointer", fontFamily: "inherit", fontWeight: 600, letterSpacing: 0.5 }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(126,200,227,0.18)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(126,200,227,0.08)"; }}>⬆ Import</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: saveStatus === "saved" ? "#8ec8a0" : saveStatus === "saving" ? "#f0c040" : saveStatus === "error" ? "#e07050" : "#445566", transition: "background 0.3s", boxShadow: saveStatus === "saving" ? "0 0 6px rgba(240,192,64,0.4)" : "none" }} />
            <span style={{ fontSize: 9, color: "#556677", letterSpacing: 1 }}>{saveStatus === "saved" ? "SAVED" : saveStatus === "saving" ? "SAVING…" : saveStatus === "error" ? "SAVE ERROR" : "AELVARIN · THIRD AGE"}</span>
          </div>
        </div>
      </div>

      {/* MAIN */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={S.topBar}>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#445566", fontSize: 14 }}>⌕</span>
            <input style={S.searchBox} placeholder="Search the codex..." value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); if (view !== "codex") { setView("codex"); setCodexFilter("all"); } }} />
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", position: "relative" }}>
            {mainCats.map(([k, c]) => (
              <div key={k} onClick={() => goCreate(k)} style={{ fontSize: 11, color: c.color, cursor: "pointer", padding: "5px 10px", border: "1px solid " + c.color + "30", borderRadius: 6, transition: "all 0.2s", letterSpacing: 0.5 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = c.color + "15"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>+ {c.label}</div>
            ))}
            <div style={{ position: "relative" }}>
              <div onClick={() => setShowMoreCats(!showMoreCats)} style={{ fontSize: 11, color: "#8899aa", cursor: "pointer", padding: "5px 10px", border: "1px solid #1e2a3a", borderRadius: 6, transition: "all 0.2s" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(240,192,64,0.08)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>+ More ▾</div>
              {showMoreCats && <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: "#111827", border: "1px solid #1e2a3a", borderRadius: 8, padding: 4, minWidth: 160, zIndex: 100, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
                {extraCats.map(([k, c]) => (
                  <div key={k} onClick={() => { setShowMoreCats(false); goCreate(k); }} style={{ fontSize: 12, color: c.color, padding: "8px 12px", cursor: "pointer", borderRadius: 4, display: "flex", alignItems: "center", gap: 8 }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = c.color + "15"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                    <span>{c.icon}</span> {c.label}
                  </div>
                ))}
              </div>}
            </div>
          </div>
        </div>

        <div style={{ ...S.content, opacity: fadeIn ? 1 : 0, transition: "opacity 0.3s ease" }}>

          {/* === DASHBOARD === */}
          {view === "dashboard" && (<div>
            <div style={{ marginTop: 28, marginBottom: 8 }}>
              <h1 style={{ fontFamily: "'Cinzel', serif", fontSize: 26, fontWeight: 700, color: "#e8dcc8", margin: 0, letterSpacing: 2 }}>The Archives of Aelvarin</h1>
              <p style={{ fontSize: 13, color: "#6b7b8d", marginTop: 4, fontStyle: "italic" }}>"Creation requires sacrifice. To give form costs essence."</p>
            </div>
            <Ornament width={300} />
            <div style={{ display: "flex", gap: 12, marginTop: 24, flexWrap: "wrap" }}>
              {[{ n: stats.total, l: "Total Articles", c: "#f0c040" }, ...Object.entries(CATEGORIES).map(([k, v]) => ({ n: catCounts[k] || 0, l: v.label + "s", c: v.color })), { n: stats.words.toLocaleString(), l: "Total Words", c: "#8ec8a0" }].map((s, i) => (
                <div key={i} style={S.statCard}><div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: s.c }} /><p style={{ fontSize: 22, fontWeight: 700, color: "#e8dcc8", fontFamily: "'Cinzel', serif", margin: 0 }}>{s.n}</p><p style={{ fontSize: 9, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 1.5, marginTop: 4 }}>{s.l}</p></div>
              ))}
            </div>

            {allConflicts.length > 0 && (<>
              <p style={S.sTitle}><span style={{ color: "#e07050" }}>🛡</span> Lore Integrity — <span style={{ color: "#e07050", fontSize: 14 }}>{allConflicts.length} conflict{allConflicts.length !== 1 ? "s" : ""}</span></p>
              <div style={{ background: "rgba(224,112,80,0.04)", border: "1px solid rgba(224,112,80,0.15)", borderRadius: 8, padding: 4 }}>
                {allConflicts.slice(0, 4).map((c) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px", borderBottom: "1px solid rgba(224,112,80,0.08)", cursor: "pointer" }} onClick={() => navigate(c.sourceId)}>
                    <span style={{ fontSize: 16, color: c.severity === "error" ? "#e07050" : "#f0c040", marginTop: 1 }}>{c.severity === "error" ? "✕" : "⚠"}</span>
                    <div style={{ flex: 1 }}><div style={{ fontSize: 12, color: "#d4c9a8", fontWeight: 600, marginBottom: 3 }}>{c.message}</div><div style={{ fontSize: 11, color: "#6b7b8d", fontStyle: "italic" }}>💡 {c.suggestion}</div></div>
                    <span style={S.catBadge(c.severity === "error" ? "#e07050" : "#f0c040")}>{c.severity}</span>
                  </div>
                ))}
                {allConflicts.length > 4 && <div style={{ padding: "10px 14px", textAlign: "center", fontSize: 12, color: "#e07050", cursor: "pointer" }} onClick={() => setView("integrity")}>View all {allConflicts.length} conflicts →</div>}
              </div>
            </>)}

            <p style={S.sTitle}>⚒ Quick Create</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
              {Object.entries(CATEGORIES).map(([k, c]) => (
                <div key={k} style={{ background: "rgba(17,24,39,0.7)", border: "1px solid " + c.color + "33", borderRadius: 8, padding: "16px 12px", cursor: "pointer", textAlign: "center", transition: "all 0.25s" }} onClick={() => goCreate(k)}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = c.color; e.currentTarget.style.transform = "translateY(-2px)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = c.color + "33"; e.currentTarget.style.transform = "none"; }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{c.icon}</div><div style={{ fontSize: 11, color: c.color, fontWeight: 600 }}>New {c.label}</div>
                </div>
              ))}
            </div>

            <p style={S.sTitle}>📜 Recent Edits</p>
            {recent.map((a) => { const ac = conflictsFor(a.id); return (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "rgba(17,24,39,0.5)", border: "1px solid " + (ac.length > 0 ? "rgba(224,112,80,0.3)" : "#151d2e"), borderRadius: 6, marginBottom: 6, cursor: "pointer", transition: "all 0.2s" }} onClick={() => navigate(a.id)}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(17,24,39,0.8)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(17,24,39,0.5)"; }}>
                <span style={{ fontSize: 16, width: 24, textAlign: "center", color: CATEGORIES[a.category]?.color }}>{CATEGORIES[a.category]?.icon}</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: "#c8bda0" }}>{a.title}</span>
                {ac.length > 0 && <span style={{ fontSize: 12, color: "#e07050" }}>⚠ {ac.length}</span>}
                <span style={S.catBadge(CATEGORIES[a.category]?.color)}>{CATEGORIES[a.category]?.label}</span>
                <span style={{ fontSize: 11, color: "#556677", minWidth: 60, textAlign: "right" }}>{timeAgo(a.updatedAt)}</span>
              </div>
            ); })}
          </div>)}

          {/* === LORE INTEGRITY PAGE === */}
          {view === "integrity" && (<div>
            <div style={{ marginTop: 24, marginBottom: 20 }}>
              <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: "#e07050", margin: 0, letterSpacing: 1, display: "flex", alignItems: "center", gap: 10 }}>🛡 Lore Integrity Report</h2>
              <p style={{ fontSize: 13, color: "#6b7b8d", marginTop: 6 }}>Canon conflicts detected across the codex. These occur when articles reference entities outside their known active period.</p>
            </div>
            <Ornament width={300} />
            {allConflicts.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60, color: "#8ec8a0" }}><div style={{ fontSize: 40, marginBottom: 12 }}>✓</div><p style={{ fontSize: 16, fontFamily: "'Cinzel', serif" }}>No Canon Conflicts Detected</p></div>
            ) : (<div style={{ marginTop: 20 }}>
              <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
                {[{ n: allConflicts.filter((c) => c.severity === "error").length, l: "Errors", c: "#e07050" }, { n: allConflicts.filter((c) => c.severity === "warning").length, l: "Warnings", c: "#f0c040" }, { n: new Set(allConflicts.map((c) => c.sourceId)).size, l: "Articles Affected", c: "#7ec8e3" }].map((s, i) => (
                  <div key={i} style={{ ...S.statCard, flex: "0 0 auto", padding: "14px 24px" }}><div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: s.c }} /><p style={{ fontSize: 22, fontWeight: 700, color: s.c, fontFamily: "'Cinzel', serif", margin: 0 }}>{s.n}</p><p style={{ fontSize: 10, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 1.5, marginTop: 4 }}>{s.l}</p></div>
                ))}
              </div>
              {allConflicts.map((c) => (
                <div key={c.id} style={{ background: "rgba(17,24,39,0.5)", border: "1px solid " + (c.severity === "error" ? "rgba(224,112,80,0.25)" : "rgba(240,192,64,0.2)"), borderLeft: "3px solid " + (c.severity === "error" ? "#e07050" : "#f0c040"), borderRadius: 6, padding: "16px 20px", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <span style={{ fontSize: 18, color: c.severity === "error" ? "#e07050" : "#f0c040" }}>{c.severity === "error" ? "✕" : "⚠"}</span>
                    <div style={{ flex: 1 }}>
                      <span style={S.catBadge(c.severity === "error" ? "#e07050" : "#f0c040")}>{c.severity} · Temporal Conflict</span>
                      <p style={{ fontSize: 13, color: "#d4c9a8", margin: "8px 0", lineHeight: 1.6 }}>{c.message}</p>
                      <p style={{ fontSize: 12, color: "#8899aa", margin: 0, fontStyle: "italic" }}>💡 {c.suggestion}</p>
                      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                        <span style={{ fontSize: 11, color: "#7ec8e3", cursor: "pointer", padding: "4px 12px", background: "rgba(126,200,227,0.1)", borderRadius: 12 }} onClick={() => navigate(c.sourceId)}>View "{c.sourceTitle}" →</span>
                        <span style={{ fontSize: 11, color: "#f0c040", cursor: "pointer", padding: "4px 12px", background: "rgba(240,192,64,0.1)", borderRadius: 12 }} onClick={() => navigate(c.targetId)}>View "{c.targetTitle}" →</span>
                        <span style={{ fontSize: 11, color: "#556677", cursor: "pointer", padding: "4px 12px", background: "rgba(85,102,119,0.1)", borderRadius: 12 }} onClick={() => setDismissedConflicts((p) => new Set([...p, c.id]))}>Dismiss</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>)}
          </div>)}

          {/* === ARCHIVES === */}
          {view === "archives" && (<div>
            <div style={{ marginTop: 24, marginBottom: 20 }}>
              <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: "#f0c040", margin: 0, letterSpacing: 1, display: "flex", alignItems: "center", gap: 10 }}>📦 Archives</h2>
              <p style={{ fontSize: 13, color: "#6b7b8d", marginTop: 6 }}>Entries moved here can be restored to the codex or permanently deleted.</p>
            </div>
            <Ornament width={300} />
            {archived.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60, color: "#556677" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
                <p style={{ fontSize: 16, fontFamily: "'Cinzel', serif" }}>The Archives Are Empty</p>
                <p style={{ fontSize: 13, color: "#445566", marginTop: 4 }}>Archived entries will appear here.</p>
              </div>
            ) : (<div style={{ marginTop: 20 }}>
              {archived.map((a) => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 14, background: "rgba(17,24,39,0.6)", border: "1px solid #1a2435", borderRadius: 8, padding: "14px 18px", marginBottom: 8, opacity: 0.85 }}>
                  <div style={{ fontSize: 20, color: CATEGORIES[a.category]?.color, opacity: 0.6 }}>{CATEGORIES[a.category]?.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "#8899aa" }}>{a.title}</span>
                      <span style={S.catBadge(CATEGORIES[a.category]?.color)}>{CATEGORIES[a.category]?.label}</span>
                    </div>
                    <p style={{ fontSize: 11, color: "#556677", margin: 0 }}>Archived {timeAgo(a.archivedAt)}</p>
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

          {/* === TIMELINE === */}
          {view === "timeline" && (<div style={{ margin: "0 -28px", height: "calc(100vh - 56px)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Timeline Header */}
            <div style={{ padding: "20px 28px 12px", borderBottom: "1px solid #1a2435", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <div>
                <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: "#e8dcc8", margin: 0, letterSpacing: 1, display: "flex", alignItems: "center", gap: 10 }}>⏳ Timeline of Aelvarin</h2>
                <p style={{ fontSize: 12, color: "#6b7b8d", marginTop: 4 }}>{tlData.items.length} temporal entries across {Object.keys(tlData.lanes).length} categories</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "#556677", letterSpacing: 0.5 }}>ZOOM</span>
                <button onClick={() => setTlZoom((z) => Math.max(0, z - 1))} style={{ ...S.btnS, padding: "4px 10px", fontSize: 14, lineHeight: 1 }} disabled={tlZoom <= 0}>−</button>
                <div style={{ width: 80, height: 4, background: "#1e2a3a", borderRadius: 2, position: "relative" }}>
                  <div style={{ position: "absolute", left: `${(tlZoom / 6) * 100}%`, top: -4, width: 12, height: 12, background: "#f0c040", borderRadius: "50%", transform: "translateX(-50%)", boxShadow: "0 0 8px rgba(240,192,64,0.4)" }} />
                </div>
                <button onClick={() => setTlZoom((z) => Math.min(6, z + 1))} style={{ ...S.btnS, padding: "4px 10px", fontSize: 14, lineHeight: 1 }} disabled={tlZoom >= 6}>+</button>
              </div>
            </div>

            {/* Timeline Body */}
            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
              {/* Swim Lane Labels */}
              <div ref={tlLabelRef} onScroll={(e) => { if (tlSyncing.current) return; tlSyncing.current = true; if (tlRef.current) tlRef.current.scrollTop = e.target.scrollTop; tlSyncing.current = false; }} style={{ width: 160, minWidth: 160, borderRight: "1px solid #1a2435", background: "rgba(10,14,26,0.6)", flexShrink: 0, overflowY: "auto" }}>
                {/* Era header spacer */}
                <div style={{ height: 52, borderBottom: "1px solid #1a2435", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 10, color: "#445566", letterSpacing: 2, textTransform: "uppercase" }}>Categories</span>
                </div>
                {/* Tick row spacer */}
                <div style={{ height: 28, borderBottom: "1px solid #151d2e" }} />
                {SWIM_LANE_ORDER.map((cat) => {
                  if (!tlData.lanes[cat]) return null;
                  const c = CATEGORIES[cat];
                  const h = tlLaneHeights[cat] || 50;
                  return (
                    <div key={cat} style={{ height: h, minHeight: 50, borderBottom: "1px solid #151d2e", display: "flex", alignItems: "center", gap: 8, padding: "0 16px" }}>
                      <span style={{ fontSize: 16, color: c.color }}>{c.icon}</span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: c.color, letterSpacing: 0.5 }}>{c.label}s</div>
                        <div style={{ fontSize: 10, color: "#556677" }}>{tlData.lanes[cat].length} entries</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Scrollable Timeline Canvas */}
              <div ref={tlRef} onScroll={(e) => { if (tlSyncing.current) return; tlSyncing.current = true; if (tlLabelRef.current) tlLabelRef.current.scrollTop = e.target.scrollTop; tlSyncing.current = false; }} style={{ flex: 1, overflowX: "auto", overflowY: "auto", position: "relative" }}>
                <div style={{ width: Math.max(tlTotalWidth + 100, 800), minHeight: "100%", position: "relative" }}>
                  {/* Era Bands */}
                  <div style={{ height: 52, position: "sticky", top: 0, zIndex: 10, display: "flex", background: "rgba(10,14,26,0.95)", borderBottom: "1px solid #1a2435", backdropFilter: "blur(8px)" }}>
                    {ERAS.map((era) => {
                      const x = yearToX(Math.max(era.start, tlRange.min));
                      const xEnd = yearToX(Math.min(era.end, tlRange.max));
                      const w = xEnd - x;
                      if (w <= 0) return null;
                      return (
                        <div key={era.id} style={{ position: "absolute", left: x, width: w, height: "100%", background: era.bg, borderRight: "1px solid " + era.color + "30", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                          <span style={{ fontFamily: "'Cinzel', serif", fontSize: w > 200 ? 12 : 9, color: era.color, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600, whiteSpace: "nowrap", opacity: w > 60 ? 1 : 0.5 }}>{w > 140 ? era.label : era.label.split("—")[0]?.trim()}</span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Year Ticks */}
                  <div style={{ height: 28, position: "relative", borderBottom: "1px solid #151d2e" }}>
                    {tlTicks.ticks.map((y) => (
                      <div key={y} style={{ position: "absolute", left: yearToX(y), top: 0, height: "100%" }}>
                        <div style={{ width: 1, height: "100%", background: "#1a2435" }} />
                        <span style={{ position: "absolute", top: 6, left: 4, fontSize: 9, color: "#556677", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{y < 0 ? `${Math.abs(y)} BA` : `Year ${y.toLocaleString()}`}</span>
                      </div>
                    ))}
                  </div>

                  {/* Swim Lanes */}
                  {SWIM_LANE_ORDER.map((cat) => {
                    if (!tlData.lanes[cat]) return null;
                    const c = CATEGORIES[cat];
                    // Compute stagger rows to avoid overlap
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
                      <div key={cat} style={{ height: laneH, minHeight: 50, borderBottom: "1px solid #151d2e", position: "relative" }}>
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
                                onMouseEnter={(e) => { e.currentTarget.style.background = c.color + "35"; e.currentTarget.style.borderColor = c.color; e.currentTarget.style.zIndex = "10"; }}
                                onMouseLeave={(e) => { if (!isSelected) { e.currentTarget.style.background = c.color + "18"; e.currentTarget.style.borderColor = c.color + "50"; e.currentTarget.style.zIndex = "1"; } }}>
                                <span style={{ fontSize: 10, color: isSelected ? "#e8dcc8" : c.color, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", letterSpacing: 0.3 }}>
                                  {a.title}{isDead ? " †" : ""}
                                </span>
                              </div>
                            );
                          }
                          // Point marker — label on hover only
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
                              <div className="tl-tip" style={{ position: "absolute", top: -20, left: "50%", transform: "translateX(-50%)", fontSize: 9, color: "#d4c9a8", whiteSpace: "nowrap", background: "rgba(10,14,26,0.95)", padding: "2px 8px", borderRadius: 4, border: "1px solid " + c.color + "40", zIndex: 20 }}>{a.title}{isDead ? " †" : ""}</div>
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
                borderLeft: tlPanelOpen ? "1px solid #1a2435" : "none",
                background: "rgba(10,14,26,0.95)", backdropFilter: "blur(10px)",
                transition: "all 0.3s ease", overflow: "hidden", flexShrink: 0,
              }}>
                {tlSelected && (
                  <div style={{ width: 320, padding: "20px 18px", overflowY: "auto", height: "100%" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                      <span style={S.catBadge(CATEGORIES[tlSelected.category]?.color)}>
                        {CATEGORIES[tlSelected.category]?.icon} {CATEGORIES[tlSelected.category]?.label}
                      </span>
                      <span onClick={tlClosePanel} style={{ fontSize: 16, color: "#556677", cursor: "pointer", padding: "4px 8px", borderRadius: 4 }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "#d4c9a8"; }} onMouseLeave={(e) => { e.currentTarget.style.color = "#556677"; }}>✕</span>
                    </div>
                    <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 18, color: "#e8dcc8", margin: "0 0 6px", letterSpacing: 0.5 }}>{tlSelected.title}</h3>
                    <p style={{ fontSize: 12, color: "#8899aa", fontStyle: "italic", lineHeight: 1.5, margin: "0 0 16px" }}>{tlSelected.summary}</p>
                    <Ornament width={280} />

                    {/* Temporal badge */}
                    <div style={{ fontSize: 11, color: "#556677", margin: "14px 0", padding: "6px 10px", background: "rgba(85,102,119,0.08)", borderRadius: 6, display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <span>⏳ {tlSelected.temporal?.type}</span>
                      {tlSelected.temporal?.active_start != null && <span>From: Year {tlSelected.temporal.active_start}</span>}
                      {tlSelected.temporal?.active_end != null && <span>To: Year {tlSelected.temporal.active_end}</span>}
                      {tlSelected.temporal?.death_year && <span style={{ color: "#e07050" }}>† Year {tlSelected.temporal.death_year}</span>}
                    </div>

                    {/* Key fields */}
                    {tlSelected.fields && Object.keys(tlSelected.fields).length > 0 && (
                      <div style={{ marginBottom: 16 }}>
                        {Object.entries(tlSelected.fields).slice(0, 4).map(([k, v]) => (
                          <div key={k} style={{ display: "flex", padding: "5px 0", borderBottom: "1px solid #111827" }}>
                            <div style={{ width: 100, fontSize: 10, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>{FIELD_LABELS[k] || k}</div>
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
                      <div style={{ fontSize: 12, color: "#8899aa", lineHeight: 1.7, marginTop: 12, maxHeight: 200, overflow: "hidden", position: "relative" }}>
                        <RenderBody text={tlSelected.body.split("\n")[0]} articles={articles} onNavigate={(id) => { tlClosePanel(); navigate(id); }} />
                        {tlSelected.body.split("\n").length > 1 && <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 40, background: "linear-gradient(transparent, rgba(10,14,26,0.95))" }} />}
                      </div>
                    )}

                    {/* Tags */}
                    {tlSelected.tags?.length > 0 && (
                      <div style={{ marginTop: 14 }}>{tlSelected.tags.map((t) => <span key={t} style={{ ...S.tag, fontSize: 10, padding: "2px 8px" }}>#{t}</span>)}</div>
                    )}

                    {/* Action buttons */}
                    <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
                      <button onClick={() => { tlClosePanel(); navigate(tlSelected.id); }} style={{ ...S.btnP, padding: "8px 16px", fontSize: 11 }}>View Full Entry →</button>
                      <button onClick={() => { tlClosePanel(); goEdit(tlSelected); }} style={{ ...S.btnS, padding: "7px 14px", fontSize: 11 }}>✎ Edit</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>)}

          {/* === AI DOCUMENT IMPORT === */}
          {view === "ai_import" && (<div>
            <div style={{ marginTop: 24, marginBottom: 20 }}>
              <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: "#e8dcc8", margin: 0, letterSpacing: 1, display: "flex", alignItems: "center", gap: 10 }}>🧠 AI Document Import</h2>
              <p style={{ fontSize: 13, color: "#6b7b8d", marginTop: 6, lineHeight: 1.6 }}>Upload a lore document and AI will parse it into structured codex entries for your review.</p>
            </div>
            <Ornament width={300} />

            <div style={{ marginTop: 24, maxWidth: 640 }}>
              <div onClick={() => aiFileRef.current?.click()} style={{
                border: "2px dashed rgba(240,192,64,0.3)", borderRadius: 12, padding: "48px 32px", textAlign: "center",
                cursor: aiParsing ? "wait" : "pointer", transition: "all 0.3s",
                background: aiParsing ? "rgba(240,192,64,0.04)" : "rgba(17,24,39,0.4)",
              }}
                onMouseEnter={(e) => { if (!aiParsing) { e.currentTarget.style.borderColor = "rgba(240,192,64,0.6)"; e.currentTarget.style.background = "rgba(240,192,64,0.06)"; } }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(240,192,64,0.3)"; e.currentTarget.style.background = aiParsing ? "rgba(240,192,64,0.04)" : "rgba(17,24,39,0.4)"; }}>
                {aiParsing ? (<>
                  <div style={{ fontSize: 36, marginBottom: 12, animation: "pulse 1.5s ease-in-out infinite" }}>🧠</div>
                  <style>{`@keyframes pulse { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }`}</style>
                  <p style={{ fontFamily: "'Cinzel', serif", fontSize: 16, color: "#f0c040", margin: "0 0 6px" }}>Analyzing Document…</p>
                  <p style={{ fontSize: 12, color: "#6b7b8d" }}>AI is reading "{aiSourceName}" and extracting lore entries</p>
                </>) : (<>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>📄</div>
                  <p style={{ fontFamily: "'Cinzel', serif", fontSize: 16, color: "#d4c9a8", margin: "0 0 6px" }}>Drop or Click to Upload</p>
                  <p style={{ fontSize: 12, color: "#6b7b8d" }}>Supports .txt, .md, and .docx files with lore, worldbuilding notes, language docs, bestiary entries, etc.</p>
                </>)}
              </div>

              {aiParseError && <WarningBanner severity="error" icon="✕" title="Parse Error" style={{ marginTop: 16 }}>{aiParseError}</WarningBanner>}

              <div style={{ marginTop: 28 }}>
                <p style={{ fontFamily: "'Cinzel', serif", fontSize: 14, color: "#d4c9a8", marginBottom: 12, letterSpacing: 0.5 }}>◈ How It Works</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    { step: "1", title: "Upload", desc: "Upload a .txt, .md, or .docx document containing your lore, canon data, language specs, creature descriptions, or cultural notes." },
                    { step: "2", title: "AI Parsing", desc: "Claude reads your document and extracts structured entries, mapping each to the right category with filled template fields." },
                    { step: "3", title: "Review", desc: "Parsed entries appear in the Staging Area. Review each one — approve, edit, or reject before committing to the codex." },
                    { step: "4", title: "Commit", desc: "Approved entries are added to your codex with full cross-referencing, temporal data, and integrity checking." },
                  ].map((s) => (
                    <div key={s.step} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(240,192,64,0.12)", border: "1px solid rgba(240,192,64,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "#f0c040", flexShrink: 0 }}>{s.step}</div>
                      <div><div style={{ fontSize: 13, fontWeight: 600, color: "#d4c9a8" }}>{s.title}</div><div style={{ fontSize: 12, color: "#6b7b8d", marginTop: 2, lineHeight: 1.5 }}>{s.desc}</div></div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 28, padding: "16px 20px", background: "rgba(126,200,227,0.06)", border: "1px solid rgba(126,200,227,0.15)", borderRadius: 8 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: "#7ec8e3", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: 1 }}>Supported Categories</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {Object.entries(CATEGORIES).map(([k, c]) => (
                    <span key={k} style={S.catBadge(c.color)}>{c.icon} {c.label}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>)}

          {/* === STAGING AREA === */}
          {view === "staging" && (<div>
            <div style={{ marginTop: 24, marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: "#e8dcc8", margin: 0, letterSpacing: 1, display: "flex", alignItems: "center", gap: 10 }}>📋 Staging Area</h2>
                  <p style={{ fontSize: 13, color: "#6b7b8d", marginTop: 6 }}>{aiStaging.length} entries parsed{aiSourceName ? " from \"" + aiSourceName + "\"" : ""}</p>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={stagingApproveAll} style={{ ...S.btnS, fontSize: 11, padding: "7px 14px", color: "#8ec8a0", borderColor: "rgba(142,200,160,0.3)" }}>✓ Approve All Pending</button>
                  <button onClick={stagingCommit} disabled={!aiStaging.some((e) => e._status === "approved" || e._status === "edited")} style={{ ...S.btnP, fontSize: 11, padding: "8px 16px", opacity: aiStaging.some((e) => e._status === "approved" || e._status === "edited") ? 1 : 0.4 }}>Commit to Codex</button>
                </div>
              </div>
            </div>
            <Ornament width={300} />

            {/* Status summary */}
            <div style={{ display: "flex", gap: 12, margin: "16px 0 20px" }}>
              {[
                { n: aiStaging.filter((e) => e._status === "pending").length, l: "Pending", c: "#f0c040" },
                { n: aiStaging.filter((e) => e._status === "approved" || e._status === "edited").length, l: "Approved", c: "#8ec8a0" },
                { n: aiStaging.filter((e) => e._status === "rejected").length, l: "Rejected", c: "#e07050" },
              ].map((s, i) => (
                <div key={i} style={{ padding: "8px 18px", background: s.c + "0c", border: "1px solid " + s.c + "25", borderRadius: 6, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: s.c, fontFamily: "'Cinzel', serif" }}>{s.n}</span>
                  <span style={{ fontSize: 11, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 1 }}>{s.l}</span>
                </div>
              ))}
            </div>

            {aiStaging.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60, color: "#556677" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                <p style={{ fontSize: 16, fontFamily: "'Cinzel', serif" }}>No Entries in Staging</p>
                <p style={{ fontSize: 13, color: "#445566", marginTop: 4 }}>Use AI Document Import to parse a lore document.</p>
                <button onClick={() => setView("ai_import")} style={{ ...S.btnP, marginTop: 16, fontSize: 12 }}>Go to AI Import</button>
              </div>
            ) : (
              <div>{aiStaging.map((entry) => {
                const c = CATEGORIES[entry.category] || { label: "Unknown", icon: "?", color: "#888" };
                const stColor = entry._status === "approved" || entry._status === "edited" ? "#8ec8a0" : entry._status === "rejected" ? "#e07050" : "#f0c040";
                return (
                  <div key={entry._stagingId} style={{ background: "rgba(17,24,39,0.6)", border: "1px solid " + (entry._status === "rejected" ? "rgba(224,112,80,0.2)" : "#1a2435"), borderLeft: "3px solid " + stColor, borderRadius: 8, padding: "16px 20px", marginBottom: 10, opacity: entry._status === "rejected" ? 0.5 : 1, transition: "all 0.3s" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                      <span style={{ fontSize: 20, color: c.color, marginTop: 2 }}>{c.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: "#d4c9a8" }}>{entry.title}</span>
                          <span style={S.catBadge(c.color)}>{c.label}</span>
                          <span style={{ ...S.catBadge(stColor), textTransform: "capitalize" }}>{entry._status === "edited" ? "✎ edited" : entry._status}</span>
                        </div>
                        <p style={{ fontSize: 12, color: "#8899aa", margin: "0 0 8px", lineHeight: 1.5 }}>{entry.summary}</p>
                        {entry.fields && Object.keys(entry.fields).length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                            {Object.entries(entry.fields).slice(0, 4).map(([k, v]) => v ? (
                              <span key={k} style={{ fontSize: 10, color: "#6b7b8d", background: "rgba(85,102,119,0.1)", padding: "2px 8px", borderRadius: 8 }}>{FIELD_LABELS[k] || k}: {typeof v === "string" ? v.slice(0, 40) : v}{typeof v === "string" && v.length > 40 ? "…" : ""}</span>
                            ) : null)}
                          </div>
                        )}
                        {entry.body && <p style={{ fontSize: 11, color: "#6b7b8d", margin: 0, lineHeight: 1.5 }}>{entry.body.slice(0, 200)}{entry.body.length > 200 ? "…" : ""}</p>}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                        {entry._status !== "approved" && entry._status !== "edited" && (
                          <button onClick={() => stagingApprove(entry._stagingId)} style={{ fontSize: 10, color: "#8ec8a0", background: "rgba(142,200,160,0.1)", border: "1px solid rgba(142,200,160,0.2)", borderRadius: 5, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>✓ Approve</button>
                        )}
                        {entry._status !== "rejected" && (
                          <button onClick={() => stagingReject(entry._stagingId)} style={{ fontSize: 10, color: "#e07050", background: "rgba(224,112,80,0.1)", border: "1px solid rgba(224,112,80,0.2)", borderRadius: 5, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>✕ Reject</button>
                        )}
                        {entry._status === "rejected" && (
                          <button onClick={() => stagingApprove(entry._stagingId)} style={{ fontSize: 10, color: "#f0c040", background: "rgba(240,192,64,0.1)", border: "1px solid rgba(240,192,64,0.2)", borderRadius: 5, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>↩ Restore</button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}</div>
            )}
          </div>)}

          {/* === CODEX === */}
          {view === "codex" && (<div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 24, marginBottom: 20 }}>
              <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 20, color: "#e8dcc8", margin: 0, letterSpacing: 1 }}>{codexFilter === "all" ? "The Full Codex" : (CATEGORIES[codexFilter]?.label || "") + "s"}</h2>
              <Ornament width={160} /><span style={{ fontSize: 12, color: "#556677" }}>{filtered.length} entries</span>
            </div>
            <div style={{ display: "flex", gap: 5, marginBottom: 20, flexWrap: "wrap" }}>
              {[{ key: "all", label: "All", color: "#f0c040" }, ...Object.entries(CATEGORIES).map(([k, v]) => ({ key: k, label: v.label, color: v.color }))].map((f) => (
                <div key={f.key} onClick={() => setCodexFilter(f.key)} style={{ fontSize: 11, padding: "4px 12px", borderRadius: 20, cursor: "pointer", letterSpacing: 0.5, fontWeight: codexFilter === f.key ? 600 : 400, background: codexFilter === f.key ? f.color + "20" : "transparent", color: codexFilter === f.key ? f.color : "#556677", border: "1px solid " + (codexFilter === f.key ? f.color + "40" : "#1e2a3a") }}>{f.label}</div>
              ))}
            </div>
            {filtered.map((a) => { const ac = conflictsFor(a.id); return (
              <div key={a.id} style={{ display: "flex", alignItems: "flex-start", gap: 14, background: "rgba(17,24,39,0.6)", border: "1px solid " + (ac.length > 0 ? "rgba(224,112,80,0.3)" : "#1a2435"), borderRadius: 8, padding: "16px 20px", marginBottom: 8, cursor: "pointer", transition: "all 0.2s" }} onClick={() => navigate(a.id)}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(17,24,39,0.85)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(17,24,39,0.6)"; }}>
                {a.portrait ? (
                  <div style={{ width: 36, height: 36, borderRadius: 6, overflow: "hidden", border: "1px solid " + (CATEGORIES[a.category]?.color || "#888") + "40", flexShrink: 0, marginTop: 2 }}><img src={a.portrait} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
                ) : (
                  <div style={{ fontSize: 22, color: CATEGORIES[a.category]?.color, marginTop: 2 }}>{CATEGORIES[a.category]?.icon}</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#d4c9a8" }}>{a.title}</span>
                    <span style={S.catBadge(CATEGORIES[a.category]?.color)}>{CATEGORIES[a.category]?.label}</span>
                    {ac.length > 0 && <span style={{ ...S.catBadge("#e07050"), gap: 3 }}>⚠ {ac.length} conflict{ac.length > 1 ? "s" : ""}</span>}
                  </div>
                  <p style={{ fontSize: 12, color: "#7a8a9a", margin: 0, lineHeight: 1.5 }}>{a.summary}</p>
                  <div style={{ marginTop: 6 }}>{a.tags?.slice(0, 5).map((t) => <span key={t} style={S.tag}>#{t}</span>)}</div>
                </div>
                <span style={{ fontSize: 11, color: "#445566", whiteSpace: "nowrap" }}>{timeAgo(a.updatedAt)}</span>
              </div>
            ); })}
            {filtered.length === 0 && <div style={{ textAlign: "center", padding: 60, color: "#445566" }}><div style={{ fontSize: 32, marginBottom: 12 }}>⌕</div><p>No entries found.</p></div>}
          </div>)}

          {/* === ARTICLE VIEW === */}
          {view === "article" && activeArticle && (
            <div style={{ display: "flex", gap: 0, overflow: "hidden", margin: "0 -28px", height: "calc(100vh - 56px)" }}>
              <div style={{ flex: 1, overflowY: "auto", padding: "0 28px 40px" }}>
                <div style={{ fontSize: 11, color: "#556677", marginTop: 20, marginBottom: 16, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ cursor: "pointer", color: "#6b7b8d" }} onClick={goDash}>Dashboard</span><span>›</span>
                  <span style={{ cursor: "pointer", color: "#6b7b8d" }} onClick={() => goCodex(activeArticle.category)}>{CATEGORIES[activeArticle.category]?.label}s</span><span>›</span>
                  <span style={{ color: CATEGORIES[activeArticle.category]?.color }}>{activeArticle.title}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8 }}>
                  <span style={{ fontSize: 28, color: CATEGORIES[activeArticle.category]?.color }}>{CATEGORIES[activeArticle.category]?.icon}</span>
                  <div style={{ flex: 1 }}>
                    <h1 style={{ fontFamily: "'Cinzel', serif", fontSize: 24, fontWeight: 700, color: "#e8dcc8", margin: 0, letterSpacing: 1 }}>{activeArticle.title}</h1>
                    <span style={{ ...S.catBadge(CATEGORIES[activeArticle.category]?.color), marginTop: 6 }}>{CATEGORIES[activeArticle.category]?.label}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => goEdit(activeArticle)} style={{ fontSize: 11, color: "#f0c040", background: "rgba(240,192,64,0.1)", border: "1px solid rgba(240,192,64,0.25)", borderRadius: 6, padding: "7px 16px", cursor: "pointer", fontFamily: "'Cinzel', serif", fontWeight: 600, letterSpacing: 0.5 }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(240,192,64,0.2)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(240,192,64,0.1)"; }}>✎ Edit</button>
                    <button onClick={() => setShowDeleteModal(activeArticle)} style={{ fontSize: 11, color: "#e07050", background: "rgba(224,112,80,0.1)", border: "1px solid rgba(224,112,80,0.25)", borderRadius: 6, padding: "7px 16px", cursor: "pointer", fontFamily: "'Cinzel', serif", fontWeight: 600, letterSpacing: 0.5 }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(224,112,80,0.2)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(224,112,80,0.1)"; }}>🗑 Delete</button>
                  </div>
                </div>
                <p style={{ fontSize: 14, color: "#8899aa", fontStyle: "italic", lineHeight: 1.6, margin: "8px 0 16px" }}>{activeArticle.summary}</p>

                {/* Portrait */}
                {activeArticle.portrait && (
                  <div style={{ float: "right", marginLeft: 20, marginBottom: 16, marginTop: 4 }}>
                    <div style={{ width: 180, borderRadius: 8, overflow: "hidden", border: "2px solid " + (CATEGORIES[activeArticle.category]?.color || "#f0c040") + "40", boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }}>
                      <img src={activeArticle.portrait} alt={activeArticle.title} style={{ width: "100%", height: "auto", display: "block" }} />
                    </div>
                    <p style={{ fontSize: 9, color: "#445566", textAlign: "center", marginTop: 6, textTransform: "uppercase", letterSpacing: 1 }}>Portrait</p>
                  </div>
                )}
                <Ornament width={260} />

                {conflictsFor(activeArticle.id).map((c) => (
                  <WarningBanner key={c.id} severity={c.severity} icon={c.severity === "error" ? "✕" : "⚠"} title="Canon Conflict Detected" style={{ marginTop: 16 }}>
                    <p style={{ margin: "0 0 6px" }}>{c.message}</p>
                    <p style={{ margin: 0, color: "#6b7b8d", fontStyle: "italic" }}>💡 {c.suggestion}</p>
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <span style={{ fontSize: 11, color: "#f0c040", cursor: "pointer", textDecoration: "underline" }} onClick={() => navigate(c.targetId)}>View {c.targetTitle}</span>
                      <span style={{ fontSize: 11, color: "#556677", cursor: "pointer" }} onClick={() => setDismissedConflicts((p) => new Set([...p, c.id]))}>Dismiss</span>
                    </div>
                  </WarningBanner>
                ))}

                {activeArticle.fields && Object.keys(activeArticle.fields).length > 0 && (
                  <div style={{ marginTop: 20, marginBottom: 24, background: "rgba(17,24,39,0.4)", border: "1px solid #151d2e", borderRadius: 8, padding: "12px 18px" }}>
                    {Object.entries(activeArticle.fields).map(([k, v]) => (
                      <div key={k} style={{ display: "flex", borderBottom: "1px solid #111827", padding: "8px 0" }}>
                        <div style={{ width: 140, minWidth: 140, fontSize: 11, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 1, fontWeight: 600, paddingTop: 2 }}>{FIELD_LABELS[k] || k}</div>
                        <div style={{ flex: 1, fontSize: 13, color: "#c8bda0", lineHeight: 1.5 }}>{v}</div>
                      </div>
                    ))}
                  </div>
                )}

                {activeArticle.temporal && (
                  <div style={{ fontSize: 11, color: "#556677", marginBottom: 16, padding: "6px 12px", background: "rgba(85,102,119,0.08)", borderRadius: 6, display: "inline-flex", gap: 12, flexWrap: "wrap" }}>
                    <span>⏳ {activeArticle.temporal.type}</span>
                    {activeArticle.temporal.active_start != null && <span>Active from: Year {activeArticle.temporal.active_start}</span>}
                    {activeArticle.temporal.active_end != null && <span>Until: Year {activeArticle.temporal.active_end}</span>}
                    {activeArticle.temporal.death_year && <span style={{ color: "#e07050" }}>† Year {activeArticle.temporal.death_year}</span>}
                  </div>
                )}

                <div style={{ fontSize: 14, color: "#b0a890", lineHeight: 1.8 }}>
                  {activeArticle.body?.split("\n").map((p, i) => <p key={i} style={{ margin: "0 0 14px" }}><RenderBody text={p} articles={articles} onNavigate={navigate} /></p>)}
                </div>
                {activeArticle.tags?.length > 0 && (
                  <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid #151d2e" }}>
                    <span style={{ fontSize: 10, color: "#556677", marginRight: 8, textTransform: "uppercase", letterSpacing: 1 }}>Tags:</span>
                    {activeArticle.tags.map((t) => <span key={t} style={{ ...S.tag, fontSize: 11, padding: "3px 10px" }}>#{t}</span>)}
                  </div>
                )}
                <div style={{ marginTop: 16, fontSize: 11, color: "#445566" }}>Created {new Date(activeArticle.createdAt).toLocaleDateString()} · Updated {timeAgo(activeArticle.updatedAt)}</div>
              </div>

              {/* SIDEBAR */}
              <div style={{ width: 280, minWidth: 280, borderLeft: "1px solid #1a2435", overflowY: "auto", padding: "20px 18px", background: "rgba(10,14,26,0.4)" }}>
                <p style={{ fontFamily: "'Cinzel', serif", fontSize: 12, fontWeight: 600, color: "#8899aa", letterSpacing: 1, textTransform: "uppercase", marginTop: 0, marginBottom: 12 }}>Related Articles</p>
                {activeArticle.linkedIds?.map((lid) => { const lk = articles.find((a) => a.id === lid); if (!lk) return <div key={lid} style={{ ...S.relItem, opacity: 0.5, cursor: "default" }}><span style={{ fontSize: 12, color: "#445566" }}>✦</span><span style={{ fontStyle: "italic" }}>{lid} (unwritten)</span></div>;
                  return <div key={lid} style={S.relItem} onClick={() => navigate(lid)} onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(17,24,39,0.8)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(17,24,39,0.5)"; }}><span style={{ fontSize: 14, color: CATEGORIES[lk.category]?.color }}>{CATEGORIES[lk.category]?.icon}</span><div style={{ flex: 1 }}><div style={{ fontWeight: 500, color: "#c8bda0", fontSize: 12 }}>{lk.title}</div><div style={{ fontSize: 10, color: "#556677", marginTop: 1 }}>{CATEGORIES[lk.category]?.label}</div></div></div>;
                })}

                {(() => { const sugs = findUnlinkedMentions(activeArticle.body, activeArticle.fields, articles, activeArticle.linkedIds || []); if (!sugs.length) return null; return (<>
                  <p style={{ fontFamily: "'Cinzel', serif", fontSize: 12, fontWeight: 600, color: "#7ec8e3", letterSpacing: 1, textTransform: "uppercase", marginTop: 24, marginBottom: 8 }}>💡 Suggested Links</p>
                  <p style={{ fontSize: 10, color: "#556677", margin: "0 0 8px" }}>Unlinked references detected</p>
                  {sugs.map((s) => <div key={s.article.id} style={{ ...S.relItem, borderLeft: "2px solid rgba(126,200,227,0.3)" }} onClick={() => navigate(s.article.id)} onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(126,200,227,0.08)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(17,24,39,0.5)"; }}>
                    <span style={{ fontSize: 14, color: CATEGORIES[s.article.category]?.color }}>{CATEGORIES[s.article.category]?.icon}</span>
                    <div style={{ flex: 1 }}><div style={{ fontWeight: 500, color: "#c8bda0", fontSize: 12 }}>{s.article.title}</div><div style={{ fontSize: 10, color: "#7ec8e3" }}>matched: "{s.match}" · {s.confidence}</div></div>
                  </div>)}
                </>); })()}

                {(() => { const br = articles.filter((a) => a.id !== activeArticle.id && a.linkedIds?.includes(activeArticle.id)); if (!br.length) return null; return (<>
                  <p style={{ fontFamily: "'Cinzel', serif", fontSize: 12, fontWeight: 600, color: "#8899aa", letterSpacing: 1, textTransform: "uppercase", marginTop: 24, marginBottom: 12 }}>Referenced By</p>
                  {br.map((r) => <div key={r.id} style={S.relItem} onClick={() => navigate(r.id)} onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(17,24,39,0.8)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(17,24,39,0.5)"; }}>
                    <span style={{ fontSize: 14, color: CATEGORIES[r.category]?.color }}>{CATEGORIES[r.category]?.icon}</span>
                    <div><div style={{ fontWeight: 500, color: "#c8bda0", fontSize: 12 }}>{r.title}</div><div style={{ fontSize: 10, color: "#556677", marginTop: 1 }}>{CATEGORIES[r.category]?.label}</div></div>
                  </div>)}
                </>); })()}

                <p style={{ fontFamily: "'Cinzel', serif", fontSize: 12, fontWeight: 600, color: "#8899aa", letterSpacing: 1, textTransform: "uppercase", marginTop: 24, marginBottom: 12 }}>Tags</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{activeArticle.tags?.map((t) => <span key={t} style={{ ...S.tag, cursor: "pointer", fontSize: 11, padding: "3px 10px" }} onClick={() => { setSearchQuery(t); goCodex("all"); }}>#{t}</span>)}</div>
              </div>
            </div>
          )}

          {/* === CREATE / EDIT === */}
          {view === "create" && createCat && (<div style={{ maxWidth: 680, marginTop: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <span style={{ fontSize: 24, color: CATEGORIES[createCat]?.color }}>{CATEGORIES[createCat]?.icon}</span>
              <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 20, color: "#e8dcc8", margin: 0 }}>{editingId ? "Edit" : "New"} {CATEGORIES[createCat]?.label}</h2>
              {editingId && <span style={{ fontSize: 11, color: "#556677", background: "rgba(85,102,119,0.15)", padding: "3px 10px", borderRadius: 10 }}>Editing: {editingId}</span>}
            </div>
            <Ornament width={260} />
            <div style={{ marginTop: 20 }}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 11, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Title</label>
                <input style={{ ...S.input, ...(liveDupes.length > 0 ? { borderColor: "#e07050" } : {}) }} value={formData.title} onChange={(e) => setFormData((p) => ({ ...p, title: e.target.value }))} placeholder={"Name this " + CATEGORIES[createCat]?.label.toLowerCase() + "..."} />
                {liveDupes.length > 0 && <WarningBanner severity="error" icon="⚠" title="Potential Duplicates Found" style={{ marginTop: 8 }}>
                  <p style={{ margin: "0 0 8px" }}>Saving will require confirmation. Similar entries:</p>
                  {liveDupes.map((d) => <div key={d.article.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                    <span style={{ color: CATEGORIES[d.article.category]?.color }}>{CATEGORIES[d.article.category]?.icon}</span>
                    <span style={{ color: "#d4c9a8", fontWeight: 500, cursor: "pointer" }} onClick={() => navigate(d.article.id)}>{d.article.title}</span>
                    <span style={{ color: "#e07050", fontSize: 11 }}>({Math.round(d.score * 100)}%)</span>
                  </div>)}
                </WarningBanner>}
              </div>
              <div style={{ marginBottom: 16 }}><label style={{ display: "block", fontSize: 11, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Summary</label><input style={S.input} value={formData.summary} onChange={(e) => setFormData((p) => ({ ...p, summary: e.target.value }))} placeholder="A brief description..." /></div>

              {/* Portrait Upload */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: 11, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Portrait / Image <span style={{ fontWeight: 400, color: "#445566" }}>— optional</span></label>
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
                      <div style={{ width: 120, height: 120, borderRadius: 8, overflow: "hidden", border: "2px solid " + (CATEGORIES[createCat]?.color || "#f0c040") + "40" }}>
                        <img src={formData.portrait} alt="Portrait" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      </div>
                      <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                        <button type="button" onClick={() => portraitFileRef.current?.click()} style={{ fontSize: 10, color: "#7ec8e3", background: "rgba(126,200,227,0.1)", border: "1px solid rgba(126,200,227,0.2)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontFamily: "inherit" }}>Replace</button>
                        <button type="button" onClick={() => setFormData((p) => ({ ...p, portrait: null }))} style={{ fontSize: 10, color: "#e07050", background: "rgba(224,112,80,0.1)", border: "1px solid rgba(224,112,80,0.2)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontFamily: "inherit" }}>Remove</button>
                      </div>
                    </div>
                  ) : (
                    <div onClick={() => portraitFileRef.current?.click()} style={{
                      width: 120, height: 120, borderRadius: 8, border: "2px dashed rgba(240,192,64,0.2)",
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", background: "rgba(17,24,39,0.4)", transition: "all 0.2s",
                    }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(240,192,64,0.5)"; e.currentTarget.style.background = "rgba(240,192,64,0.04)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(240,192,64,0.2)"; e.currentTarget.style.background = "rgba(17,24,39,0.4)"; }}>
                      <span style={{ fontSize: 24, color: "#445566", marginBottom: 4 }}>📷</span>
                      <span style={{ fontSize: 10, color: "#556677" }}>Add Image</span>
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: "#445566", lineHeight: 1.5, paddingTop: 4 }}>
                    Upload a portrait, depiction, map, or symbol for this entry.<br />
                    Supports JPG, PNG, GIF, WebP. Max 2MB.
                  </div>
                </div>
              </div>

              <p style={{ fontFamily: "'Cinzel', serif", fontSize: 13, fontWeight: 600, color: "#d4c9a8", marginTop: 24, marginBottom: 16, letterSpacing: 1 }}>◈ Template Fields</p>
              {TEMPLATE_FIELDS[createCat]?.map((fk) => (
                <div key={fk} style={{ marginBottom: 16 }}><label style={{ display: "block", fontSize: 11, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>{FIELD_LABELS[fk] || fk}</label><input style={S.input} value={formData.fields[fk] || ""} onChange={(e) => setFormData((p) => ({ ...p, fields: { ...p.fields, [fk]: e.target.value } }))} placeholder={"Enter " + (FIELD_LABELS[fk] || fk).toLowerCase() + "..."} /></div>
              ))}

              {/* Temporal override for deity/magic/race */}
              {(createCat === "deity" || createCat === "magic" || createCat === "race") && (<>
                <p style={{ fontFamily: "'Cinzel', serif", fontSize: 13, fontWeight: 600, color: "#d4c9a8", marginTop: 24, marginBottom: 16, letterSpacing: 1 }}>⏳ Temporal Data <span style={{ fontWeight: 400, fontSize: 11, color: "#556677" }}>— for conflict detection</span></p>
                <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: 11, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Type</label>
                    <select style={{ ...S.input, cursor: "pointer" }} value={formData.temporal?.type || ""} onChange={(e) => setFormData((p) => ({ ...p, temporal: { ...(p.temporal || {}), type: e.target.value } }))}>
                      <option value="">None</option><option value="immortal">Immortal</option><option value="race">Race</option><option value="concept">Concept</option><option value="mortal">Mortal</option>
                    </select>
                  </div>
                  <div style={{ flex: 1 }}><label style={{ display: "block", fontSize: 11, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Active From (Year)</label><input style={S.input} type="number" value={formData.temporal?.active_start ?? ""} onChange={(e) => setFormData((p) => ({ ...p, temporal: { ...(p.temporal || {}), active_start: e.target.value ? parseInt(e.target.value) : null } }))} /></div>
                  <div style={{ flex: 1 }}><label style={{ display: "block", fontSize: 11, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Active Until (Year)</label><input style={S.input} type="number" value={formData.temporal?.active_end ?? ""} onChange={(e) => setFormData((p) => ({ ...p, temporal: { ...(p.temporal || {}), active_end: e.target.value ? parseInt(e.target.value) : null } }))} /></div>
                </div>
              </>)}

              <div style={{ marginBottom: 16 }}><label style={{ display: "block", fontSize: 11, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Body <span style={{ fontWeight: 400, color: "#445566" }}>— use @article_id to link</span></label><textarea style={S.textarea} value={formData.body} onChange={(e) => setFormData((p) => ({ ...p, body: e.target.value }))} placeholder={"Write about this " + CATEGORIES[createCat]?.label.toLowerCase() + "..."} rows={8} /></div>

              {linkSugs.length > 0 && <WarningBanner severity="info" icon="🔗" title="Suggested Links" style={{ marginBottom: 16 }}>
                <p style={{ margin: "0 0 8px" }}>These existing articles may be related. Click to add an @mention:</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{linkSugs.map((s) => (
                  <span key={s.article.id} onClick={() => { const tag = "@" + s.article.id; if (!formData.body.includes(tag)) setFormData((p) => ({ ...p, body: p.body + (p.body ? " " : "") + tag })); }}
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, padding: "4px 10px", background: "rgba(126,200,227,0.1)", border: "1px solid rgba(126,200,227,0.2)", borderRadius: 12, cursor: "pointer", color: CATEGORIES[s.article.category]?.color, transition: "all 0.2s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(126,200,227,0.2)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(126,200,227,0.1)"; }}>
                    <span>{CATEGORIES[s.article.category]?.icon}</span><span>{s.article.title}</span><span style={{ color: "#556677", fontSize: 10 }}>({s.confidence})</span>
                  </span>
                ))}</div>
              </WarningBanner>}

              <div style={{ marginBottom: 16 }}><label style={{ display: "block", fontSize: 11, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Tags <span style={{ fontWeight: 400, color: "#445566" }}>— comma separated</span></label><input style={S.input} value={formData.tags} onChange={(e) => setFormData((p) => ({ ...p, tags: e.target.value }))} placeholder="war, second-age, dragons..." /></div>
              <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
                <button style={S.btnP} onClick={attemptSave}>{editingId ? "Save Changes" : "Create Entry"}</button>
                <button style={S.btnS} onClick={() => editingId ? navigate(editingId) : goDash()}>Cancel</button>
              </div>
            </div>
          </div>)}

        </div>
      </div>
    </div>
  );
}