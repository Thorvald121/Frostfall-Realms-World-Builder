#!/usr/bin/env node
// Read-only staging GET + anonymous authentication rejection. No passwords,
// database writes, API provider calls or production URLs are permitted.
import { checkStagingEnvironment } from '../lib/domain/stagingGate.js';
const errs = checkStagingEnvironment(process.env);
if (process.env.FROSTFALL_DEPLOYMENT_ROLE !== 'staging') { process.stderr.write('SMOKE TEST BLOCKED: deployment role is not staging.\n'); process.exit(1); }
if (errs.length) { process.stderr.write('SMOKE TEST BLOCKED: run staging-preflight first.\n'); process.exit(1); }
const origin = process.env.FROSTFALL_STAGING_URL;
const opts = { redirect: 'manual', signal: AbortSignal.timeout(12000) };
const marker = await fetch(new URL('/api/staging-status', origin), opts);
if (marker.status !== 200) throw new Error('P6 staging marker unavailable: wrong host or old build.');
const markerData = await marker.json();
if (markerData?.stage !== 'staging' || markerData?.gate !== 'p6') throw new Error('Wrong staging marker: refusing to test this environment.');
const page = await fetch(origin, opts);
if (page.status !== 200 || !(page.headers.get('content-type') || '').includes('text/html')) throw new Error('Staging app did not serve HTML 200.');
if (page.headers.get('x-frame-options') !== 'DENY') throw new Error('Framing protection header missing.');
if (page.headers.get('x-content-type-options') !== 'nosniff') throw new Error('Content-type protection header missing.');
const unauth = await fetch(new URL('/api/ai-import', origin), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', redirect: 'manual', signal: AbortSignal.timeout(12000) });
if (unauth.status !== 401) throw new Error(`Anonymous AI call should return 401, got ${unauth.status}.`);
process.stdout.write('STAGING HTTP SMOKE PASS: marker, HTML, security headers, anonymous AI blocked.\nAuthenticated world isolation and RLS must still be tested with dedicated staging users.\n');
