# Frostfall Realms P5 — Staging hardening and authenticated-app gate

**2026-11-16** · Branch: `modernization/p5-staging-hardening-20261116` · Parent: P4 `74a28d2fdf1a7b077e8aea4778245bf636b9f606`.

## Delivered in source

1. AuthGate now fails closed when Supabase is misconfigured. It shows a readable setup error rather than opening a local-only guest world behind a nonexistent login. Initial sessions are validated via `auth.getUser()` rather than trusting cached `getSession()` data alone.
2. Initial world/article reads now use a strict failure path; a Supabase/RLS/network failure is **not** an empty world. The UI blocks editing and offers retry/sign-out. A world switch loads the destination successfully **before** changing the active world; the previous world survives read errors.
3. World creation now requires a confirmed returned database row before switching.
4. Remove wildcard CORS and permissive framing headers. Add `DENY` framing, nosniff, safer referrer and resource policies. No restrictive CSP is claimed yet because editor HTML and Next.js inline scripts require a separate tested rollout.
5. Add `scripts/staging-preflight.mjs` (read-only environment/schema/lock checks) and `scripts/staging-smoke.mjs` (only staging HTTP GET and anonymous AI rejection). Both fail before any network work unless staging and production hosts plus Supabase projects are explicitly distinct. The smoke test does **not** submit credentials or write data.
6. Preserve P1–P4 Codex, nine themes, colored sidebar, theme dropdown, Canon Studio, versioned manuscripts and interactive Chronicles timeline unchanged.

## Verified locally

- 68/68 `node --experimental-default-type=module --test tests/modernization/*.test.mjs` tests pass.
- TypeScript-parser syntax and local-import resolution checks (see release verification log).
- No live login, Supabase staging database, Next.js dependency installation, full Next.js build, or production promotion was performed.

## Known blockers (must not be bypassed)

1. `pnpm-lock.yaml` lacks `@tabler/core` and `lucide-react` declared in `package.json`. On a trusted computer with Internet and pnpm 9+, regenerate with `pnpm install --lockfile-only` and **commit the new lockfile**. Follow with `pnpm install --frozen-lockfile`, `pnpm test:modernization` and `pnpm build`. P5 does **not** claim a successful full build.
2. There is no verified dedicated staging deployment URL, independent Supabase project, schema backup, or staging credentials in this package. Do not connect staging to the live Supabase project.
3. Apply P2 and P3 migrations only after backing up and inspecting the **separate staging database**. P4 and P5 require no SQL migration. Test owner/editor/viewer RLS and concurrent manuscript saves with throwaway users.
4. The connected GitHub account has read-only permissions. This local bundle cannot be pushed by the assistant; a user or authorized deploy identity must import/push the P5 branch before deploying to staging. Do not force-push main.
5. A comprehensive rich-text HTML sanitizer and Content Security Policy are required before an unrestricted live production launch. The legacy editor still has `dangerouslySetInnerHTML` surfaces. Do not call P5 production ready.
6. Account deletion remains **documented but not implemented**, pending validation of real Auth/storage/collaborator ownership and export integrity. Do not deploy a destructive mock.

## Safe Windows import

Download/extract the P5 package, and use a clean local P4 repository:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Import-Frostfall-P5.ps1 `
  -Repository "$env:USERPROFILE\Documents\realms-rework\frostfall-repo" `
  -Bundle "$env:USERPROFILE\Downloads\Frostfall_Studio_P5_Local_Branch.bundle"
```

Change the example paths to your actual checkout and download location. The importer refuses a dirty checkout and never deploys or migrates anything. Alternatively, the full source ZIP can be extracted to a **new isolated folder**; do not paste over production or an existing repository.

## Staging-only checks after lockfile repair

```powershell
node --experimental-default-type=module --test tests/modernization/*.test.mjs
node scripts/staging-preflight.mjs
# Only after preflight passes and staging app is deployed:
node scripts/staging-smoke.mjs
```

Set the variables described in `.env.staging.example` in the staging environment; do not commit real keys. The CLI will refuse the test when required values are missing or production and staging overlap.

### Authenticated acceptance to complete manually on staging

- Sign in with a **dedicated staging-only** account; confirm OAuth/password recovery and sign out.
- Create two staging worlds, then use two different users to verify unauthorized article, canon and manuscript access is denied.
- Force an RLS deny and a network failure; the app must show its load error and never save a false empty-world state.
- Edit manuscripts in two sessions; verify conflict recovery and retained snapshots.
- Test Chronicle event selection, date filters, negative years, event index, theme contrast in all nine palettes, and mobile viewport scrolling.
- Prove backup and rollback, then decide separately on production promotion.

## Forward backlog

- Structured canon participation assertions tied directly to Chronicle event inspectors.
- Full rich-text sanitization + CSP and e2e auth/RLS tests.
- Owner-aware account deletion, export verification, storage cleanup and secure reauthentication.
- Improve the chapter/editor and timeline interactions after integrated staging is verified.
