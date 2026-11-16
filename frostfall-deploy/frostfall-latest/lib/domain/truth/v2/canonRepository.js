import { supabase } from '../../../supabase.js';

const keyFor = (worldId) => `frostfall-canon-p2-local:${worldId}`;
const demoBranch = { id: 'main', worldId: '', slug: 'main', name: 'Main Canon', description: 'Local demonstration branch' };
const normalizeBranch = (b) => ({ id:b.id, worldId:b.world_id, slug:b.slug,name:b.name,description:b.description || '' });
const normalizeSource = (s) => ({ id:s.id,worldId:s.world_id,articleId:s.article_id,kind:s.kind,title:s.title,excerpt:s.excerpt || '',citation:s.citation || '' });
const normalizeClaim = (a) => ({ id:a.id, worldId:a.world_id,branchId:a.branch_id,subjectId:a.subject_id,subjectUuid:a.subject_article_id,predicate:a.predicate,
  objectId:a.object_id,objectUuid:a.object_article_id,value:a.value,from:a.from_year == null ? null : Number(a.from_year),until:a.until_year == null ? null : Number(a.until_year),
  status:a.status, exclusive:a.exclusive, sourceIds:a.source_ids || [],notes:a.notes || '' });
const normalizeFinding = (f) => ({worldId:f.world_id,branchId:f.branch_id,findingKey:f.finding_key,signature:f.signature,disposition:f.disposition,rationale:f.rationale || ''});
const requireId = (id) => { if (!id) throw new Error('A world is required for canon operations.'); return id; };
const fail = (name, error) => {if (error) throw new Error(`${name}: ${error.message || error.code || 'unknown database error'}`);};
const emptyLocal = (worldId) => ({ branches:[{...demoBranch, worldId}],sources:[],assertions:[],decisions:[] });
function readLocal(worldId) {
  const raw = localStorage.getItem(keyFor(worldId));
  if (!raw) return emptyLocal(worldId);
  const parsed = JSON.parse(raw);
  return {branches:Array.isArray(parsed.branches) ? parsed.branches : emptyLocal(worldId).branches,
    sources:Array.isArray(parsed.sources) ? parsed.sources : [],
    assertions:Array.isArray(parsed.assertions) ? parsed.assertions : [],
    decisions:Array.isArray(parsed.decisions) ? parsed.decisions : []};
}
function writeLocal(worldId, data) { localStorage.setItem(keyFor(worldId), JSON.stringify(data)); }
const mutateLocal = (worldId, collection, entity, predicate) => {
  const snapshot = readLocal(worldId);
  const index = snapshot[collection].findIndex(predicate);
  if (index >= 0) snapshot[collection][index] = entity;
  else snapshot[collection].push(entity);
  writeLocal(worldId, snapshot);
  return entity;
};

/** Explicitly paginate: PostgREST defaults to a 1,000 row maximum. */
async function fetchAll(table,worldId) {
  const PAGE_SIZE=500;
  const MAX_PAGES=50;
  const rows=[];
  for(let page=0;page<MAX_PAGES;page++) {
    const {data,error}=await supabase.from(table).select('*').eq('world_id',worldId).range(page*PAGE_SIZE,(page+1)*PAGE_SIZE-1);
    fail(`Load ${table}`,error);
    const batch=data || [];
    rows.push(...batch);
    if(batch.length<PAGE_SIZE)return rows;
  }
  throw new Error(`Load ${table}: world exceeds the 25,000-record safety limit; cannot display incomplete canon data.`);
}

/** Hosted mode never silently falls back to browser storage on schema or RLS errors. */
export async function loadCanonWorld(worldId) {
  requireId(worldId);
  if (!supabase) return {...readLocal(worldId),mode:'local'};
  const [branches,sources,assertions,decisions] = await Promise.all([
    fetchAll('ff_canon_branches',worldId),fetchAll('ff_canon_sources',worldId),
    fetchAll('ff_canon_assertions',worldId),fetchAll('ff_canon_findings',worldId),
  ]);
  return {mode:'cloud', branches:branches.map(normalizeBranch),sources:sources.map(normalizeSource),
    assertions:assertions.map(normalizeClaim),decisions:decisions.map(normalizeFinding)};
}

