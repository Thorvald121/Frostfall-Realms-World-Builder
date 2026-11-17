/**
 * Chronicles v2 — deterministic world-local chronology model.
 * No inference from prose mentions: a mention is a reference, NOT participation.
 * All years are numerical world years. Year zero and negative years are valid.
 */

const validYear = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && /^[+-]?\d+(?:\.\d+)?$/.test(value.trim())) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
};
const asText = (v) => v == null ? '' : String(v);
const cmpString = (a, b) => asText(a).localeCompare(asText(b), undefined, { sensitivity: 'base', numeric: true });

export function buildChronicleEvents(articles = []) {
  if (!Array.isArray(articles)) return [];
  return articles.filter(a => a && a.id != null).map(a => {
    const t = a.temporal || {};
    const start = validYear(t.active_start) ?? validYear(t.birth_year) ??
      (a.category === 'character' ? validYear(a.fields?.birth_year) : null);
    const rawEnd = validYear(t.active_end) ?? validYear(t.death_year) ??
      (a.category === 'character' ? validYear(a.fields?.death_year) : null);
    const end = rawEnd == null ? start : rawEnd;
    const invalidRange = start != null && end != null && end < start;
    const point = start != null && (end == null || end === start);
    return {
      id: asText(a.id), article: a, title: asText(a.title || 'Untitled'),
      category: asText(a.category || 'other'), summary: asText(a.summary),
      start, end, valid: !invalidRange, dated: start != null,
      kind: !start && start !== 0 ? 'undated' : point ? 'point' : 'span',
      tags: Array.isArray(a.tags) ? a.tags.map(asText) : [],
      updated: Number.isFinite(Date.parse(a.updatedAt || '')) ? Date.parse(a.updatedAt) : 0,
    };
  });
}

export function eraForEvent(event, eras = []) {
  if (!event?.dated) return [];
  const lo = Math.min(event.start, event.end ?? event.start);
  const hi = Math.max(event.start, event.end ?? event.start);
  return (eras || []).filter(era => {
    const start = validYear(era.start), end = validYear(era.end);
    return start != null && end != null && lo < end && hi >= start;
  });
}

