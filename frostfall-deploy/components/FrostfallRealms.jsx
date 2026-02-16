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
    const mentions = [
      ...(source.body?.match(/@\[([^\]]+)\]\(([^)]+)\)/g) || []).map((m) => { const match = m.match(/@\[([^\]]+)\]\(([^)]+)\)/); return match ? match[2] : null; }).filter(Boolean),
      ...(source.body?.match(/@(?!\[)([\w]+)/g) || []).map((m) => m.slice(1)),
    ];
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
  const bodyOnly = (text || "").toLowerCase();
  const linked = new Set(existingLinks || []);
  // Also exclude rich mentions already in the text
  const richMentionIds = new Set((text?.match(/@\[([^\]]+)\]\(([^)]+)\)/g) || []).map((m) => { const match = m.match(/@\[([^\]]+)\]\(([^)]+)\)/); return match ? match[2] : null; }).filter(Boolean));
  const mentioned = new Set([...(text?.match(/@(?!\[)([\w]+)/g) || []).map((m) => m.slice(1)), ...richMentionIds]);
  articles.forEach((a) => {
    if (linked.has(a.id) || mentioned.has(a.id)) return;
    const tl = a.title.toLowerCase();
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
    const matched = words.filter((w) => allTextLower.includes(w.toLowerCase()));
    if (matched.length >= 2) {
      // Find longest matched word position for contextual placement
      const longest = matched.sort((a, b) => b.length - a.length)[0];
      const wIdx = bodyOnly.indexOf(longest.toLowerCase());
      if (wIdx !== -1) { matchPosition = wIdx; matchText = (text || "").substring(wIdx, wIdx + longest.length); }
      suggestions.push({ article: a, confidence: "strong", label: "Multiple word match", match: matched.join(", "), matchPosition, matchText });
    }
    else if (matched.length === 1 && matched[0].length >= 6) {
      const wIdx = bodyOnly.indexOf(matched[0].toLowerCase());
      if (wIdx !== -1) { matchPosition = wIdx; matchText = (text || "").substring(wIdx, wIdx + matched[0].length); }
      suggestions.push({ article: a, confidence: "possible", label: "Partial word match", match: matched[0], matchPosition, matchText });
    }
  });
  return suggestions.sort((a, b) => ({ exact: 3, strong: 2, possible: 1 }[b.confidence] || 0) - ({ exact: 3, strong: 2, possible: 1 }[a.confidence] || 0));
}

// Fuzzy match a broken ref ID against all existing articles — returns scored suggestions
function findFuzzyMatches(brokenRefId, articles) {
  const broken = brokenRefId.toLowerCase().replace(/_/g, " ");
  const brokenWords = broken.split(/[\s_]+/).filter((w) => w.length >= 3);
  const results = [];
  articles.forEach((a) => {
    let score = 0;
    const titleLower = a.title.toLowerCase();
    const idLower = a.id.toLowerCase().replace(/_/g, " ");
    // Exact substring match in ID (azurax in azurax_the_storm_wing)
    if (idLower.includes(broken)) score += 50;
    else if (broken.includes(idLower)) score += 40;
    // Exact substring match in title
    if (titleLower.includes(broken)) score += 45;
    else if (broken.includes(titleLower)) score += 35;
    // Word overlap scoring
    const titleWords = titleLower.split(/[\s_\-]+/).filter((w) => w.length >= 3);
    brokenWords.forEach((bw) => {
      titleWords.forEach((tw) => {
        if (tw === bw) score += 20;
        else if (tw.startsWith(bw) || bw.startsWith(tw)) score += 12;
        else if (tw.includes(bw) || bw.includes(tw)) score += 8;
      });
    });
    // Levenshtein-like: first word match boost (handles "azurax" vs "azurax")
    if (brokenWords[0] && titleWords[0] && (titleWords[0].startsWith(brokenWords[0]) || brokenWords[0].startsWith(titleWords[0]))) score += 15;
    if (score > 5) results.push({ article: a, score });
  });
  return results.sort((a, b) => b.score - a.score).slice(0, 5);
}

