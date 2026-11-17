import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarizeWorldOverview } from '../../lib/domain/worldOverview.js';

const appSource = readFileSync(new URL('../../components/FrostfallRealms.jsx', import.meta.url), 'utf8');
const overviewSource = readFileSync(new URL('../../features/studio/WorldOverview.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../app/themes.css', import.meta.url), 'utf8');

test('P7 summarizes only articles supplied for the selected world', () => {
  const one = summarizeWorldOverview({ articles: [{ id:'a', title:'North Wind', category:'location', body:'A frozen realm.' }] });
  const empty = summarizeWorldOverview({ articles: [] });
  assert.equal(one.entries, 1); assert.equal(one.categories, 1); assert.equal(empty.entries, 0);
});

test('P7 excludes archived entries and avoids inventing chronology', () => {
  const summary = summarizeWorldOverview({ articles: [
    { id:'a', category:'event', body:'1200 is a date but no structured time' },
    { id:'b', category:'event', isArchived:true, body:'hidden' },
    { id:'c', category:'location', is_archived:true, body:'hidden' },
  ] });
  assert.equal(summary.entries,1);
  assert.equal(summary.categories,1);
  assert.equal('timelineEvents' in summary,false);
});

test('P7 counts categories and manuscripts independently and bounds integrity', () => {
  const result = summarizeWorldOverview({ articles:[{category:'character'},{category:'character'},{category:'deity'}],
    manuscripts:[{id:1},{id:2}], integrityCount:-9 });
  assert.equal(result.categories,2);assert.equal(result.manuscripts,2);assert.equal(result.integrityIssues,0);
});

test('P7 latest changes are sorted and capped at six without modifying source order', () => {
  const input = Array.from({length:9},(_,i)=>({id:`item${i}`,updatedAt:`2026-11-${String(i+1).padStart(2,'0')}T12:00:00Z`}));
  const got=summarizeWorldOverview({articles:input});
  assert.equal(got.recent.length,6);assert.equal(got.recent[0].id,'item8');assert.equal(input[0].id,'item0');
});

test('P7 zero-entry overview shows an honest world-scoped empty state', () => {
  assert.match(overviewSource,/No entries in this world yet/);
  assert.match(overviewSource,/other accounts or worlds do not appear here/);
  assert.match(overviewSource,/onSwitchWorld/);
});

test('P7 replaces obsolete dashboard rather than hiding it behind a second nav', () => {
  assert.match(appSource,/const renderDashboard = \(\) => view === "dashboard"/);
  assert.doesNotMatch(appSource,/The Archives of \{activeWorld/);
  assert.match(appSource,/WorldOverview/);
});

test('P7 preserves registered modules and groups sidebar by function', () => {
  for(const heading of ['THE WORLD','CONNECTIONS','WRITING & CANON','CREATION & TOOLS','ACCOUNT & HELP']) assert.ok(appSource.includes(heading));
  for(const name of ['codex','timeline','graph','family_tree','novel','canon_studio','integrity','ai_import','support_page']) assert.ok(appSource.includes(`id: "${name}"`));
  assert.match(appSource,/categoriesExpanded \? \[/);
});

test('P7 keeps one theme selector in the desktop toolbar and one accessible on mobile', () => {
  assert.match(appSource,/fr-studio-toolbar-actions/);
  assert.match(appSource,/fr-mobile-theme/);
  assert.match(appSource,/showMoreCats/);
});

test('P7 retains 9 theme-driven color tokens and viewport containment', () => {
  assert.match(css,/\.fr-studio-nav-list \{/);
  assert.match(css,/overscroll-behavior:contain/);
  assert.match(css,/\.fr-studio \.fr-content/);
  assert.match(css,/background:var\(--cardBg\)/);
  assert.match(css,/@media\(max-width:700px\)/);
});
