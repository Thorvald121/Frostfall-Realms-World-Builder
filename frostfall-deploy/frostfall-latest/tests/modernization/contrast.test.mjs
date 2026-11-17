import test from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, normalizeThemeKey } from '../../lib/themes.js';
import { contrastRatio, themeSurfaces, ensureContrast, readableOn } from '../../lib/ui/contrast.js';
import { NAV_COLOR_IDS, navTone } from '../../lib/ui/navigation.js';

test('all nine named themes remain selectable, preserving the seven legacy styles', () => {
  for (const id of ['dark_arcane','obsidian','parchment','frozen_steel','emberforge','voidbloom','thornwood','glacier_light','dawnlight']) assert.ok(THEMES[id], id);
  assert.equal(normalizeThemeKey('frostfall_ice'), 'frozen_steel');
});

test('principal foreground tokens meet WCAG AA at each principal background', () => {
  for (const [id, theme] of Object.entries(THEMES)) {
    for (const field of ['text','textMuted','textDim']) {
      for (const bg of [theme.surface, theme.inputBg, theme.deepBg, ...themeSurfaces(theme)]) {
        assert.ok(contrastRatio(theme[field], bg) >= 4.5 - 0.01, `${id} ${field} over ${bg} = ${contrastRatio(theme[field], bg)}`);
      }
    }
  }
});

test('every module icon and label maintains at least 5:1 contrast on its sidebar', () => {
  for (const [themeId, theme] of Object.entries(THEMES)) {
    for (const navId of Object.keys(NAV_COLOR_IDS)) {
      for (const bg of themeSurfaces(theme)) {
        assert.ok(contrastRatio(navTone(theme,navId),bg) >= 4.99, `${themeId}/${navId}`);
      }
    }
  }
});

test('navigation module identity palettes differ by default', () => {
  assert.equal(new Set(Object.values(NAV_COLOR_IDS)).size, Object.keys(NAV_COLOR_IDS).length);
  for (const theme of Object.values(THEMES)) {
    const tones = Object.keys(NAV_COLOR_IDS).map((id) => navTone(theme, id));
    assert.equal(new Set(tones).size, tones.length, `${theme.name} has duplicate navigation colors`);
  }
  assert.notEqual(navTone(THEMES.parchment, 'codex'), navTone(THEMES.parchment, 'timeline'));
  assert.ok(contrastRatio(ensureContrast('#ffff00','#ffffff',5),'#ffffff')>=4.99);
  for (const theme of Object.values(THEMES))
    assert.ok(contrastRatio(readableOn(theme.accent), theme.accent) >= 4.5, `${theme.name} action text`);
});