// Check a single article or form data against all existing articles for integrity violations
function checkArticleIntegrity(data, articles, excludeId = null) {
  const warnings = [];
  const entityMap = {};
  articles.forEach((a) => { entityMap[a.id] = a; });

  const temporal = data.temporal;
  const body = data.body || "";
  const fields = data.fields || {};
  const allText = body + " " + Object.values(fields).join(" ");

  // 1. Broken @mentions — references to non-existent articles
  const mentionRefs = (body.match(/@\[([^\]]+)\]\(([^)]+)\)/g) || []).map((m) => {
    const match = m.match(/@\[([^\]]+)\]\(([^)]+)\)/);
    return match ? { title: match[1], id: match[2], rawMention: m, isRich: true } : null;
  }).filter(Boolean);
  // Legacy @id refs: only flag if they look like real article IDs (contain underscores = generated IDs)
  const legacyRefs = (body.match(/@(?!\[)([\w]+)/g) || [])
    .filter((m) => !m.match(/@\[/))
    .map((m) => ({ id: m.slice(1), rawMention: m, isRich: false }))
    .filter((ref) => {
      if (entityMap[ref.id]) return true;
      if (ref.id.includes("_") && ref.id.length > 5) return true;
      return false;
    });
  const allRefs = [
    ...mentionRefs.map((r) => ({ id: r.id, rawMention: r.rawMention, isRich: r.isRich })),
    ...legacyRefs,
  ];

  allRefs.forEach((ref) => {
    if (ref.id === excludeId) return;
    if (!entityMap[ref.id]) {
      const readableName = ref.id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const fuzzyMatches = findFuzzyMatches(ref.id, articles.filter((a) => a.id !== excludeId));
      warnings.push({
        type: "broken_ref", severity: "warning",
        message: "References \"" + readableName + "\" which doesn't exist in the codex.",
        suggestion: fuzzyMatches.length > 0 ? "Did you mean one of these? Click to fix:" : "Create the referenced article, or remove the @mention if unintended.",
        refId: ref.id,
        rawMention: ref.rawMention,
        fuzzyMatches,
      });
    }
  });

  // 2. Temporal conflicts — referencing entities that weren't alive/active at this time
  if (temporal && temporal.active_start != null) {
    allRefs.forEach((ref) => {
      const target = entityMap[ref.id];
      if (!target?.temporal || target.temporal.type === "concept") return;
      const tt = target.temporal;
      if (tt.type === "immortal" && !tt.active_end) return;
      if (tt.active_end != null && temporal.active_start > tt.active_end) {
        warnings.push({
          type: "temporal", severity: "error",
          message: "References \"" + target.title + "\" (ended Year " + tt.active_end + ") but this entry starts in Year " + temporal.active_start + ".",
          suggestion: "This is a " + (temporal.active_start - tt.active_end) + "-year discrepancy. Was this intentional (legacy/historical reference)?",
        });
      }
      if (tt.death_year && temporal.active_start > tt.death_year) {
        warnings.push({
          type: "temporal", severity: "warning",
          message: "\"" + target.title + "\" died in Year " + tt.death_year + ", which is before this entry's time period (Year " + temporal.active_start + ").",
          suggestion: "Verify this is intentional — perhaps a posthumous mention or historical record.",
        });
      }
    });
  }

  // 3. Orphan detection — article references nothing and nothing references it
  if (body.length > 100 && allRefs.length === 0) {
    const referencedByOthers = articles.some((a) => a.id !== excludeId && a.body?.includes("@" + (data.id || "")));
    if (!referencedByOthers && articles.length > 3) {
      warnings.push({ type: "orphan", severity: "info", message: "This entry has no cross-references and isn't referenced by other entries.", suggestion: "Consider adding @mentions to connect it with related entries." });
    }
  }

  // 4. Missing key fields for category
  const cat = data.category;
  const requiredFields = {
    deity: ["domain"], race: ["lifespan", "homeland"], character: ["char_race"],
    event: ["date_range"], location: ["region"], organization: ["type", "purpose"],
    language: ["speakers"], magic: ["type"], item: ["type"],
  };
  if (requiredFields[cat]) {
    requiredFields[cat].forEach((f) => {
      if (!fields[f] || !String(fields[f]).trim()) {
        warnings.push({ type: "missing_field", severity: "info", message: "\"" + formatKey(f) + "\" is empty — this field helps with cross-referencing and integrity checks.", suggestion: "Fill in this field for better codex integration." });
      }
    });
  }

  // 5. Contradicting facts — check if two articles claim same unique role
  if (fields.titles || fields.role) {
    const roleText = (fields.titles || "") + " " + (fields.role || "");
    const uniqueRoles = ["king", "queen", "emperor", "empress", "high priest", "archmage", "chieftain", "ruler"];
    uniqueRoles.forEach((role) => {
      if (!roleText.toLowerCase().includes(role)) return;
      const region = fields.region || fields.affiliations || fields.homeland || "";
      articles.forEach((other) => {
        if (other.id === excludeId || other.category !== data.category) return;
        const otherRoles = ((other.fields?.titles || "") + " " + (other.fields?.role || "")).toLowerCase();
        const otherRegion = other.fields?.region || other.fields?.affiliations || other.fields?.homeland || "";
        if (otherRoles.includes(role) && region && otherRegion && region.toLowerCase() === otherRegion.toLowerCase()) {
          // Check temporal overlap
          const ot = other.temporal;
          if (temporal && ot && temporal.active_start != null && ot.active_start != null) {
            const overlap = !(temporal.active_end != null && temporal.active_end < ot.active_start) && !(ot.active_end != null && ot.active_end < temporal.active_start);
            if (overlap) {
              warnings.push({
                type: "contradiction", severity: "warning",
                message: "Both this entry and \"" + other.title + "\" claim the role of " + role + " in " + region + " during overlapping time periods.",
                suggestion: "Verify that these roles don't conflict, or adjust time periods.",
              });
            }
          }
        }
      });
    });
  }

  return warnings;
}

// Check novel scene for integrity issues (broken mentions, temporal conflicts, and name mismatches)
function checkSceneIntegrity(sceneBody, articles) {
  const warnings = [];
  if (!sceneBody) return warnings;
  // Check rich mentions @[Title](id)
  const richRefs = (sceneBody.match(/@\[([^\]]+)\]\(([^)]+)\)/g) || []).map((m) => {
    const match = m.match(/@\[([^\]]+)\]\(([^)]+)\)/);
    return match ? { title: match[1], id: match[2] } : null;
  }).filter(Boolean);
  // Check legacy @id mentions
  const legacyRefs = (sceneBody.match(/@(?!\[)([\w]+)/g) || []).map((m) => m.slice(1));
  const entityMap = {};
  articles.forEach((a) => { entityMap[a.id] = a; });

  richRefs.forEach((ref) => {
    if (!entityMap[ref.id]) {
      warnings.push({ severity: "error", message: "\"" + ref.title + "\" not found in codex.", ref: ref.id });
    } else {
      // Check if title changed (stale mention)
      const art = entityMap[ref.id];
      if (art.title !== ref.title) {
        warnings.push({ severity: "warning", message: "\"" + ref.title + "\" was renamed to \"" + art.title + "\" — mention is stale.", ref: ref.id });
      }
    }
  });
  legacyRefs.forEach((refId) => {
    if (!entityMap[refId]) {
      warnings.push({ severity: "warning", message: "\"@" + refId + "\" is a raw mention — not linked to a codex entry.", ref: refId });
    }
  });

  // Check if scene references characters from incompatible time periods
  const mentionedArticles = [...richRefs.map((r) => entityMap[r.id]), ...legacyRefs.map((r) => entityMap[r])].filter(Boolean);
  const mortals = mentionedArticles.filter((a) => a.temporal && a.temporal.death_year);
  const events = mentionedArticles.filter((a) => a.category === "event" && a.temporal?.active_start);
  // If scene mentions both a dead character and an event that happened after their death
  mortals.forEach((mortal) => {
    events.forEach((event) => {
      if (event.temporal.active_start > mortal.temporal.death_year) {
        warnings.push({
          severity: "warning",
          message: "\"" + mortal.title + "\" (died Year " + mortal.temporal.death_year + ") referenced alongside \"" + event.title + "\" (Year " + event.temporal.active_start + ").",
          ref: mortal.id,
        });
      }
    });
  });

  return warnings;
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
  notable_regions: "Notable Regions", physical_characteristics: "Physical Characteristics",
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
// Universal field key formatter — never show raw underscored keys to users
const formatKey = (k) => FIELD_LABELS[k] || k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
        onMouseEnter={(e) => { e.currentTarget.style.background = catColor + "30"; e.currentTarget.style.borderColor = catColor + "60"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = catColor + "15"; e.currentTarget.style.borderColor = catColor + "35"; }}>
        {catIcon} {displayName}
      </span>
    );
    return <span key={i} style={{ color: "#e07050", fontStyle: "italic", fontSize: "0.92em" }} title="Not found in codex">⚠ {displayName}</span>;
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
  const [allWorlds, setAllWorlds] = useState([]);
  const [showWorldCreate, setShowWorldCreate] = useState(false);
  const [worldForm, setWorldForm] = useState({ name: "", description: "" });
  const [worldSwitcherOpen, setWorldSwitcherOpen] = useState(false);
  const tlRef = useRef(null);
  const tlLabelRef = useRef(null);
  const tlSyncing = useRef(false);
  const importFileRef = useRef(null);
  const saveTimer = useRef(null);

    // === SAFE STRING HELPERS ===
  const lower = (v) => (typeof v === "string" ? v.toLowerCase() : v == null ? "" : String(v).toLowerCase());
  const safeText = (v) => (v == null ? "" : String(v));

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
              setArticles(dbArticles.filter((a) => !a.isArchived));
              setArchived(dbArticles.filter((a) => a.isArchived));
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
            if (data.articles?.length > 0) setArticles(data.articles);
            if (data.archived) setArchived(data.archived);
            if (data.worldName) setActiveWorld({ name: data.worldName, description: data.worldDesc || "" });
          }
          setSaveStatus("saved");
        } catch (e) { setSaveStatus("idle"); }
      }
      setDataLoaded(true);
    };
    loadData();
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
      setArticles(dbArticles.filter((a) => !a.isArchived));
      setArchived(dbArticles.filter((a) => a.isArchived));
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
  const [aiProgress, setAiProgress] = useState({ current: 0, total: 0, entries: 0 });
  const [showDonate, setShowDonate] = useState(false);
  const [authView, setAuthView] = useState(null);
  const aiFileRef = useRef(null);
  const portraitFileRef = useRef(null);

  // === MAP BUILDER ===
  const [mapData, setMapData] = useState({ image: null, imageW: 0, imageH: 0, pins: [], territories: [] });
  const [mapTool, setMapTool] = useState("select"); // select, pin, territory, erase
  const [mapZoom, setMapZoom] = useState(1);
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 });
  const [mapDragging, setMapDragging] = useState(false);
  const [mapDragStart, setMapDragStart] = useState({ x: 0, y: 0 });
  const [mapSelected, setMapSelected] = useState(null); // { type: 'pin'|'territory', id }
  const [mapDrawing, setMapDrawing] = useState(null); // territory points being drawn
  const [mapEditPanel, setMapEditPanel] = useState(null); // pin/territory being edited
  const mapContainerRef = useRef(null);
  const mapFileRef = useRef(null);

  // === NOVEL WRITING TOOL ===
  const [manuscripts, setManuscripts] = useState([]); // all manuscripts for active world
  const [activeMs, setActiveMs] = useState(null); // current manuscript object
  const [novelView, setNovelView] = useState("select"); // select, outline, write, corkboard
  const [novelActiveScene, setNovelActiveScene] = useState(null); // { actId, chId, scId }
  const [novelCodexOpen, setNovelCodexOpen] = useState(false);
  const [novelCodexSearch, setNovelCodexSearch] = useState("");
  const [novelCodexFilter, setNovelCodexFilter] = useState("all");
  const [novelCodexExpanded, setNovelCodexExpanded] = useState(null); // article id
  const [novelMention, setNovelMention] = useState(null); // { query, x, y, actId, chId, scId }
  const [novelOutlineCollapsed, setNovelOutlineCollapsed] = useState(new Set());
  const [novelMsForm, setNovelMsForm] = useState({ title: "", description: "" });
  const [showMsCreate, setShowMsCreate] = useState(false);
  const novelEditorRef = useRef(null);
  // Enhanced features
  const [novelFocusMode, setNovelFocusMode] = useState(false); // composition/focus mode
  const [novelSplitPane, setNovelSplitPane] = useState("codex"); // "codex" | "notes" | "article" | null
  const [novelSplitArticle, setNovelSplitArticle] = useState(null); // article to show in split pane
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
    { id: "gold", color: "#f0c040", label: "Plot Point" },
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
        const a = chunk.slice(0, 500).toLowerCase().replace(/\s+/g, " ");
        const b = existing.slice(0, 500).toLowerCase().replace(/\s+/g, " ");
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
    setAiStaging([]); setAiProgress({ current: 0, total: 0, entries: 0 });

    const chunks = chunkText(text);
    setAiProgress({ current: 0, total: chunks.length, entries: 0 });
    let allEntries = [];
    let errors = [];
    let existingTitles = articles.map((a) => safeText(a?.title)); // always strings


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
            existingTitles: existingTitles.slice(-50), // Last 50 to stay within token limits
          }),
        });
        const data = await response.json();
        if (data.error && !data.entries?.length) {
          errors.push("Section " + (i + 1) + ": " + data.error);
          continue;
        }
        if (data.entries && data.entries.length > 0) {
  // Normalize incoming entries FIRST so the rest of the UI can trust types
  const normalizedIncoming = data.entries.map((e) => ({
    ...e,
    title: safeText(e?.title),
    summary: safeText(e?.summary),
    body: safeText(e?.body),
    category: safeText(e?.category),
    fields: (e && typeof e.fields === "object" && !Array.isArray(e.fields)) ? e.fields : {},
    tags: Array.isArray(e?.tags) ? e.tags.map(safeText).filter(Boolean) : [],
  }));

  // Client-side dedup: skip entries with titles that already exist
  const newEntries = normalizedIncoming.filter((e) => {
    const normalTitle = lower(e.title).trim();
    return !existingTitles.some((t) => lower(t).trim() === normalTitle);
  });

  const staged = newEntries.map((e, j) => ({
    ...e,
    _stagingId: Date.now() + "-" + i + "-" + j,
    _status: "pending",
    id:
      lower(e.title).replace(/[^a-z0-9]+/g, "_").replace(/_+$/, "") ||
      "entry_" + i + "_" + j,
    linkedIds: (safeText(e.body).match(/@([\w]+)/g) || []).map((m) => m.slice(1)),
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
    // File size warning
    if (file.size > 500000) {
      setAiParseError("⚠ Large file (" + (file.size / 1024).toFixed(0) + "KB). Estimated parse time: " + estimateParseTime(file.size) + ". The file will be split into chunks for processing.");
    }
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

  // === MAP BUILDER FUNCTIONS ===
  const handleMapImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5000000) { alert("Image must be under 5MB"); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        setMapData((prev) => ({ ...prev, image: ev.target.result, imageW: img.naturalWidth, imageH: img.naturalHeight }));
        setMapZoom(1); setMapPan({ x: 0, y: 0 });
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const mapClickHandler = (e) => {
    if (!mapData.image || mapDragging) return;
    const rect = mapContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left - mapPan.x) / mapZoom;
    const y = (e.clientY - rect.top - mapPan.y) / mapZoom;
    const nx = x / mapData.imageW;
    const ny = y / mapData.imageH;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;

    if (mapTool === "pin") {
      const pin = { id: "pin_" + Date.now(), x: nx, y: ny, label: "New Pin", color: "#f0c040", linkedArticleId: null };
      setMapData((prev) => ({ ...prev, pins: [...prev.pins, pin] }));
      setMapEditPanel(pin); setMapSelected({ type: "pin", id: pin.id });
    } else if (mapTool === "territory") {
      setMapDrawing((prev) => prev ? [...prev, { x: nx, y: ny }] : [{ x: nx, y: ny }]);
    } else if (mapTool === "select") {
      const clickedPin = mapData.pins.find((p) => Math.abs(p.x - nx) < 0.02 && Math.abs(p.y - ny) < 0.02);
      if (clickedPin) { setMapSelected({ type: "pin", id: clickedPin.id }); setMapEditPanel(clickedPin); }
      else {
        const clickedTerr = mapData.territories.find((t) => pointInPoly(nx, ny, t.points));
        if (clickedTerr) { setMapSelected({ type: "territory", id: clickedTerr.id }); setMapEditPanel(clickedTerr); }
        else { setMapSelected(null); setMapEditPanel(null); }
      }
    } else if (mapTool === "erase") {
      const clickedPin = mapData.pins.find((p) => Math.abs(p.x - nx) < 0.02 && Math.abs(p.y - ny) < 0.02);
      if (clickedPin) { setMapData((prev) => ({ ...prev, pins: prev.pins.filter((p) => p.id !== clickedPin.id) })); if (mapSelected?.id === clickedPin.id) { setMapSelected(null); setMapEditPanel(null); } }
      else {
        const clickedTerr = mapData.territories.find((t) => pointInPoly(nx, ny, t.points));
        if (clickedTerr) { setMapData((prev) => ({ ...prev, territories: prev.territories.filter((t) => t.id !== clickedTerr.id) })); if (mapSelected?.id === clickedTerr.id) { setMapSelected(null); setMapEditPanel(null); } }
      }
    }
  };

  const finishTerritory = () => {
    if (!mapDrawing || mapDrawing.length < 3) { setMapDrawing(null); return; }
    const terr = { id: "terr_" + Date.now(), points: mapDrawing, label: "New Territory", color: "#f0c040", fill: "rgba(240,192,64,0.15)", linkedArticleId: null };
    setMapData((prev) => ({ ...prev, territories: [...prev.territories, terr] }));
    setMapDrawing(null); setMapEditPanel(terr); setMapSelected({ type: "territory", id: terr.id });
  };

  const updateMapItem = (id, updates) => {
    setMapData((prev) => ({
      ...prev,
      pins: prev.pins.map((p) => p.id === id ? { ...p, ...updates } : p),
      territories: prev.territories.map((t) => t.id === id ? { ...t, ...updates } : t),
    }));
    setMapEditPanel((prev) => prev?.id === id ? { ...prev, ...updates } : prev);
  };

  const pointInPoly = (px, py, pts) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  };

  const mapMouseDown = (e) => { if (mapTool === "select" && !mapEditPanel) { setMapDragging(true); setMapDragStart({ x: e.clientX - mapPan.x, y: e.clientY - mapPan.y }); } };
  const mapMouseMove = (e) => { if (mapDragging) setMapPan({ x: e.clientX - mapDragStart.x, y: e.clientY - mapDragStart.y }); };
  const mapMouseUp = () => setMapDragging(false);
  const mapWheel = useCallback((e) => { e.preventDefault(); setMapZoom((z) => Math.max(0.2, Math.min(5, z + (e.deltaY > 0 ? -0.1 : 0.1)))); }, []);

  useEffect(() => {
    if (!dataLoaded || !activeWorld) return;
    const mapKey = "frostfall-map-" + (activeWorld?.id || "default");
    const t = setTimeout(async () => {
      const json = JSON.stringify(mapData);
      try { if (typeof window !== "undefined" && window.storage) { await window.storage.set(mapKey, json); return; } } catch (_) {}
      try { if (typeof window !== "undefined") localStorage.setItem(mapKey, json); } catch (_) {}
    }, 2000);
    return () => clearTimeout(t);
  }, [mapData, dataLoaded, activeWorld]);

  useEffect(() => {
    if (!activeWorld) return;
    const mapKey = "frostfall-map-" + (activeWorld?.id || "default");
    const defaultMap = { image: null, imageW: 0, imageH: 0, pins: [], territories: [] };
    (async () => {
      try {
        if (typeof window !== "undefined" && window.storage) {
          const r = await window.storage.get(mapKey);
          if (r?.value) { setMapData(JSON.parse(r.value)); return; }
        }
      } catch (_) {}
      try {
        if (typeof window !== "undefined") {
          const stored = localStorage.getItem(mapKey);
          if (stored) { setMapData(JSON.parse(stored)); return; }
        }
      } catch (_) {}
      setMapData(defaultMap);
    })();
  }, [activeWorld]);

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
      if (manuscripts.length > 0 && activeWorld) {
        const key = msKey();
        try { localStorage.setItem(key, JSON.stringify(manuscripts)); } catch (_) {}
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
        color: "#f0c040",
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
    setManuscripts((prev) => prev.map((m) => m.id === activeMs?.id ? { ...updater(m), updatedAt: new Date().toISOString() } : m));
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
        color: ["#f0c040", "#7ec8e3", "#e07050", "#8ec8a0", "#c084fc"][m.acts.length % 5],
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

  const getActiveScene = () => {
    if (!activeMs || !novelActiveScene) return null;
    const act = activeMs.acts.find((a) => a.id === novelActiveScene.actId);
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
          const w = sc.body ? sc.body.trim().split(/\s+/).filter(Boolean).length : 0;
          actWords += w;
        }
      }
      acts[act.id] = actWords;
      total += actWords;
    }
    return { total, acts };
  }, [activeMs]);

  const chapterWordCount = (ch) => ch.scenes.reduce((sum, sc) => sum + (sc.body ? sc.body.trim().split(/\s+/).filter(Boolean).length : 0), 0);

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
            return { ...s, snapshots: [...snaps, { body: s.body || "", savedAt: new Date().toISOString(), wordCount: (s.body || "").trim().split(/\s+/).filter(Boolean).length }].slice(-10) };
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
    if (novelEditorRef.current) lastRenderedSceneRef.current = null; // force re-render
  };

  // === SESSION WORD TRACKING ===
  useEffect(() => {
    if (novelView === "write" && novelGoal.sessionStart === 0 && msWordCount.total > 0) {
      setNovelGoal((g) => ({ ...g, sessionStart: msWordCount.total }));
    }
  }, [novelView, msWordCount.total]);
  const sessionWords = msWordCount.total - (novelGoal.sessionStart || msWordCount.total);
  const goalProgress = novelGoal.daily > 0 ? Math.min(100, Math.round((sessionWords / novelGoal.daily) * 100)) : 0;

  // === COMPILE TO DOCX ===
  const compileManuscript = async () => {
    if (!activeMs || novelCompiling) return;
    setNovelCompiling(true);
    try {
      // Build plain text manuscript
      let text = activeMs.title + "\n\n";
      if (activeMs.description) text += activeMs.description + "\n\n";
      text += "---\n\n";
      for (const act of activeMs.acts) {
        text += act.title.toUpperCase() + "\n\n";
        for (const ch of act.chapters) {
          text += ch.title + "\n\n";
          if (ch.synopsis) text += ch.synopsis + "\n\n";
          for (const sc of ch.scenes) {
            if (sc.body) {
              // Strip @mentions to plain text
              let clean = sc.body.replace(/@\[([^\]]+)\]\(([^)]+)\)/g, "$1").replace(/@([\w]+)/g, (_, id) => id.replace(/_/g, " "));
              text += clean + "\n\n";
            }
          }
          text += "* * *\n\n";
        }
      }
      // Create downloadable file
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = (activeMs.title || "manuscript").replace(/[^a-z0-9]+/gi, "_") + ".txt";
      a.click(); URL.revokeObjectURL(url);
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

  // @mention detection in editor — uses @[Title](article_id) format for rich display
  // Convert raw text with @[Title](id) to HTML with styled mention spans
  const textToMentionHTML = useCallback((text) => {
    if (!text) return "";
    // Escape HTML entities first
    let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // Replace @[Title](id) with styled spans
    html = html.replace(/@\[([^\]]+)\]\(([^)]+)\)/g, (_, title, id) => {
      const art = articles.find((a) => a.id === id);
      const cat = art?.category;
      const icon = CATEGORIES[cat]?.icon || "?";
      const color = CATEGORIES[cat]?.color || "#f0c040";
      const brokenStyle = !art ? "background:rgba(224,112,80,0.12);border:1px solid rgba(224,112,80,0.4);color:#e07050" : `background:${color}18;border:1px solid ${color}40;color:${color}`;
      return `<span contenteditable="false" data-mention-id="${id}" data-mention-title="${title.replace(/"/g, "&quot;")}" style="${brokenStyle};border-radius:4px;padding:1px 6px;margin:0 1px;font-family:'Cinzel',sans-serif;font-weight:600;font-size:13px;letter-spacing:0.3px;cursor:pointer;user-select:all;display:inline;white-space:nowrap">${!art ? "⚠" : icon} ${title}</span>`;
    });
    // Convert newlines to <br>
    html = html.replace(/\n/g, "<br>");
    return html;
  }, [articles]);

  // Serialize contentEditable DOM back to raw text with @[Title](id) format
  const serializeEditor = useCallback((node) => {
    let result = "";
    if (!node) return result;
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        result += child.textContent;
      } else if (child.nodeName === "BR") {
        result += "\n";
      } else if (child.dataset?.mentionId) {
        const title = child.dataset.mentionTitle || child.textContent.replace(/^[^\s]*\s/, "");
        result += "@[" + title + "](" + child.dataset.mentionId + ")";
      } else if (child.nodeName === "DIV" || child.nodeName === "P") {
        // ContentEditable sometimes wraps lines in divs
        if (result.length > 0 && !result.endsWith("\n")) result += "\n";
        result += serializeEditor(child);
      } else {
        result += serializeEditor(child);
      }
    }
    return result;
  }, []);

  // Track which scene is rendered to avoid unnecessary innerHTML updates
  const lastRenderedSceneRef = useRef(null);
  const isComposingRef = useRef(false);

  // Set innerHTML when scene changes
  useEffect(() => {
    if (!novelEditorRef.current || !novelActiveScene) return;
    const scene = getActiveScene();
    const sceneKey = novelActiveScene.scId;
    if (lastRenderedSceneRef.current !== sceneKey) {
      lastRenderedSceneRef.current = sceneKey;
      novelEditorRef.current.innerHTML = textToMentionHTML(scene?.body || "");
    }
  }, [novelActiveScene?.scId, textToMentionHTML]);

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

  const insertMention = useCallback((article) => {
    if (!novelMention || !novelEditorRef.current) return;
    const { textNode, atOffset, cursorOffset } = novelMention;

    // Create mention span
    const span = document.createElement("span");
    span.contentEditable = "false";
    span.dataset.mentionId = article.id;
    span.dataset.mentionTitle = article.title;
    const cat = article.category;
    const color = CATEGORIES[cat]?.color || "#f0c040";
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
      const color = CATEGORIES[cat]?.color || "#f0c040";
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

  // Hover tooltip state for mentions
  const [mentionTooltip, setMentionTooltip] = useState(null);

  // Codex articles filtered for sidebar
    const novelCodexArticles = useMemo(() => {
    let filtered = articles;
    if (novelCodexFilter !== "all") filtered = filtered.filter((a) => a.category === novelCodexFilter);

    const q = lower(novelCodexSearch).trim();
    if (q) {
      filtered = filtered.filter((a) =>
        lower(a?.title).includes(q) || lower(a?.summary).includes(q)
      );
    }

    return filtered.slice(0, 50);
  }, [articles, novelCodexFilter, novelCodexSearch]);


  const STATUS_COLORS = { draft: "#556677", revised: "#f0c040", final: "#8ec8a0" };

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

  const [integrityGate, setIntegrityGate] = useState(null); // { warnings, onProceed }
  const [expandedWarning, setExpandedWarning] = useState(null); // index of expanded broken_ref warning

  // Replace a broken @mention in the body with a proper rich mention to the selected article
  const resolveRef = (warning, selectedArticle) => {
    const richMention = "@[" + selectedArticle.title + "](" + selectedArticle.id + ")";
    setFormData((prev) => {
      let newBody = prev.body;
      if (warning.rawMention && newBody.includes(warning.rawMention)) {
        // Direct replacement of the broken mention text
        newBody = newBody.replace(warning.rawMention, richMention);
      } else if (warning.refId) {
        // Try to find @refId pattern
        const legacyPattern = "@" + warning.refId;
        if (newBody.includes(legacyPattern)) {
          newBody = newBody.replace(legacyPattern, richMention);
        }
      }
      return { ...prev, body: newBody };
    });
    // Don't close expandedWarning — the fixed warning disappears naturally from the recalculated list,
    // and other expanded warnings remain visible for the user to continue fixing
  };

  // Smart insert a link suggestion — find where the name appears in body and wrap it in-place
  const smartInsertLink = (sug) => {
    const richMention = "@[" + sug.article.title + "](" + sug.article.id + ")";
    // Don't add if already linked
    if (formData.body.includes(richMention) || formData.body.includes("@[" + sug.article.title + "]")) return;

    // Helper: check if a position falls inside an existing @mention
    const findEnclosingMention = (body, pos) => {
      const legacyPattern = /@(?!\[)([\w]+)/g;
      let m;
      while ((m = legacyPattern.exec(body)) !== null) {
        if (pos >= m.index && pos < m.index + m[0].length) return { start: m.index, end: m.index + m[0].length, text: m[0] };
      }
      return null;
    };

    setFormData((prev) => {
      let newBody = prev.body;
      const bodyLower = newBody.toLowerCase();

      // Strategy 1: exact title match
      const titleLower = sug.article.title.toLowerCase();
      const exactIdx = bodyLower.indexOf(titleLower);
      if (exactIdx !== -1) {
        return { ...prev, body: newBody.substring(0, exactIdx) + richMention + newBody.substring(exactIdx + sug.article.title.length) };
      }

      // Strategy 2: matched text — but check if it's inside an @mention
      const searchText = (sug.matchText || sug.match || "").toLowerCase();
      if (searchText) {
        const matchIdx = bodyLower.indexOf(searchText);
        if (matchIdx !== -1) {
          const enclosing = findEnclosingMention(newBody, matchIdx);
          if (enclosing) {
            return { ...prev, body: newBody.substring(0, enclosing.start) + richMention + newBody.substring(enclosing.end) };
          }
          return { ...prev, body: newBody.substring(0, matchIdx) + richMention + newBody.substring(matchIdx + searchText.length) };
        }
      }

      // Fallback: append
      return { ...prev, body: newBody + (newBody ? "\n\n" : "") + richMention };
    });
  };

  const attemptSave = () => {
    const dupes = findDuplicates(formData.title, articles, editingId);
    if (dupes.length > 0) { setPendingDupes(dupes); setShowDupeModal(true); return; }
    // Check integrity — gate on errors/warnings
        const slug = lower(formData?.title).replace(/[^a-z0-9]+/g, "_");
    const data = { ...formData, id: editingId || slug, category: createCat };

    const warnings = checkArticleIntegrity(data, articles, editingId);
    const serious = warnings.filter((w) => w.severity === "error" || w.severity === "warning");
    if (serious.length > 0) {
      setIntegrityGate({ warnings: serious, onProceed: doSave });
      return;
    }
    doSave();
  };
  const doSave = () => {
        const id = editingId || lower(formData?.title).replace(/[^a-z0-9]+/g, "_").replace(/_+$/, "");

    // Extract both @[Title](id) rich mentions and legacy @id mentions
    const richMentions = (formData.body.match(/@\[([^\]]+)\]\(([^)]+)\)/g) || []).map((m) => { const match = m.match(/@\[([^\]]+)\]\(([^)]+)\)/); return match ? match[2] : null; }).filter(Boolean);
    const legacyMentions = (formData.body.match(/@(?!\[)([\w]+)/g) || []).map((m) => m.slice(1));
    const allMentions = [...new Set([...richMentions, ...legacyMentions])];
    const temporal = buildTemporal(createCat, formData.fields, formData.temporal);
    const now = new Date().toISOString();
    const a = {
      id, title: formData.title, category: createCat, summary: formData.summary,
      fields: formData.fields, body: formData.body,
      tags: safeText(formData.tags).split(",").map((t) => t.trim()).filter(Boolean),

      linkedIds: allMentions, temporal,
      portrait: formData.portrait || (editingId ? (articles.find((x) => x.id === editingId)?.portrait || null) : null),
      createdAt: editingId ? (articles.find((x) => x.id === editingId)?.createdAt || now) : now,
      updatedAt: now,
    };
    if (editingId) {
      setArticles((prev) => prev.map((x) => x.id === editingId ? a : x));
    } else {
      setArticles((prev) => [a, ...prev]);
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

  // Global integrity scan — counts all articles with issues (broken refs, temporal, orphans, missing fields, contradictions)
  const globalIntegrity = useMemo(() => {
    const articlesWithIssues = [];
    articles.forEach((a) => {
      const issues = checkArticleIntegrity(a, articles, a.id);
      const serious = issues.filter((w) => w.severity === "error" || w.severity === "warning");
      if (serious.length > 0) articlesWithIssues.push({ article: a, issues: serious });
    });
    return articlesWithIssues;
  }, [articles]);

  const totalIntegrityIssues = allConflicts.length + globalIntegrity.reduce((t, a) => t + a.issues.length, 0);
  const linkSugs = useMemo(() => view === "create" ? findUnlinkedMentions(formData.body + " " + formData.summary + " " + formData.title, formData.fields, articles, editingId ? (articles.find((a) => a.id === editingId)?.linkedIds || []) : []) : [], [view, formData, articles, editingId]);
  const liveDupes = useMemo(() => view === "create" ? findDuplicates(formData.title, articles, editingId) : [], [view, formData.title, articles, editingId]);
    const liveIntegrity = useMemo(() => {
    if (view !== "create") return [];
    const slug = lower(formData?.title).replace(/[^a-z0-9]+/g, "_");
    const data = { ...formData, id: editingId || slug, category: createCat };
    return checkArticleIntegrity(data, articles, editingId);
  }, [view, formData, articles, editingId, createCat]);


    const filtered = useMemo(() => {
    let l = articles;
    if (codexFilter !== "all") l = l.filter((a) => a.category === codexFilter);

    const q = lower(searchQuery).trim();
    if (q) {
      l = l.filter((a) =>
        lower(a?.title).includes(q) ||
        lower(a?.summary).includes(q) ||
        (Array.isArray(a?.tags) && a.tags.some((t) => lower(t).includes(q)))
      );
    }

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
    { id: "map", icon: "🗺", label: "Map Builder", action: () => setView("map") },
    { id: "novel", icon: "✒", label: "Novel Writing", action: () => setView("novel") },
    { id: "integrity", icon: "🛡", label: "Lore Integrity", action: () => setView("integrity"), count: totalIntegrityIssues > 0 ? totalIntegrityIssues : undefined, alert: totalIntegrityIssues > 0 },
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
    if (item.id === "map" && view === "map") return true;
    if (item.id === "novel" && view === "novel") return true;
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
      {/* Integrity gate modal — shown when saving an article with lore conflicts */}
      {integrityGate && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
          <div style={{ background: "#111827", border: "1px solid #1e2a3a", borderRadius: 12, padding: "28px 32px", maxWidth: 480, width: "90%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 24 }}>🛡</span>
              <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 18, color: "#e07050", margin: 0 }}>Lore Integrity Warning</h3>
            </div>
            <p style={{ fontSize: 13, color: "#8899aa", marginBottom: 16, lineHeight: 1.5 }}>
              This entry has {integrityGate.warnings.length} integrity issue{integrityGate.warnings.length !== 1 ? "s" : ""} that may conflict with existing canon:
            </p>
            <div style={{ maxHeight: 200, overflowY: "auto", marginBottom: 20 }}>
              {integrityGate.warnings.map((w, i) => (
                <div key={i} style={{ display: "flex", gap: 8, padding: "8px 10px", marginBottom: 4, borderRadius: 6, background: w.severity === "error" ? "rgba(224,112,80,0.08)" : "rgba(240,192,64,0.06)", border: "1px solid " + (w.severity === "error" ? "rgba(224,112,80,0.2)" : "rgba(240,192,64,0.15)") }}>
                  <span style={{ fontSize: 12, flexShrink: 0 }}>{w.severity === "error" ? "🔴" : "🟡"}</span>
                  <div>
                    <div style={{ fontSize: 12, color: w.severity === "error" ? "#e07050" : "#f0c040", lineHeight: 1.4 }}>{w.message}</div>
                    {w.suggestion && <div style={{ fontSize: 10, color: "#6b7b8d", marginTop: 3 }}>{w.suggestion}</div>}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setIntegrityGate(null)} style={{ ...S.btnS, fontSize: 12 }}>Go Back & Fix</button>
              <button onClick={() => { integrityGate.onProceed(); setIntegrityGate(null); }} style={{ ...S.btnP, fontSize: 12, background: "rgba(224,112,80,0.15)", borderColor: "rgba(224,112,80,0.4)", color: "#e07050" }}>Save Anyway</button>
            </div>
          </div>
        </div>
      )}
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
        {/* World switcher */}
        {activeWorld && (
          <div style={{ padding: "8px 16px", borderBottom: "1px solid #1a2435" }}>
            <div onClick={() => setWorldSwitcherOpen(!worldSwitcherOpen)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "4px 0" }}>
              <span style={{ fontSize: 14, color: "#f0c040" }}>🌍</span>
              <span style={{ flex: 1, fontSize: 12, color: "#d4c9a8", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeWorld.name}</span>
              <span style={{ fontSize: 10, color: "#556677", transition: "transform 0.2s", transform: worldSwitcherOpen ? "rotate(180deg)" : "none" }}>▾</span>
            </div>
            {worldSwitcherOpen && (
              <div style={{ marginTop: 4, background: "rgba(17,24,39,0.5)", borderRadius: 6, border: "1px solid #1e2a3a", overflow: "hidden" }}>
                {allWorlds.map((w) => (
                  <div key={w.id} onClick={() => switchWorld(w)} style={{ padding: "8px 12px", fontSize: 11, color: w.id === activeWorld?.id ? "#f0c040" : "#8899aa", cursor: "pointer", borderBottom: "1px solid #111827", display: "flex", alignItems: "center", gap: 8, background: w.id === activeWorld?.id ? "rgba(240,192,64,0.06)" : "transparent" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(240,192,64,0.1)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = w.id === activeWorld?.id ? "rgba(240,192,64,0.06)" : "transparent"; }}>
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
            <span style={{ fontSize: 9, color: "#556677", letterSpacing: 1 }}>{saveStatus === "saved" ? "SAVED" : saveStatus === "saving" ? "SAVING…" : saveStatus === "error" ? "SAVE ERROR" : (activeWorld?.name?.toUpperCase() || "NO WORLD")}</span>
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

          {/* === WELCOME SCREEN — No world yet === */}
          {!activeWorld && dataLoaded && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", textAlign: "center", padding: 40 }}>
              <div style={{ fontSize: 64, marginBottom: 20 }}>🌍</div>
              <h1 style={{ fontFamily: "'Cinzel', serif", fontSize: 28, fontWeight: 700, color: "#e8dcc8", margin: 0, letterSpacing: 2 }}>Welcome to Frostfall Realms</h1>
              <p style={{ fontSize: 14, color: "#6b7b8d", marginTop: 8, maxWidth: 460, lineHeight: 1.7 }}>
                Create your first world to begin building your codex. Every world has its own articles, timeline, and lore — you can create as many as you need.
              </p>
              <Ornament width={300} />
              {!showWorldCreate ? (
                <button onClick={() => setShowWorldCreate(true)} style={{ ...S.btnP, fontSize: 15, padding: "14px 40px", marginTop: 24 }}>Create Your First World</button>
              ) : (
                <div style={{ marginTop: 24, background: "rgba(17,24,39,0.6)", border: "1px solid #1e2a3a", borderRadius: 12, padding: "28px 32px", width: "100%", maxWidth: 440 }}>
                  <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 18, color: "#f0c040", margin: "0 0 20px", letterSpacing: 1 }}>Create a New World</h3>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 11, color: "#8899aa", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 5 }}>World Name *</label>
                    <input style={S.input} placeholder="e.g. Aelvarin, Middle-earth, Eberron" value={worldForm.name} onChange={(e) => setWorldForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
                  </div>
                  <div style={{ marginBottom: 20 }}>
                    <label style={{ fontSize: 11, color: "#8899aa", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 5 }}>Description (optional)</label>
                    <textarea style={{ ...S.textarea, minHeight: 60 }} placeholder="A brief description of your world…" value={worldForm.description} onChange={(e) => setWorldForm((f) => ({ ...f, description: e.target.value }))} />
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button onClick={handleCreateWorld} disabled={!worldForm.name.trim()} style={{ ...S.btnP, flex: 1, opacity: worldForm.name.trim() ? 1 : 0.4 }}>Create World</button>
                    <button onClick={() => setShowWorldCreate(false)} style={{ ...S.btnS }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* === WORLD CREATE MODAL (from sidebar) === */}
          {showWorldCreate && activeWorld && (
            <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={(e) => { if (e.target === e.currentTarget) setShowWorldCreate(false); }}>
              <div style={{ background: "#111827", border: "1px solid #1e2a3a", borderRadius: 12, padding: "28px 32px", width: "100%", maxWidth: 440 }}>
                <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 18, color: "#f0c040", margin: "0 0 20px", letterSpacing: 1 }}>Create a New World</h3>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 11, color: "#8899aa", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 5 }}>World Name *</label>
                  <input style={S.input} placeholder="e.g. Aelvarin, Middle-earth, Eberron" value={worldForm.name} onChange={(e) => setWorldForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
                </div>
                <div style={{ marginBottom: 20 }}>
                  <label style={{ fontSize: 11, color: "#8899aa", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 5 }}>Description (optional)</label>
                  <textarea style={{ ...S.textarea, minHeight: 60 }} placeholder="A brief description of your world…" value={worldForm.description} onChange={(e) => setWorldForm((f) => ({ ...f, description: e.target.value }))} />
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={handleCreateWorld} disabled={!worldForm.name.trim()} style={{ ...S.btnP, flex: 1, opacity: worldForm.name.trim() ? 1 : 0.4 }}>Create World</button>
                  <button onClick={() => { setShowWorldCreate(false); setWorldForm({ name: "", description: "" }); }} style={{ ...S.btnS }}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          {/* === DASHBOARD === */}
          {view === "dashboard" && activeWorld && (<div>
            <div style={{ marginTop: 28, marginBottom: 8 }}>
              <h1 style={{ fontFamily: "'Cinzel', serif", fontSize: 26, fontWeight: 700, color: "#e8dcc8", margin: 0, letterSpacing: 2 }}>The Archives of {activeWorld?.name || "Your World"}</h1>
              <p style={{ fontSize: 13, color: "#6b7b8d", marginTop: 4, fontStyle: "italic" }}>"Creation requires sacrifice. To give form costs essence."</p>
            </div>
            <Ornament width={300} />
            <div style={{ display: "flex", gap: 12, marginTop: 24, flexWrap: "wrap" }}>
              {[{ n: stats.total, l: "Total Articles", c: "#f0c040" }, ...Object.entries(CATEGORIES).map(([k, v]) => ({ n: catCounts[k] || 0, l: v.label + "s", c: v.color })), { n: stats.words.toLocaleString(), l: "Total Words", c: "#8ec8a0" }].map((s, i) => (
                <div key={i} style={S.statCard}><div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: s.c }} /><p style={{ fontSize: 22, fontWeight: 700, color: "#e8dcc8", fontFamily: "'Cinzel', serif", margin: 0 }}>{s.n}</p><p style={{ fontSize: 9, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 1.5, marginTop: 4 }}>{s.l}</p></div>
              ))}
            </div>

            {totalIntegrityIssues > 0 && (<>
              <p style={S.sTitle}><span style={{ color: "#e07050" }}>🛡</span> Lore Integrity — <span style={{ color: "#e07050", fontSize: 14 }}>{totalIntegrityIssues} issue{totalIntegrityIssues !== 1 ? "s" : ""}</span></p>
              <div style={{ background: "rgba(224,112,80,0.04)", border: "1px solid rgba(224,112,80,0.15)", borderRadius: 8, padding: 4 }}>
                {allConflicts.slice(0, 3).map((c) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px", borderBottom: "1px solid rgba(224,112,80,0.08)", cursor: "pointer" }} onClick={() => navigate(c.sourceId)}>
                    <span style={{ fontSize: 16, color: c.severity === "error" ? "#e07050" : "#f0c040", marginTop: 1 }}>{c.severity === "error" ? "✕" : "⚠"}</span>
                    <div style={{ flex: 1 }}><div style={{ fontSize: 12, color: "#d4c9a8", fontWeight: 600, marginBottom: 3 }}>{c.message}</div><div style={{ fontSize: 11, color: "#6b7b8d", fontStyle: "italic" }}>💡 {c.suggestion}</div></div>
                    <span style={S.catBadge(c.severity === "error" ? "#e07050" : "#f0c040")}>{c.severity}</span>
                  </div>
                ))}
                {globalIntegrity.slice(0, Math.max(0, 4 - allConflicts.length)).map(({ article: a, issues }) => (
                  <div key={a.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 14px", borderBottom: "1px solid rgba(224,112,80,0.08)", cursor: "pointer" }} onClick={() => navigate(a.id)}>
                    <span style={{ fontSize: 14, color: CATEGORIES[a.category]?.color }}>{CATEGORIES[a.category]?.icon}</span>
                    <div style={{ flex: 1 }}><div style={{ fontSize: 12, color: "#d4c9a8", fontWeight: 600, marginBottom: 3 }}>{a.title} — {issues.length} issue{issues.length !== 1 ? "s" : ""}</div><div style={{ fontSize: 11, color: "#6b7b8d" }}>{issues[0].message}</div></div>
                    <span style={S.catBadge(issues.some((w) => w.severity === "error") ? "#e07050" : "#f0c040")}>{issues.some((w) => w.severity === "error") ? "error" : "warning"}</span>
                  </div>
                ))}
                <div style={{ padding: "10px 14px", textAlign: "center", fontSize: 12, color: "#e07050", cursor: "pointer" }} onClick={() => setView("integrity")}>View full integrity report →</div>
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
              <p style={{ fontSize: 13, color: "#6b7b8d", marginTop: 6 }}>Full integrity scan across the codex — temporal conflicts, broken references, contradictions, and missing data.</p>
            </div>
            <Ornament width={300} />
            {totalIntegrityIssues === 0 ? (
              <div style={{ textAlign: "center", padding: 60, color: "#8ec8a0" }}><div style={{ fontSize: 40, marginBottom: 12 }}>✓</div><p style={{ fontSize: 16, fontFamily: "'Cinzel', serif" }}>No Canon Conflicts Detected</p><p style={{ fontSize: 12, color: "#556677" }}>All articles passed integrity checks.</p></div>
            ) : (<div style={{ marginTop: 20 }}>
              <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
                {[
                  { n: allConflicts.filter((c) => c.severity === "error").length + globalIntegrity.reduce((t, a) => t + a.issues.filter((w) => w.severity === "error").length, 0), l: "Errors", c: "#e07050" },
                  { n: allConflicts.filter((c) => c.severity === "warning").length + globalIntegrity.reduce((t, a) => t + a.issues.filter((w) => w.severity === "warning").length, 0), l: "Warnings", c: "#f0c040" },
                  { n: new Set([...allConflicts.map((c) => c.sourceId), ...globalIntegrity.map((a) => a.article.id)]).size, l: "Articles Affected", c: "#7ec8e3" },
                ].map((s, i) => (
                  <div key={i} style={{ ...S.statCard, flex: "0 0 auto", padding: "14px 24px" }}><div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: s.c }} /><p style={{ fontSize: 22, fontWeight: 700, color: s.c, fontFamily: "'Cinzel', serif", margin: 0 }}>{s.n}</p><p style={{ fontSize: 10, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 1.5, marginTop: 4 }}>{s.l}</p></div>
                ))}
              </div>

              {/* Cross-article temporal conflicts */}
              {allConflicts.length > 0 && (<>
                <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 14, color: "#e8dcc8", margin: "24px 0 12px", letterSpacing: 1 }}>⏱ Temporal Conflicts</h3>
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
              </>)}

              {/* Per-article integrity issues */}
              {globalIntegrity.length > 0 && (<>
                <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 14, color: "#e8dcc8", margin: "24px 0 12px", letterSpacing: 1 }}>📋 Article Integrity Issues</h3>
                {globalIntegrity.map(({ article: a, issues }) => (
                  <div key={a.id} style={{ background: "rgba(17,24,39,0.5)", border: "1px solid rgba(224,112,80,0.15)", borderRadius: 8, padding: "14px 18px", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <span style={{ color: CATEGORIES[a.category]?.color }}>{CATEGORIES[a.category]?.icon}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#d4c9a8", cursor: "pointer" }} onClick={() => navigate(a.id)}>{a.title}</span>
                      <span style={S.catBadge(CATEGORIES[a.category]?.color)}>{CATEGORIES[a.category]?.label}</span>
                      <span style={{ ...S.catBadge("#e07050"), marginLeft: "auto" }}>{issues.length} issue{issues.length !== 1 ? "s" : ""}</span>
                    </div>
                    {issues.map((w, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, padding: "5px 0 5px 28px", fontSize: 12 }}>
                        <span style={{ color: w.severity === "error" ? "#e07050" : "#f0c040" }}>{w.severity === "error" ? "🔴" : "🟡"}</span>
                        <span style={{ color: "#8899aa" }}>{w.message}</span>
                      </div>
                    ))}
                    <div style={{ textAlign: "right", marginTop: 6 }}>
                      <span style={{ fontSize: 11, color: "#7ec8e3", cursor: "pointer" }} onClick={() => { goEdit(a); }}>Edit article →</span>
                    </div>
                  </div>
                ))}
              </>)}
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
                <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: "#e8dcc8", margin: 0, letterSpacing: 1, display: "flex", alignItems: "center", gap: 10 }}>⏳ Timeline of {activeWorld?.name || "Your World"}</h2>
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
                            <div style={{ width: 100, fontSize: 10, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>{formatKey(k)}</div>
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

          {/* === MAP BUILDER === */}
          {view === "map" && (<div style={{ margin: "0 -28px", height: "calc(100vh - 56px)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Map Header */}
            <div style={{ padding: "16px 28px 12px", borderBottom: "1px solid #1a2435", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <div>
                <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 22, color: "#e8dcc8", margin: 0, letterSpacing: 1 }}>🗺 Map of {activeWorld?.name || "Your World"}</h2>
                <p style={{ fontSize: 12, color: "#6b7b8d", marginTop: 4 }}>{mapData.pins.length} pin{mapData.pins.length !== 1 ? "s" : ""} · {mapData.territories.length} territor{mapData.territories.length !== 1 ? "ies" : "y"}</p>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {/* Tool palette */}
                {[
                  { id: "select", icon: "☝", tip: "Select / Pan" },
                  { id: "pin", icon: "📍", tip: "Place Pin" },
                  { id: "territory", icon: "⬡", tip: "Draw Territory" },
                  { id: "erase", icon: "✕", tip: "Erase" },
                ].map((t) => (
                  <button key={t.id} title={t.tip} onClick={() => { setMapTool(t.id); if (mapDrawing && t.id !== "territory") { setMapDrawing(null); } }}
                    style={{ padding: "6px 12px", fontSize: 14, background: mapTool === t.id ? "rgba(240,192,64,0.2)" : "transparent", border: mapTool === t.id ? "1px solid rgba(240,192,64,0.5)" : "1px solid #1e2a3a", borderRadius: 6, color: mapTool === t.id ? "#f0c040" : "#8899aa", cursor: "pointer", transition: "all 0.2s" }}>
                    {t.icon}
                  </button>
                ))}
                <div style={{ width: 1, height: 24, background: "#1e2a3a", margin: "0 4px" }} />
                <button onClick={() => mapFileRef.current?.click()} style={{ ...S.btnS, fontSize: 11, padding: "6px 12px" }}>📷 Upload Map</button>
                <input ref={mapFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleMapImageUpload} />
                <span style={{ fontSize: 11, color: "#556677" }}>{Math.round(mapZoom * 100)}%</span>
                <button onClick={() => setMapZoom((z) => Math.min(5, z + 0.2))} style={{ ...S.btnS, padding: "4px 8px", fontSize: 14 }}>+</button>
                <button onClick={() => setMapZoom((z) => Math.max(0.2, z - 0.2))} style={{ ...S.btnS, padding: "4px 8px", fontSize: 14 }}>−</button>
                <button onClick={() => { setMapZoom(1); setMapPan({ x: 0, y: 0 }); }} style={{ ...S.btnS, padding: "4px 8px", fontSize: 10 }}>FIT</button>
              </div>
            </div>

            {mapDrawing && (
              <div style={{ padding: "8px 28px", background: "rgba(240,192,64,0.06)", borderBottom: "1px solid rgba(240,192,64,0.2)", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                <span style={{ fontSize: 12, color: "#f0c040" }}>Drawing territory — {mapDrawing.length} point{mapDrawing.length !== 1 ? "s" : ""} placed</span>
                <button onClick={finishTerritory} disabled={mapDrawing.length < 3} style={{ ...S.btnP, fontSize: 10, padding: "4px 14px", opacity: mapDrawing.length < 3 ? 0.4 : 1 }}>Finish ({"\u2265"}3 pts)</button>
                <button onClick={() => setMapDrawing(null)} style={{ ...S.btnS, fontSize: 10, padding: "4px 14px" }}>Cancel</button>
              </div>
            )}

            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
              {/* Map canvas */}
              <div ref={mapContainerRef} style={{ flex: 1, overflow: "hidden", position: "relative", background: "#080c14", cursor: mapTool === "pin" ? "crosshair" : mapTool === "territory" ? "crosshair" : mapTool === "erase" ? "not-allowed" : mapDragging ? "grabbing" : "grab" }}
                onClick={mapClickHandler} onMouseDown={mapMouseDown} onMouseMove={mapMouseMove} onMouseUp={mapMouseUp} onMouseLeave={mapMouseUp}
                onWheel={(e) => { e.preventDefault(); setMapZoom((z) => Math.max(0.2, Math.min(5, z + (e.deltaY > 0 ? -0.1 : 0.1)))); }}>

                {!mapData.image ? (
                  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
                    <div style={{ fontSize: 56, opacity: 0.3 }}>🗺</div>
                    <p style={{ fontFamily: "'Cinzel', serif", fontSize: 18, color: "#445566" }}>Upload a Map Image</p>
                    <p style={{ fontSize: 12, color: "#334455", maxWidth: 340, textAlign: "center", lineHeight: 1.6 }}>Upload a PNG, JPG, or WebP image of your world map. You can then place pins at locations and draw territory borders.</p>
                    <button onClick={() => mapFileRef.current?.click()} style={{ ...S.btnP, fontSize: 13 }}>Choose Image</button>
                  </div>
                ) : (
                  <div style={{ transform: `translate(${mapPan.x}px, ${mapPan.y}px) scale(${mapZoom})`, transformOrigin: "0 0", position: "relative", width: mapData.imageW, height: mapData.imageH }}>
                    <img src={mapData.image} style={{ width: mapData.imageW, height: mapData.imageH, display: "block", userSelect: "none", pointerEvents: "none" }} draggable={false} alt="World map" />

                    {/* Territory polygons */}
                    <svg style={{ position: "absolute", top: 0, left: 0, width: mapData.imageW, height: mapData.imageH, pointerEvents: "none" }}>
                      {mapData.territories.map((t) => (
                        <g key={t.id}>
                          <polygon points={t.points.map((p) => `${p.x * mapData.imageW},${p.y * mapData.imageH}`).join(" ")}
                            fill={mapSelected?.id === t.id ? "rgba(240,192,64,0.25)" : (t.fill || "rgba(240,192,64,0.12)")}
                            stroke={mapSelected?.id === t.id ? "#f0c040" : (t.color || "#f0c040")}
                            strokeWidth={mapSelected?.id === t.id ? 3 : 2} strokeDasharray={mapSelected?.id === t.id ? "none" : "6,3"} />
                          {t.label && t.points.length > 0 && (
                            <text x={t.points.reduce((s, p) => s + p.x, 0) / t.points.length * mapData.imageW}
                              y={t.points.reduce((s, p) => s + p.y, 0) / t.points.length * mapData.imageH}
                              textAnchor="middle" fill={t.color || "#f0c040"} fontSize={14 / mapZoom} fontFamily="'Cinzel', serif" fontWeight="700"
                              stroke="#0a0e1a" strokeWidth={3 / mapZoom} paintOrder="stroke">{t.label}</text>
                          )}
                        </g>
                      ))}
                      {/* Drawing preview */}
                      {mapDrawing && mapDrawing.length > 1 && (
                        <polyline points={mapDrawing.map((p) => `${p.x * mapData.imageW},${p.y * mapData.imageH}`).join(" ")}
                          fill="none" stroke="#f0c040" strokeWidth={2} strokeDasharray="4,4" opacity={0.7} />
                      )}
                      {mapDrawing && mapDrawing.map((p, i) => (
                        <circle key={i} cx={p.x * mapData.imageW} cy={p.y * mapData.imageH} r={4} fill="#f0c040" />
                      ))}
                    </svg>

                    {/* Pins */}
                    {mapData.pins.map((pin) => {
                      const linked = pin.linkedArticleId ? articles.find((a) => a.id === pin.linkedArticleId) : null;
                      return (
                        <div key={pin.id} style={{ position: "absolute", left: pin.x * mapData.imageW - 12, top: pin.y * mapData.imageH - 28, pointerEvents: "auto", cursor: "pointer", zIndex: mapSelected?.id === pin.id ? 10 : 1 }}>
                          <div style={{ fontSize: 24, filter: mapSelected?.id === pin.id ? "drop-shadow(0 0 6px rgba(240,192,64,0.8))" : "drop-shadow(0 2px 3px rgba(0,0,0,0.5))", transition: "filter 0.2s", transform: mapSelected?.id === pin.id ? "scale(1.2)" : "scale(1)" }}>📍</div>
                          <div style={{ position: "absolute", top: -20, left: "50%", transform: "translateX(-50%)", whiteSpace: "nowrap", fontSize: 10 / Math.max(mapZoom, 0.5), fontWeight: 700, color: pin.color || "#f0c040", textShadow: "0 1px 3px rgba(0,0,0,0.9), 0 0 6px rgba(0,0,0,0.7)", fontFamily: "'Cinzel', serif", letterSpacing: 0.5 }}>
                            {pin.label}{linked ? " ↗" : ""}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Edit panel */}
              {mapEditPanel && (
                <div style={{ width: 280, borderLeft: "1px solid #1a2435", padding: "16px 14px", overflowY: "auto", flexShrink: 0, background: "#0d1117" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 14, color: "#e8dcc8", margin: 0 }}>
                      {mapEditPanel.points ? "Territory" : "Pin"} Properties
                    </h3>
                    <span onClick={() => { setMapEditPanel(null); setMapSelected(null); }} style={{ cursor: "pointer", color: "#556677", fontSize: 14 }}>✕</span>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 10, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 4 }}>Label</label>
                    <input style={S.input} value={mapEditPanel.label || ""} onChange={(e) => updateMapItem(mapEditPanel.id, { label: e.target.value })} />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 10, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 4 }}>Color</label>
                    <div style={{ display: "flex", gap: 6 }}>
                      {["#f0c040", "#e07050", "#7ec8e3", "#8ec8a0", "#c084fc", "#d4a060", "#e0c878", "#a088d0"].map((c) => (
                        <div key={c} onClick={() => updateMapItem(mapEditPanel.id, { color: c, ...(mapEditPanel.points ? { fill: c + "25" } : {}) })}
                          style={{ width: 22, height: 22, borderRadius: 4, background: c, cursor: "pointer", border: mapEditPanel.color === c ? "2px solid #fff" : "2px solid transparent", transition: "border 0.2s" }} />
                      ))}
                    </div>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 10, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 1, display: "block", marginBottom: 4 }}>Link to Codex Article</label>
                    <select style={{ ...S.input, padding: "8px 10px" }} value={mapEditPanel.linkedArticleId || ""}
                      onChange={(e) => {
                        const val = e.target.value || null;
                        updateMapItem(mapEditPanel.id, { linkedArticleId: val });
                        if (val) {
                          const art = articles.find((a) => a.id === val);
                          if (art && mapEditPanel.label === "New Pin") updateMapItem(mapEditPanel.id, { label: art.title, linkedArticleId: val });
                        }
                      }}>
                      <option value="">— None —</option>
                      {articles.filter((a) => a.category === "location" || a.category === "organization" || a.category === "race").sort((a, b) => a.title.localeCompare(b.title)).map((a) => (
                        <option key={a.id} value={a.id}>{CATEGORIES[a.category]?.icon} {a.title}</option>
                      ))}
                      <optgroup label="All Articles">
                        {articles.filter((a) => a.category !== "location" && a.category !== "organization" && a.category !== "race").sort((a, b) => a.title.localeCompare(b.title)).map((a) => (
                          <option key={a.id} value={a.id}>{CATEGORIES[a.category]?.icon} {a.title}</option>
                        ))}
                      </optgroup>
                    </select>
                  </div>
                  {mapEditPanel.linkedArticleId && (() => {
                    const linked = articles.find((a) => a.id === mapEditPanel.linkedArticleId);
                    return linked ? (
                      <div onClick={() => { setActiveArticle(linked); setView("article"); }} style={{ padding: "10px 12px", background: "rgba(240,192,64,0.06)", border: "1px solid rgba(240,192,64,0.15)", borderRadius: 6, cursor: "pointer", marginBottom: 12, transition: "all 0.2s" }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(240,192,64,0.12)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(240,192,64,0.06)"; }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#d4c9a8" }}>{CATEGORIES[linked.category]?.icon} {linked.title}</div>
                        <div style={{ fontSize: 10, color: "#6b7b8d", marginTop: 3 }}>{linked.summary?.slice(0, 80)}{linked.summary?.length > 80 ? "…" : ""}</div>
                        <div style={{ fontSize: 9, color: "#f0c040", marginTop: 4 }}>Click to view article →</div>
                      </div>
                    ) : null;
                  })()}
                  <div style={{ borderTop: "1px solid #1a2435", paddingTop: 12 }}>
                    <button onClick={() => {
                      if (mapEditPanel.points) setMapData((prev) => ({ ...prev, territories: prev.territories.filter((t) => t.id !== mapEditPanel.id) }));
                      else setMapData((prev) => ({ ...prev, pins: prev.pins.filter((p) => p.id !== mapEditPanel.id) }));
                      setMapEditPanel(null); setMapSelected(null);
                    }} style={{ ...S.btnS, fontSize: 11, color: "#e07050", borderColor: "rgba(224,112,80,0.3)", width: "100%" }}>Delete {mapEditPanel.points ? "Territory" : "Pin"}</button>
                  </div>
                </div>
              )}
            </div>
          </div>)}

          {/* === NOVEL WRITING === */}
          {view === "novel" && (<div style={{ margin: "0 -28px", height: "calc(100vh - 56px)", display: "flex", flexDirection: "column", overflow: "hidden" }}>

            {/* Manuscript Selector */}
            {novelView === "select" && (
              <div style={{ padding: "40px 28px", overflowY: "auto", flex: 1 }}>
                <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 24, color: "#e8dcc8", margin: 0, letterSpacing: 1 }}>✒ Manuscripts</h2>
                <p style={{ fontSize: 13, color: "#6b7b8d", marginTop: 6, lineHeight: 1.6, maxWidth: 520 }}>Write your novels with full access to your codex. Organize by Acts, Chapters, and Scenes.</p>
                <Ornament width={300} />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 24 }}>
                  {manuscripts.map((ms) => {
                    const wc = ms.acts.reduce((t, a) => t + a.chapters.reduce((tc, c) => tc + c.scenes.reduce((ts, s) => ts + (s.body?.trim().split(/\s+/).filter(Boolean).length || 0), 0), 0), 0);
                    const chCount = ms.acts.reduce((t, a) => t + a.chapters.length, 0);
                    const scCount = ms.acts.reduce((t, a) => t + a.chapters.reduce((tc, c) => tc + c.scenes.length, 0), 0);
                    return (
                      <div key={ms.id} onClick={() => { setActiveMs(ms); setNovelView("outline"); }} style={{ width: 240, padding: "20px 18px", background: "rgba(17,24,39,0.5)", border: "1px solid #1e2a3a", borderRadius: 10, cursor: "pointer", transition: "all 0.2s", position: "relative" }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(240,192,64,0.4)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1e2a3a"; e.currentTarget.style.transform = "none"; }}>
                        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, #f0c040, #e07050)", borderRadius: "10px 10px 0 0" }} />
                        <div style={{ fontSize: 28, marginBottom: 10 }}>📖</div>
                        <div style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: "#e8dcc8", fontWeight: 600, letterSpacing: 0.5 }}>{ms.title}</div>
                        {ms.description && <div style={{ fontSize: 11, color: "#6b7b8d", marginTop: 4, lineHeight: 1.4 }}>{ms.description.slice(0, 80)}</div>}
                        <div style={{ display: "flex", gap: 8, marginTop: 12, fontSize: 10, color: "#556677", flexWrap: "wrap" }}>
                          <span style={{ background: "rgba(240,192,64,0.08)", padding: "2px 8px", borderRadius: 8 }}>{ms.acts.length} act{ms.acts.length !== 1 ? "s" : ""}</span>
                          <span style={{ background: "rgba(126,200,227,0.08)", padding: "2px 8px", borderRadius: 8 }}>{chCount} ch</span>
                          <span style={{ background: "rgba(142,200,160,0.08)", padding: "2px 8px", borderRadius: 8 }}>{scCount} scenes</span>
                          <span style={{ background: "rgba(192,132,252,0.08)", padding: "2px 8px", borderRadius: 8 }}>{wc.toLocaleString()} words</span>
                        </div>
                      </div>
                    );
                  })}
                  <div onClick={() => setShowMsCreate(true)} style={{ width: 240, padding: "20px 18px", background: "transparent", border: "2px dashed #1e2a3a", borderRadius: 10, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 140, transition: "all 0.2s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(240,192,64,0.4)"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1e2a3a"; }}>
                    <div style={{ fontSize: 32, color: "#334455" }}>+</div>
                    <div style={{ fontSize: 12, color: "#556677", marginTop: 6 }}>New Manuscript</div>
                  </div>
                </div>
                {showMsCreate && (
                  <div style={{ marginTop: 20, background: "rgba(17,24,39,0.6)", border: "1px solid #1e2a3a", borderRadius: 10, padding: "20px 24px", maxWidth: 400 }}>
                    <h3 style={{ fontFamily: "'Cinzel', serif", fontSize: 16, color: "#f0c040", margin: "0 0 14px" }}>New Manuscript</h3>
                    <input style={S.input} placeholder="Title" value={novelMsForm.title} onChange={(e) => setNovelMsForm((f) => ({ ...f, title: e.target.value }))} autoFocus />
                    <textarea style={{ ...S.textarea, minHeight: 50, marginTop: 8 }} placeholder="Description (optional)" value={novelMsForm.description} onChange={(e) => setNovelMsForm((f) => ({ ...f, description: e.target.value }))} />
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <button onClick={createManuscript} disabled={!novelMsForm.title.trim()} style={{ ...S.btnP, fontSize: 11, opacity: novelMsForm.title.trim() ? 1 : 0.4 }}>Create</button>
                      <button onClick={() => setShowMsCreate(false)} style={{ ...S.btnS, fontSize: 11 }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Outline Mode — Enhanced */}
            {novelView === "outline" && activeMs && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <div style={{ padding: "14px 28px", borderBottom: "1px solid #1a2435", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span onClick={() => { setNovelView("select"); setActiveMs(null); }} style={{ cursor: "pointer", color: "#556677", fontSize: 11 }}>← Manuscripts</span>
                    <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 18, color: "#e8dcc8", margin: 0, letterSpacing: 1 }}>{activeMs.title}</h2>
                    <span style={{ fontSize: 11, color: "#556677" }}>{msWordCount.total.toLocaleString()} words</span>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => setNovelView("corkboard")} style={{ ...S.btnS, fontSize: 10, padding: "5px 12px" }}>🗂 Corkboard</button>
                    <button onClick={compileManuscript} disabled={novelCompiling} style={{ ...S.btnS, fontSize: 10, padding: "5px 12px", color: "#8ec8a0", borderColor: "rgba(142,200,160,0.3)", opacity: novelCompiling ? 0.5 : 1 }}>{novelCompiling ? "Exporting..." : "📄 Export"}</button>
                    <button onClick={addAct} style={{ ...S.btnS, fontSize: 10, padding: "5px 12px" }}>+ Act</button>
                    <button onClick={() => deleteManuscript(activeMs.id)} style={{ ...S.btnS, fontSize: 10, padding: "5px 12px", color: "#e07050", borderColor: "rgba(224,112,80,0.3)" }}>Delete</button>
                  </div>
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}>
                  {activeMs.acts.map((act, ai) => (
                    <div key={act.id} style={{ marginBottom: 20 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, cursor: "pointer" }}
                        onClick={() => setNovelOutlineCollapsed((prev) => { const n = new Set(prev); n.has(act.id) ? n.delete(act.id) : n.add(act.id); return n; })}>
                        <div style={{ width: 4, height: 28, background: act.color, borderRadius: 2 }} />
                        <span style={{ fontSize: 10, color: "#556677", transform: novelOutlineCollapsed.has(act.id) ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>▾</span>
                        <input style={{ background: "none", border: "none", fontFamily: "'Cinzel', serif", fontSize: 16, color: act.color, fontWeight: 700, letterSpacing: 1, outline: "none", flex: 1, cursor: "text", minWidth: 0 }}
                          value={act.title} onClick={(e) => e.stopPropagation()} onChange={(e) => updateAct(act.id, { title: e.target.value })} />
                        <span style={{ fontSize: 10, color: "#556677" }}>{(msWordCount.acts[act.id] || 0).toLocaleString()} words</span>
                        <button onClick={(e) => { e.stopPropagation(); addChapter(act.id); }} style={{ ...S.btnS, fontSize: 9, padding: "3px 10px" }}>+ Ch</button>
                        {activeMs.acts.length > 1 && <button onClick={(e) => { e.stopPropagation(); deleteAct(act.id); }} style={{ background: "none", border: "none", color: "#556677", cursor: "pointer", fontSize: 12, padding: "2px 6px" }}>✕</button>}
                      </div>
                      {!novelOutlineCollapsed.has(act.id) && (
                        <div style={{ marginLeft: 20 }}>
                          {act.chapters.map((ch) => (
                            <div key={ch.id} style={{ marginBottom: 10, background: "rgba(17,24,39,0.4)", border: "1px solid #1a2435", borderRadius: 8, overflow: "hidden" }}>
                              <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid #111827" }}>
                                <span onClick={() => setNovelOutlineCollapsed((prev) => { const n = new Set(prev); n.has(ch.id) ? n.delete(ch.id) : n.add(ch.id); return n; })}
                                  style={{ fontSize: 10, color: "#556677", cursor: "pointer", transform: novelOutlineCollapsed.has(ch.id) ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>▾</span>
                                <input style={{ background: "none", border: "none", fontSize: 13, color: "#d4c9a8", fontWeight: 600, outline: "none", flex: 1, minWidth: 0, fontFamily: "inherit" }}
                                  value={ch.title} onChange={(e) => updateChapter(act.id, ch.id, { title: e.target.value })} />
                                <select value={ch.status} onChange={(e) => updateChapter(act.id, ch.id, { status: e.target.value })}
                                  style={{ background: "#0d1117", border: "1px solid #1e2a3a", borderRadius: 4, fontSize: 9, color: STATUS_COLORS[ch.status], padding: "2px 6px", cursor: "pointer", outline: "none", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
                                  <option value="draft">Draft</option><option value="revised">Revised</option><option value="final">Final</option>
                                </select>
                                <span style={{ fontSize: 10, color: "#556677", minWidth: 50, textAlign: "right" }}>{chapterWordCount(ch).toLocaleString()} w</span>
                                <button onClick={() => addScene(act.id, ch.id)} style={{ ...S.btnS, fontSize: 8, padding: "2px 8px" }}>+ Scene</button>
                                {act.chapters.length > 1 && <button onClick={() => deleteChapter(act.id, ch.id)} style={{ background: "none", border: "none", color: "#445566", cursor: "pointer", fontSize: 11 }}>✕</button>}
                              </div>
                              <div style={{ padding: "0 14px" }}>
                                <input style={{ width: "100%", background: "none", border: "none", fontSize: 11, color: "#6b7b8d", padding: "6px 0", outline: "none", fontStyle: "italic", fontFamily: "inherit", boxSizing: "border-box" }}
                                  placeholder="Chapter synopsis..." value={ch.synopsis || ""} onChange={(e) => updateChapter(act.id, ch.id, { synopsis: e.target.value })} />
                              </div>
                              {!novelOutlineCollapsed.has(ch.id) && (
                                <div style={{ padding: "4px 14px 10px" }}>
                                  {ch.scenes.map((sc) => {
                                    const scWords = sc.body ? sc.body.trim().split(/\s+/).filter(Boolean).length : 0;
                                    const scColor = SCENE_COLORS.find((c) => c.id === sc.color) || SCENE_COLORS[0];
                                    return (
                                      <div key={sc.id} onClick={() => { setNovelActiveScene({ actId: act.id, chId: ch.id, scId: sc.id }); setNovelView("write"); }}
                                        style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", marginTop: 4, borderRadius: 5, cursor: "pointer", transition: "all 0.15s", background: "rgba(240,192,64,0.02)", borderLeft: scColor.color !== "transparent" ? "3px solid " + scColor.color : "3px solid transparent" }}
                                        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(240,192,64,0.08)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(240,192,64,0.02)"; }}>
                                        <span style={{ fontSize: 10, color: "#f0c040" }}>▸</span>
                                        <input style={{ background: "none", border: "none", fontSize: 12, color: "#8899aa", outline: "none", flex: 1, minWidth: 0, fontFamily: "inherit", cursor: "pointer" }}
                                          value={sc.title} onClick={(e) => e.stopPropagation()} onChange={(e) => { e.stopPropagation(); updateScene(act.id, ch.id, sc.id, { title: e.target.value }); }} />
                                        {sc.povCharacter && <span style={{ fontSize: 9, color: "#c084fc", background: "rgba(192,132,252,0.1)", padding: "1px 6px", borderRadius: 8 }}>{sc.povCharacter}</span>}
                                        {sc.label && <span style={{ fontSize: 9, color: scColor.color !== "transparent" ? scColor.color : "#556677", background: (scColor.color !== "transparent" ? scColor.color : "#556677") + "18", padding: "1px 6px", borderRadius: 8 }}>{sc.label || scColor.label}</span>}
                                        <span style={{ fontSize: 9, color: "#445566" }}>{scWords > 0 ? scWords.toLocaleString() + " w" : "empty"}</span>
                                        {sc.notes && <span style={{ fontSize: 9, color: "#f0c040" }} title="Has notes">📝</span>}
                                        {sc.snapshots?.length > 0 && <span style={{ fontSize: 9, color: "#7ec8e3" }} title={sc.snapshots.length + " snapshot(s)"}>📸{sc.snapshots.length}</span>}
                                        {ch.scenes.length > 1 && <button onClick={(e) => { e.stopPropagation(); deleteScene(act.id, ch.id, sc.id); }} style={{ background: "none", border: "none", color: "#334455", cursor: "pointer", fontSize: 10 }}>✕</button>}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* === CORKBOARD VIEW === */}
            {novelView === "corkboard" && activeMs && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <div style={{ padding: "14px 28px", borderBottom: "1px solid #1a2435", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                  <span onClick={() => setNovelView("outline")} style={{ cursor: "pointer", color: "#556677", fontSize: 11 }}>← Outline</span>
                  <h2 style={{ fontFamily: "'Cinzel', serif", fontSize: 16, color: "#e8dcc8", margin: 0, letterSpacing: 1 }}>🗂 Corkboard</h2>
                  <div style={{ flex: 1 }} />
                  {/* Chapter filter */}
                  <select value={corkboardChapter ? corkboardChapter.actId + "|" + corkboardChapter.chId : "all"}
                    onChange={(e) => {
                      if (e.target.value === "all") setCorkboardChapter(null);
                      else { const [a, c] = e.target.value.split("|"); setCorkboardChapter({ actId: a, chId: c }); }
                    }}
                    style={{ background: "#0d1117", border: "1px solid #1e2a3a", borderRadius: 6, fontSize: 11, color: "#d4c9a8", padding: "4px 10px", outline: "none" }}>
                    <option value="all">All Chapters</option>
                    {activeMs.acts.map((a) => a.chapters.map((c) => (
                      <option key={c.id} value={a.id + "|" + c.id}>{a.title} › {c.title}</option>
                    )))}
                  </select>
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
                  {activeMs.acts.filter((a) => !corkboardChapter || a.id === corkboardChapter.actId).map((act) => (
                    act.chapters.filter((c) => !corkboardChapter || c.id === corkboardChapter.chId).map((ch) => (
                      <div key={ch.id} style={{ marginBottom: 28 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                          <div style={{ width: 3, height: 16, background: act.color, borderRadius: 2 }} />
                          <span style={{ fontSize: 13, color: act.color, fontWeight: 700, fontFamily: "'Cinzel', serif" }}>{act.title}</span>
                          <span style={{ color: "#334455" }}>›</span>
                          <span style={{ fontSize: 13, color: "#d4c9a8", fontWeight: 600 }}>{ch.title}</span>
                          <span style={{ fontSize: 10, color: "#556677" }}>{chapterWordCount(ch).toLocaleString()} words</span>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
                          {ch.scenes.map((sc, si) => {
                            const scWords = sc.body ? sc.body.trim().split(/\s+/).filter(Boolean).length : 0;
                            const scColor = SCENE_COLORS.find((c) => c.id === sc.color) || SCENE_COLORS[0];
                            return (
                              <div key={sc.id}
                                draggable onDragStart={() => setCorkboardDragId(sc.id)}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={() => { if (corkboardDragId && corkboardDragId !== sc.id) handleCorkDrop(act.id, ch.id, corkboardDragId, sc.id); setCorkboardDragId(null); }}
                                onClick={() => { setNovelActiveScene({ actId: act.id, chId: ch.id, scId: sc.id }); setNovelView("write"); }}
                                style={{
                                  width: 200, minHeight: 140, padding: "14px 16px",
                                  background: corkboardDragId === sc.id ? "rgba(240,192,64,0.15)" : "rgba(17,24,39,0.6)",
                                  border: "1px solid " + (corkboardDragId === sc.id ? "rgba(240,192,64,0.4)" : "#1e2a3a"),
                                  borderTop: "3px solid " + (scColor.color !== "transparent" ? scColor.color : "#1e2a3a"),
                                  borderRadius: 8, cursor: "grab", transition: "all 0.2s", position: "relative",
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.4)"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}>
                                <div style={{ fontSize: 13, color: "#d4c9a8", fontWeight: 600, marginBottom: 6, lineHeight: 1.3 }}>{sc.title}</div>
                                {sc.povCharacter && <div style={{ fontSize: 9, color: "#c084fc", marginBottom: 4 }}>POV: {sc.povCharacter}</div>}
                                {sc.label && <div style={{ fontSize: 9, color: scColor.color !== "transparent" ? scColor.color : "#6b7b8d", marginBottom: 4 }}>{sc.label}</div>}
                                <div style={{ fontSize: 10, color: "#6b7b8d", lineHeight: 1.4, overflow: "hidden", maxHeight: 52 }}>
                                  {sc.body ? sc.body.replace(/@\[([^\]]+)\]\([^)]+\)/g, "$1").slice(0, 120) + (sc.body.length > 120 ? "..." : "") : <span style={{ fontStyle: "italic", color: "#445566" }}>Empty scene</span>}
                                </div>
                                <div style={{ position: "absolute", bottom: 10, left: 16, right: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <span style={{ fontSize: 9, color: "#445566" }}>{scWords > 0 ? scWords.toLocaleString() + "w" : "—"}</span>
                                  <div style={{ display: "flex", gap: 4 }}>
                                    {sc.notes && <span style={{ fontSize: 9 }} title="Has notes">📝</span>}
                                    {sc.snapshots?.length > 0 && <span style={{ fontSize: 9 }}>📸</span>}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                          <div onClick={() => addScene(act.id, ch.id)}
                            style={{ width: 200, minHeight: 140, border: "2px dashed #1e2a3a", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.2s" }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(240,192,64,0.4)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1e2a3a"; }}>
                            <span style={{ color: "#445566", fontSize: 24 }}>+</span>
                          </div>
                        </div>
                      </div>
                    ))
                  ))}
                </div>
              </div>
            )}

            {/* === WRITING MODE — Enhanced === */}
            {novelView === "write" && activeMs && (() => {
              const scene = getActiveScene();
              const act = activeMs.acts.find((a) => a.id === novelActiveScene?.actId);
              const ch = act?.chapters.find((c) => c.id === novelActiveScene?.chId);
              if (!scene || !act || !ch) return <div style={{ padding: 40, color: "#556677" }}>No scene selected.</div>;
              const scWords = scene.body ? scene.body.trim().split(/\s+/).filter(Boolean).length : 0;
              const scColor = SCENE_COLORS.find((c) => c.id === (scene.color || "none")) || SCENE_COLORS[0];
              const mentionMatches = novelMention ? articles.filter((a) => {
                const q = lower(novelMention?.query).trim();
                if (!q) return true;
                return lower(a?.title).includes(q) || lower(a?.id).startsWith(q);
              }).slice(0, 8) : [];


              // Focus mode — fullscreen overlay
              if (novelFocusMode) return (
                <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "#0a0e1a", display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{ position: "absolute", top: 16, right: 20, display: "flex", gap: 10, opacity: 0.3, transition: "opacity 0.3s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }} onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.3"; }}>
                    <span style={{ fontSize: 11, color: "#556677" }}>{scWords.toLocaleString()} words</span>
                    {novelGoal.daily > 0 && <span style={{ fontSize: 11, color: goalProgress >= 100 ? "#8ec8a0" : "#f0c040" }}>{sessionWords}/{novelGoal.daily} today</span>}
                    <button onClick={() => setNovelFocusMode(false)} style={{ background: "none", border: "1px solid #1e2a3a", color: "#6b7b8d", borderRadius: 6, padding: "3px 12px", cursor: "pointer", fontSize: 10 }}>Exit Focus</button>
                  </div>
                  <div style={{ position: "absolute", top: 16, left: 20, opacity: 0.15 }}>
                    <span style={{ fontFamily: "'Cinzel', serif", fontSize: 11, color: "#556677" }}>{act.title} › {ch.title} › {scene.title}</span>
                  </div>
                  {/* Typewriter progress bar */}
                  {novelGoal.daily > 0 && <div style={{ position: "absolute", top: 0, left: 0, height: 2, background: goalProgress >= 100 ? "#8ec8a0" : "#f0c040", width: goalProgress + "%", transition: "width 0.5s", borderRadius: 1 }} />}
                  <div style={{ flex: 1, width: "100%", maxWidth: 680, display: "flex", flexDirection: "column", overflow: "hidden", padding: "60px 0 40px" }}>
                    <div
                      ref={novelEditorRef}
                      contentEditable suppressContentEditableWarning
                      onInput={handleNovelInput}
                      onClick={handleEditorClick}
                      onMouseOver={handleEditorMouseOver}
                      onMouseLeave={() => setMentionTooltip(null)}
                      onCompositionStart={() => { isComposingRef.current = true; }}
                      onCompositionEnd={() => { isComposingRef.current = false; handleNovelInput(); }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") { if (novelMention) setNovelMention(null); else setNovelFocusMode(false); }
                        if (novelMention && mentionMatches.length > 0 && (e.key === "Tab" || e.key === "Enter")) { e.preventDefault(); insertMention(mentionMatches[0]); }
                      }}
                      onBlur={() => setTimeout(() => setNovelMention(null), 200)}
                      data-placeholder={"Begin writing...\nType @ to reference codex entries."}
                      style={{
                        flex: 1, width: "100%", background: "transparent", border: "none",
                        color: "#c8bda0", caretColor: "#f0c040",
                        fontSize: 18, fontFamily: "'Georgia', 'Times New Roman', serif",
                        lineHeight: 2.2, padding: "0 20px", outline: "none", resize: "none",
                        letterSpacing: 0.4, overflowY: "auto", whiteSpace: "pre-wrap", wordWrap: "break-word",
                      }}
                    />
                  </div>
                  {/* @mention autocomplete in focus mode */}
                  {novelMention && mentionMatches.length > 0 && (
                    <div style={{ position: "fixed", left: Math.max(10, novelMention.x), top: novelMention.y, background: "#111827", border: "1px solid rgba(240,192,64,0.3)", borderRadius: 10, padding: 6, minWidth: 260, maxHeight: 280, overflowY: "auto", zIndex: 10000, boxShadow: "0 8px 32px rgba(0,0,0,0.6)" }}>
                      <div style={{ padding: "4px 10px 6px", fontSize: 9, color: "#556677", textTransform: "uppercase", letterSpacing: 1 }}>Codex entries</div>
                      {mentionMatches.map((a, idx) => (
                        <div key={a.id} onMouseDown={(e) => { e.preventDefault(); insertMention(a); }}
                          style={{ padding: "8px 12px", fontSize: 12, color: "#d4c9a8", cursor: "pointer", borderRadius: 6, display: "flex", alignItems: "center", gap: 8, background: idx === 0 ? "rgba(240,192,64,0.08)" : "transparent" }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(240,192,64,0.12)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = idx === 0 ? "rgba(240,192,64,0.08)" : "transparent"; }}>
                          <span style={{ fontSize: 14, color: CATEGORIES[a.category]?.color }}>{CATEGORIES[a.category]?.icon}</span>
                          <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{a.title}</div></div>
                          <span style={{ fontSize: 9, color: "#445566" }}>{CATEGORIES[a.category]?.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {mentionTooltip && mentionTooltip.article && (
                    <div style={{ position: "fixed", left: mentionTooltip.x, top: mentionTooltip.y, background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "12px 14px", minWidth: 240, maxWidth: 320, zIndex: 10001, boxShadow: "0 8px 24px rgba(0,0,0,0.6)", pointerEvents: "none" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: CATEGORIES[mentionTooltip.article.category]?.color, fontFamily: "'Cinzel', serif" }}>{CATEGORIES[mentionTooltip.article.category]?.icon} {mentionTooltip.article.title}</div>
                      <div style={{ fontSize: 11, color: "#8899aa", lineHeight: 1.5, marginTop: 4 }}>{mentionTooltip.article.summary?.slice(0, 120) || "No summary."}</div>
                    </div>
                  )}
                </div>
              );

              // Normal write mode
              return (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                  {/* Writing toolbar */}
                  <div style={{ padding: "8px 20px", borderBottom: "1px solid #1a2435", display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
                    <span onClick={() => setNovelView("outline")} style={{ cursor: "pointer", color: "#556677", fontSize: 11 }}>← Outline</span>
                    <div style={{ width: 1, height: 16, background: "#1e2a3a" }} />
                    <span style={{ fontSize: 11, color: act.color, fontWeight: 600 }}>{act.title}</span>
                    <span style={{ color: "#334455" }}>›</span>
                    <span style={{ fontSize: 11, color: "#d4c9a8", fontWeight: 600 }}>{ch.title}</span>
                    <span style={{ color: "#334455" }}>›</span>
                    <span style={{ fontSize: 11, color: "#8899aa" }}>{scene.title}</span>
                    <div style={{ flex: 1 }} />

                    {/* Scene color tag */}
                    <select value={scene.color || "none"} onChange={(e) => updateScene(act.id, ch.id, scene.id, { color: e.target.value })}
                      style={{ background: "#0d1117", border: "1px solid #1e2a3a", borderRadius: 4, fontSize: 9, color: scColor.color !== "transparent" ? scColor.color : "#6b7b8d", padding: "2px 8px", cursor: "pointer", outline: "none" }}>
                      {SCENE_COLORS.map((c) => <option key={c.id} value={c.id} style={{ color: c.color !== "transparent" ? c.color : "#ccc" }}>{c.label}</option>)}
                    </select>

                    <button onClick={() => navigateScene(-1)} style={{ ...S.btnS, fontSize: 10, padding: "3px 10px" }}>←</button>
                    <button onClick={() => navigateScene(1)} style={{ ...S.btnS, fontSize: 10, padding: "3px 10px" }}>→</button>
                    <div style={{ width: 1, height: 16, background: "#1e2a3a" }} />
                    <button onClick={() => setNovelFocusMode(true)} style={{ ...S.btnS, fontSize: 10, padding: "3px 12px", color: "#c084fc", borderColor: "rgba(192,132,252,0.3)" }} title="Distraction-free writing">⊡ Focus</button>
                    <button onClick={() => setNovelSplitPane(novelSplitPane ? null : "notes")} style={{ ...S.btnS, fontSize: 10, padding: "3px 12px", background: novelSplitPane ? "rgba(240,192,64,0.1)" : "transparent", color: novelSplitPane ? "#f0c040" : "#8899aa" }}>
                      ◫ Split
                    </button>
                  </div>

                  {/* Writing goal bar */}
                  {(novelGoal.daily > 0 || novelShowGoalSet) && (
                    <div style={{ padding: "6px 20px", borderBottom: "1px solid #1a2435", display: "flex", alignItems: "center", gap: 10, flexShrink: 0, background: "rgba(17,24,39,0.3)" }}>
                      {novelShowGoalSet ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 10, color: "#6b7b8d" }}>Daily word goal:</span>
                          <input type="number" style={{ ...S.input, width: 80, padding: "3px 8px", fontSize: 11 }} placeholder="e.g. 1000" value={novelGoalInput}
                            onChange={(e) => setNovelGoalInput(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === "Enter") { setNovelGoal((g) => ({ ...g, daily: parseInt(novelGoalInput) || 0 })); setNovelShowGoalSet(false); } }} />
                          <button onClick={() => { setNovelGoal((g) => ({ ...g, daily: parseInt(novelGoalInput) || 0 })); setNovelShowGoalSet(false); }} style={{ ...S.btnS, fontSize: 9, padding: "3px 10px" }}>Set</button>
                          <button onClick={() => { setNovelGoal((g) => ({ ...g, daily: 0 })); setNovelShowGoalSet(false); }} style={{ ...S.btnS, fontSize: 9, padding: "3px 10px", color: "#e07050" }}>Clear</button>
                        </div>
                      ) : (
                        <>
                          <span style={{ fontSize: 10, color: "#6b7b8d" }}>Session:</span>
                          <span style={{ fontSize: 11, color: sessionWords > 0 ? "#8ec8a0" : "#556677", fontWeight: 600 }}>+{sessionWords.toLocaleString()}</span>
                          <div style={{ flex: 1, height: 4, background: "#111827", borderRadius: 2, maxWidth: 200, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: goalProgress + "%", background: goalProgress >= 100 ? "#8ec8a0" : goalProgress > 50 ? "#f0c040" : "#e07050", borderRadius: 2, transition: "width 0.5s" }} />
                          </div>
                          <span style={{ fontSize: 10, color: goalProgress >= 100 ? "#8ec8a0" : "#556677" }}>{goalProgress}% of {novelGoal.daily.toLocaleString()}</span>
                          {goalProgress >= 100 && <span style={{ fontSize: 10, color: "#8ec8a0" }}>🎉 Goal reached!</span>}
                          <span onClick={() => { setNovelGoalInput(String(novelGoal.daily)); setNovelShowGoalSet(true); }} style={{ fontSize: 9, color: "#445566", cursor: "pointer" }}>✎</span>
                        </>
                      )}
                    </div>
                  )}

                  <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
                    {/* Chapter nav rail */}
                    <div style={{ width: 180, borderRight: "1px solid #1a2435", overflowY: "auto", flexShrink: 0, padding: "12px 0", background: "#0a0e1a" }}>
                      {activeMs.acts.map((a) => (
                        <div key={a.id}>
                          <div style={{ padding: "6px 14px", fontSize: 10, color: a.color, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
                            <div style={{ width: 3, height: 12, background: a.color, borderRadius: 1 }} />{a.title}
                          </div>
                          {a.chapters.map((c) => (
                            <div key={c.id}>
                              {c.scenes.map((s) => {
                                const sColor = SCENE_COLORS.find((sc) => sc.id === s.color) || SCENE_COLORS[0];
                                return (
                                  <div key={s.id} onClick={() => setNovelActiveScene({ actId: a.id, chId: c.id, scId: s.id })}
                                    style={{ padding: "5px 14px 5px 26px", fontSize: 11, color: s.id === scene.id ? "#f0c040" : "#6b7b8d", cursor: "pointer", background: s.id === scene.id ? "rgba(240,192,64,0.06)" : "transparent", borderLeft: s.id === scene.id ? "2px solid #f0c040" : sColor.color !== "transparent" ? "2px solid " + sColor.color + "60" : "2px solid transparent", transition: "all 0.15s", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                                    onMouseEnter={(e) => { if (s.id !== scene.id) e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
                                    onMouseLeave={(e) => { if (s.id !== scene.id) e.currentTarget.style.background = "transparent"; }}>
                                    <span style={{ fontSize: 9, color: "#445566" }}>{c.title.replace(/Chapter\s*/i, "Ch")} · </span>{s.title}
                                  </div>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      ))}
                      {/* Goal set button in nav */}
                      <div style={{ padding: "12px 14px", borderTop: "1px solid #1a2435", marginTop: 8 }}>
                        <span onClick={() => setNovelShowGoalSet(true)} style={{ fontSize: 10, color: "#556677", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>🎯 {novelGoal.daily > 0 ? novelGoal.daily.toLocaleString() + " word goal" : "Set word goal"}</span>
                      </div>
                    </div>

                    {/* Main editor area */}
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                      {/* Scene metadata bar */}
                      <div style={{ padding: "6px 20px", borderBottom: "1px solid #111827", display: "flex", alignItems: "center", gap: 8, flexShrink: 0, background: "rgba(17,24,39,0.3)" }}>
                        <input style={{ background: "none", border: "none", fontSize: 10, color: "#c084fc", outline: "none", width: 100, fontFamily: "inherit" }}
                          placeholder="POV character..." value={scene.povCharacter || ""} onChange={(e) => updateScene(act.id, ch.id, scene.id, { povCharacter: e.target.value })} />
                        <div style={{ width: 1, height: 12, background: "#1a2435" }} />
                        <input style={{ background: "none", border: "none", fontSize: 10, color: "#6b7b8d", outline: "none", flex: 1, fontFamily: "inherit" }}
                          placeholder="Scene label / notes tag..." value={scene.label || ""} onChange={(e) => updateScene(act.id, ch.id, scene.id, { label: e.target.value })} />
                        <div style={{ width: 1, height: 12, background: "#1a2435" }} />
                        <button onClick={() => saveSnapshot(act.id, ch.id, scene.id)} title="Save snapshot of current text"
                          style={{ background: "none", border: "1px solid #1e2a3a", borderRadius: 4, color: "#7ec8e3", cursor: "pointer", fontSize: 9, padding: "2px 8px" }}>📸 Snapshot</button>
                        {scene.snapshots?.length > 0 && (
                          <span onClick={() => setNovelSnapshotView(novelSnapshotView !== null ? null : scene.snapshots.length - 1)}
                            style={{ fontSize: 9, color: "#7ec8e3", cursor: "pointer", background: "rgba(126,200,227,0.1)", padding: "2px 8px", borderRadius: 4 }}>
                            {scene.snapshots.length} snapshot{scene.snapshots.length !== 1 ? "s" : ""} {novelSnapshotView !== null ? "▾" : "▸"}
                          </span>
                        )}
                      </div>

                      {/* Snapshot viewer */}
                      {novelSnapshotView !== null && scene.snapshots?.length > 0 && (
                        <div style={{ padding: "10px 20px", borderBottom: "1px solid #1a2435", background: "rgba(126,200,227,0.03)", flexShrink: 0, maxHeight: 200, overflowY: "auto" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                            <span style={{ fontSize: 11, color: "#7ec8e3", fontWeight: 600 }}>📸 Snapshots</span>
                            <div style={{ flex: 1 }} />
                            <span onClick={() => setNovelSnapshotView(null)} style={{ fontSize: 10, color: "#556677", cursor: "pointer" }}>✕</span>
                          </div>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                            {scene.snapshots.map((snap, si) => (
                              <span key={si} onClick={() => setNovelSnapshotView(si)}
                                style={{ fontSize: 10, padding: "3px 10px", borderRadius: 6, cursor: "pointer", background: novelSnapshotView === si ? "rgba(126,200,227,0.15)" : "rgba(17,24,39,0.5)", border: "1px solid " + (novelSnapshotView === si ? "rgba(126,200,227,0.3)" : "#1e2a3a"), color: novelSnapshotView === si ? "#7ec8e3" : "#6b7b8d" }}>
                                {new Date(snap.savedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {snap.wordCount}w
                              </span>
                            ))}
                          </div>
                          {scene.snapshots[novelSnapshotView] && (
                            <div>
                              <div style={{ fontSize: 11, color: "#6b7b8d", lineHeight: 1.6, maxHeight: 80, overflow: "hidden", padding: 8, background: "rgba(10,14,26,0.5)", borderRadius: 6, fontFamily: "'Georgia', serif" }}>
                                {scene.snapshots[novelSnapshotView].body.slice(0, 300) || "(empty)"}...
                              </div>
                              <button onClick={() => { restoreSnapshot(act.id, ch.id, scene.id, novelSnapshotView); setNovelSnapshotView(null); }}
                                style={{ ...S.btnS, fontSize: 10, padding: "4px 12px", marginTop: 6, color: "#f0c040", borderColor: "rgba(240,192,64,0.3)" }}>
                                ↩ Restore this snapshot
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* ContentEditable editor */}
                      <div
                        ref={novelEditorRef}
                        contentEditable suppressContentEditableWarning
                        onInput={handleNovelInput}
                        onClick={handleEditorClick}
                        onMouseOver={handleEditorMouseOver}
                        onMouseLeave={() => setMentionTooltip(null)}
                        onCompositionStart={() => { isComposingRef.current = true; }}
                        onCompositionEnd={() => { isComposingRef.current = false; handleNovelInput(); }}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setNovelMention(null);
                          if (novelMention && mentionMatches.length > 0 && (e.key === "Tab" || e.key === "Enter")) { e.preventDefault(); insertMention(mentionMatches[0]); }
                        }}
                        onBlur={() => setTimeout(() => setNovelMention(null), 200)}
                        data-placeholder={"Begin writing " + scene.title + "...\nType @ to reference codex entries — they'll appear as clickable links."}
                        style={{
                          flex: 1, width: "100%", background: "#0d1117", border: "none",
                          color: "#d4c9a8", caretColor: "#f0c040",
                          fontSize: 15, fontFamily: "'Georgia', 'Times New Roman', serif",
                          lineHeight: 1.9, padding: "32px 48px", outline: "none", resize: "none",
                          boxSizing: "border-box", letterSpacing: 0.3, overflowY: "auto",
                          whiteSpace: "pre-wrap", wordWrap: "break-word", minHeight: 200,
                        }}
                      />

                      {/* @mention autocomplete */}
                      {novelMention && mentionMatches.length > 0 && (
                        <div style={{ position: "fixed", left: Math.max(10, novelMention.x), top: novelMention.y, background: "#111827", border: "1px solid rgba(240,192,64,0.3)", borderRadius: 10, padding: 6, minWidth: 260, maxHeight: 280, overflowY: "auto", zIndex: 100, boxShadow: "0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(240,192,64,0.1)" }}>
                          <div style={{ padding: "4px 10px 6px", fontSize: 9, color: "#556677", textTransform: "uppercase", letterSpacing: 1 }}>Codex entries</div>
                          {mentionMatches.map((a, idx) => (
                            <div key={a.id} onMouseDown={(e) => { e.preventDefault(); insertMention(a); }}
                              style={{ padding: "8px 12px", fontSize: 12, color: "#d4c9a8", cursor: "pointer", borderRadius: 6, display: "flex", alignItems: "center", gap: 8, background: idx === 0 ? "rgba(240,192,64,0.08)" : "transparent", transition: "background 0.1s" }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(240,192,64,0.12)"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = idx === 0 ? "rgba(240,192,64,0.08)" : "transparent"; }}>
                              <span style={{ fontSize: 14, color: CATEGORIES[a.category]?.color || "#888" }}>{CATEGORIES[a.category]?.icon || "?"}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</div>
                                {a.summary && <div style={{ fontSize: 10, color: "#6b7b8d", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.summary.slice(0, 60)}</div>}
                              </div>
                              <span style={{ fontSize: 9, color: "#445566", flexShrink: 0 }}>{CATEGORIES[a.category]?.label}</span>
                            </div>
                          ))}
                          <div style={{ padding: "6px 10px 4px", fontSize: 9, color: "#445566", borderTop: "1px solid #1a2435", marginTop: 4 }}>Tab/Enter to insert · Esc to close</div>
                        </div>
                      )}

                      {/* Mention hover tooltip */}
                      {mentionTooltip && mentionTooltip.article && (
                        <div style={{ position: "fixed", left: mentionTooltip.x, top: mentionTooltip.y, background: "#111827", border: "1px solid #1e2a3a", borderRadius: 10, padding: "12px 14px", minWidth: 240, maxWidth: 320, zIndex: 200, boxShadow: "0 8px 24px rgba(0,0,0,0.6)", pointerEvents: "none" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                            {mentionTooltip.article.portrait && <img src={mentionTooltip.article.portrait} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover", border: "1px solid #1e2a3a" }} />}
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: CATEGORIES[mentionTooltip.article.category]?.color || "#e8dcc8", fontFamily: "'Cinzel', serif" }}>
                                {CATEGORIES[mentionTooltip.article.category]?.icon} {mentionTooltip.article.title}
                              </div>
                              <div style={{ fontSize: 9, color: "#556677", textTransform: "uppercase", letterSpacing: 0.5 }}>{CATEGORIES[mentionTooltip.article.category]?.label}</div>
                            </div>
                          </div>
                          <div style={{ fontSize: 11, color: "#8899aa", lineHeight: 1.5 }}>{mentionTooltip.article.summary?.slice(0, 150) || "No summary."}{mentionTooltip.article.summary?.length > 150 ? "…" : ""}</div>
                          {Object.entries(mentionTooltip.article.fields || {}).filter(([_, v]) => v).slice(0, 3).map(([k, v]) => (
                            <div key={k} style={{ fontSize: 10, color: "#556677", marginTop: 3 }}><strong style={{ color: "#6b7b8d" }}>{formatKey(k)}:</strong> {String(v).slice(0, 50)}</div>
                          ))}
                          <div style={{ fontSize: 9, color: "#f0c040", marginTop: 6 }}>Click mention to open article</div>
                        </div>
                      )}

                      {/* Scene integrity warnings */}
                      {(() => {
                        const sceneWarnings = checkSceneIntegrity(scene.body, articles);
                        if (sceneWarnings.length === 0) return null;
                        return (
                          <div style={{ padding: "6px 28px", background: "rgba(224,112,80,0.04)", borderTop: "1px solid rgba(224,112,80,0.15)", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                            <span style={{ fontSize: 11, color: "#e07050" }}>🛡 {sceneWarnings.length} integrity issue{sceneWarnings.length !== 1 ? "s" : ""}:</span>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1 }}>
                              {sceneWarnings.slice(0, 4).map((w, i) => (
                                <span key={i} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: w.severity === "error" ? "rgba(224,112,80,0.1)" : "rgba(240,192,64,0.1)", color: w.severity === "error" ? "#e07050" : "#f0c040", border: "1px solid " + (w.severity === "error" ? "rgba(224,112,80,0.2)" : "rgba(240,192,64,0.2)") }}>
                                  {w.message}
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Footer bar */}
                      <div style={{ padding: "8px 20px", borderTop: "1px solid #1a2435", display: "flex", alignItems: "center", gap: 16, flexShrink: 0, background: "#0a0e1a" }}>
                        <span style={{ fontSize: 10, color: "#556677" }}>Scene: <strong style={{ color: "#8899aa" }}>{scWords.toLocaleString()}</strong> words</span>
                        <span style={{ fontSize: 10, color: "#556677" }}>Chapter: <strong style={{ color: "#8899aa" }}>{chapterWordCount(ch).toLocaleString()}</strong></span>
                        <span style={{ fontSize: 10, color: "#556677" }}>Total: <strong style={{ color: "#8899aa" }}>{msWordCount.total.toLocaleString()}</strong></span>
                        <div style={{ flex: 1 }} />
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <div style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS_COLORS[ch.status] }} />
                          <span style={{ fontSize: 9, color: "#556677", textTransform: "uppercase", letterSpacing: 0.5 }}>{ch.status}</span>
                        </div>
                        <span style={{ fontSize: 9, color: "#334455" }}>@ codex · ⊡ focus · ◫ split</span>
                      </div>
                    </div>

                    {/* === SPLIT PANE RIGHT SIDE === */}
                    {novelSplitPane && (
                      <div style={{ width: 340, borderLeft: "1px solid #1a2435", display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0, background: "#0d1117" }}>
                        {/* Split pane tabs */}
                        <div style={{ padding: "8px 12px", borderBottom: "1px solid #1a2435", display: "flex", gap: 4, flexShrink: 0 }}>
                          {[
                            { id: "notes", icon: "📝", label: "Notes" },
                            { id: "codex", icon: "📖", label: "Codex" },
                            { id: "snapshots", icon: "📸", label: "Snapshots" },
                          ].map((tab) => (
                            <span key={tab.id} onClick={() => setNovelSplitPane(tab.id)}
                              style={{ fontSize: 10, padding: "4px 10px", borderRadius: 6, cursor: "pointer", background: novelSplitPane === tab.id ? "rgba(240,192,64,0.1)" : "transparent", color: novelSplitPane === tab.id ? "#f0c040" : "#556677", border: "1px solid " + (novelSplitPane === tab.id ? "rgba(240,192,64,0.25)" : "transparent"), transition: "all 0.15s" }}>
                              {tab.icon} {tab.label}
                            </span>
                          ))}
                          <div style={{ flex: 1 }} />
                          <span onClick={() => setNovelSplitPane(null)} style={{ cursor: "pointer", color: "#445566", fontSize: 12 }}>✕</span>
                        </div>

                        {/* NOTES PANE */}
                        {novelSplitPane === "notes" && (
                          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                            <div style={{ padding: "10px 14px 6px", flexShrink: 0 }}>
                              <span style={{ fontFamily: "'Cinzel', serif", fontSize: 12, color: "#f0c040", letterSpacing: 0.5 }}>Scene Notes</span>
                              <div style={{ fontSize: 10, color: "#445566", marginTop: 2 }}>Private notes — won't appear in exports</div>
                            </div>
                            <textarea
                              value={scene.notes || ""}
                              onChange={(e) => updateScene(act.id, ch.id, scene.id, { notes: e.target.value })}
                              placeholder={"Research notes for " + scene.title + "...\n\nCharacter motivations, plot threads, setting details, reminders..."}
                              style={{
                                flex: 1, background: "transparent", border: "none", color: "#8899aa",
                                fontSize: 13, fontFamily: "'Georgia', serif", lineHeight: 1.7,
                                padding: "8px 14px", outline: "none", resize: "none", overflowY: "auto",
                              }}
                            />
                          </div>
                        )}

                        {/* CODEX PANE (replaces old sidebar) */}
                        {novelSplitPane === "codex" && (
                          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                            <div style={{ padding: "10px 14px", borderBottom: "1px solid #1a2435", flexShrink: 0 }}>
                              <input style={{ ...S.input, fontSize: 11, padding: "6px 10px" }} placeholder="Search articles..." value={novelCodexSearch} onChange={(e) => setNovelCodexSearch(e.target.value)} />
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                                <span onClick={() => setNovelCodexFilter("all")} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, cursor: "pointer", background: novelCodexFilter === "all" ? "rgba(240,192,64,0.15)" : "transparent", color: novelCodexFilter === "all" ? "#f0c040" : "#556677", border: "1px solid " + (novelCodexFilter === "all" ? "rgba(240,192,64,0.3)" : "#1e2a3a") }}>All</span>
                                {["character", "location", "race", "deity", "item", "event"].map((cat) => (
                                  <span key={cat} onClick={() => setNovelCodexFilter(cat)} style={{ fontSize: 9, padding: "2px 8px", borderRadius: 10, cursor: "pointer", background: novelCodexFilter === cat ? CATEGORIES[cat].color + "20" : "transparent", color: novelCodexFilter === cat ? CATEGORIES[cat].color : "#556677", border: "1px solid " + (novelCodexFilter === cat ? CATEGORIES[cat].color + "40" : "#1e2a3a") }}>
                                    {CATEGORIES[cat].icon}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px" }}>
                              {novelCodexArticles.map((a) => (
                                <div key={a.id} style={{ marginBottom: 2, borderRadius: 6, overflow: "hidden" }}>
                                  <div onClick={() => setNovelCodexExpanded(novelCodexExpanded === a.id ? null : a.id)}
                                    style={{ padding: "8px 10px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, transition: "background 0.15s" }}
                                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                                    <span style={{ color: CATEGORIES[a.category]?.color, fontSize: 12 }}>{CATEGORIES[a.category]?.icon}</span>
                                    <span style={{ fontSize: 12, color: "#d4c9a8", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
                                    <button onClick={(e) => { e.stopPropagation(); insertMentionFromSidebar(a); }}
                                      style={{ background: "none", border: "none", color: "#556677", cursor: "pointer", fontSize: 10, padding: "2px 4px" }} title="Insert @mention">@+</button>
                                  </div>
                                  {novelCodexExpanded === a.id && (
                                    <div style={{ padding: "4px 10px 12px 30px" }}>
                                      {a.portrait && <img src={a.portrait} alt="" style={{ width: 48, height: 48, borderRadius: 6, objectFit: "cover", float: "right", marginLeft: 8, marginBottom: 4, border: "1px solid #1e2a3a" }} />}
                                      <p style={{ fontSize: 11, color: "#6b7b8d", lineHeight: 1.5, margin: "0 0 6px" }}>{a.summary || "No summary."}</p>
                                      {Object.entries(a.fields || {}).filter(([_, v]) => v).slice(0, 5).map(([k, v]) => (
                                        <div key={k} style={{ fontSize: 10, color: "#556677", marginBottom: 2 }}><strong style={{ color: "#6b7b8d" }}>{formatKey(k)}:</strong> {String(v).slice(0, 60)}</div>
                                      ))}
                                      <div onClick={() => { setActiveArticle(a); setView("article"); }} style={{ fontSize: 10, color: "#f0c040", cursor: "pointer", marginTop: 6 }}>Open full article →</div>
                                    </div>
                                  )}
                                </div>
                              ))}
                              {novelCodexArticles.length === 0 && <p style={{ fontSize: 11, color: "#445566", textAlign: "center", padding: 20 }}>No matching articles.</p>}
                            </div>
                          </div>
                        )}

                        {/* SNAPSHOTS PANE */}
                        {novelSplitPane === "snapshots" && (
                          <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                              <span style={{ fontFamily: "'Cinzel', serif", fontSize: 12, color: "#7ec8e3", letterSpacing: 0.5 }}>Scene Snapshots</span>
                              <button onClick={() => saveSnapshot(act.id, ch.id, scene.id)} style={{ ...S.btnS, fontSize: 9, padding: "3px 10px", color: "#7ec8e3", borderColor: "rgba(126,200,227,0.3)" }}>📸 Save</button>
                            </div>
                            {(!scene.snapshots || scene.snapshots.length === 0) ? (
                              <div style={{ textAlign: "center", padding: "30px 10px", color: "#445566" }}>
                                <div style={{ fontSize: 28, marginBottom: 8 }}>📸</div>
                                <p style={{ fontSize: 12 }}>No snapshots yet.</p>
                                <p style={{ fontSize: 10, color: "#334455" }}>Save a snapshot to create a restorable version of this scene.</p>
                              </div>
                            ) : (
                              scene.snapshots.map((snap, si) => (
                                <div key={si} style={{ marginBottom: 10, background: "rgba(17,24,39,0.5)", border: "1px solid #1e2a3a", borderRadius: 8, padding: "10px 12px" }}>
                                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                                    <span style={{ fontSize: 11, color: "#7ec8e3" }}>
                                      {new Date(snap.savedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                    </span>
                                    <span style={{ fontSize: 10, color: "#556677" }}>{snap.wordCount} words</span>
                                  </div>
                                  <div style={{ fontSize: 11, color: "#6b7b8d", lineHeight: 1.5, maxHeight: 60, overflow: "hidden", marginBottom: 6 }}>
                                    {snap.body.slice(0, 150) || "(empty)"}...
                                  </div>
                                  <button onClick={() => { restoreSnapshot(act.id, ch.id, scene.id, si); }}
                                    style={{ ...S.btnS, fontSize: 9, padding: "3px 10px", color: "#f0c040", borderColor: "rgba(240,192,64,0.3)" }}>↩ Restore</button>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

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
                  <p style={{ fontSize: 12, color: "#6b7b8d", marginBottom: 10 }}>AI is reading "{aiSourceName}" and extracting lore entries</p>
                  {aiProgress.total > 0 && (
                    <div style={{ width: "80%", maxWidth: 300, margin: "0 auto" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#556677", marginBottom: 4 }}>
                        <span>Chunk {aiProgress.current} of {aiProgress.total}</span>
                        <span>{aiProgress.entries} entries found</span>
                      </div>
                      <div style={{ height: 6, background: "#1a2435", borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ height: "100%", background: "linear-gradient(90deg, #f0c040, #d4a020)", borderRadius: 3, width: (aiProgress.current / aiProgress.total * 100) + "%", transition: "width 0.5s ease" }} />
                      </div>
                    </div>
                  )}
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
                              <span key={k} style={{ fontSize: 10, color: "#6b7b8d", background: "rgba(85,102,119,0.1)", padding: "2px 8px", borderRadius: 8 }}>{formatKey(k)}: {typeof v === "string" ? v.slice(0, 40) : v}{typeof v === "string" && v.length > 40 ? "…" : ""}</span>
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
            {filtered.map((a) => { const ac = conflictsFor(a.id); const ai = checkArticleIntegrity(a, articles, a.id); const aiErrors = ai.filter((w) => w.severity === "error"); const aiWarns = ai.filter((w) => w.severity === "warning"); return (
              <div key={a.id} style={{ display: "flex", alignItems: "flex-start", gap: 14, background: "rgba(17,24,39,0.6)", border: "1px solid " + (ac.length > 0 || aiErrors.length > 0 ? "rgba(224,112,80,0.3)" : aiWarns.length > 0 ? "rgba(240,192,64,0.2)" : "#1a2435"), borderRadius: 8, padding: "16px 20px", marginBottom: 8, cursor: "pointer", transition: "all 0.2s" }} onClick={() => navigate(a.id)}
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
                    {aiErrors.length > 0 && <span style={{ ...S.catBadge("#e07050"), gap: 3 }}>🛡 {aiErrors.length} error{aiErrors.length > 1 ? "s" : ""}</span>}
                    {aiWarns.length > 0 && ac.length === 0 && aiErrors.length === 0 && <span style={{ ...S.catBadge("#f0c040"), gap: 3 }}>🛡 {aiWarns.length} warning{aiWarns.length > 1 ? "s" : ""}</span>}
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

                {/* Expanded integrity check */}
                {(() => {
                  const artWarnings = checkArticleIntegrity(activeArticle, articles, activeArticle.id)
                    .filter((w) => w.type !== "orphan");
                  const actionable = artWarnings.filter((w) => w.severity === "error" || w.severity === "warning");
                  if (actionable.length === 0) return null;
                  return (
                    <WarningBanner severity={artWarnings.some((w) => w.severity === "error") ? "error" : "warning"} icon="🛡" title={"Lore Integrity: " + actionable.length + " issue" + (actionable.length !== 1 ? "s" : "")} style={{ marginTop: 12 }}>
                      {actionable.map((w, i) => {
                        const wKey = "av_" + (w.refId || i);
                        return (
                        <div key={wKey} style={{ padding: "4px 0", fontSize: 12 }}>
                          <div style={{ display: "flex", gap: 6, alignItems: "flex-start", color: w.severity === "error" ? "#e07050" : "#f0c040", cursor: w.type === "broken_ref" && w.fuzzyMatches?.length > 0 ? "pointer" : "default" }}
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
                                w.suggestion && <div style={{ fontSize: 10, color: "#6b7b8d", marginTop: 1 }}>💡 {w.suggestion}</div>
                              )}
                            </div>
                          </div>
                          {expandedWarning === wKey && w.fuzzyMatches && (
                            <div style={{ marginLeft: 24, marginTop: 6, background: "rgba(10,14,26,0.6)", border: "1px solid #1a2435", borderRadius: 8, padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                              <div style={{ fontSize: 10, color: "#6b7b8d", marginBottom: 2 }}>Replace <span style={{ color: "#e07050", fontFamily: "monospace" }}>{(w.rawMention || "").replace(/_/g, " ")}</span> with:</div>
                              {w.fuzzyMatches.map((fm) => (
                                <div key={fm.article.id}
                                  onClick={() => {
                                    const richMention = "@[" + fm.article.title + "](" + fm.article.id + ")";
                                    setArticles((prev) => prev.map((a) => {
                                      if (a.id !== activeArticle.id) return a;
                                      let newBody = a.body || "";
                                      if (w.rawMention && newBody.includes(w.rawMention)) newBody = newBody.replace(w.rawMention, richMention);
                                      else { const legacy = "@" + w.refId; if (newBody.includes(legacy)) newBody = newBody.replace(legacy, richMention); }
                                      const newLinked = [...new Set([...(a.linkedIds || []), fm.article.id])];
                                      return { ...a, body: newBody, linkedIds: newLinked, updatedAt: new Date().toISOString() };
                                    }));
                                  }}
                                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 6, cursor: "pointer", background: "rgba(126,200,227,0.05)", border: "1px solid rgba(126,200,227,0.1)", transition: "all 0.2s" }}
                                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(126,200,227,0.15)"; e.currentTarget.style.borderColor = "rgba(126,200,227,0.3)"; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(126,200,227,0.05)"; e.currentTarget.style.borderColor = "rgba(126,200,227,0.1)"; }}>
                                  <span style={{ fontSize: 14, color: CATEGORIES[fm.article.category]?.color }}>{CATEGORIES[fm.article.category]?.icon}</span>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 12, color: "#c8bda0", fontWeight: 500 }}>{fm.article.title}</div>
                                    <div style={{ fontSize: 10, color: "#556677" }}>{CATEGORIES[fm.article.category]?.label} · match score: {fm.score}</div>
                                  </div>
                                  <span style={{ fontSize: 10, color: "#8ec8a0", fontWeight: 600 }}>✓ Fix</span>
                                </div>
                              ))}
                              <div style={{ display: "flex", gap: 8, marginTop: 4, paddingTop: 4, borderTop: "1px solid #1a2435" }}>
                                <span style={{ fontSize: 10, color: "#e07050", cursor: "pointer", opacity: 0.7 }}
                                  onClick={() => {
                                    setArticles((prev) => prev.map((a) => a.id !== activeArticle.id ? a : { ...a, body: (a.body || "").replace(w.rawMention, ""), updatedAt: new Date().toISOString() }));
                                  }}>
                                  🗑 Remove mention
                                </span>
                                <span style={{ fontSize: 10, color: "#f0c040", cursor: "pointer", opacity: 0.7 }}
                                  onClick={() => goEdit(activeArticle)}>
                                  ✎ Edit in full editor
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                        );
                      })}
                    </WarningBanner>
                  );
                })()}

                {activeArticle.fields && Object.keys(activeArticle.fields).length > 0 && (
                  <div style={{ marginTop: 20, marginBottom: 24, background: "rgba(17,24,39,0.4)", border: "1px solid #151d2e", borderRadius: 8, padding: "12px 18px", overflow: "hidden" }}>
                    {Object.entries(activeArticle.fields).filter(([_, v]) => v).map(([k, v]) => (
                      <div key={k} style={{ display: "flex", flexWrap: "wrap", borderBottom: "1px solid #111827", padding: "8px 0", gap: "4px 12px" }}>
                        <div style={{ width: 160, minWidth: 160, fontSize: 11, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 1, fontWeight: 600, paddingTop: 2 }}>{formatKey(k)}</div>
                        <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: "#c8bda0", lineHeight: 1.5, wordWrap: "break-word", overflowWrap: "break-word" }}>{v}</div>
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
                {activeArticle.linkedIds?.map((lid) => { const lk = articles.find((a) => a.id === lid); if (!lk) return <div key={lid} style={{ ...S.relItem, opacity: 0.5, cursor: "default" }}><span style={{ fontSize: 12, color: "#445566" }}>✦</span><span style={{ fontStyle: "italic" }}>{lid.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} (unwritten)</span></div>;
                  return <div key={lid} style={S.relItem} onClick={() => navigate(lid)} onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(17,24,39,0.8)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(17,24,39,0.5)"; }}><span style={{ fontSize: 14, color: CATEGORIES[lk.category]?.color }}>{CATEGORIES[lk.category]?.icon}</span><div style={{ flex: 1 }}><div style={{ fontWeight: 500, color: "#c8bda0", fontSize: 12 }}>{lk.title}</div><div style={{ fontSize: 10, color: "#556677", marginTop: 1 }}>{CATEGORIES[lk.category]?.label}</div></div></div>;
                })}

                {(() => { const sugs = findUnlinkedMentions(activeArticle.body, activeArticle.fields, articles, activeArticle.linkedIds || []); if (!sugs.length) return null; return (<>
                  <p style={{ fontFamily: "'Cinzel', serif", fontSize: 12, fontWeight: 600, color: "#7ec8e3", letterSpacing: 1, textTransform: "uppercase", marginTop: 24, marginBottom: 8 }}>💡 Suggested Links</p>
                  <p style={{ fontSize: 10, color: "#556677", margin: "0 0 8px" }}>Names found in text that may refer to codex entries. Click ✓ to link in-place.</p>
                  {sugs.map((s) => <div key={s.article.id} style={{ ...S.relItem, borderLeft: "2px solid " + (s.confidence === "exact" ? "rgba(142,200,160,0.4)" : s.confidence === "strong" ? "rgba(126,200,227,0.3)" : "rgba(240,192,64,0.2)"), display: "flex", alignItems: "center" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(126,200,227,0.08)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(17,24,39,0.5)"; }}>
                    <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }} onClick={() => navigate(s.article.id)}>
                      <span style={{ fontSize: 14, color: CATEGORIES[s.article.category]?.color }}>{CATEGORIES[s.article.category]?.icon}</span>
                      <div><div style={{ fontWeight: 500, color: "#c8bda0", fontSize: 12 }}>{s.article.title}</div><div style={{ fontSize: 10, color: s.confidence === "exact" ? "#8ec8a0" : s.confidence === "strong" ? "#7ec8e3" : "#f0c040", marginTop: 1 }}>{s.label}</div></div>
                    </div>
                    <span title={"Link \"" + s.match + "\" to " + s.article.title + " in body text"}
                      onClick={(e) => {
                        e.stopPropagation();
                        const richMention = "@[" + s.article.title + "](" + s.article.id + ")";
                        setArticles((prev) => prev.map((a) => {
                          if (a.id !== activeArticle.id) return a;
                          let newBody = a.body || "";
                          if (newBody.includes(richMention)) return a;

                          // Helper: check if a position falls inside an existing @mention and return the full @mention to replace
                          const findEnclosingMention = (body, pos) => {
                            // Check for legacy @word mentions
                            const legacyPattern = /@(?!\[)([\w]+)/g;
                            let m;
                            while ((m = legacyPattern.exec(body)) !== null) {
                              if (pos >= m.index && pos < m.index + m[0].length) return { start: m.index, end: m.index + m[0].length, text: m[0] };
                            }
                            return null;
                          };

                          // Strategy 1: Try exact full title match first
                          const titleLower = s.article.title.toLowerCase();
                          const bodyLower = newBody.toLowerCase();
                          const titleIdx = bodyLower.indexOf(titleLower);
                          if (titleIdx !== -1) {
                            newBody = newBody.substring(0, titleIdx) + richMention + newBody.substring(titleIdx + s.article.title.length);
                            return { ...a, body: newBody, linkedIds: [...new Set([...(a.linkedIds || []), s.article.id])], updatedAt: new Date().toISOString() };
                          }

                          // Strategy 2: Find where the matched text appears
                          const searchText = (s.matchText || s.match || "").toLowerCase();
                          if (searchText) {
                            const matchIdx = bodyLower.indexOf(searchText);
                            if (matchIdx !== -1) {
                              // Check if this match is inside an existing @mention — if so, replace the whole @mention
                              const enclosing = findEnclosingMention(newBody, matchIdx);
                              if (enclosing) {
                                newBody = newBody.substring(0, enclosing.start) + richMention + newBody.substring(enclosing.end);
                              } else {
                                newBody = newBody.substring(0, matchIdx) + richMention + newBody.substring(matchIdx + searchText.length);
                              }
                              return { ...a, body: newBody, linkedIds: [...new Set([...(a.linkedIds || []), s.article.id])], updatedAt: new Date().toISOString() };
                            }
                          }

                          // Fallback: append
                          newBody = newBody + "\n\n" + richMention;
                          return { ...a, body: newBody, linkedIds: [...new Set([...(a.linkedIds || []), s.article.id])], updatedAt: new Date().toISOString() };
                        }));
                      }}
                      style={{ fontSize: 11, color: "#8ec8a0", cursor: "pointer", padding: "3px 8px", borderRadius: 6, background: "rgba(142,200,160,0.1)", border: "1px solid rgba(142,200,160,0.2)", fontWeight: 600, whiteSpace: "nowrap" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(142,200,160,0.25)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(142,200,160,0.1)"; }}>
                      ✓ Link
                    </span>
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
                <div key={fk} style={{ marginBottom: 16 }}><label style={{ display: "block", fontSize: 11, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>{formatKey(fk)}</label><input style={S.input} value={formData.fields[fk] || ""} onChange={(e) => setFormData((p) => ({ ...p, fields: { ...p.fields, [fk]: e.target.value } }))} placeholder={"Enter " + formatKey(fk).toLowerCase() + "..."} /></div>
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

              <div style={{ marginBottom: 16 }}><label style={{ display: "block", fontSize: 11, color: "#6b7b8d", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontWeight: 600 }}>Body <span style={{ fontWeight: 400, color: "#445566" }}>— type @ to link codex entries</span></label><textarea style={S.textarea} value={formData.body} onChange={(e) => setFormData((p) => ({ ...p, body: e.target.value }))} placeholder={"Write about this " + CATEGORIES[createCat]?.label.toLowerCase() + "..."} rows={8} /></div>

              {linkSugs.length > 0 && <WarningBanner severity="info" icon="🔗" title="Possible Codex Links" style={{ marginBottom: 16 }}>
                <p style={{ margin: "0 0 8px" }}>Names found in your text that match codex entries. Click to link them in-place:</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{linkSugs.map((s) => (
                  <span key={s.article.id} onClick={() => smartInsertLink(s)}
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, padding: "4px 10px", background: s.confidence === "exact" ? "rgba(142,200,160,0.1)" : s.confidence === "strong" ? "rgba(126,200,227,0.1)" : "rgba(240,192,64,0.08)", border: "1px solid " + (s.confidence === "exact" ? "rgba(142,200,160,0.25)" : s.confidence === "strong" ? "rgba(126,200,227,0.2)" : "rgba(240,192,64,0.15)"), borderRadius: 12, cursor: "pointer", color: CATEGORIES[s.article.category]?.color, transition: "all 0.2s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(126,200,227,0.2)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = s.confidence === "exact" ? "rgba(142,200,160,0.1)" : "rgba(126,200,227,0.1)"; }}
                    title={s.label + ': "' + s.match + '" — will replace in-place if found in text'}>
                    <span>{CATEGORIES[s.article.category]?.icon}</span><span>{s.article.title}</span><span style={{ color: s.confidence === "exact" ? "#8ec8a0" : s.confidence === "strong" ? "#7ec8e3" : "#f0c040", fontSize: 9 }}>● {s.confidence === "exact" ? "exact" : s.confidence === "strong" ? "likely" : "possible"}</span>
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
                  <div key={warnKey} style={{ padding: "6px 0", fontSize: 12, color: "#f0c040" }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "flex-start", cursor: w.type === "broken_ref" && w.fuzzyMatches?.length > 0 ? "pointer" : "default" }}
                      onClick={() => { if (w.type === "broken_ref" && w.fuzzyMatches?.length > 0) setExpandedWarning(expandedWarning === warnKey ? null : warnKey); }}>
                      <span>⚠</span>
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
                      <div style={{ marginLeft: 24, marginTop: 6, background: "rgba(10,14,26,0.6)", border: "1px solid #1a2435", borderRadius: 8, padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ fontSize: 10, color: "#6b7b8d", marginBottom: 2 }}>Replace <span style={{ color: "#e07050", fontFamily: "monospace" }}>{(w.rawMention || "").replace(/_/g, " ")}</span> with:</div>
                        {w.fuzzyMatches.map((fm) => (
                          <div key={fm.article.id}
                            onClick={() => resolveRef(w, fm.article)}
                            style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 6, cursor: "pointer", background: "rgba(126,200,227,0.05)", border: "1px solid rgba(126,200,227,0.1)", transition: "all 0.2s" }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(126,200,227,0.15)"; e.currentTarget.style.borderColor = "rgba(126,200,227,0.3)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(126,200,227,0.05)"; e.currentTarget.style.borderColor = "rgba(126,200,227,0.1)"; }}>
                            <span style={{ fontSize: 14, color: CATEGORIES[fm.article.category]?.color }}>{CATEGORIES[fm.article.category]?.icon}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, color: "#c8bda0", fontWeight: 500 }}>{fm.article.title}</div>
                              <div style={{ fontSize: 10, color: "#556677" }}>{CATEGORIES[fm.article.category]?.label} · match score: {fm.score}</div>
                            </div>
                            <span style={{ fontSize: 10, color: "#8ec8a0", fontWeight: 600 }}>✓ Apply</span>
                          </div>
                        ))}
                        {w.type === "broken_ref" && (
                          <div style={{ display: "flex", gap: 8, marginTop: 4, paddingTop: 4, borderTop: "1px solid #1a2435" }}>
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