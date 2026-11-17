/** Read-only, active-world metrics. This module never queries or writes another world. */
export function summarizeWorldOverview({ articles = [], manuscripts = [], integrityCount = 0 } = {}) {
  const items = Array.isArray(articles) ? articles : [];
  const books = Array.isArray(manuscripts) ? manuscripts : [];
  const live = items.filter(a => a && !a.isArchived && !a.is_archived);
  const categories = new Set(live.map(a => a.category).filter(Boolean));
  const words = live.reduce((count, article) => {
    const text = [article.title, article.summary, article.body].filter(x => typeof x === 'string').join(' ');
    return count + (text.replace(/<[^>]*>/g, ' ').trim().match(/\S+/g) || []).length;
  }, 0);
  const recent = [...live].sort((a, b) => {
    const first = Date.parse(a?.updatedAt || a?.updated_at || '') || 0;
    const second = Date.parse(b?.updatedAt || b?.updated_at || '') || 0;
    return second - first;
  }).slice(0, 6);
  return { entries: live.length, categories: categories.size, manuscripts: books.length,
    integrityIssues: Number.isFinite(integrityCount) ? Math.max(0, Math.trunc(integrityCount)) : 0,
    words, recent };
}
