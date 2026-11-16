import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClaim, validateSource, previewTypedDateCandidates, findingSignature, decisionForFinding } from '../../lib/domain/truth/v2/canonWorkflow.js';
import { evaluateCanonAssertions } from '../../lib/domain/truth/v2/canonEngine.js';
const world='w-1',branch='b-1';
const articles=[{id:'vaerith',_uuid:'saved-vaerith',title:'Vaerith',category:'character',temporal:{birth_year:10,death_year:110}},
  {id:'frost_battle',_uuid:'saved-battle',title:'Battle of Frost',category:'event'},
  {id:'ironhold',_uuid:'saved-hold',title:'Ironhold',category:'location'}];
const sources=[{id:'s1',title:'Chronicles'}];
const opts={worldId:world,branchId:branch,articles,sources};
const claim=(input)=>buildClaim(input,opts);

test('author claims validate actual world articles and provenance before persistence',()=>{
 const data=claim({subjectId:'vaerith',predicate:'participated_in',objectId:'frost_battle',from:'95',status:'canon',sourceIds:['s1']});
 assert.equal(data.subjectId,'vaerith');assert.equal(data.objectId,'frost_battle');assert.deepEqual(data.sourceIds,['s1']);
 assert.equal(data.from,95);assert.equal(data.until,95);assert.equal(data.status,'canon');
 assert.throws(()=>claim({...data,subjectId:'foreign'}),/belonging to this world/);
 assert.throws(()=>claim({...data,objectId:'foreign'}),/related codex entry/);
 assert.throws(()=>claim({...data,sourceIds:['another-world-source']}),/belong to this world/);
});
test('dates and relation semantics are validated without invented participation',()=>{
 assert.throws(()=>claim({subjectId:'vaerith',predicate:'participated_in',objectId:'frost_battle'}),/Specify an event year/);
 assert.throws(()=>claim({subjectId:'vaerith',predicate:'born',from:'999999999999'}),/chronology range/);
 assert.throws(()=>claim({subjectId:'vaerith',predicate:'rules',objectId:'ironhold',from:50,until:40}),/end year/);
 const remembered=claim({subjectId:'frost_battle',predicate:'remembered',objectId:'vaerith',from:130,status:'canon',sourceIds:['s1']});
 const death=claim({subjectId:'vaerith',predicate:'died',from:110,status:'canon',sourceIds:['s1']});
 assert.ok(!evaluateCanonAssertions([remembered,death]).findings.some(f=>/after_death/.test(f.code)));
 assert.equal(claim({subjectId:'vaerith',predicate:'born',from:0}).from,0);
});
test('exclusive flag limited to meaningful relation predicates and draft status default',()=>{
 const a=claim({subjectId:'vaerith',predicate:'remembered',objectId:'frost_battle',exclusive:true});
 assert.equal(a.exclusive,false);assert.equal(a.status,'draft');
 const b=claim({subjectId:'vaerith',predicate:'rules',objectId:'ironhold',from:20,exclusive:true});assert.equal(b.exclusive,true);
});
test('linked source validation disallows unsaved or unrelated articles in cloud mode',()=>{
 const source=validateSource({title:'  Chronicle  ',kind:'codex',articleId:'vaerith'},articles);
 assert.equal(source.title,'Chronicle');assert.equal(source.articleUuid,'saved-vaerith');
 assert.throws(()=>validateSource({title:'',kind:'codex'},articles),/Source title/);
 assert.throws(()=>validateSource({title:'X',articleId:'alien'},articles),/matching saved article/);
 assert.equal(validateSource({title:'X',articleId:'local' },[{id:'local'}],{requireSavedArticle:false}).articleId,'local');
});
test('typed date suggestions never automatically become canon and avoid repeated candidates',()=>{
 const candidates=previewTypedDateCandidates(articles);
 assert.equal(candidates.length,2);
 assert.ok(candidates.every(c=>!('status' in c)));
 const after=previewTypedDateCandidates(articles,[{subjectId:'vaerith',predicate:'born',from:10}]);
 assert.equal(after.length,1);assert.equal(after[0].predicate,'died');
});
test('review decisions expire when the actual claim evidence or chronology changes',()=>{
 const a={id:'a',worldId:world,branchId:branch,subjectId:'vaerith',predicate:'died',from:110,until:110,status:'canon',exclusive:false,sourceIds:['s1'],notes:''};
 const f={id:'death:a:b',code:'death_before_birth',assertionIds:['a']};
 const old=findingSignature(f,[a]);
 assert.equal(decisionForFinding(f,[{findingKey:f.id,branchId:branch,signature:old,disposition:'intentional',rationale:'Prophecy'}],[a],branch).disposition,'intentional');
 assert.equal(decisionForFinding(f,[{findingKey:f.id,branchId:branch,signature:old,disposition:'intentional'}],[{...a,from:120}],branch).disposition,'open');
 assert.equal(decisionForFinding(f,[{findingKey:f.id,branchId:'other',signature:old,disposition:'intentional'}],[a],branch).disposition,'open');
 assert.notEqual(old,findingSignature(f,[{...a,sourceIds:[]}]))
});

test('canonical identity remains stable when author renames a codex slug',()=>{
  const original=buildClaim({subjectId:'vaerith',predicate:'born',from:10},opts);
  const renamed=[{...articles[0],id:'vaerith-the-eternal'},...articles.slice(1)];
  const after=buildClaim({subjectId:'vaerith-the-eternal',predicate:'born',from:10},{...opts,articles:renamed});
  assert.equal(original.subjectUuid,after.subjectUuid);
  assert.equal(original.subjectUuid,'saved-vaerith');
  assert.notEqual(original.subjectId,after.subjectId);
});
