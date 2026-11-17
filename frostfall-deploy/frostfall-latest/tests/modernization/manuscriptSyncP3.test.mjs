import test from 'node:test';
import assert from 'node:assert/strict';
import { readBrowserDraft, writeBrowserDraft, chooseManuscriptHydration, sameSnapshot,
  stableSerialize, journalKey, legacyKey } from '../../lib/domain/manuscripts/manuscriptSync.js';

function storage(){const map=new Map();return {map,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}
const sample=[{id:'ms-1',title:'The North',acts:[{id:'act-1',chapters:[{id:'chapter-1',scenes:[{id:'scene-1',body:'The ice was silent.'}]}]}]}];
test('object-property order does not trigger spurious conflicts after jsonb normalization',()=>{
 assert.equal(sameSnapshot([{a:1,z:{q:2,b:3}}],[{z:{b:3,q:2},a:1}]),true);
 assert.equal(sameSnapshot(sample,[{...sample[0],title:'Changed'}]),false);
 assert.ok(stableSerialize(sample).includes('The North'));
});
test('P3 journal and legacy copy are world-scoped; neither erases another world',()=>{
 const s=storage();writeBrowserDraft(s,'worldA',sample,{syncedRevision:2,dirty:true});
 writeBrowserDraft(s,'worldB',[],{syncedRevision:3,dirty:false});
 assert.deepEqual(readBrowserDraft(s,'worldA').manuscripts,sample);
 assert.deepEqual(readBrowserDraft(s,'worldB').manuscripts,[]);
 assert.equal(readBrowserDraft(s,'worldA').syncedRevision,2);
 assert.equal(readBrowserDraft(s,'worldA').dirty,true);
 assert.ok(s.getItem(legacyKey('worldA')));assert.ok(s.getItem(journalKey('worldB')));
});
test('legacy manuscript arrays become recoverable drafts rather than being discarded',()=>{
 const s=storage();s.setItem(legacyKey('old'),JSON.stringify(sample));
 const draft=readBrowserDraft(s,'old');assert.equal(draft.legacy,true);assert.deepEqual(draft.manuscripts,sample);
});
test('corrupted or cross-world recovery never silently loads',()=>{
 const s=storage();s.setItem(journalKey('A'),JSON.stringify({format:'frostfall-manuscript-draft-v3',worldId:'B',manuscripts:[]}));
 assert.throws(()=>readBrowserDraft(s,'A'),/another world/);
 s.setItem(journalKey('A'),'{bad json');assert.throws(()=>readBrowserDraft(s,'A'));
});
test('cloud and local mismatch is a blocked, explicit author recovery choice',()=>{
 const s=storage();const draft=writeBrowserDraft(s,'W',sample,{syncedRevision:0,dirty:true});
 const resolved=chooseManuscriptHydration({cloud:{manuscripts:[],revision:5},browser:draft,hosted:true});
 assert.deepEqual(resolved.manuscripts,[]);assert.equal(resolved.revision,5);
 assert.deepEqual(resolved.recovery.manuscripts,sample);
});
test('even missing cloud records do not auto-overwrite legacy browser manuscripts',()=>{
 const s=storage();s.setItem(legacyKey('W'),JSON.stringify(sample));
 const resolved=chooseManuscriptHydration({cloud:null,browser:readBrowserDraft(s,'W'),hosted:true});
 assert.deepEqual(resolved.manuscripts,[]);assert.ok(resolved.recovery);
});
test('matching cloud and browser content produces no recovery blocker',()=>{
 const s=storage();const draft=writeBrowserDraft(s,'W',sample,{syncedRevision:3,dirty:false});
 const cloud=JSON.parse(JSON.stringify(sample));
 const result=chooseManuscriptHydration({cloud:{revision:3,manuscripts:cloud},browser:draft,hosted:true});
 assert.equal(result.recovery,null);assert.deepEqual(result.manuscripts,sample);
});
test('offline local-only mode loads browser manuscript directly',()=>{
 const draft={manuscripts:sample};
 const result=chooseManuscriptHydration({cloud:null,browser:draft,hosted:false});
 assert.deepEqual(result.manuscripts,sample);assert.equal(result.recovery,null);
});
test('intentionally deleted manuscripts persist as a valid empty snapshot',()=>{
 const s=storage();writeBrowserDraft(s,'W',[],{dirty:true});
 assert.deepEqual(readBrowserDraft(s,'W').manuscripts,[]);
});
test('failed browser quota write cannot claim recovery succeeded',()=>{
 const s=storage();s.setItem=()=>{throw new Error('QuotaExceededError');};
 assert.throws(()=>writeBrowserDraft(s,'W',sample),/QuotaExceededError/);
});
