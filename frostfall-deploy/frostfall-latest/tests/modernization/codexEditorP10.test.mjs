import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { draftOverview } from '../../lib/domain/editorDraft.js';

const root = process.cwd();
const component = readFileSync(join(root,'features/codex/CodexEditorWorkspace.jsx'),'utf8');
const app = readFileSync(join(root,'components/FrostfallRealms.jsx'),'utf8');
const css = readFileSync(join(root,'features/codex/CodexEditorWorkspace.module.css'),'utf8');

test('draft overview handles empty and malformed inputs', () => {
  assert.deepEqual(draftOverview(), {titleReady:false, summaryReady:false, wordCount:0, filledFields:0, tagCount:0});
  assert.equal(draftOverview({body:null,fields:null,tags:null}).wordCount,0);
});
test('draft overview strips HTML and counts structured fields and distinct tags', () => {
  const m=draftOverview({title:' Aelvarin ',summary:'Summary',body:'<p>The <b>golden</b> age</p><p>began &amp; ended</p>',fields:{year:0,home:'North',unused:' '},tags:'Empire, empire, history'});
  assert.deepEqual(m,{titleReady:true,summaryReady:true,wordCount:5,filledFields:2,tagCount:2});
});
test('editor component parses as JSX without syntax diagnostics', () => {
  const ast=ts.createSourceFile('CodexEditorWorkspace.jsx',component,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  assert.equal(ast.parseDiagnostics.length,0,ast.parseDiagnostics.map(x=>x.messageText).join('; '));
});
test('editor component preserves existing persistence authority', () => {
  assert.match(component,/onSave/);assert.doesNotMatch(component,/supabase|updateArticle|insert\(/i);
  assert.match(component,/Manual save/);assert.doesNotMatch(component,/automatically saved|autosaved/i);
});
test('section anchors and IDs remain aligned', () => {
  for(const id of ['fr-editor-identity','fr-editor-details','fr-editor-story','fr-editor-index'])assert.match(component,new RegExp(id));
  assert.match(component,/href=\{`#\$\{id\}`\}/);
});
test('layout stays tokenized and responsive', () => {
  assert.match(css,/var\(--accent\)/);assert.match(css,/var\(--text\)/);assert.match(css,/@media\(max-width:720px\)/);assert.doesNotMatch(css,/overflow-x:\s*hidden/);
});
test('legacy create/edit route renders new workspace but retains create data and gates', () => {
  assert.match(app,/CodexEditorWorkspace/);assert.match(app,/view === "create" && createCat/);
  assert.match(app,/onSave=\{attemptSave\}/);assert.match(app,/editingId/);
  assert.match(app,/liveDupes/);assert.match(app,/liveIntegrity/);
});
test('editor fields organize into four sections', () => {
  for(const id of ['fr-editor-identity','fr-editor-details','fr-editor-story','fr-editor-index'])assert.match(app,new RegExp(`CodexEditorSection id="${id}"`));
});
test('legacy entry save path is not duplicated', () => {
  assert.match(app,/const attemptSave/);
  assert.doesNotMatch(component,/fetch\(|\.rpc\(/);
});