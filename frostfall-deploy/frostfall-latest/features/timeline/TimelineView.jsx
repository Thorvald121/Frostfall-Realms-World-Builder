"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CalendarRange, List, Search, FilterX, ZoomIn, ZoomOut,
  Download, ChevronRight, X, BookOpen, Pencil,
  Link2, AlertTriangle, Clock3, Compass, Rows3, ArrowUpDown,
} from "lucide-react";
import { CATEGORIES, SWIM_LANE_ORDER, formatKey } from "@/lib/domain/categories";
import { ensureContrast, readableOn } from "@/lib/ui/contrast";
import {
  buildChronicleEvents, filterChronicleEvents, eraForEvent, chronicleRange,
  layoutChronicleLanes, chronicleTicks, chronicleConnections, exportChroniclesCSV,
} from "@/lib/domain/chronicles";
import styles from "./Chronicles.module.css";

const EMPTY_FILTERS = Object.freeze({
  search: "", category: "all", era: "all", kind: "all",
  from: null, to: null, sort: "date_asc", includeUndated: false,
});
const ZOOM_FACTORS = [0.7, 1, 1.5, 2.5, 4, 6];
const formatYear = (year) => year == null ? "Date not recorded" :
  year < 0 ? `Year −${Math.abs(year).toLocaleString()}` : `Year ${year.toLocaleString()}`;
const rangeLabel = (e, yearFormatter = formatYear) => !e.dated ? "Date not recorded" : e.kind === "point" ? yearFormatter(e.start) :
  `${yearFormatter(e.start)} – ${yearFormatter(e.end)}`;
const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
const yearValue = (s) => s === "" ? null : (Number.isFinite(Number(s)) ? Number(s) : null);

function EventInspector({ event, allArticles, conflictsFor, eras, theme, yearFormatter, navigate, goEdit, onClose, onPick }) {
  const closeRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    const escape = (e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "Tab") {
        const dialog = closeRef.current?.closest('[role=dialog]');
        const focusable = [...(dialog?.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled])') || [])];
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      } };
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("keydown", escape); previous?.focus?.(); };
  }, [onClose]);
  if (!event) return null;
  const related = chronicleConnections(event.article, allArticles);
  const conflicts = typeof conflictsFor === "function" ? (conflictsFor(event.id) || []) : [];
  const eraNames = eraForEvent(event, eras).map(e => e.label || e.name).join(" · ");
  const fields = Object.entries(event.article.fields || {}).filter(([, value]) => value != null && value !== "");
  const category = CATEGORIES[event.category];
  return createPortal(
    <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section className={styles.inspector} role="dialog" aria-modal="true" aria-labelledby="chronicle-inspector-title"
        style={{ "--cr-bg": theme.surface, "--cr-panel": theme.inputBg, "--cr-text": theme.text,
          "--cr-muted": theme.textMuted, "--cr-border": theme.border,
          "--cr-accent": ensureContrast(theme.accent, [theme.surface], 4.5),
          "--cr-accent-bg": theme.accent, "--cr-accent-on": readableOn(theme.accent) }}>
        <div className={styles.inspectorHeader}>
          <span className={styles.eyebrow}><Clock3 size={15}/> Chronicle entry · {category?.label || event.category}</span>
          <button ref={closeRef} className={styles.iconButton} aria-label="Close event details" onClick={onClose}><X size={18}/></button>
        </div>
        <h2 id="chronicle-inspector-title">{event.title}</h2>
        <p className={styles.timeHeading}>{rangeLabel(event, yearFormatter)}</p>
        {eraNames && <div className={styles.eraBadge}>{eraNames}</div>}
        {event.summary && <p className={styles.inspectorSummary}>{event.summary}</p>}
        {event.article.body && <section className={styles.inspectorSection}>
          <h3>Recorded lore</h3>
          <p className={styles.bodyExcerpt}>{String(event.article.body).replace(/<[^>]*>/g, " ").slice(0, 1400)}{String(event.article.body).length > 1400 ? "…" : ""}</p>
        </section>}
        {fields.length > 0 && <section className={styles.inspectorSection}>
          <h3>Associated information</h3>
          <dl className={styles.fieldGrid}>{fields.map(([name, value]) => <div key={name}><dt>{formatKey(name)}</dt><dd>{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>)}</dl>
        </section>}
        {related.length > 0 && <section className={styles.inspectorSection}>
          <h3><Link2 size={15}/> Referenced lore <small>(references do not imply participation)</small></h3>
          <div className={styles.linkGrid}>{related.map(a => <button key={a.id} className={styles.link} onClick={() => onPick(a)}>{a.title}</button>)}</div>
        </section>}
        {conflicts.length > 0 && <section className={styles.inspectorSection}>
          <h3><AlertTriangle size={15}/> Canon findings ({conflicts.length})</h3>
          {conflicts.map((c, index) => <p className={styles.finding} key={c.id || index}>{c.message}</p>)}
        </section>}
        {!event.valid && <p className={styles.finding}>The recorded end year precedes the start year. Review the Codex dates.</p>}
        <div className={styles.inspectorActions}>
          <button className={styles.primary} onClick={() => { onClose(); navigate(event.id); }}><BookOpen size={15}/> Open Codex entry</button>
          <button className={styles.secondary} onClick={() => { onClose(); goEdit(event.article); }}><Pencil size={15}/> Edit entry</button>
        </div>
      </section>
    </div>, document.body);
}

