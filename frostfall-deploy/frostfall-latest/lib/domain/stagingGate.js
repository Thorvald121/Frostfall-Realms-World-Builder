/**
 * Deployment readiness checks. Pure functions; never print credentials.
 * A negative result prevents staging promotion; it does not mutate any system.
 */
const validHttpsOrigin = (value) => {
  try {
    const u = new URL(value || "");
    return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash && u.pathname === '/';
  } catch { return false; }
};
const host = value => { try { return new URL(value).host.toLowerCase(); } catch { return ''; } };

export function checkStagingEnvironment(env) {
  const problems = [];
  const stage = env.FROSTFALL_STAGING_URL;
  const prod = env.FROSTFALL_PRODUCTION_URL;
  const stageDb = env.NEXT_PUBLIC_SUPABASE_URL;
  const prodDb = env.FROSTFALL_PRODUCTION_SUPABASE_URL;
  if (!validHttpsOrigin(stage)) problems.push('FROSTFALL_STAGING_URL must be an HTTPS origin (no path or credentials).');
  if (!validHttpsOrigin(prod)) problems.push('FROSTFALL_PRODUCTION_URL must be an HTTPS origin.');
  if (validHttpsOrigin(stage) && validHttpsOrigin(prod) && host(stage) === host(prod))
    problems.push('Staging must not share its host with production.');
  if (!validHttpsOrigin(stageDb) || !/\.supabase\.co$/i.test(host(stageDb)))
    problems.push('NEXT_PUBLIC_SUPABASE_URL must be a real HTTPS Supabase project URL.');
  if (!validHttpsOrigin(prodDb) || !/\.supabase\.co$/i.test(host(prodDb)))
    problems.push('FROSTFALL_PRODUCTION_SUPABASE_URL is required for safe comparison.');
  if (validHttpsOrigin(stageDb) && validHttpsOrigin(prodDb) && host(stageDb) === host(prodDb))
    problems.push('Staging and production MUST use different Supabase projects.');
  if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY || /replace|placeholder|your-|example|change.me|anon-key-here/i.test(env.NEXT_PUBLIC_SUPABASE_ANON_KEY))
    problems.push('A real staging public Supabase anon/publishable key is required.');
  if (Object.keys(env).some(k => /^NEXT_PUBLIC_.*(SERVICE_ROLE|SECRET_KEY|PRIVATE_KEY)/i.test(k)))
    problems.push('Server secrets must not be exposed using NEXT_PUBLIC_ variables.');
  if (env.FF_AI_ALLOW_SHARED_PROVIDER_KEYS === 'true')
    problems.push('Staging must not enable shared, metered AI credentials.');
  return problems;
}

export function checkDependencyLock(packageJson, pnpmLockText) {
  const missing = [];
  const importer = (pnpmLockText || '').split('\npackages:\n')[0];
  for (const name of Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies })) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp("^\\s{6}['\"]?" + escaped + "['\"]?\\s*:", 'm').test(importer)) missing.push(name);
  }
  return missing;
}
