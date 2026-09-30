# One-step setup for Windows PowerShell. Safe to run again.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is not installed. Install Node 22 from https://nodejs.org, then rerun.' }
$v = [version](node -p 'process.versions.node')
if ($v -lt [version]'20.19.0') { throw "Node $v is too old; Scriptorium needs 20.19 or newer." }

npm ci
if (-not (Test-Path .venv)) { python -m venv .venv }
.\.venv\Scripts\python -m pip install --quiet -r requirements.txt
npm run demo
Write-Host "`nDone. Equation checks: npm run test:equations"
