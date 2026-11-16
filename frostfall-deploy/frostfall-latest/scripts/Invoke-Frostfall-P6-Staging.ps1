# Offline-safe, production-protecting staging acceptance. Does NOT deploy, migrate or push.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Repository,
    [Parameter(Mandatory=$true)][string]$EnvironmentFile,
    [switch]$RepairLockfile,
    [switch]$RunHttpSmoke
)
$ErrorActionPreference = 'Stop'
$repoPath = (Resolve-Path -LiteralPath $Repository).Path
$envPath = (Resolve-Path -LiteralPath $EnvironmentFile).Path
if (-not (Test-Path -LiteralPath (Join-Path $repoPath '.git'))) { throw 'Use an isolated Git checkout; .git not found.' }
if (-not (Test-Path -LiteralPath (Join-Path $repoPath 'pnpm-lock.yaml'))) { throw 'pnpm lockfile missing.' }
if ($envPath.StartsWith($repoPath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and
    -not $envPath.EndsWith('.env.staging.local')) {
    throw 'Store deployment credentials outside the repository, or only in ignored .env.staging.local.'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node 22 or newer is required.' }
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { throw 'pnpm 9 required: activate using Corepack on the trusted developer workstation.' }
# Read only literal KEY=VALUE lines. No Invoke-Expression, no secret echoing.
$allowed = @('FROSTFALL_DEPLOYMENT_ROLE', 'FROSTFALL_STAGING_URL', 'FROSTFALL_PRODUCTION_URL',
 'NEXT_PUBLIC_SUPABASE_URL', 'FROSTFALL_PRODUCTION_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'FF_AI_ALLOW_SHARED_PROVIDER_KEYS')
foreach ($line in (Get-Content -LiteralPath $envPath)) {
    $trim = $line.Trim()
    if (-not $trim -or $trim.StartsWith('#')) { continue }
    if ($trim -notmatch '^([A-Z_][A-Z0-9_]*)=(.*)$') { throw 'Invalid staging environment file line.' }
    $key = $Matches[1]; $value = $Matches[2].Trim().Trim('"').Trim("'")
    if ($allowed -notcontains $key) { throw "Unexpected staging environment setting: $key" }
    [Environment]::SetEnvironmentVariable($key, $value, 'Process')
}
if ($env:FROSTFALL_DEPLOYMENT_ROLE -ne 'staging') { throw 'FROSTFALL_DEPLOYMENT_ROLE=staging required.' }
Push-Location $repoPath
try {
    $status = @(git status --porcelain)
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect Git status.' }
    if ($status.Length -gt 0 -and -not ($status.Length -eq 1 -and $status[0] -match 'pnpm-lock.yaml')) {
        throw 'Refusing to work on an uncommitted checkout (other than an already edited lockfile).'
    }
    if ($RepairLockfile) {
        Write-Host 'Regenerating pnpm lockfile on this trusted machine (network access needed)...'
        & pnpm install --lockfile-only --ignore-scripts
        if ($LASTEXITCODE -ne 0) { throw 'Lockfile regeneration failed.' }
    }
    & node scripts/staging-preflight.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Staging preflight blocked. Do not deploy.' }
    & pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'Frozen lockfile installation failed.' }
    & pnpm test:modernization
    if ($LASTEXITCODE -ne 0) { throw 'Regression tests failed.' }
    & pnpm test:syntax
    if ($LASTEXITCODE -ne 0) { throw 'Source syntax/import tests failed.' }
    & pnpm build
    if ($LASTEXITCODE -ne 0) { throw 'Next.js production build failed.' }
    if ($RunHttpSmoke) {
        & node scripts/staging-smoke.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Staging HTTP checks failed.' }
    }
    Write-Host 'P6 SOURCE BUILD GATE PASS. This does NOT confirm staging DB migrations, real login, RLS or live deployment.'
    Write-Host 'Commit the updated lockfile; use a separate staging Supabase project and hostname before deployment.'
}
finally { Pop-Location }
