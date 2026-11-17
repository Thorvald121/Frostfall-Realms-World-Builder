/** Safe author-controlled canon workflow. A warning disposition is NOT a truth edit. */
export const PREDICATES = Object.freeze([
  { value: 'born', label: 'Born', temporal: true, description: 'Recorded birth year' },
  { value: 'died', label: 'Died', temporal: true, description: 'Recorded death year' },
  { value: 'participated_in', label: 'Participated in', temporal: true, object: true, description: 'Physical presence in an event' },
  { value: 'remembered', label: 'Remembered', object: true, description: 'Mentions or honors another entity, not physical participation' },
  { value: 'rules', label: 'Rules', object: true, temporal: true, description: 'Governs a place or domain in a defined interval' },
  { value: 'member_of', label: 'Member of', object: true, temporal: true, description: 'Belongs to an organization or group' },
  { value: 'located_in', label: 'Located in', object: true, temporal: true, description: 'Located within another region' },
  { value: 'created', label: 'Created', object: true, temporal: true, description: 'Created another entity or artifact' },
  { value: 'related_to', label: 'Related to', object: true, description: 'Non-exclusive relationship' },
]);
export const DISPOSITIONS = Object.freeze(['acknowledged','intentional','dismissed']);
const MAX_ID = 200;
const validId = (str) => typeof str === 'string' && str.trim().length > 0 && str.length <= MAX_ID;
const permittedStatuses = new Set(['canon','draft','disputed','superseded','alternate']);
const predicateNames = new Set(PREDICATES.map((p) => p.value));
const numericYear = (value) => {
  if (value == null || value === '') return null;
  const year = Number(value);
  if (!Number.isFinite(year) || Math.abs(year) > 99999999999.999) throw new Error('Years must be finite numbers within the supported chronology range.');
  return year;
};
export function buildClaim(input, { worldId, branchId, articles = [], sources = [] }) {
  if (!worldId || !branchId) throw new Error('Select a world and canon branch.');
  if (!validId(input.subjectId) || !articles.some((a) => a.id === input.subjectId)) throw new Error('Choose a codex subject belonging to this world.');
  if (!predicateNames.has(input.predicate)) throw new Error('Choose a supported relationship type.');
  const predicate = PREDICATES.find((p) => p.value === input.predicate);
  const objectId = input.objectId || null;
  if (predicate.object && (!validId(objectId) || !articles.some((a) => a.id === objectId))) throw new Error('Choose a related codex entry from this world.');
  if (!predicate.object && objectId) throw new Error('This predicate does not accept a related entry.');
  const from = numericYear(input.from);
  const until = numericYear(input.until);
  if (predicate.temporal && from === null) throw new Error('Specify an event year or the start of the interval.');
  if (until !== null && from === null) throw new Error('An end year requires a start year.');
  if (from !== null && until !== null && until < from) throw new Error('The end year cannot precede the start year.');
  const subjectUuid = articles.find((a) => a.id === input.subjectId)?._uuid || null;
  const objectUuid = objectId ? (articles.find((a) => a.id === objectId)?._uuid || null) : null;
  const sourceIds = Array.isArray(input.sourceIds) ? [...new Set(input.sourceIds)] : [];
  if (!sourceIds.every((id) => sources.some((s) => s.id === id))) throw new Error('The selected evidence must belong to this world.');
  const notes = String(input.notes || '').trim();
  if (notes.length > 12000) throw new Error('Notes exceed the 12,000 character limit.');
  const status = permittedStatuses.has(input.status) ? input.status : 'draft';
  return {
    id: input.id || globalThis.crypto?.randomUUID?.() || `local-${Date.now()}`,
    worldId, branchId, subjectId: input.subjectId, subjectUuid, predicate: input.predicate,
    objectId, objectUuid, value: null, from, until: until ?? from,
    status, exclusive: Boolean(input.exclusive && predicate.object && ['rules','member_of','located_in'].includes(input.predicate)),
    sourceIds, notes,
  };
}

export function validateSource(input, articles, { requireSavedArticle = true } = {}) {
  const title = String(input.title || '').trim();
  if (!title || title.length > 200) throw new Error('Source title must be 1–200 characters.');
  const articleId = input.articleId || null;
  const article = articleId && articles.find((a) => a.id === articleId);
  if (articleId && (!article || (requireSavedArticle && !article._uuid))) throw new Error('The codex source has no matching saved article in this world.');
  const kind = ['author_note','codex','document','import'].includes(input.kind) ? input.kind : 'author_note';
  const excerpt = String(input.excerpt || '');
  const citation = String(input.citation || '');
  if (excerpt.length > 12000 || citation.length > 2000) throw new Error('Source excerpt or citation is too long.');
  return { id: input.id || globalThis.crypto?.randomUUID?.() || `local-${Date.now()}`, kind, title, excerpt, citation,
    articleId, articleUuid: article?._uuid || null };
}

/** A disposition only applies to the exact source-claim snapshot that was reviewed. */
export function findingSignature(finding, assertions) {
  const byId = new Map(assertions.map((a) => [a.id,a]));
  const serialized = JSON.stringify({ code: finding.code,
    claims: [...finding.assertionIds].sort().map((id) => {
      const a = byId.get(id);
      if (!a) return ['missing',id];
      return [a.id,a.worldId,a.branchId,a.subjectUuid || a.subjectId,a.predicate,a.objectUuid || a.objectId,a.value,a.from,a.until,a.status,a.exclusive,[...(a.sourceIds || [])].sort(),a.notes];
    })
  });
  // FNV-1a 64-bit is a deterministic revision fingerprint, not a security hash.
  let hash = 14695981039346656037n;
  for (let i=0;i<serialized.length;i++) {
    hash ^= BigInt(serialized.charCodeAt(i));
    hash = (hash * 1099511628211n) & 0xffffffffffffffffn;
  }
  return `v1-${serialized.length}-${hash.toString(16).padStart(16,'0')}`;
}

export function decisionForFinding(finding, decisions, assertions, branchId) {
  const signature = findingSignature(finding, assertions);
  const decision = decisions.find((d) => d.findingKey === finding.id && d.branchId === branchId);
  return { signature, disposition: decision?.signature === signature ? decision.disposition : 'open', rationale: decision?.signature === signature ? decision.rationale : '', stale: !!decision && decision.signature !== signature };
}

/** Typed dates are suggestions only; never silently add them to published canon. */
export function previewTypedDateCandidates(articles, savedClaims = []) {
  const recorded = new Set(savedClaims.map((a) => [a.subjectId,a.predicate,a.from].join('|')));
  return articles.flatMap((article) => {
    if (article.category !== 'character') return [];
    return [['birth_year','born'],['death_year','died']].flatMap(([field,predicate]) => {
      const raw = article.temporal?.[field] ?? article.fields?.[field];
      if (raw == null || raw === '') return [];
      const from = Number(raw);
      if (!Number.isFinite(from) || recorded.has([article.id,predicate,from].join('|'))) return [];
      return [{ subjectId: article.id, predicate, from, until: from, title: article.title, field }];
    });
  });
}
