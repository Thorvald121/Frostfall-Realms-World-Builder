import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { safeHref, safeImageSrc, parseSafeRichText, escapeHtml } from '../../lib/domain/richTextSafety.js';

const file = path => readFile(new URL('../../' + path, import.meta.url), 'utf8');
test('P6 only permits explicit http(s), mailto or local anchor links', () => {
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('JaVaScRiPt:alert(1)'), null);
  assert.equal(safeHref('data:text/html,<script>'), null);
  assert.equal(safeHref('https://example.org/a?x=1'), 'https://example.org/a?x=1');
  assert.equal(safeHref('#chapter-1'), '#chapter-1');
  assert.equal(safeHref('https:\n//example.org'), null);
});
test('P6 restricts embedded images to non-SVG images or Supabase public storage', () => {
  assert.equal(safeImageSrc('data:image/svg+xml;base64,PHN2Zz4='), null);
  assert.equal(safeImageSrc('javascript:alert(1)'), null);
  assert.equal(safeImageSrc('https://evil.example/track.png'), null);
  assert.equal(safeImageSrc('data:image/png;base64,aGVsbG8='), 'data:image/png;base64,aGVsbG8=');
  assert.ok(safeImageSrc('https://demo.supabase.co/storage/v1/object/public/maps/map.png'));
});
test('P6 escapes fallback text without a DOM', () => {
  assert.equal(escapeHtml('<img onerror="attack()">'), '&lt;img onerror=&quot;attack()&quot;&gt;');
  assert.deepEqual(parseSafeRichText('<b>example</b>', null), [{kind:'text',text:'<b>example</b>'}]);
});
test('P6 rendered stored HTML never uses raw innerHTML injection sinks', async () => {
  const files = await Promise.all([
    'components/FrostfallRealms.jsx',
    'features/novel/NovelWorkspace.jsx',
    'features/world/WorldHomePage.jsx',
  ].map(file));
  assert.doesNotMatch(files.join('\n'), /dangerouslySetInnerHTML=\{\{ __html: (?!`)/);
  assert.ok(files.join('\n').includes('SafeRichText'));
  assert.match(files[0], /sanitizeRichHtml\(plainToHtml\(formData\.body\)\)/);
});
test('P6 source-rendering component constructs approved React elements', async () => {
  const safe = await file('components/ui/SafeRichText.jsx');
  assert.match(safe, /React\.createElement/);
  assert.doesNotMatch(safe, /dangerouslySetInnerHTML\s*=/);
});
test('P6 exposes no staging marker when not explicitly in staging mode', async () => {
  const status = await file('app/api/staging-status/route.js');
  assert.match(status, /process\.env\.FROSTFALL_DEPLOYMENT_ROLE !== 'staging'/);
  assert.match(status, /status: 404/);
  assert.doesNotMatch(status, /SUPABASE_URL|ANON_KEY|SERVICE_ROLE/);
});
test('P6 tightens framing and non-staging search indexing', async () => {
  const cfg = await file('next.config.js');
  assert.match(cfg, /frame-ancestors 'none'/);
  assert.match(cfg, /X-Robots-Tag/);
  const smoke = await file('scripts/staging-smoke.mjs');
  assert.match(smoke, /\/api\/staging-status/);
  assert.match(smoke, /SMOKE TEST BLOCKED/);
});
