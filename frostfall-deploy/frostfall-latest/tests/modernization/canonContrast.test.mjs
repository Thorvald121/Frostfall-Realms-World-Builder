import test from 'node:test';
import assert from 'node:assert/strict';
import { THEMES } from '../../lib/themes.js';
import { contrastRatio, ensureContrast, readableOn, themeSurfaces } from '../../lib/ui/contrast.js';
import { navTone, NAV_COLOR_IDS } from '../../lib/ui/navigation.js';

test('Canon Studio controls, actions, status colors and labels remain legible in every theme',()=>{
 for(const [key,theme] of Object.entries(THEMES)) {
  const surfaces=[theme.surface,theme.inputBg];
  const accent=ensureContrast(theme.accent,surfaces,5);
  const border=ensureContrast(theme.border,surfaces,3);
  for(const bg of surfaces) {
   assert.ok(contrastRatio(accent,bg)>=4.99,`${key}: accent on ${bg}`);
   assert.ok(contrastRatio(border,bg)>=2.99,`${key}: control border on ${bg}`);
   for(const statusColor of ['#e07050','#e2a551','#67afd5','#6fbf94']) {
    const fg=ensureContrast(statusColor,surfaces,4.5);
    assert.ok(contrastRatio(fg,bg)>=4.49,`${key}: status ${statusColor} on ${bg}`);
   }
   for(const textColor of [theme.text,theme.textMuted]) {
    assert.ok(contrastRatio(textColor,bg)>=4.49,`${key}: text on ${bg}`);
   }
  }
  assert.ok(contrastRatio(readableOn(theme.accent),theme.accent)>=4.49,`${key}: CTA readability`);
  for(const bg of themeSurfaces(theme))assert.ok(contrastRatio(navTone(theme,'canon_studio'),bg)>=4.99,`${key}: Canon Studio sidebar`);
 }
 assert.ok('canon_studio' in NAV_COLOR_IDS);
});