export async function saveCanonSource(worldId, input) {
  requireId(worldId);
  const s = {...input,worldId};
  if (!supabase) return mutateLocal(worldId,'sources',s,(item)=>item.id===s.id);
  const { data,error } = await supabase.from('ff_canon_sources').upsert({id:s.id,world_id:worldId,
    article_id:s.articleUuid || null,kind:s.kind,title:s.title,excerpt:s.excerpt,citation:s.citation}).select().single();
  fail('Save source',error); if (!data) throw new Error('Source save was not acknowledged.');
  return normalizeSource(data);
}
export async function saveCanonAssertion(worldId, input) {
  requireId(worldId);
  const a = {...input,worldId};
  if (!supabase) return mutateLocal(worldId,'assertions',a,(item)=>item.id===a.id);
  if (!a.subjectUuid || (a.objectId && !a.objectUuid)) throw new Error('Save these codex entries to the database before recording hosted canon claims.');
  const {data,error} = await supabase.from('ff_canon_assertions').upsert({id:a.id,world_id:worldId,branch_id:a.branchId,
    subject_id:a.subjectId,subject_article_id:a.subjectUuid,predicate:a.predicate,object_id:a.objectId,object_article_id:a.objectUuid,value:a.value,from_year:a.from,until_year:a.until,
    status:a.status,exclusive:a.exclusive,source_ids:a.sourceIds,notes:a.notes}).select().single();
  fail('Save claim',error); if (!data) throw new Error('Claim save was not acknowledged.');
  return normalizeClaim(data);
}
export async function saveFindingDecision(worldId, input) {
  requireId(worldId);
  const f={...input,worldId};
  if (!supabase) return mutateLocal(worldId,'decisions',f,(d)=>d.findingKey===f.findingKey && d.branchId===f.branchId);
  const {data,error}=await supabase.from('ff_canon_findings').upsert({world_id:worldId,branch_id:f.branchId,
    finding_key:f.findingKey,signature:f.signature,disposition:f.disposition,rationale:f.rationale},
  {onConflict:'world_id,branch_id,finding_key'}).select().single();
  fail('Save finding review',error); if (!data) throw new Error('Finding review was not acknowledged.');
  return normalizeFinding(data);
}
export async function createCanonBranch(worldId, input) {
  requireId(worldId);
  const slug=String(input.name || '').toLowerCase().trim().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60);
  if (!slug) throw new Error('Branch name is required.');
  const name=String(input.name).trim().slice(0,120);
  if (!supabase) {
    const b={id:globalThis.crypto?.randomUUID?.() || `local-${Date.now()}`,worldId,slug,name,description:input.description || ''};
    const snapshot=readLocal(worldId);
    if (snapshot.branches.some((existing)=>existing.slug===slug)) throw new Error('This branch already exists.');
    snapshot.branches.push(b); writeLocal(worldId,snapshot); return b;
  }
  const {data,error}=await supabase.from('ff_canon_branches').insert({world_id:worldId,slug,name,description:input.description||''}).select().single();
  fail('Create branch',error);if(!data) throw new Error('Branch creation was not acknowledged.');return normalizeBranch(data);
}
export async function clearFindingDecision(worldId, branchId, findingKey) {
  requireId(worldId);
  if (!supabase) {
    const snapshot=readLocal(worldId);
    snapshot.decisions=snapshot.decisions.filter((d)=>!(d.branchId===branchId && d.findingKey===findingKey));
    writeLocal(worldId,snapshot);return true;
  }
  const {error}=await supabase.from('ff_canon_findings').delete().eq('world_id',worldId).eq('branch_id',branchId).eq('finding_key',findingKey);
  fail('Reopen finding',error);return true;
}
