# Import P6 into a brand new local checkout. No existing files, DBs or deployments changed.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Bundle,
  [Parameter(Mandatory=$true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
$bundlePath = (Resolve-Path -LiteralPath $Bundle).Path
$target = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $target) { throw "Destination already exists: $target. Choose a NEW staging folder." }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is required.' }
# `git bundle verify` requires a repository even for a self-contained bundle.
# Use a throwaway empty bare repository; NEVER initialize or change the target.
$verifyDir = Join-Path ([IO.Path]::GetTempPath()) ('frostfall-bundle-check-' + [guid]::NewGuid().ToString('N'))
try {
  & git init --quiet --bare -- $verifyDir
  if ($LASTEXITCODE -ne 0) { throw 'Could not initialize temporary bundle verifier.' }
  & git -C $verifyDir bundle verify $bundlePath
  if ($LASTEXITCODE -ne 0) { throw 'The Git bundle failed verification.' }
}
finally {
  if (Test-Path -LiteralPath $verifyDir) { Remove-Item -LiteralPath $verifyDir -Recurse -Force }
}
& git clone --branch 'modernization/p6-safe-rich-text-and-staging-20261116' --single-branch -- $bundlePath $target
if ($LASTEXITCODE -ne 0) { throw 'Could not clone the P6 bundle.' }
$expectedParent = 'e836fc02bd4b39b80853a6046a40cf1ee265cc08'
$actualParent = (& git -C $target rev-parse 'HEAD^').Trim()
if ($actualParent -ne $expectedParent) { throw 'P6 baseline check failed; do not use this checkout.' }
Write-Host 'P6 staging source imported into a new directory. Nothing deployed.'
Write-Host 'Use scripts/Invoke-Frostfall-P6-Staging.ps1 after supplying a REAL isolated staging environment.'