export function filterChronicleEvents(events = [], filters = {}, eras = []) {
  const search = asText(filters.search).trim().toLocaleLowerCase();
  const category = filters.category || 'all';
  const era = filters.era || 'all';
  const kind = filters.kind || 'all';
  const includeUndated = Boolean(filters.includeUndated);
  const from = validYear(filters.from), to = validYear(filters.to);
  const results = events.filter(e => {
    if (!includeUndated && kind !== 'undated' && !e.dated) return false;
    if (category !== 'all' && e.category !== category) return false;
    if (kind !== 'all' && e.kind !== kind) return false;
    if (era !== 'all' && !eraForEvent(e, eras).some(x => String(x.id ?? (eras || []).indexOf(x)) === era)) return false;
    // An undated entry cannot honestly pass a bounded-year query.
    if (!e.dated && (from != null || to != null || era !== 'all')) return false;
    if (e.dated) {
      const low = Math.min(e.start, e.end ?? e.start);
      const high = Math.max(e.start, e.end ?? e.start);
      if (from != null && high < from) return false;
      if (to != null && low > to) return false;
    }
    if (search) {
      const hay = [e.title, e.summary, e.category, ...(e.tags || []),
        ...Object.values(e.article?.fields || {}).map(asText), asText(e.article?.body)]
        .join(' ').toLocaleLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
  const sort = filters.sort || 'date_asc';
  const byDate = (a, b) => (a.start == null ? Number.POSITIVE_INFINITY : a.start) - (b.start == null ? Number.POSITIVE_INFINITY : b.start) || 0;
  results.sort((a, b) => {
    let order = 0;
    if (sort === 'date_desc') order = ((b.start ?? Number.NEGATIVE_INFINITY) - (a.start ?? Number.NEGATIVE_INFINITY)) || 0;
    else if (sort === 'duration_desc') order = ((b.end ?? b.start ?? 0) - (b.start ?? 0)) - ((a.end ?? a.start ?? 0) - (a.start ?? 0));
    else if (sort === 'title_asc') order = cmpString(a.title, b.title);
    else if (sort === 'title_desc') order = cmpString(b.title, a.title);
    else if (sort === 'updated_desc') order = b.updated - a.updated;
    else order = byDate(a, b);
    return order || byDate(a, b) || cmpString(a.title, b.title) || cmpString(a.id, b.id);
  });
  return results;
}

export function chronicleRange(events = [], minWidth = 500) {
  const dated = events.filter(e => e.dated);
  if (!dated.length) return { min: -100, max: 100, span: 200 };
  const min = Math.min(...dated.map(e => Math.min(e.start, e.end ?? e.start)));
  const max = Math.max(...dated.map(e => Math.max(e.start, e.end ?? e.start)));
  const padding = Math.max((max - min) * 0.06, 10);
  const lo = min - padding, hi = max + padding;
  return { min: lo, max: hi, span: Math.max(hi - lo, 1), widthHint: minWidth };
}

export function layoutChronicleLanes(events, categories, yearToX, minCardWidth = 138) {
  const lanes = [];
  for (const category of categories) {
    const entries = events.filter(e => e.dated && e.category === category)
      .sort((a, b) => a.start - b.start || cmpString(a.title, b.title));
    if (!entries.length) continue;
    const rows = [];
    const placed = entries.map(e => {
      const x = yearToX(e.start);
      const to = yearToX(Math.max(e.start, e.end ?? e.start));
      const width = Math.max(minCardWidth, to - x);
      let row = rows.findIndex(lastEnd => lastEnd <= x - 10);
      if (row === -1) { row = rows.length; rows.push(x + width); }
      else rows[row] = x + width;
      return { ...e, x, width, row };
    });
    lanes.push({ category, rows: rows.length, height: Math.max(62, rows.length * 45 + 12), entries: placed });
  }
  return lanes;
}

export function chronicleTicks(min, max, pixelsPerYear) {
  const yearsPerTick = 150 / Math.max(pixelsPerYear, .0001);
  const magnitude = Math.pow(10, Math.floor(Math.log10(yearsPerTick)));
  const step = [1,2,5,10].map(n=>n*magnitude).find(n=>n>=yearsPerTick) || 10*magnitude;
  const ticks = [];
  for (let y = Math.ceil(min / step) * step; y <= max && ticks.length < 150; y += step) {
    ticks.push(Math.round(y * 1e8) / 1e8);
  }
  return ticks;
}

export function chronicleConnections(entry, articles = []) {
  if (!entry) return [];
  const text = [entry.body || '', entry.summary || '', ...Object.values(entry.fields || {}).map(asText)].join(' ');
  const refs = new Set();
  const mention = /@\[([^\]]+)\]\(([^)]+)\)|@([a-zA-Z0-9_\-]+)/g;
  let found;
  while ((found = mention.exec(text)) !== null) refs.add(found[2] || found[3]);
  for (const id of entry.links || []) if (typeof id === 'string') refs.add(id);
  return (articles || []).filter(a => a?.id !== entry.id && refs.has(a?.id));
}

function csvCell(value) {
  const raw = asText(value);
  // Spreadsheet applications can execute formulas in imported CSVs.
  const safe = typeof value === 'number' ? raw : (/^[=+\-@\t\r]/.test(raw) ? "'" + raw : raw);
  return '"' + safe.replace(/"/g, '""') + '"';
}

export function exportChroniclesCSV(events = []) {
  const cols = ['Title', 'Category', 'Start year', 'End year', 'Type', 'Summary', 'ID'];
  const rows = events.map(e => [e.title, e.category, e.start ?? '', e.end ?? '', e.kind, e.summary, e.id]);
  return [cols, ...rows].map(row=>row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
