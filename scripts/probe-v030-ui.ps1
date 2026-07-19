[CmdletBinding()]
param(
    [string]$Executable = (Join-Path (Split-Path -Parent $PSScriptRoot) 'release\win-unpacked\Grok Build Desktop.exe'),
    [int]$Port = 9332,
    [switch]$LiveRisk
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Executable = [IO.Path]::GetFullPath($Executable)
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw "Executable not found: $Executable" }
if (Get-Process -Name 'Grok Build Desktop' -ErrorAction SilentlyContinue) { throw 'Close the running Grok Build Desktop instance before the v0.3 UI probe.' }
$TestApp = [IO.Path]::GetFullPath((& (Join-Path $PSScriptRoot 'build-computer-test-page.ps1') | Select-Object -Last 1))
$Helper = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $Executable) 'resources\native\win-x64\GrokComputerHost.exe'))
if (-not (Test-Path -LiteralPath $Helper -PathType Leaf)) { throw "Packaged Computer Host not found: $Helper" }
$Fixture = [IO.Path]::GetFullPath((Join-Path $Root 'out\e2e-plugin'))
$LiveRiskWorkspace = [IO.Path]::GetFullPath((Join-Path $Root 'out\e2e-live-risk-workspace'))
$AllowedOut = [IO.Path]::GetFullPath((Join-Path $Root 'out'))
if (-not $Fixture.StartsWith($AllowedOut, [StringComparison]::OrdinalIgnoreCase)) { throw 'E2E fixture path escaped the workspace output directory.' }
if (Test-Path -LiteralPath $Fixture) { Remove-Item -LiteralPath $Fixture -Recurse -Force }
if ($LiveRisk -and (Test-Path -LiteralPath $LiveRiskWorkspace)) { Remove-Item -LiteralPath $LiveRiskWorkspace -Recurse -Force }
[void](New-Item -ItemType Directory -Force -Path (Join-Path $Fixture 'skills\preview-skill'),(Join-Path $Fixture 'hooks'))
if ($LiveRisk) { [void](New-Item -ItemType Directory -Force -Path $LiveRiskWorkspace) }
'{"name":"e2e-preview","version":"1.0.0","license":"MIT","mcpServers":{"fixture":{}},"hooks":{"on-turn":{}}}' | Set-Content -LiteralPath (Join-Path $Fixture 'plugin.json') -Encoding UTF8
"---`nname: preview-skill`ndescription: Static preview fixture.`n---`n" | Set-Content -LiteralPath (Join-Path $Fixture 'skills\preview-skill\SKILL.md') -Encoding UTF8
'Write-Output "This file must never be executed by preview."' | Set-Content -LiteralPath (Join-Path $Fixture 'demo.ps1') -Encoding UTF8
$appProcess = Start-Process -FilePath $TestApp -PassThru
$info = [Diagnostics.ProcessStartInfo]::new(); $info.FileName = $Executable; $info.WorkingDirectory = Split-Path -Parent $Executable; $info.UseShellExecute = $false
[void]$info.ArgumentList.Add("--remote-debugging-port=$Port")
$desktopProcess = [Diagnostics.Process]::Start($info)
try {
    $nodeArguments = @((Join-Path $PSScriptRoot 'probe-v030-ui.mjs'), '--port', [string]$Port, '--plugin', $Fixture, '--helper', $Helper)
    if ($LiveRisk) { $nodeArguments += @('--live-risk-workspace', $LiveRiskWorkspace) }
    $nodeOutput = @(& node @nodeArguments 2>&1)
    $nodeExit = $LASTEXITCODE
    $nodeOutput | ForEach-Object { Write-Host $_ }
    if ($nodeExit -ne 0) { throw "v0.3 Electron UI probe failed ($nodeExit)." }
    $jsonLine = $nodeOutput | Where-Object { [string]$_ -match '^\{"ok":true' } | Select-Object -Last 1
    if (-not $jsonLine) { throw 'v0.3 Electron UI probe did not return acceptance JSON.' }
    $evidencePath = Join-Path $Root 'out\computer-test\ui-acceptance.json'
    [IO.File]::WriteAllText($evidencePath, ([string]$jsonLine + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    Write-Host 'v0.3 Electron UI acceptance passed.' -ForegroundColor Green
} finally {
    if ($desktopProcess -and -not $desktopProcess.HasExited) { [void]$desktopProcess.CloseMainWindow(); if (-not $desktopProcess.WaitForExit(5000)) { $desktopProcess.Kill() } }
    $testTargets = @(Get-Process -Name GrokComputerTestPage -ErrorAction SilentlyContinue | Where-Object { $_.Path -and [IO.Path]::GetFullPath($_.Path) -eq $TestApp })
    if ($testTargets.Count) { $testTargets | Stop-Process -Force -ErrorAction SilentlyContinue }
    if ($Fixture.StartsWith($AllowedOut, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $Fixture)) { Remove-Item -LiteralPath $Fixture -Recurse -Force }
    if ($LiveRiskWorkspace.StartsWith($AllowedOut, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $LiveRiskWorkspace)) { Remove-Item -LiteralPath $LiveRiskWorkspace -Recurse -Force }
    $GrokWorkspaceHistory = Join-Path (Join-Path $HOME '.grok\sessions') ([Uri]::EscapeDataString($LiveRiskWorkspace))
    if (Test-Path -LiteralPath $GrokWorkspaceHistory -PathType Container) {
        $HistoryChildren = @(Get-ChildItem -LiteralPath $GrokWorkspaceHistory -Force)
        if (-not ($HistoryChildren | Where-Object { $_.PSIsContainer -or $_.Name -ne 'prompt_history.jsonl' })) {
            $PromptHistory = Join-Path $GrokWorkspaceHistory 'prompt_history.jsonl'
            if (Test-Path -LiteralPath $PromptHistory -PathType Leaf) { Remove-Item -LiteralPath $PromptHistory -Force }
            Remove-Item -LiteralPath $GrokWorkspaceHistory -Force
        }
    }
}
