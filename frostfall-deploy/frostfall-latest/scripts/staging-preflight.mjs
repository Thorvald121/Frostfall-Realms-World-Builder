#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { checkStagingEnvironment, checkDependencyLock } from '../lib/domain/stagingGate.js';
const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8');
const faults = checkStagingEnvironment(process.env);
if (process.env.FROSTFALL_DEPLOYMENT_ROLE !== 'staging') faults.push('FROSTFALL_DEPLOYMENT_ROLE must explicitly be staging.');
const missing = checkDependencyLock(pkg, lock);
if (missing.length) faults.push(`pnpm-lock.yaml is missing dependencies: ${missing.join(', ')}. Run pnpm install --lockfile-only on a trusted machine and commit the result.`);
for (const file of ['202611160001_canon_studio.sql', '202611160002_manuscript_versioned_sync.sql']) {
  if (!fs.existsSync(path.join(root, 'supabase', 'migrations', file))) faults.push(`Migration missing: ${file}`);
}
if (faults.length) {
  process.stdout.write(`STAGING PREFLIGHT: BLOCKED (${faults.length} issues)\n` + faults.map((m,i) => `${i+1}. ${m}`).join('\n') + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write('STAGING PREFLIGHT: SOURCE/ENVIRONMENT GATES PASS\nDatabase migrations, RLS policies, authentication and rollback still require separate live staging verification.\n');
}
