[CmdletBinding()]
param(
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

if (-not $SkipTests) {
    & (Join-Path $PSScriptRoot 'verify.ps1')
}
npm run package:win
if ($LASTEXITCODE -ne 0) { throw "Windows 打包失败 ($LASTEXITCODE)" }
& (Join-Path $PSScriptRoot 'create-shortcut.ps1')
& (Join-Path $PSScriptRoot 'smoke-app.ps1')
Write-Host 'Application rebuilt and desktop shortcut refreshed.' -ForegroundColor Green
