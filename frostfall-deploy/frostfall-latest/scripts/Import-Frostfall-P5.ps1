param(
  [Parameter(Mandatory=$true)][string]$Repository,
  [Parameter(Mandatory=$true)][string]$Bundle
)
$ErrorActionPreference='Stop'
$Branch='modernization/p5-staging-hardening-20261116'
if (-not (Test-Path (Join-Path $Repository '.git'))) { throw 'Target must be an existing Git repository.' }
if (-not (Test-Path $Bundle)) { throw 'Bundle does not exist.' }
$dirty = git -C $Repository status --porcelain
if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Stop: Repository has uncommitted changes, or Git failed.' }
# No force updates, production checkout, migrations or deployment.
git -C $Repository bundle verify $Bundle
if ($LASTEXITCODE -ne 0) { throw 'Bundle verification failed.' }
git -C $Repository fetch $Bundle "refs/heads/$($Branch):refs/heads/$($Branch)"
if ($LASTEXITCODE -ne 0) { throw 'Branch import failed. Verify P4 source and ref availability.' }
git -C $Repository switch $Branch
if ($LASTEXITCODE -ne 0) { throw 'Branch switch failed.' }
Write-Host 'P5 imported into local working tree. Nothing has been pushed or deployed.'
Write-Host 'Next: node --experimental-default-type=module --test tests/modernization/*.test.mjs'
Write-Host 'Then: node scripts/staging-preflight.mjs (requires staging configuration)'
