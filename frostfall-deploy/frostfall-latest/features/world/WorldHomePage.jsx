"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, BookOpen, CalendarClock, Check, ChevronRight, FilePenLine,
  FileText, ImagePlus, Layers3, Link2, Map, Pencil, Save,
  ShieldCheck, Sparkles, Star, UploadCloud, X,
} from "lucide-react";
import { fetchWorldHome, updateWorldHome, uploadWorldCover } from "@/lib/supabase";
import SafeRichText from "@/components/ui/SafeRichText";
import styles from "./WorldHomePage.module.css";

const wordCount = (html) => String(html || "")
  .replace(/<[^>]*>/g, " ").trim().split(/\s+/).filter(Boolean).length;

const toTime = (value) => {
  const date = new Date(value || 0).getTime();
  return Number.isFinite(date) ? date : 0;
};

const fmtDate = (value) => {
  if (!value) return "Not yet updated";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Date unavailable" : date.toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
};

function PanelTitle({ eyebrow, title, action }) {
  return <div className={styles.panelHeading}>
    <div><span className={styles.eyebrow}>{eyebrow}</span><h2>{title}</h2></div>
    {action}
  </div>;
}

/** World-scoped homepage. This view never mixes the previous world's fetched home data. */
export function WorldHomePage({
  activeWorld, articles = [], archived = [], CATEGORIES = {}, totalIntegrityIssues = 0,
  user, onNavigate, onOpenArticle,
}) {
  const worldId = activeWorld?.id;
  const canEdit = !!worldId && (activeWorld?.user_id === user?.id || activeWorld?.member_role === "owner");
  const coverInputRef = useRef(null);
  const [homeData, setHomeData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState("");
  const [editing, setEditing] = useState(false);
  const [draftTagline, setDraftTagline] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftFeatured, setDraftFeatured] = useState([]);
  const [saving, setSaving] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setHomeData(null);
    setReadError("");
    setEditing(false);
    setSaveMsg("");
    setDraftFeatured([]);
    setDraftTagline("");
    setDraftDesc("");
    if (!worldId) { setLoading(false); return () => { cancelled = true; }; }
    fetchWorldHome(worldId).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setReadError(error === "schema_missing"
          ? "World Home storage is not configured. No world information has been changed."
          : "World details could not be loaded. Editing is unavailable until the connection is restored.");
      } else {
        setHomeData(data);
        setDraftTagline(data?.tagline || "");
        setDraftDesc(data?.description_html || "");
        setDraftFeatured(Array.isArray(data?.featured_ids) ? data.featured_ids : []);
      }
    }).catch(() => {
      if (!cancelled) setReadError("World details could not be loaded. Please try again.");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [worldId]);

  const recentArticles = useMemo(() => [...articles]
    .sort((a, b) => toTime(b.updatedAt || b.createdAt) - toTime(a.updatedAt || a.createdAt))
    .slice(0, 6), [articles]);
  const featuredArticles = useMemo(() => (homeData?.featured_ids || [])
    .map((id) => articles.find((a) => a.id === id)).filter(Boolean).slice(0, 3), [homeData, articles]);
  const categoryCounts = useMemo(() => Object.entries(CATEGORIES).map(([key, category]) => ({
    key, ...category, count: articles.filter((article) => article.category === key).length,
  })).filter(({ count }) => count).sort((a, b) => b.count - a.count), [articles, CATEGORIES]);
  const totalWords = useMemo(() => articles.reduce((sum, a) => sum + wordCount(a.body), 0), [articles]);
  const connections = useMemo(() => articles.reduce((sum, a) => sum + (a.linkedIds?.length || 0), 0), [articles]);

  const save = async () => {
    if (!canEdit || readError || saving) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const result = await updateWorldHome(worldId, {
        tagline: draftTagline.trim(), descriptionHtml: draftDesc,
        featuredIds: draftFeatured.slice(0, 3),
      });
      if (!result?.success) { setSaveMsg("Changes were not saved. Please retry."); return; }
      setHomeData((old) => ({ ...old, tagline: draftTagline.trim(), description_html: draftDesc,
        featured_ids: draftFeatured.slice(0, 3) }));
      setEditing(false);
      setSaveMsg("World Home saved successfully.");
    } catch {
      setSaveMsg("Changes were not saved. Please retry.");
    } finally { setSaving(false); }
  };

  const uploadCover = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!canEdit || readError || !file) return;
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      setSaveMsg("Choose an image smaller than 5 MB."); return;
    }
    setCoverUploading(true);
    setSaveMsg("");
    try {
      const url = await uploadWorldCover(user.id, worldId, file);
      if (!url) throw new Error("upload failed");
      const saved = await updateWorldHome(worldId, { coverUrl: url });
      if (!saved?.success) throw new Error("save failed");
      setHomeData((old) => ({ ...old, cover_url: url }));
      setSaveMsg("Cover image updated.");
    } catch { setSaveMsg("Cover image could not be saved. Please retry."); }
    finally { setCoverUploading(false); }
  };

  const toggleFeatured = (id) => setDraftFeatured((old) => old.includes(id)
    ? old.filter((x) => x !== id) : old.length < 3 ? [...old, id] : old);

  if (loading) return <div className={styles.loading} role="status">Loading world home…</div>;

  const cover = homeData?.cover_url;
  const tagline = homeData?.tagline || activeWorld?.description || "";
  const description = homeData?.description_html || "";
  const readable = !readError;
  const cards = [
    { icon: BookOpen, label: "Codex entries", value: articles.length, action: () => onNavigate("codex") },
    { icon: FileText, label: "Lore words", value: totalWords.toLocaleString(), action: () => onNavigate("codex") },
    { icon: Link2, label: "Linked references", value: connections, action: () => onNavigate("graph") },
    { icon: ShieldCheck, label: "Integrity findings", value: totalIntegrityIssues, action: () => onNavigate("integrity") },
  ];

  return <section className={styles.root} aria-label="World Home">
    <div className={styles.pageIntro}>
      <div><span className={styles.eyebrow}>THE WORLD / HOME</span><h1>World Home</h1>
        <p>Introduce your realm, curate its essential lore, and track its ongoing creation.</p></div>
      {canEdit && readable && <button type="button" className={styles.secondary} onClick={() => setEditing((v) => !v)}>
        {editing ? <X size={16} /> : <Pencil size={16} />} {editing ? "Stop editing" : "Edit World Home"}
      </button>}
    </div>

    {!!readError && <div className={styles.error} role="alert">{readError}</div>}
    <div className={styles.hero} style={cover && readable ? { backgroundImage: `linear-gradient(90deg, var(--deepBg, #0a0e1a), transparent), url("${cover.replace(/"/g, "%22")}")` } : undefined}>
      <div className={styles.heroCopy}>
        <span className={styles.eyebrow}>{activeWorld?.member_role === "viewer" ? "SHARED WORLD" : "YOUR WORLD"} · WORLD HOME</span>
        <h2>{activeWorld?.name || "Untitled World"}</h2>
        {editing ? <label className={styles.formLabel}>World tagline
          <input maxLength={120} value={draftTagline} onChange={(e) => setDraftTagline(e.target.value)} placeholder="A short description of your realm" />
        </label> : <p>{tagline || "Every great world begins with an idea. Give this realm a story worth exploring."}</p>}
        <div className={styles.heroActions}>
          <button className={styles.primary} onClick={() => onNavigate("codex")} type="button"><BookOpen size={16} /> Explore Codex <ArrowRight size={15} /></button>
          <button className={styles.secondary} onClick={() => onNavigate("timeline")} type="button"><CalendarClock size={16} /> Chronicles</button>
        </div>
      </div>
      <div className={styles.heroEmblem} aria-hidden="true"><Sparkles size={46} /></div>
      {canEdit && readable && <><input type="file" accept="image/*" ref={coverInputRef} hidden onChange={uploadCover} />
        <button type="button" disabled={coverUploading} className={styles.coverButton} onClick={() => coverInputRef.current?.click()}>
          {coverUploading ? <UploadCloud size={15} /> : <ImagePlus size={15} />}
          {coverUploading ? "Uploading…" : cover ? "Change cover" : "Add cover"}
        </button></>}
    </div>

    <div className={styles.stats} aria-label="World statistics">{cards.map(({ icon: Icon, label, value, action }) => (
      <button type="button" className={styles.stat} onClick={action} key={label}>
        <Icon aria-hidden="true" size={18}/><strong>{value}</strong><span>{label}</span><ChevronRight aria-hidden="true" size={15}/>
      </button>
    ))}</div>

    {saveMsg && <p className={styles.saveMessage} role="status">{saveMsg}</p>}
    {editing && canEdit && readable && <div className={styles.editActions}>
      <span>Changes become visible to members of this world when saved.</span>
      <button type="button" className={styles.primary} onClick={save} disabled={saving}><Save size={16} /> {saving ? "Saving…" : "Save world changes"}</button>
      <button type="button" className={styles.secondary} onClick={() => { setDraftTagline(homeData?.tagline || "");setDraftDesc(homeData?.description_html || "");setDraftFeatured(homeData?.featured_ids || []);setEditing(false); }}>Discard changes</button>
    </div>}

    {articles.length === 0 && <div className={styles.starter}>
      <div className={styles.starterHeading}><Sparkles aria-hidden="true" size={19}/>
        <div><span className={styles.eyebrow}>START BUILDING</span><h2>Your world's first chapters</h2></div></div>
      <div className={styles.starterSteps}>
        <button type="button" onClick={() => onNavigate("codex")}><BookOpen size={20}/><strong>1. Create an entry</strong><span>Establish a person, place, event or other piece of lore.</span><ArrowRight size={16}/></button>
        <button type="button" onClick={() => onNavigate("timeline")}><CalendarClock size={20}/><strong>2. Build its history</strong><span>Add dated events to give your realm a chronology.</span><ArrowRight size={16}/></button>
        <button type="button" onClick={() => onNavigate("canon_studio")}><ShieldCheck size={20}/><strong>3. Establish canon</strong><span>Record claims and sources you want to treat as established.</span><ArrowRight size={16}/></button>
      </div>
    </div>}

    <div className={styles.bodyGrid}>
      <section className={styles.panel}>
        <PanelTitle eyebrow="FOUNDATION" title="About this world" />
        {editing ? <label className={styles.formLabel}>World introduction
          <textarea rows={9} value={draftDesc} onChange={(e) => setDraftDesc(e.target.value)} placeholder="Describe the realm, central conflict, geography, history or your creative vision…" />
        </label> : description ? <SafeRichText html={description} className={styles.description} /> :
          <div className={styles.emptyInline}><Map size={23}/><h3>The story has yet to be told</h3>
            <p>Write an introduction to give visitors context for this world.</p>
            {canEdit && readable && <button type="button" className={styles.textAction} onClick={() => setEditing(true)}>Write an introduction <ArrowRight size={15}/></button>}
          </div>}
      </section>
      <section className={styles.panel}>
        <PanelTitle eyebrow="CURATED LORE" title="Featured entries" action={!!articles.length && !editing ? <button className={styles.textAction} onClick={() => onNavigate("codex")}>Browse Codex <ArrowRight size={14}/></button> : null}/>
        {editing ? <div className={styles.pinList} role="group" aria-label="Feature up to three entries">
          <p>Select up to three entries ({draftFeatured.length}/3)</p>
          {articles.slice(0, 60).map((article) => <label key={article.id}><input type="checkbox" checked={draftFeatured.includes(article.id)} disabled={!draftFeatured.includes(article.id) && draftFeatured.length >= 3} onChange={() => toggleFeatured(article.id)} />{article.title}</label>)}
          {!articles.length && <p>Add Codex entries before choosing featured lore.</p>}
        </div> : featuredArticles.length ? <div className={styles.featuredList}>{featuredArticles.map((article) => {
          const category = CATEGORIES[article.category] || {};
          return <button type="button" key={article.id} onClick={() => onOpenArticle(article)} style={{ "--entry-color": category.color || "var(--accent)" }}>
            <Star size={16}/><span><strong>{article.title}</strong><small>{category.label || "Codex entry"}</small></span><ChevronRight size={16}/>
          </button>;
        })}</div> : <div className={styles.emptyInline}><Star size={23}/><h3>Spotlight your essential lore</h3><p>Feature up to three Codex entries that define this world.</p>
          {!!articles.length && canEdit && readable && <button className={styles.textAction} onClick={() => setEditing(true)}>Choose featured entries <ArrowRight size={15}/></button>}
        </div>}
      </section>
    </div>

    <div className={styles.bodyGrid}>
      <section className={styles.panel}>
        <PanelTitle eyebrow="WORLD ACTIVITY" title="Recently updated lore" action={<button className={styles.textAction} onClick={() => onNavigate("codex")}>All entries <ArrowRight size={14}/></button>} />
        {recentArticles.length ? <div className={styles.recentGrid}>{recentArticles.map((article) => {
          const category = CATEGORIES[article.category] || {};
          return <button type="button" key={article.id} className={styles.recentCard} onClick={() => onOpenArticle(article)} style={{ "--entry-color": category.color || "var(--accent)" }}>
            <span className={styles.recentCategory}>{category.label || "Codex"}</span>
            <strong>{article.title}</strong><small>{article.summary || "Open this entry"}</small>
            <span className={styles.recentDate}>{fmtDate(article.updatedAt || article.createdAt)} <ArrowRight size={14}/></span>
          </button>;
        })}</div> : <div className={styles.emptyInline}><FilePenLine size={23}/><h3>No recent lore yet</h3><p>As entries are written and updated, they will appear here.</p></div>}
      </section>
      <section className={styles.panel}>
        <PanelTitle eyebrow="WORLD CONTENT" title="Codex breakdown" />
        {categoryCounts.length ? <div className={styles.categoryList}>{categoryCounts.map((category) => <button type="button" key={category.key} onClick={() => onNavigate("codex",category.key)} style={{ "--entry-color": category.color || "var(--accent)" }}>
          <span className={styles.categoryDot}/><span>{category.label}</span><strong>{category.count}</strong><ArrowRight size={15}/>
        </button>)}</div> : <div className={styles.emptyInline}><Layers3 size={23}/><h3>Ready for a world of possibilities</h3><p>Categories fill automatically as your Codex grows.</p></div>}
      </section>
    </div>
    <p className={styles.footer}><Check size={13}/> World scoped to {activeWorld?.name}. {articles.length} entries, {archived.length} archived.</p>
  </section>;
}

export default WorldHomePage;