/** Accessible chronological atlas with one page-level vertical scroll. */
export function TimelineView({ theme, articles, activeWorld, activeEras = [], formatWorldYear, navigate, goEdit, conflictsFor }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const displayYear = formatWorldYear || formatYear;
  const [mode, setMode] = useState("lanes");
  const [zoom, setZoom] = useState(2);
  const [selectedId, setSelectedId] = useState(null);
  const [indexLimit, setIndexLimit] = useState(50);
  const [jumpYear, setJumpYear] = useState("");
  const scrollRef = useRef(null);
  const events = useMemo(() => buildChronicleEvents(articles), [articles]);
  const filtered = useMemo(() => filterChronicleEvents(events, filters, activeEras), [events, filters, activeEras]);
  const dated = useMemo(() => filtered.filter(e => e.dated), [filtered]);
  const selected = useMemo(() => events.find(e => e.id === selectedId) || null, [events, selectedId]);
  const allDated = events.filter(e => e.dated).length;
  const update = (name, value) => { setFilters(f => ({ ...f, [name]: value })); setIndexLimit(50); };
  const range = useMemo(() => chronicleRange(dated), [dated]);
  const stageWidth = clamp(Math.round(1050 * ZOOM_FACTORS[zoom]), 720, 19000);
  const scale = (stageWidth - 220) / range.span;
  const yearToX = useCallback(y => 175 + (y - range.min) * scale, [scale, range.min]);
  const categories = SWIM_LANE_ORDER.filter(category => dated.some(e => e.category === category));
  const lanes = useMemo(() => layoutChronicleLanes(dated, categories, yearToX, 148), [dated, categories.join("|"), yearToX]);
  const ticks = useMemo(() => chronicleTicks(range.min, range.max, scale), [range.min, range.max, scale]);
  const colorFor = useCallback(cat => ensureContrast(CATEGORIES[cat]?.color || theme.accent,
    [theme.surface, theme.inputBg], 4.5), [theme]);
  const openId = useCallback(id => setSelectedId(String(id)), []);
  const closeDetail = useCallback(() => setSelectedId(null), []);
  const pickRelated = useCallback(a => setSelectedId(a.id), []);
  useEffect(() => { setFilters(EMPTY_FILTERS); setSelectedId(null); setZoom(2); }, [activeWorld?.id]);
  const jumpTo = () => {
    const year = yearValue(jumpYear);
    if (year == null || !scrollRef.current) return;
    scrollRef.current.scrollLeft = clamp(yearToX(year) - scrollRef.current.clientWidth / 2, 0, stageWidth);
  };
  const selectedIndex = filtered.findIndex(e => e.id === selectedId);
  const adjacent = step => { if (!filtered.length) return; const idx = selectedIndex < 0 ? 0 : (selectedIndex + step + filtered.length) % filtered.length; openId(filtered[idx].id); };
  const saveCSV = () => {
    const csv = exportChroniclesCSV(filtered);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `frostfall-chronicles-${activeWorld?.name || 'world'}`.toLowerCase().replace(/[^a-z0-9._-]+/g,'-') + '.csv';
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 3000);
  };

  return <section className={styles.root} aria-label="Chronicles workspace"
    style={{ "--cr-bg": theme.surface, "--cr-panel": theme.inputBg, "--cr-text": theme.text,
      "--cr-muted": theme.textMuted, "--cr-soft": theme.textDim,
      "--cr-border": theme.border, "--cr-divider": theme.divider,
      "--cr-accent": ensureContrast(theme.accent, [theme.surface,theme.inputBg], 4.5),
      "--cr-accent-bg": theme.accent, "--cr-accent-on": readableOn(theme.accent) }}>
    <header className={styles.heading}>
      <div>
        <p className={styles.eyebrow}><Compass size={16}/> World history / {activeWorld?.name || 'Current world'}</p>
        <h1>The Chronicles <span className={styles.version}>Interactive timeline</span></h1>
        <p>Discover events, investigate their context, and trace the history of your world.</p>
      </div>
      <div className={styles.topActions}>
        <button className={styles.secondary} onClick={saveCSV} disabled={!filtered.length}><Download size={16}/> Export filtered CSV</button>
      </div>
    </header>
    <div className={styles.stats} aria-live="polite">
      <div><strong>{dated.length.toLocaleString()}</strong><span>Dated in view</span></div>
      <div><strong>{filtered.length.toLocaleString()}</strong><span>Matching entries</span></div>
      <div><strong>{allDated.toLocaleString()}</strong><span>Dated in world</span></div>
      <div><strong>{events.length - allDated}</strong><span>Without dates</span></div>
    </div>
    <div className={styles.filters}>
      <label className={`${styles.searchField} ${styles.field}`}>
        <span><Search size={14}/> Find lore or events</span>
        <input type="search" value={filters.search} onChange={e => update('search', e.target.value)} placeholder="Search title, tags, lore…"/>
      </label>
      <label className={styles.field}><span>Category</span>
        <select value={filters.category} onChange={e => update('category', e.target.value)}><option value="all">All categories</option>
          {Object.entries(CATEGORIES).map(([id,cat]) => <option key={id} value={id}>{cat.label}</option>)}
        </select>
      </label>
      <label className={styles.field}><span>Era</span>
        <select value={filters.era} onChange={e => update('era', e.target.value)}><option value="all">All eras</option>
          {activeEras.map((era,index) => <option key={era.id || index} value={era.id || String(index)}>{era.label || era.name}</option>)}
        </select>
      </label>
      <label className={styles.field}><span>Entry type</span>
        <select value={filters.kind} onChange={e => update('kind', e.target.value)}>
          <option value="all">All types</option><option value="point">Point in time</option>
          <option value="span">Time span</option><option value="undated">Without dates</option>
        </select>
      </label>
      <label className={styles.field}><span>From year</span>
        <input type="number" value={filters.from ?? ""} onChange={e=>update('from', yearValue(e.target.value))} placeholder="Any"/>
      </label>
      <label className={styles.field}><span>Through year</span>
        <input type="number" value={filters.to ?? ""} onChange={e=>update('to', yearValue(e.target.value))} placeholder="Any"/>
      </label>
      <label className={styles.field}><span><ArrowUpDown size={13}/> Sort by</span>
        <select value={filters.sort} onChange={e=>update('sort',e.target.value)}>
          <option value="date_asc">Earliest first</option><option value="date_desc">Latest first</option>
          <option value="title_asc">Title A → Z</option><option value="title_desc">Title Z → A</option>
          <option value="updated_desc">Recently updated</option><option value="duration_desc">Longest duration</option>
        </select>
      </label>
      <div className={styles.filterActions}>
        <label className={styles.checkline}><input type="checkbox" checked={filters.includeUndated} onChange={e=>update('includeUndated',e.target.checked)}/> Include undated</label>
        <button className={styles.secondary} onClick={() => { setFilters(EMPTY_FILTERS); setIndexLimit(50); }}><FilterX size={14}/> Clear filters</button>
      </div>
    </div>
    <div className={styles.workspaceBar}>
      <div className={styles.modeTabs} role="group" aria-label="Chronicles display mode">
        <button aria-pressed={mode === 'lanes'} className={mode === 'lanes' ? styles.activeMode : ''} onClick={()=>setMode('lanes')}><CalendarRange size={16}/> Timeline</button>
        <button aria-pressed={mode === 'index'} className={mode === 'index' ? styles.activeMode : ''} onClick={()=>setMode('index')}><List size={16}/> Event index</button>
      </div>
      {mode === 'lanes' && <div className={styles.zoomTools}>
        <label className={styles.jump}><span className={styles.srOnly}>Jump to world year</span><input type="number" value={jumpYear} onChange={e=>setJumpYear(e.target.value)} placeholder="Jump to year" onKeyDown={e=>e.key==='Enter'&&jumpTo()}/></label>
        <button className={styles.secondary} onClick={jumpTo} disabled={jumpYear.trim()==='' || !dated.length}>Go</button>
        <button className={styles.iconButton} onClick={()=>setZoom(v=>Math.max(0,v-1))} disabled={zoom===0} aria-label="Zoom timeline out"><ZoomOut size={16}/></button>
        <span className={styles.zoomLabel}>Zoom {zoom+1}/{ZOOM_FACTORS.length}</span>
        <button className={styles.iconButton} onClick={()=>setZoom(v=>Math.min(ZOOM_FACTORS.length-1,v+1))} disabled={zoom===ZOOM_FACTORS.length-1} aria-label="Zoom timeline in"><ZoomIn size={16}/></button>
      </div>}
    </div>
    {mode === 'lanes' ? <div className={styles.laneWrapper}>
      {!dated.length ? <div className={styles.empty}><CalendarRange size={25}/><h3>No dated events match</h3><p>Adjust the filters or add dates to Codex entries. Undated lore can still be found in the Event index.</p><button className={styles.secondary} onClick={()=>setMode('index')}>Open event index</button></div> : <>
        <p className={styles.hint}>Horizontally scroll to explore history. Select any event for details. Sorting applies to Event index; visual lanes remain chronological.</p>
        <div className={styles.horizontal} ref={scrollRef} tabIndex={0} role="region" aria-label="Scrollable world history timeline">
          <div className={styles.stage} style={{width:stageWidth+160}}>
            <div className={styles.axis}>
              {activeEras.map((era, index) => {
                const left = Math.max(range.min, era.start), right = Math.min(range.max, era.end);
                if (right <= left) return null;
                const color = ensureContrast(era.color || theme.accent, [theme.inputBg], 4.5);
                return <div key={era.id||index} className={styles.eraBand} style={{left:yearToX(left),width:yearToX(right)-yearToX(left),"--era-color":color}}><span>{era.label || era.name}</span></div>;
              })}
              {ticks.map(y => <div className={styles.tick} key={y} style={{left:yearToX(y)}}><span>{formatYear(y)}</span></div>)}
            </div>
            {lanes.map(lane => <div key={lane.category} className={styles.lane} style={{height:lane.height}}>
              <div className={styles.laneLabel}><span style={{color:colorFor(lane.category)}}>{CATEGORIES[lane.category]?.label || lane.category}</span><small>{lane.entries.length}</small></div>
              {lane.entries.map(e => <button type="button" key={e.id} className={styles.eventPill} style={{left:e.x,top:lane.rows>1 ? 7+e.row*45 : 13,width:e.width,"--event-color":colorFor(e.category)}}
                title={`${e.title} · ${rangeLabel(e, displayYear)}`} onClick={()=>openId(e.id)} aria-label={`Inspect ${e.title}, ${rangeLabel(e, displayYear)}`}>
                <strong>{e.title}</strong><small>{rangeLabel(e, displayYear)}</small>
              </button>)}
            </div>)}
          </div>
        </div>
        <p className={styles.hint}>Showing all {dated.length} dated entries across {lanes.length} categories. Scroll horizontally inside the timeline; vertical scrolling stays in the workspace.</p>
      </>}
    </div> : <div className={styles.indexWrapper}>
      <div className={styles.indexHeader}><h2><Rows3 size={17}/> Event index</h2><span>{filtered.length} results · {Math.min(indexLimit, filtered.length)} visible</span></div>
      {!filtered.length ? <div className={styles.empty}><Search size={24}/><p>No matching lore entries.</p><button className={styles.secondary} onClick={()=>setFilters(EMPTY_FILTERS)}>Clear filters</button></div> : <div className={styles.indexRows}>
        {filtered.slice(0,indexLimit).map(e => <button type="button" className={styles.indexRow} key={e.id} onClick={()=>openId(e.id)}>
          <span className={styles.indexYear}>{rangeLabel(e, displayYear)}</span>
          <span className={styles.indexBody}><strong>{e.title}</strong><small>{e.summary || 'No summary supplied'}</small></span>
          <span className={styles.indexCategory} style={{"--event-color":colorFor(e.category)}}>{CATEGORIES[e.category]?.label || e.category}</span>
          <ChevronRight size={17}/>
        </button>)}
      </div>}
      {indexLimit<filtered.length && <button className={styles.secondary} onClick={()=>setIndexLimit(v=>v+50)}>Show 50 more ({filtered.length-indexLimit} remaining)</button>}
    </div>}
    <p className={styles.footerNote}>Chronicles displays recorded dates and explicit references only. It does not infer a person's attendance from a textual mention, and it does not change canon.</p>
    {selected && <EventInspector event={selected} allArticles={articles} conflictsFor={conflictsFor} eras={activeEras}
      theme={theme} yearFormatter={displayYear} navigate={navigate} goEdit={goEdit} onClose={closeDetail} onPick={pickRelated}/>}
  </section>;
}
