$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host ""
Write-Host " BloodLink HOST for Windows"
Write-Host " ======================="
Write-Host " This starts a SERVER on this computer."
Write-Host " Friends should use BloodLink-Connect.zip or the Invite People link."
Write-Host ""

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "Node.js 22.5+ is required. Install LTS from https://nodejs.org/ then run this again."
  Start-Process "https://nodejs.org/"
  exit 1
}

Write-Host "Using $($node.Source) $(node -v)"

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies..."
  npm install
}
if (-not (Test-Path "client\dist\index.html")) {
  Write-Host "Building the client..."
  npm run build
}

$env:HEARTH_PORT = "3928"
$env:HEARTH_HOST = "0.0.0.0"
Write-Host ""
Write-Host "Starting BloodLink on http://127.0.0.1:3928"
Write-Host "Leave this window open."
Start-Process "http://127.0.0.1:3928"
node server\src\index.js
