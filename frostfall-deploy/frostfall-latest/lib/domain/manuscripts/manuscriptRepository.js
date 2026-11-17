import { supabase } from '../../supabase.js';
import { validateManuscripts } from './manuscriptSync.js';

const dbFailure = (operation,error) => {
  if (!error) return;
  if (String(error.message||'').includes('FF_MANUSCRIPT_REVISION_CONFLICT')) {
    const conflict=new Error('Cloud manuscript changed in another session. Your local draft is preserved; reload and choose the version to restore.');
    conflict.code='REVISION_CONFLICT';throw conflict;
  }
  throw new Error(`${operation}: ${error.message||error.code||'database request failed'}`);
};

export async function loadManuscriptWorld(worldId, client=supabase) {
  if (!client) return {manuscripts:[],revision:0,mode:'local'};
  if (!worldId) throw new Error('Select a world to load your manuscripts.');
  const {data,error} = await client.from('ff_manuscript_worlds')
    .select('revision,manuscripts,updated_at').eq('world_id',worldId).maybeSingle();
  dbFailure('Manuscript load',error);
  return {manuscripts:validateManuscripts(data?.manuscripts??[]),revision:Number(data?.revision??0),
    updatedAt:data?.updated_at??null,mode:'cloud'};
}

/** Transactional optimistic-concurrency save; a stale editor never overwrites another. */
export async function saveManuscriptWorld(worldId, expectedRevision, manuscripts, client=supabase) {
  if (!client) throw new Error('No cloud manuscript connection is configured.');
  validateManuscripts(manuscripts);
  if (!Number.isSafeInteger(expectedRevision)||expectedRevision<0) throw new Error('Invalid manuscript base revision.');
  const {data,error} = await client.rpc('ff_save_manuscript_world',{
    p_world_id:worldId,p_expected_revision:expectedRevision,p_manuscripts:manuscripts,
  });
  dbFailure('Manuscript save',error);
  const receipt = Array.isArray(data)?data[0]:data;
  if (!receipt || !Number.isSafeInteger(Number(receipt.revision)) || Number(receipt.revision)!==expectedRevision+1) {
    throw new Error('Manuscript save did not return a valid revision acknowledgment.');
  }
  return {revision:Number(receipt.revision),updatedAt:receipt.updated_at,mode:'cloud'};
}

export async function listManuscriptRevisions(worldId,client=supabase) {
  if (!client) return [];
  const {data,error}=await client.from('ff_manuscript_revisions')
    .select('revision,saved_at,author_id').eq('world_id',worldId).order('revision',{ascending:false}).limit(30);
  dbFailure('Version history',error);return data||[];
}

/** Read one immutable snapshot before an author-initiated restore. */
export async function fetchManuscriptRevision(worldId,revision,client=supabase) {
  if(!client)throw new Error('Cloud version history is not available offline.');
  if(!Number.isSafeInteger(revision)||revision<1)throw new Error('Invalid manuscript revision.');
  const {data,error}=await client.from('ff_manuscript_revisions').select('revision,manuscripts,saved_at')
    .eq('world_id',worldId).eq('revision',revision).single();
  dbFailure('Open manuscript revision',error);
  if(!data)throw new Error('The selected manuscript revision is unavailable.');
  return {revision:Number(data.revision),savedAt:data.saved_at,manuscripts:validateManuscripts(data.manuscripts)};
}
