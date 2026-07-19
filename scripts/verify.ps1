[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$PackageDirectory
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

Write-Host '== Grok Build Desktop 离线验证 ==' -ForegroundColor Cyan
Write-Host '此流程不会读取 auth.json、查询额度、切换插件或调用付费模型。' -ForegroundColor DarkGray

& (Join-Path $PSScriptRoot 'check-public-safety.ps1')
& (Join-Path $PSScriptRoot 'build-computer-host.ps1') -SelfTest
& (Join-Path $PSScriptRoot 'probe-computer-host.ps1')
& (Join-Path $PSScriptRoot 'probe-computer-flows.ps1')
node (Join-Path $PSScriptRoot 'ensure-electron.mjs')
if ($LASTEXITCODE -ne 0) { throw "Electron 二进制准备失败 ($LASTEXITCODE)" }
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw "类型检查失败 ($LASTEXITCODE)" }
npm test
if ($LASTEXITCODE -ne 0) { throw "自动化测试失败 ($LASTEXITCODE)" }
if (-not $SkipBuild) {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "生产构建失败 ($LASTEXITCODE)" }
}
npm audit --audit-level=high
if ($LASTEXITCODE -ne 0) { throw "npm 安全审计失败 ($LASTEXITCODE)" }

if ($PackageDirectory) {
    $env:APP_BUILD_PROFILE = 'public'
    npx electron-builder --win dir --x64 --publish never
    if ($LASTEXITCODE -ne 0) { throw '目录打包失败。' }
    node (Join-Path $PSScriptRoot 'verify-fuses.mjs') (Join-Path $Root 'release\win-unpacked\Grok Build Desktop.exe')
    if ($LASTEXITCODE -ne 0) { throw 'Electron Fuses 校验失败。' }
    & (Join-Path $PSScriptRoot 'check-public-safety.ps1') -ArtifactPath (Join-Path $Root 'release')
}

Write-Host '离线验证已通过。真实 CLI 与账号验收请显式运行 scripts\verify-live.ps1。' -ForegroundColor Green
