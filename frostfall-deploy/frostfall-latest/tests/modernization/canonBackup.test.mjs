import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCanonBackup } from '../../lib/domain/truth/v2/canonBackup.js';

test('canon export is portable, world-scoped and avoids auth/provider secrets',()=>{
 const snapshot={branches:[{id:'main',name:'Main Canon'}],sources:[],assertions:[{id:'x',notes:'Approved lore'}],decisions:[],
  apiKeys:{openai:'SECRET'},accessToken:'TOKEN',provider:'openai'};
 const json=makeCanonBackup('world-3',snapshot,new Date('2026-11-16T12:00:00Z'));
 const parsed=JSON.parse(json);
 assert.equal(parsed.format,'frostfall.canon.v2');assert.equal(parsed.worldId,'world-3');
 assert.equal(parsed.exportedAt,'2026-11-16T12:00:00.000Z');assert.equal(parsed.assertions.length,1);
 assert.equal(json.includes('SECRET'),false);assert.equal(json.includes('TOKEN'),false);
 assert.deepEqual(Object.keys(parsed),['format','version','worldId','exportedAt','branches','sources','assertions','decisions']);
});
