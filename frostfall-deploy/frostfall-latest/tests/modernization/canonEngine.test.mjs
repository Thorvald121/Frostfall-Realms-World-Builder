import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCanonAssertions, explicitClaimsFromArticles } from '../../lib/domain/truth/v2/canonEngine.js';
const fact=(id,subjectId,predicate,from,extras={})=>({id,subjectId,predicate,from,until:from,status:'canon',sourceIds:['lore-1'],...extras});
const codes=(facts)=>evaluateCanonAssertions(facts).findings.map(f=>f.code);

test('historical remembrance is not participation and cannot trigger a death anomaly',()=>{
  const facts=[fact('birth','vaerith','born',10),fact('death','vaerith','died',110),
    fact('remembered','scribe','remembered',130,{objectId:'vaerith'})];
  assert.deepEqual(codes(facts),[]);
});

test('explicit death/birth and event participation contradictions are detected',()=>{
  assert.ok(codes([fact('birth','a','born',50),fact('death','a','died',30)]).includes('death_before_birth'));
  assert.ok(codes([fact('death','a','died',110),fact('battle','a','participated_in',130,{objectId:'event-130'})]).includes('participation_after_death'));
  assert.ok(codes([fact('birth','a','born',110),fact('battle','a','participated_in',90,{objectId:'event-90'})]).includes('participation_before_birth'));
});

test('overlapping mutually exclusive reigns flag only if explicitly declared exclusive',()=>{
  const a=fact('a','king-a','rules',20,{until:60,objectId:'ironhold',exclusive:true});
  const b=fact('b','king-b','rules',40,{until:80,objectId:'ironhold',exclusive:true});
  assert.ok(codes([a,b]).includes('exclusive_claim_overlap'));
  assert.ok(!codes([a,{...b,exclusive:false}]).includes('exclusive_claim_overlap'));
  assert.ok(!codes([a,{...b,branchId:'alternate'}]).includes('exclusive_claim_overlap'));
});

test('draft, disputed, alternate-world claims are not incorrectly treated as canon conflicts',()=>{
  const death=fact('death','x','died',20);
  for (const variant of [{status:'draft'},{status:'disputed'},{status:'superseded'},{worldId:'world-2'}]) {
    const participation=fact('a','x','participated_in',50,{objectId:'e',...variant});
    assert.ok(!codes([death, participation]).includes('participation_after_death'));
  }
});

test('provenance is visible and explicit article dates bridge without invented relationships',()=>{
  assert.ok(codes([fact('a','x','born',20,{sourceIds:[]})]).includes('missing_provenance'));
  const claims=explicitClaimsFromArticles([{id:'v',category:'character', temporal:{birth_year:10,death_year:100},body:'@battle_250'},
    {id:'b',category:'event',body:'@v',temporal:{active_start:250}}], 'fantasy-world');
  assert.equal(claims.length,2);
  assert.ok(!codes(claims).includes('participation_after_death'));
});

test('physical participation spanning beyond death is explicitly contradictory',()=>{
  const death=fact('death','th','died',110);
  const attendance=fact('attendance','th','participated_in',99,{until:130,objectId:'battle'});
  assert.ok(codes([death,attendance]).includes('participation_spans_death'));
});

test('exclusivity on one entity flags incompatible simultaneous locations only when authored',()=>{
  const a=fact('a','hero','located_in',100,{until:120,objectId:'north',exclusive:true});
  const b=fact('b','hero','located_in',110,{until:130,objectId:'south',exclusive:true});
  assert.ok(codes([a,b]).includes('exclusive_subject_overlap'));
  assert.ok(!codes([a,{...b,exclusive:false}]).includes('exclusive_subject_overlap'));
});
