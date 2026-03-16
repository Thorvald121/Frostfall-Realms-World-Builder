"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { uploadWorldCover, updateWorldHome, fetchWorldHome } from "@/lib/supabase";

// ─── tiny helpers ────────────────────────────────────────────────
const timeAgo = (iso) => {
  if (!iso) return "never";
  const d = new Date(iso), now = new Date(), hrs = Math.floor((now - d) / 36e5);
  if (hrs < 1) return "just now";
  if (hrs < 24) return hrs + "h ago";
  const days = Math.floor(hrs / 24);
  return days === 1 ? "yesterday" : days + "d ago";
};

const wordCount = (html) => {
  if (!html) return 0;
  return html.replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length;
};

// ─────────────────────────────────────────────────────────────────
export function WorldHomePage({
  theme, ta, tBtnP, tBtnS, S, Ornament,
  activeWorld, articles, archived, stats, CATEGORIES,
  allConflicts, totalIntegrityIssues,
  user, isMobile,
  onNavigate,          // (view, filter?) => void
  onOpenArticle,       // (article) => void
}) {
  const isOwner = activeWorld?.user_id === user?.id || activeWorld?.member_role === "owner";

  // ── home data state ──
  const [homeData, setHomeData]         = useState(null);  // fetched from DB
  const [schemaReady, setSchemaReady]   = useState(true);  // false if columns missing
  const [loading, setLoading]           = useState(true);

  // ── edit mode state ──
  const [editing, setEditing]           = useState(false);
  const [draftTagline, setDraftTagline] = useState("");
  const [draftDesc, setDraftDesc]       = useState("");
  const [draftFeatured, setDraftFeatured] = useState([]);  // array of article ids (max 3)
  const [saving, setSaving]             = useState(false);
  const [saveMsg, setSaveMsg]           = useState(null);

  // ── cover upload ──
  const coverInputRef   = useRef(null);
  const [coverUploading, setCoverUploading] = useState(false);

  // ── derived ──
  const recentArticles = [...articles]
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
    .slice(0, 6);

  const featuredArticles = (homeData?.featured_ids || [])
    .map((id) => articles.find((a) => a.id === id))
    .filter(Boolean)
    .slice(0, 3);

  const totalWords = articles.reduce((s, a) => s + wordCount(a.body), 0);
  const connectionCount = articles.reduce((s, a) => s + (a.linkedIds?.length || 0), 0);
  const catBreakdown = Object.entries(CATEGORIES)
    .map(([k, c]) => ({ key: k, ...c, count: articles.filter((a) => a.category === k).length }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);

  // ── load from DB ──
  const load = useCallback(async () => {
    if (!activeWorld?.id) return;
    setLoading(true);
    const { data, error } = await fetchWorldHome(activeWorld.id);
    if (error === "schema_missing") { setSchemaReady(false); }
    else if (data) {
      setHomeData(data);
      setDraftTagline(data.tagline || "");
      setDraftDesc(data.description_html || "");
      setDraftFeatured(data.featured_ids || []);
    }
    setLoading(false);
  }, [activeWorld?.id]);

  useEffect(() => { load(); }, [load]);

  // ── cover upload ──
  const handleCoverUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !activeWorld?.id) return;
    setCoverUploading(true);
    const url = await uploadWorldCover(user.id, activeWorld.id, file);
    if (url) {
      await updateWorldHome(activeWorld.id, { coverUrl: url });
      setHomeData((prev) => ({ ...prev, cover_url: url }));
    }
    setCoverUploading(false);
    e.target.value = "";
  };

  // ── save edits ──
  const handleSave = async () => {
    if (!activeWorld?.id) return;
    setSaving(true);
    const result = await updateWorldHome(activeWorld.id, {
      tagline: draftTagline,
      descriptionHtml: draftDesc,
      featuredIds: draftFeatured,
    });
    setSaving(false);
    if (result.success) {
      setHomeData((prev) => ({
        ...prev,
        tagline: draftTagline,
        description_html: draftDesc,
        featured_ids: draftFeatured,
      }));
      setSaveMsg("Saved!");
      setTimeout(() => setSaveMsg(null), 2500);
      setEditing(false);
    } else {
      setSaveMsg("Save failed — " + result.error);
    }
  };

  const toggleFeatured = (articleId) => {
    setDraftFeatured((prev) => {
      if (prev.includes(articleId)) return prev.filter((id) => id !== articleId);
      if (prev.length >= 3) return prev; // max 3
      return [...prev, articleId];
    });
  };

  // ── style shortcuts ──
  const cardBase = {
    background: ta(theme.surface, 0.55),
    border: "1px solid " + theme.border,
    borderRadius: 10,
    transition: "all 0.2s",
  };

  const sectionLabel = {
    fontFamily: "'Cinzel', serif",
    fontSize: 11,
    fontWeight: 700,
    color: theme.textDim,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginBottom: 12,
  };

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: theme.textDim }}>
        <span>Loading world homepage…</span>
      </div>
    );
  }

  const cover = homeData?.cover_url || null;
  const tagline = homeData?.tagline || activeWorld?.description || "";
  const descHtml = homeData?.description_html || "";
  const lastUpdated = articles[0]?.updatedAt || activeWorld?.updated_at;

  return (
    <div style={{ maxWidth: 960, paddingBottom: 60 }}>

      {/* ── Schema missing banner ── */}
      {!schemaReady && (
        <div style={{ padding: "12px 18px", background: "rgba(240,192,64,0.08)", borderLeft: "3px solid #f0c040", borderRadius: 8, marginBottom: 20, fontSize: 12, color: "#f0c040" }}>
          ⚠ Run <code style={{ background: ta(theme.deepBg, 0.6), padding: "1px 6px", borderRadius: 4 }}>schema_world_home.sql</code> to enable cover images, taglines and featured articles.
        </div>
      )}

      {/* ══════════════════════════════════════════
          HERO — cover + title + tagline
      ══════════════════════════════════════════ */}
      <div style={{
        position: "relative", borderRadius: 14, overflow: "hidden",
        marginBottom: 28, minHeight: cover ? 280 : 160,
        background: cover
          ? `linear-gradient(to bottom, transparent 20%, ${theme.deepBg} 100%), url(${cover}) center/cover no-repeat`
          : `linear-gradient(135deg, ${ta(theme.accent, 0.08)} 0%, ${ta(theme.surface, 0.4)} 100%)`,
        border: "1px solid " + theme.border,
      }}>
        {/* Cover upload zone */}
        {isOwner && schemaReady && (
          <>
            <input ref={coverInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleCoverUpload} />
            <button
              onClick={() => coverInputRef.current?.click()}
              disabled={coverUploading}
              style={{
                position: "absolute", top: 12, right: 12,
                fontSize: 10, padding: "5px 12px", borderRadius: 6,
                background: ta(theme.deepBg, 0.75), border: "1px solid " + theme.border,
                color: theme.textMuted, cursor: "pointer", fontFamily: "inherit",
                backdropFilter: "blur(8px)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = theme.accent; e.currentTarget.style.borderColor = ta(theme.accent, 0.4); }}
              onMouseLeave={(e) => { e.currentTarget.style.color = theme.textMuted; e.currentTarget.style.borderColor = theme.border; }}>
              {coverUploading ? "Uploading…" : cover ? "🖼 Change Cover" : "🖼 Add Cover Image"}
            </button>
          </>
        )}

        {/* World title + tagline */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0,
          padding: isMobile ? "20px 20px 20px" : "28px 32px 24px",
          background: cover ? "linear-gradient(to top, " + ta(theme.deepBg, 0.95) + " 0%, transparent 100%)" : "none",
        }}>
          <h1 style={{
            fontFamily: "'Cinzel', serif", fontSize: isMobile ? 26 : 36,
            fontWeight: 700, color: theme.text, margin: "0 0 8px",
            letterSpacing: 2, textShadow: cover ? "0 2px 12px rgba(0,0,0,0.7)" : "none",
          }}>
            {activeWorld?.name}
          </h1>

          {editing ? (
            <input
              value={draftTagline}
              onChange={(e) => setDraftTagline(e.target.value)}
              placeholder="A short tagline for your world…"
              maxLength={120}
              style={{ ...S.input, width: "100%", fontSize: 14, background: ta(theme.deepBg, 0.8), marginTop: 4 }}
            />
          ) : tagline ? (
            <p style={{ fontSize: 15, color: theme.textMuted, margin: 0, fontStyle: "italic", lineHeight: 1.5, textShadow: cover ? "0 1px 6px rgba(0,0,0,0.6)" : "none" }}>
              {tagline}
            </p>
          ) : isOwner && schemaReady ? (
            <p style={{ fontSize: 13, color: ta(theme.textDim, 0.6), margin: 0, fontStyle: "italic" }}>
              Click Edit to add a tagline…
            </p>
          ) : null}
        </div>
      </div>

      {/* ── Edit / Save toolbar (owner only) ── */}
      {isOwner && schemaReady && (
        <div style={{ display: "flex", gap: 8, marginBottom: 24, alignItems: "center" }}>
          {editing ? (
            <>
              <button onClick={handleSave} disabled={saving} style={{ ...tBtnP, fontSize: 12, padding: "7px 20px", opacity: saving ? 0.6 : 1 }}>
                {saving ? "Saving…" : "✓ Save Homepage"}
              </button>
              <button onClick={() => { setEditing(false); setDraftTagline(homeData?.tagline || ""); setDraftDesc(homeData?.description_html || ""); setDraftFeatured(homeData?.featured_ids || []); }}
                style={{ ...tBtnS, fontSize: 12, padding: "7px 16px" }}>Cancel</button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} style={{ ...tBtnS, fontSize: 12, padding: "7px 16px" }}>✎ Edit Homepage</button>
          )}
          {saveMsg && <span style={{ fontSize: 12, color: saveMsg.startsWith("Save failed") ? "#e07050" : "#8ec8a0" }}>{saveMsg}</span>}
        </div>
      )}

      {/* ══════════════════════════════════════════
          STAT BAR
      ══════════════════════════════════════════ */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)", gap: 12, marginBottom: 28 }}>
        {[
          { label: "Articles", value: articles.length, icon: "📖", action: () => onNavigate("codex") },
          { label: "Words Written", value: totalWords.toLocaleString(), icon: "✍", action: null },
          { label: "Connections", value: connectionCount, icon: "🔗", action: () => onNavigate("graph") },
          { label: "Integrity Issues", value: totalIntegrityIssues, icon: "🛡", action: () => onNavigate("integrity"), alert: totalIntegrityIssues > 0 },
        ].map((s) => (
          <div key={s.label} onClick={s.action || undefined}
            style={{ ...cardBase, padding: "16px 18px", cursor: s.action ? "pointer" : "default", textAlign: "center" }}
            onMouseEnter={(e) => { if (s.action) e.currentTarget.style.borderColor = ta(theme.accent, 0.4); }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = theme.border; }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontSize: isMobile ? 22 : 28, fontWeight: 700, color: s.alert ? "#e07050" : theme.accent, fontFamily: "'Cinzel', serif" }}>{s.value}</div>
            <div style={{ fontSize: 10, color: theme.textDim, textTransform: "uppercase", letterSpacing: 1, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ══════════════════════════════════════════
          TWO-COLUMN LAYOUT: lore blurb | featured
      ══════════════════════════════════════════ */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 300px", gap: 24, marginBottom: 28 }}>

        {/* World lore description */}
        <div>
          <p style={sectionLabel}>About This World</p>
          {editing ? (
            <textarea
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
              placeholder="Write a lore introduction, world premise, or creator's note…"
              style={{ ...S.textarea, minHeight: 160, fontSize: 13, lineHeight: 1.7 }}
            />
          ) : descHtml ? (
            <div
              style={{ fontSize: 14, color: theme.textMuted, lineHeight: 1.8, ...cardBase, padding: "18px 20px" }}
              dangerouslySetInnerHTML={{ __html: descHtml }}
            />
          ) : (
            <div style={{ ...cardBase, padding: "24px 20px", textAlign: "center", color: ta(theme.textDim, 0.6) }}>
              <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>📜</div>
              <p style={{ fontSize: 13, margin: 0 }}>{isOwner ? "Click \"Edit Homepage\" to write a world introduction." : "No world description yet."}</p>
            </div>
          )}
        </div>

        {/* Featured articles */}
        <div>
          <p style={sectionLabel}>Featured Articles</p>
          {editing ? (
            <div>
              <p style={{ fontSize: 11, color: theme.textDim, marginBottom: 10 }}>Pin up to 3 articles ({draftFeatured.length}/3 selected):</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 260, overflowY: "auto" }}>
                {articles.slice(0, 40).map((a) => {
                  const cat = CATEGORIES[a.category] || {};
                  const pinned = draftFeatured.includes(a.id);
                  return (
                    <div key={a.id} onClick={() => toggleFeatured(a.id)}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 7, cursor: "pointer", background: pinned ? ta(theme.accent, 0.08) : "transparent", border: "1px solid " + (pinned ? ta(theme.accent, 0.3) : "transparent"), transition: "all 0.15s" }}
                      onMouseEnter={(e) => { if (!pinned) e.currentTarget.style.background = ta(theme.surface, 0.6); }}
                      onMouseLeave={(e) => { if (!pinned) e.currentTarget.style.background = "transparent"; }}>
                      <span style={{ fontSize: 13, flexShrink: 0 }}>{cat.icon}</span>
                      <span style={{ fontSize: 12, color: pinned ? theme.accent : theme.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</span>
                      <span style={{ fontSize: 14, color: pinned ? theme.accent : ta(theme.textDim, 0.3), flexShrink: 0 }}>{pinned ? "★" : "☆"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : featuredArticles.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {featuredArticles.map((a) => {
                const cat = CATEGORIES[a.category] || {};
                return (
                  <div key={a.id} onClick={() => onOpenArticle(a)}
                    style={{ ...cardBase, padding: "14px 16px", cursor: "pointer", borderLeft: "3px solid " + (cat.color || theme.accent) }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.surface, 0.85); e.currentTarget.style.transform = "translateX(3px)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = ta(theme.surface, 0.55); e.currentTarget.style.transform = "none"; }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 14 }}>{cat.icon}</span>
                      <span style={{ fontSize: 10, color: cat.color, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{cat.label}</span>
                      <span style={{ fontSize: 12, color: "#f0c040", marginLeft: "auto" }}>★</span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, fontFamily: "'Cinzel', serif" }}>{a.title}</div>
                    {a.summary && <div style={{ fontSize: 11, color: theme.textDim, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{a.summary}</div>}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ ...cardBase, padding: "24px 16px", textAlign: "center", color: ta(theme.textDim, 0.6) }}>
              <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.4 }}>★</div>
              <p style={{ fontSize: 12, margin: 0 }}>{isOwner ? "Pin up to 3 key articles via Edit." : "No featured articles yet."}</p>
            </div>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════
          RECENT ACTIVITY STRIP
      ══════════════════════════════════════════ */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <p style={{ ...sectionLabel, margin: 0 }}>Recently Updated</p>
          <button onClick={() => onNavigate("codex")}
            style={{ fontSize: 11, color: theme.textDim, background: "none", border: "none", cursor: "pointer", padding: 0 }}
            onMouseEnter={(e) => { e.currentTarget.style.color = theme.accent; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = theme.textDim; }}>
            View all →
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 10 }}>
          {recentArticles.map((a) => {
            const cat = CATEGORIES[a.category] || {};
            return (
              <div key={a.id} onClick={() => onOpenArticle(a)}
                style={{ ...cardBase, padding: "12px 14px", cursor: "pointer" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = ta(theme.surface, 0.85); e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.3)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = ta(theme.surface, 0.55); e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 13 }}>{cat.icon}</span>
                  <span style={{ fontSize: 9, color: cat.color || theme.textDim, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{cat.label}</span>
                  <span style={{ fontSize: 9, color: theme.textDim, marginLeft: "auto" }}>{timeAgo(a.updatedAt || a.createdAt)}</span>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: theme.text, fontFamily: "'Cinzel', serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</div>
                {a.summary && <div style={{ fontSize: 10, color: theme.textDim, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.summary}</div>}
              </div>
            );
          })}
          {recentArticles.length === 0 && (
            <div style={{ gridColumn: "1/-1", textAlign: "center", padding: "30px 0", color: theme.textDim, fontSize: 13 }}>
              No articles yet. <button onClick={() => onNavigate("codex")} style={{ background: "none", border: "none", color: theme.accent, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>Create your first →</button>
            </div>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════
          CATEGORY BREAKDOWN
      ══════════════════════════════════════════ */}
      {catBreakdown.length > 0 && (
        <div>
          <p style={sectionLabel}>Codex Breakdown</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {catBreakdown.map((c) => (
              <div key={c.key} onClick={() => onNavigate("codex", c.key)}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", ...cardBase, cursor: "pointer", borderLeft: "3px solid " + c.color }}
                onMouseEnter={(e) => { e.currentTarget.style.background = ta(c.color, 0.1); }}
                onMouseLeave={(e) => { e.currentTarget.style.background = ta(theme.surface, 0.55); }}>
                <span style={{ fontSize: 14 }}>{c.icon}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: c.color }}>{c.count}</div>
                  <div style={{ fontSize: 9, color: theme.textDim, textTransform: "uppercase", letterSpacing: 0.5 }}>{c.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Last updated footnote */}
      <div style={{ marginTop: 32, fontSize: 10, color: ta(theme.textDim, 0.5), textAlign: "center" }}>
        Last activity {timeAgo(lastUpdated)} · {articles.length} articles · {archived.length} archived
      </div>
    </div>
  );
}

export default WorldHomePage;