[CmdletBinding()]
param(
    [switch]$SkipTests,
    [switch]$CreateShortcut
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

Write-Host '== Grok Build Desktop 构建环境预检 ==' -ForegroundColor Cyan
if ($PSVersionTable.PSVersion.Major -lt 5) { throw '需要 PowerShell 5.1 或更高版本。' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '未找到 Node.js。请安装 Node.js 24 LTS 后重试。' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw '未找到 npm。请重新安装 Node.js 24 LTS。' }
$NodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($NodeMajor -ne 24) { throw "当前 Node.js 主版本为 $NodeMajor；公开构建固定使用 Node.js 24 LTS。" }
if (-not [Environment]::Is64BitOperatingSystem) { throw '仅支持 Windows x64。' }

Write-Host '正在安装固定版本依赖…' -ForegroundColor Cyan
npm ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci 失败。' }

if (-not $SkipTests) { & (Join-Path $PSScriptRoot 'verify.ps1') }
# A contributor machine may have Task Scheduler disabled by organization or
# local policy. That must not discard an otherwise valid Setup/Portable build;
# release maintainers still run package-win.ps1 directly with the strict gate.
& (Join-Path $PSScriptRoot 'package-win.ps1') -SkipVerification:$SkipTests -AllowUnavailableTaskScheduler

if ($CreateShortcut) {
    & (Join-Path $PSScriptRoot 'create-shortcut.ps1')
    Write-Host '已按请求创建开发版桌面快捷方式。' -ForegroundColor Green
} else {
    Write-Host '未修改桌面。安装版可在安装向导中选择桌面快捷方式。' -ForegroundColor DarkGray
}
Write-Host '构建完成，产物位于 release 目录。' -ForegroundColor Green
