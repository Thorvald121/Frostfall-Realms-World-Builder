import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarizeCodexWorkspace } from '../../lib/domain/codexMetrics.js';

const source = readFileSync(new URL('../../components/FrostfallRealms.jsx', import.meta.url), 'utf8');
const menu = readFileSync(new URL('../../components/ui/EntryTypeMenu.jsx', import.meta.url), 'utf8');
const header = readFileSync(new URL('../../features/codex/CodexWorkspaceHeader.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../features/codex/CodexWorkspaceHeader.module.css', import.meta.url), 'utf8');
const shellCss = readFileSync(new URL('../../app/themes.css', import.meta.url), 'utf8');

const categories = { character: { label: 'Character' }, location: { label: 'Location' }, event: { label: 'Event' } };

test('P8: Codex metrics are world-scoped, immutable, and exclude all archive flags', () => {
  const articles = [
    { id: 'one', category: 'character', linkedIds: ['two'] },
    { id: 'two', category: 'location', canonStatus: 'disputed' },
    { id: 'old', category: 'event', archived: true },
    { id: 'older', category: 'event', is_archived: true },
    { id: 'oldest', category: 'character', isArchived: true },
  ];
  const first = JSON.stringify(articles);
  const data = summarizeCodexWorkspace({ articles, categories });
  assert.deepEqual({ entries: data.entries, categories: data.categories, linked: data.linked, flagged: data.flagged },
    { entries: 2, categories: 2, linked: 1, flagged: 1 });
  assert.equal(data.categoryCounts.event, 0);
  assert.equal(JSON.stringify(articles), first);
});

test('P8: disabled categories do not appear in category filters or summaries', () => {
  const data = summarizeCodexWorkspace({ categories, disabledCategories: ['event'],
    articles: [{ category: 'event' }, { category: 'event' }, { category: 'character' }] });
  assert.equal(data.entries, 3); // do not hide or delete source records
  assert.equal(data.categories, 1);
  assert.deepEqual(Object.keys(data.categoryCounts), ['character', 'location']);
});

test('P8: empty and malformed records produce safe, honest summaries', () => {
  assert.deepEqual(summarizeCodexWorkspace(), { entries: 0, categories: 0, linked: 0, flagged: 0, categoryCounts: {} });
  const data = summarizeCodexWorkspace({ articles: [null, { category: 'event', body: 'Arin met Thorne in 1220' }], categories });
  assert.equal(data.entries, 1);
  assert.equal(data.linked, 0); // a text mention is NOT a relationship
  assert.equal(data.flagged, 0); // no inferred canonical status
});

test('P8: New Entry menu closes outside without blocking the page', () => {
  assert.match(menu, /addEventListener\("pointerdown", outsidePointer, true\)/);
  assert.match(menu, /removeEventListener\("pointerdown", outsidePointer, true\)/);
  assert.match(menu, /addEventListener\("focusin", outsideFocus, true\)/);
  assert.match(menu, /const contains = /);
  assert.match(menu, /setOpen\(false\)/);
  assert.doesNotMatch(source, /fr-create-dismiss/);
  assert.doesNotMatch(shellCss, /\.fr-create-dismiss\s*\{/);
});

test('P8: menu keyboard access, focus return, and selection are explicit', () => {
  for (const key of ['Escape', 'ArrowDown', 'ArrowUp', 'Home', 'End']) assert.ok(menu.includes(key));
  assert.match(menu, /trigger\.current\?\.focus\(\)/);
  assert.match(menu, /aria-haspopup="menu"/);
  assert.match(menu, /role="menuitem"/);
  assert.match(menu, /onSelect\(id\)/);
  assert.match(menu, /onClick=\{toggle\}/);
});

test('P8: global and Codex entry creation share the reusable menu', () => {
  assert.match(source, /<EntryTypeMenu/);
  assert.match(header, /<EntryTypeMenu/);
  assert.doesNotMatch(source, /showMoreCats|showCodexCreate/);
  assert.match(menu, /disabledCategories/);
});

test('P8: the Codex shell uses a real search form and accessible category toggles', () => {
  for (const text of ['Codex Studio', 'Search this world', 'Recently updated', 'Populated categories', 'Entries with links']) assert.ok(header.includes(text));
  assert.match(header, /type="search"/);
  assert.match(header, /aria-pressed=\{categoryFilter === id\}/);
  assert.match(header, /aria-label="Codex display style"/);
  assert.match(header, /role="status"/);
  assert.match(source, /<CodexWorkspaceHeader/);
  assert.match(source, /<CodexEmptyState/);
});

test('P8: filters, sort and selection retain the existing Codex state model', () => {
  for (const item of ['onSearch={setSearchQuery}', 'onSort={setCodexSort}', 'onViewMode={setCodexViewMode}', 'onCategoryFilter={setCodexFilter}', 'onCreate={goCreate}']) assert.ok(source.includes(item));
  assert.match(source, /setCodexTagFilter\(""\); setCodexRefFilter\("all"\)/);
});

test('P8: responsive Codex controls contain scrolling rather than overflowing workspace', () => {
  assert.match(css, /overflow-x:auto/);
  assert.match(css, /overscroll-behavior-x:contain/);
  assert.match(css, /@media\(max-width:480px\)/);
  assert.match(shellCss, /\.fr-create-anchor/);
  assert.match(shellCss, /\.fr-create-menu:focus-within/);
});
