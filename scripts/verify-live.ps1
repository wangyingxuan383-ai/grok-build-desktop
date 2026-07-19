[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$SkipLiveCli,
    [switch]$SkipWindowSmoke,
    [switch]$RequireLiveComputerAction,
    [switch]$RequirePackagedUi
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

Write-Host '== Grok Build Desktop 真实环境验收 ==' -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'verify.ps1') -SkipBuild:$SkipBuild
if (-not $SkipLiveCli) {
    $Cli = Join-Path $HOME '.grok\bin\grok.exe'
    if (-not (Test-Path -LiteralPath $Cli -PathType Leaf)) {
        $Found = Get-Command grok -ErrorAction SilentlyContinue
        if ($Found) { $Cli = $Found.Source }
    }
    if (Test-Path -LiteralPath $Cli -PathType Leaf) {
        node (Join-Path $PSScriptRoot 'probe-grok.mjs') --cli $Cli --effort low --require-media --require-extensions --plugin-dir (Join-Path $Root 'resources\plugins\grok-computer-use')
        if ($LASTEXITCODE -ne 0) { throw 'Real Grok CLI ACP probe failed.' }
        $AvailablePlugins = & $Cli plugin list --available --json | ConvertFrom-Json
        if (-not ($AvailablePlugins | Where-Object { $_.name -in @('chrome-devtools', 'chrome-devtools-mcp') })) { throw 'Grok extension fallback probe did not find the official Chrome DevTools plugin.' }
        $Marketplaces = @(& $Cli plugin marketplace list --json | ConvertFrom-Json)
        $Official = $Marketplaces | Where-Object { $_.name -eq 'xAI Official' -and $_.source.url } | Select-Object -First 1
        if (-not $Official) { throw 'The xAI Official plugin marketplace source was not found.' }
        $ResolvedCommit = (& git ls-remote ([string]$Official.source.url) HEAD 2>$null | Select-Object -First 1) -split '\s+' | Select-Object -First 1
        if ($LASTEXITCODE -ne 0 -or $ResolvedCommit -notmatch '^[0-9a-f]{40}$') { throw 'The xAI Official marketplace source could not be resolved to a fixed commit.' }
        Write-Host "Official marketplace source pinned for review: $ResolvedCommit" -ForegroundColor Green
        & (Join-Path $PSScriptRoot 'probe-plugin-restore.ps1') -GrokPath $Cli
        & (Join-Path $PSScriptRoot 'probe-v020-compatibility.ps1') -CliPath $Cli -RequireQuota
        if ($RequireLiveComputerAction) {
            $PreviousLiveFlag = $env:GROK_LIVE_COMPUTER_ACTION
            try {
                $env:GROK_LIVE_COMPUTER_ACTION = '1'
                npx vitest run src/main/services/computer-use-live.test.ts --reporter verbose
                if ($LASTEXITCODE -ne 0) { throw 'Real Grok Computer Use visual/risk acceptance failed.' }
            } finally {
                $env:GROK_LIVE_COMPUTER_ACTION = $PreviousLiveFlag
            }
        }
    } else {
        Write-Warning 'Grok CLI was not found; live ACP probe skipped.'
    }
}
npm audit --audit-level=high
if ($LASTEXITCODE -ne 0) { throw "npm 安全审计失败 ($LASTEXITCODE)" }
if (-not $SkipWindowSmoke) {
    $PackagedExe = Join-Path $Root 'release\win-unpacked\Grok Build Desktop.exe'
    if (Test-Path -LiteralPath $PackagedExe -PathType Leaf) {
        & (Join-Path $PSScriptRoot 'smoke-app.ps1') -Executable $PackagedExe
    } else {
        Write-Host 'Packaged executable does not exist yet; window smoke test skipped.' -ForegroundColor Yellow
    }
}
if ($RequirePackagedUi) {
    $PackagedExe = Join-Path $Root 'release\win-unpacked\Grok Build Desktop.exe'
    if (-not (Test-Path -LiteralPath $PackagedExe -PathType Leaf)) { throw 'Packaged executable is required for the v0.3 UI acceptance.' }
    & (Join-Path $PSScriptRoot 'probe-v030-ui.ps1') -Executable $PackagedExe -LiveRisk:$RequireLiveComputerAction
}
Write-Host '真实环境验收已完成。' -ForegroundColor Green
