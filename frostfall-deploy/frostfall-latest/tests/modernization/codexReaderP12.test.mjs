import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { summarizeCodexReader } from '../../lib/domain/codexReader.js';

const component = readFileSync(new URL('../../features/codex/CodexReaderWorkspace.jsx',import.meta.url),'utf8');
const css = readFileSync(new URL('../../features/codex/CodexReaderWorkspace.module.css',import.meta.url),'utf8');
const app = readFileSync(new URL('../../components/FrostfallRealms.jsx',import.meta.url),'utf8');

test('P12: article statistics are read-only and tolerate malformed data',()=>{
  const source={ body:'<p>One <s>crossed</s> word &amp; another.</p>',fields:{home:'North',age:0,other:' '},tags:['lore','people'],linkedIds:['one','one','two'] };
  const original=JSON.stringify(source);
  assert.deepEqual(summarizeCodexReader(source),{wordCount:4,filledFields:2,tagCount:2,linkedCount:2});
  assert.equal(JSON.stringify(source),original);
  assert.deepEqual(summarizeCodexReader(),{wordCount:0,filledFields:0,tagCount:0,linkedCount:0});
});
test('P12: reader is valid JSX with accessible landmarks',()=>{
  const ast=ts.createSourceFile('CodexReaderWorkspace.jsx',component,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  assert.equal(ast.parseDiagnostics.length,0,ast.parseDiagnostics.map(e=>e.messageText).join('; '));
  for(const name of ['Article breadcrumb','Back to Codex','Story & lore','aria-current="page"','Entry overview']) assert.ok(component.includes(name),name);
});
test('P12: reader cannot mutate entries or bypass existing persistence',()=>{
  assert.doesNotMatch(component,/supabase|\.rpc\(|updateArticle|dangerouslySetInnerHTML/);
  assert.match(app,/CodexReaderHero/);
  assert.match(app,/CodexReaderStoryHeading/);
  assert.match(app,/CodexReaderWorkspace\.module\.css/);
  assert.match(app,/SafeRichText html=\{part\}/);
  assert.match(app,/CodexCanonPanel/);
  assert.match(app,/getArticleHistory\(activeArticle\.id\)/);
  assert.match(app,/setShowMoveMenu/);
  assert.match(app,/setShowDeleteModal/);
  assert.match(app,/CodexEditorWorkspace/);
});
test('P12: theme tokens, long-form type, mobile rails and overflow-safe media',()=>{
  for(const token of ['var(--text)','var(--textMuted)','var(--border)','var(--accent)','var(--cardBg)']) assert.ok(css.includes(token));
  assert.match(css,/@media\(max-width:850px\)/);
  assert.match(css,/max-width:100%/);
  assert.match(css,/overflow-x:auto/);
});
