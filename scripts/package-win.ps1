[CmdletBinding()]
param([switch]$SkipVerification)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root
$env:APP_BUILD_PROFILE = 'public'

if (-not $SkipVerification) { & (Join-Path $PSScriptRoot 'check-public-safety.ps1') }
node (Join-Path $PSScriptRoot 'ensure-electron.mjs')
if ($LASTEXITCODE -ne 0) { throw "Electron 二进制准备失败 ($LASTEXITCODE)" }
npm run build:resources
if ($LASTEXITCODE -ne 0) { throw "资源构建失败 ($LASTEXITCODE)" }
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw "类型检查失败 ($LASTEXITCODE)" }
npm test
if ($LASTEXITCODE -ne 0) { throw "自动化测试失败 ($LASTEXITCODE)" }
npm run build
if ($LASTEXITCODE -ne 0) { throw "生产构建失败 ($LASTEXITCODE)" }
npx electron-builder --win nsis zip --x64 --publish never
if ($LASTEXITCODE -ne 0) { throw "electron-builder 失败 ($LASTEXITCODE)" }
Remove-Item -LiteralPath (Join-Path $Root 'release\builder-debug.yml'),(Join-Path $Root 'release\builder-effective-config.yaml') -Force -ErrorAction SilentlyContinue
Get-ChildItem -LiteralPath (Join-Path $Root 'release') -Filter '*.blockmap' -File -ErrorAction SilentlyContinue | Remove-Item -Force
node (Join-Path $PSScriptRoot 'verify-fuses.mjs') (Join-Path $Root 'release\win-unpacked\Grok Build Desktop.exe')
if ($LASTEXITCODE -ne 0) { throw 'Electron Fuses 校验失败。' }

$Version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$GenericZip = Join-Path $Root "release\Grok-Build-Desktop-$Version-x64.zip"
$PortableZip = Join-Path $Root "release\Grok-Build-Desktop-Portable-v$Version-x64.zip"
if (Test-Path -LiteralPath $GenericZip) {
    if (Test-Path -LiteralPath $PortableZip) { [IO.File]::Delete($PortableZip) }
    [IO.File]::Move($GenericZip, $PortableZip)
}
& (Join-Path $PSScriptRoot 'check-public-safety.ps1') -ArtifactPath (Join-Path $Root 'release')
& (Join-Path $PSScriptRoot 'generate-release-assets.ps1')
Write-Host "Windows 公开产物已生成：$PortableZip" -ForegroundColor Green
