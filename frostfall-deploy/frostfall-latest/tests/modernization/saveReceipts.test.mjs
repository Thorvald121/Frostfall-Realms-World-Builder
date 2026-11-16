import test from 'node:test';
import assert from 'node:assert/strict';
import { requireSaveReceipt, codexRecoveryKey, makeCodexRecovery } from '../../lib/domain/saveReceipts.js';
test('a failed or missing DB acknowledgment never counts as Saved', () => {
  for (const receipt of [false,null,undefined,{ok:false},{status:'saved'}]) {
    assert.throws(()=>requireSaveReceipt(receipt),/did not acknowledge/);
  }
  assert.equal(requireSaveReceipt({ok:true,count:7}).count,7);
});
test('recovery backup is per-world, carries manuscripts-free codex content, and contains no provider keys', () => {
  const a = JSON.parse(makeCodexRecovery('world-1',[{id:'a',title:'A'}],[]));
  assert.equal(a.worldId,'world-1');
  assert.equal(a.format,'frostfall-codex-recovery');
  assert.notEqual(codexRecoveryKey('world-1'),codexRecoveryKey('world-2'));
  assert.throws(()=>codexRecoveryKey(''),/Missing world/);
});
