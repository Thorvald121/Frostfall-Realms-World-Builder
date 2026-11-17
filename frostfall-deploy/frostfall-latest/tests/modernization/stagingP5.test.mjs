import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkStagingEnvironment, checkDependencyLock } from '../../lib/domain/stagingGate.js';

const env = () => ({
  FROSTFALL_STAGING_URL: 'https://staging.frostfall-realms.com/',
  FROSTFALL_PRODUCTION_URL: 'https://frostfall-realms.com/',
  NEXT_PUBLIC_SUPABASE_URL: 'https://stageexample.supabase.co/',
  FROSTFALL_PRODUCTION_SUPABASE_URL: 'https://productionexample.supabase.co/',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'safe_public_anon_key_for_test',
  FF_AI_ALLOW_SHARED_PROVIDER_KEYS: 'false',
});

test('P5 allows a unique HTTPS staging host and isolated Supabase project', () => {
  assert.deepEqual(checkStagingEnvironment(env()), []);
});
test('P5 refuses any staging host that equals live production', () => {
  const e = env(); e.FROSTFALL_STAGING_URL = 'https://frostfall-realms.com/';
  assert.match(checkStagingEnvironment(e).join(' '), /must not share its host/i);
});
test('P5 refuses a production Supabase project as the staging database', () => {
  const e = env(); e.NEXT_PUBLIC_SUPABASE_URL = e.FROSTFALL_PRODUCTION_SUPABASE_URL;
  assert.match(checkStagingEnvironment(e).join(' '), /different Supabase projects/);
});
test('P5 rejects http, paths, userinfo and placeholders in staging config', () => {
  const e = env(); e.FROSTFALL_STAGING_URL = 'http://staging.frostfall-realms.com/';
  e.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'your-anon-key-here';
  assert.equal(checkStagingEnvironment(e).length, 2);
  e.FROSTFALL_STAGING_URL = 'https://user:password@staging.frostfall-realms.com/subpath';
  assert.ok(checkStagingEnvironment(e).length >= 2);
});
test('P5 forbids public server secrets and shared metered provider calls in staging', () => {
  const e = env(); e.NEXT_PUBLIC_SERVICE_ROLE_KEY = 'secret'; e.FF_AI_ALLOW_SHARED_PROVIDER_KEYS = 'true';
  assert.match(checkStagingEnvironment(e).join(' '), /NEXT_PUBLIC_/);
  assert.match(checkStagingEnvironment(e).join(' '), /metered/);
});
test('P5 dependency check flags new UI packages absent from the lockfile', () => {
  const pkg = { dependencies: {'lucide-react':'1.72.0', '@tabler/core': '1.7.4'} };
  const lock = `importers:\n  .:\n    dependencies:\n      lucide-react:\n        specifier: 1.72.0\n\npackages:\n`;
  assert.deepEqual(checkDependencyLock(pkg, lock), ['@tabler/core']);
});
test('P5 legacy wildcard CORS and permissive framing are removed', async () => {
  const config = await readFile(new URL('../../next.config.js', import.meta.url), 'utf8');
  assert.doesNotMatch(config, /Access-Control-Allow-Origin|ALLOWALL/); // no wildcard headers in source
  assert.match(config, /X-Frame-Options/);
  assert.match(config, /'DENY'/);
  assert.match(config, /nosniff/);
});
test('P5 refuses an unauthenticated local application bypass', async () => {
  const auth = await readFile(new URL('../../components/AuthGate.jsx', import.meta.url), 'utf8');
  assert.match(auth, /getUser\(\)/);
  assert.match(auth, /if \(!supabase\) return \(/);
  assert.doesNotMatch(auth, /if \(!supabase\) return children/);
});
test('P5 failed world loads block editing and switching preserves old world', async () => {
  const app = await readFile(new URL('../../components/FrostfallRealms.jsx', import.meta.url), 'utf8');
  const db = await readFile(new URL('../../lib/supabase.js', import.meta.url), 'utf8');
  assert.match(app, /setDataLoaded\(loadedSuccessfully\)/);
  assert.match(app, /if \(worldLoadError\) return \(/);
  assert.match(app, /fetchArticles\(world\.id, \{ strict: true \}\)/);
  assert.match(db, /const worlds = await fetchWorlds\(userId, \{ strict: true \}\)/);
  assert.match(db, /const articles = await fetchArticles\(worlds\[0\]\.id, \{ strict: true \}\)/);
});
