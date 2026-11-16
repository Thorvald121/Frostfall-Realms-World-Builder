import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql=readFileSync(new URL('../../supabase/migrations/202611160001_canon_studio.sql',import.meta.url),'utf8');
test('P2 migration is additive, transactional and never rewrites existing articles',()=>{
 assert.match(sql,/BEGIN;/);assert.match(sql,/COMMIT;/);
 assert.doesNotMatch(sql,/\b(?:DROP|TRUNCATE|DELETE\s+FROM|UPDATE)\s+(?:TABLE\s+)?public\.(?:worlds|articles|manuscripts)\b/i);
 for(const name of ['ff_canon_branches','ff_canon_sources','ff_canon_assertions','ff_canon_findings']) {
  assert.match(sql,new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${name}`));
  assert.match(sql,new RegExp(`ALTER TABLE public\\.${name} ENABLE ROW LEVEL SECURITY`));
 }
});
test('canon permissions check actual authenticated owners/members and keep viewer read only',()=>{
 assert.match(sql,/auth\.uid\(\)/);
 assert.match(sql,/role IN \(''owner'', ''editor'', ''viewer''\)/);
 assert.match(sql,/role IN \(''owner'', ''editor''\)/);
 assert.match(sql,/WITH CHECK \(public\.ff_canon_can_write\(world_id\)\)/);
 assert.match(sql,/FROM anon;/);
});
test('claims must use same-world subject, object, evidence source and branch',()=>{
 for(const phrase of ['a.id = NEW.subject_article_id','a.id = NEW.object_article_id','s.world_id = NEW.world_id','FOREIGN KEY (world_id,branch_id)'])assert.ok(sql.includes(phrase),phrase);
});
