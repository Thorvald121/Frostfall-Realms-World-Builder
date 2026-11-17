import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js';

const home = readFileSync(new URL('./WorldHomePage.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./WorldHomePage.module.css', import.meta.url), 'utf8');
const parse = (source, name) => ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);

test('P9 World Home JSX parses without errors', () => {
  const diagnostics = parse(home, 'WorldHomePage.jsx').parseDiagnostics;
  assert.deepEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, ' ')), []);
});
test('modern World Home replaces fixed-width legacy panel', () => {
  assert.doesNotMatch(home, /maxWidth:\s*960/);
  assert.match(css, /max-width:none/);
  assert.match(home, /THE WORLD \/ HOME/);
});
test('world home remains world scoped', () => {
  assert.match(home, /const worldId = activeWorld\?\.id/);
  assert.match(home, /fetchWorldHome\(worldId\)/);
  assert.match(home, /let cancelled = false/);
  assert.match(home, /if \(cancelled\) return/);
  assert.match(home, /return \(\) => \{ cancelled = true; \}/);
});
test('load errors are visible, not represented as an empty world', () => {
  assert.match(home, /setReadError\(/);
  assert.match(home, /role="alert"/);
  assert.match(home, /readError \|\| saving/);
});
test('all existing home fields remain persisted by existing APIs', () => {
  assert.match(home, /updateWorldHome\(worldId, \{/);
  for (const key of ['tagline:', 'descriptionHtml:', 'featuredIds:', 'coverUrl:']) assert.ok(home.includes(key), key);
  assert.match(home, /uploadWorldCover\(user\.id, worldId, file\)/);
  assert.match(home, /setHomeData\(\(old\)/);
});
test('cover editing and lore editing remain restricted', () => {
  assert.match(home, /const canEdit = !!worldId/);
  assert.match(home, /activeWorld\?\.member_role === "owner"/);
  assert.match(home, /canEdit && readable/);
});
test('featured lore limited to three entries', () => {
  assert.match(home, /draftFeatured\.slice\(0, 3\)/);
  assert.match(home, /old\.length < 3/);
});
test('no artificial content is inserted for empty worlds', () => {
  assert.match(home, /articles\.length === 0/);
  assert.match(home, /recentArticles\.length \?/);
  assert.match(home, /categoryCounts\.length \?/);
  assert.doesNotMatch(home, /demo entries|sample articles|fabricated/i);
});
test('navigation keeps Codex, Chronicle, Canon and graph actions', () => {
  for (const id of ['codex', 'timeline', 'canon_studio', 'graph', 'integrity']) assert.ok(home.includes(`onNavigate("${id}"`));
});
test('layout has non-clipping tablet and phone breakpoints', () => {
  assert.match(css, /@media\(max-width:1050px\)/);
  assert.match(css, /@media\(max-width:750px\)/);
  assert.match(css, /@media\(max-width:380px\)/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\)/);
});