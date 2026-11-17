import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../../supabase/migrations/202611160002_manuscript_versioned_sync.sql',import.meta.url),'utf8');
const repo=readFileSync(new URL('../../lib/domain/manuscripts/manuscriptRepository.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../../components/FrostfallRealms.jsx',import.meta.url),'utf8');
test('P3 migration is additive, versioned, RLS-controlled and transactionally audited',()=>{
 for(const table of ['ff_manuscript_worlds','ff_manuscript_revisions']){
  assert.match(sql,new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
  assert.match(sql,new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
 }
 assert.match(sql,/BEGIN;/);assert.match(sql,/COMMIT;/);
 assert.match(sql,/SECURITY DEFINER SET search_path = ''/);
 assert.match(sql,/public\.ff_canon_can_write\(p_world_id\)/);
 assert.match(sql,/ms\.revision=p_expected_revision/);
 assert.match(sql,/FF_MANUSCRIPT_REVISION_CONFLICT/);
 assert.match(sql,/INSERT INTO public\.ff_manuscript_revisions/);
 assert.doesNotMatch(sql,/(?:DROP TABLE|TRUNCATE|DELETE FROM) public\.(?:articles|worlds|manuscripts)/i);
});
test('RPC is the only exposed mutation path and requires authenticated role',()=>{
 assert.match(sql,/REVOKE ALL ON TABLE public\.ff_manuscript_worlds, public\.ff_manuscript_revisions FROM anon, authenticated;/);
 assert.match(sql,/GRANT SELECT ON public\.ff_manuscript_worlds, public\.ff_manuscript_revisions TO authenticated;/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.ff_save_manuscript_world\(uuid,bigint,jsonb\) TO authenticated;/);
 assert.match(sql,/auth\.uid\(\) IS NULL/);
 assert.match(repo,/client\.rpc\('ff_save_manuscript_world'/);
 assert.match(repo,/expectedRevision\+1/);
});
test('app pauses editing for recovery and never silently saves conflicting drafts',()=>{
 for(const phrase of ['novelRecoveryRef.current','Restore browser draft','Keep cloud version','writeBrowserDraft(localStorage','novelSaveChainRef'])assert.ok(app.includes(phrase));
 assert.match(app,/if \(novelRecoveryRef\.current\?\.worldId === worldId\)/);
});
test('codex evidence panel and Canon Studio share an explicit article filter',()=>{
 assert.match(app,/<CodexCanonPanel/);
 assert.match(app,/entryFocus=\{canonArticleIntent\}/);
 const canon=readFileSync(new URL('../../features/canon/CanonStudio.jsx',import.meta.url),'utf8');
 assert.match(canon,/focusedSubjectId/);
 assert.match(canon,/setClaimForm\(\{\.\.\.initialClaim\(\),subjectId:entryFocus\.id\}\)/);
});
test('version-history toolbar is inside the existing bounded NovelWorkspace, not outside it',()=>{
 const novel=readFileSync(new URL('../../features/novel/NovelWorkspace.jsx',import.meta.url),'utf8');
 assert.match(novel,/<ManuscriptHistoryBar/);
 assert.match(novel,/height: "calc\(100vh - 56px\)"/);
 assert.match(novel,/manuscriptSync\?\.worldId/);
});
test('restore clears prior contentEditable scene before replacing a snapshot',()=>{
 assert.match(app,/setNovelView\('select'\);setActiveMs\(null\);setNovelActiveScene\(null\);/);
});
