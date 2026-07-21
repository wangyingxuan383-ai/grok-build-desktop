[CmdletBinding()]
param([string]$Executable)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $Executable) { $Executable = Join-Path $repoRoot 'release\win-unpacked\Grok Build Desktop.exe' }
$Executable = [IO.Path]::GetFullPath($Executable)
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw "Executable not found: $Executable" }

$normalTitle = '"\u666e\u901a\u4f1a\u8bdd"' | ConvertFrom-Json
$taskTitle = '"\u5b9a\u65f6\u68c0\u67e5"' | ConvertFrom-Json
$codexTitle = '"\u539f Codex \u4f1a\u8bdd\u6807\u9898"' | ConvertFrom-Json
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$root = Join-Path $tempRoot ("Grok-Origin-Smoke-{0}" -f [guid]::NewGuid().ToString('N'))
$profile = Join-Path $root 'profile'
$homeRoot = Join-Path $root 'home'
$workspace = Join-Path $root 'Project Space'
$encoded = [uri]::EscapeDataString($workspace)
$sessionRoot = Join-Path $homeRoot ".grok\sessions\$encoded"
$process = $null

try {
    New-Item -ItemType Directory -Force -Path $profile, $workspace, (Join-Path $sessionRoot 'normal-session'), (Join-Path $sessionRoot 'task-session'), (Join-Path $sessionRoot 'codex-session'), (Join-Path $profile 'automations\tasks') | Out-Null
    foreach ($item in @(@('normal-session', $normalTitle), @('task-session', $taskTitle), @('codex-session', $codexTitle))) {
        $summary = @{ session_summary = $item[1]; created_at = '2026-07-21T00:00:00Z'; num_chat_messages = 2 } | ConvertTo-Json -Compress
        [IO.File]::WriteAllText((Join-Path $sessionRoot "$($item[0])\summary.json"), $summary, [Text.UTF8Encoding]::new($false))
    }
    [IO.File]::WriteAllText((Join-Path $profile 'settings.json'), (@{ activeWorkspace = $workspace } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $profile 'onboarding.json'), (@{ version = 1; completed = $true; skipped = $false; currentStep = 0 } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    $metadata = @{ renames = @{ 'task-session' = $taskTitle; 'codex-session' = $codexTitle }; unread = @{}; pinned = @{}; archived = @{}; parents = @{}; origins = @{ 'task-session' = @{ kind = 'automation'; id = 'task-fixture'; title = $taskTitle }; 'codex-session' = @{ kind = 'codex-continuation'; id = 'codex-fixture'; title = 'Codex relay' } } } | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText((Join-Path $profile 'session-metadata.json'), $metadata, [Text.UTF8Encoding]::new($false))
    $task = @{ id = 'task-fixture'; name = $taskTitle; workspace = $workspace; schedule = @{ kind = 'daily'; time = '09:00' }; profile = @{ modelId = 'grok-4.5'; effort = ''; mode = 'auto'; permissionPolicy = 'auto'; computerEnabled = $false }; enabled = $true; wakeToRun = $false; notify = $false; missedRunPolicy = 'skip'; contextPolicy = 'reuse'; sessionId = 'task-session'; promptPresent = $true; encryptedPrompt = 'unused'; sessionMigrationComplete = $true; registrationStatus = 'registered'; createdAt = '2026-07-21T00:00:00Z'; updatedAt = '2026-07-21T00:00:00Z' } | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText((Join-Path $profile 'automations\tasks\task-fixture.json'), $task, [Text.UTF8Encoding]::new($false))

    $port = Get-Random -Minimum 19000 -Maximum 25000
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Executable
    $info.WorkingDirectory = Split-Path -Parent $Executable
    $info.UseShellExecute = $false
    $info.Arguments = "--remote-debugging-port=$port --user-data-dir=`"$profile`""
    $info.EnvironmentVariables['GROK_DESKTOP_OFFLINE_SMOKE'] = '1'
    $info.EnvironmentVariables['USERPROFILE'] = $homeRoot
    $info.EnvironmentVariables['HOME'] = $homeRoot
    $process = [Diagnostics.Process]::Start($info)
    for ($attempt = 0; $attempt -lt 40 -and $process.MainWindowHandle -eq 0; $attempt++) { Start-Sleep -Milliseconds 300; $process.Refresh() }
    & node (Join-Path $PSScriptRoot 'probe-session-origin-ui.mjs') "http://127.0.0.1:$port"
    if ($LASTEXITCODE -ne 0) { throw 'Session-origin UI acceptance failed' }
} finally {
    if ($process -and -not $process.HasExited) { [void]$process.CloseMainWindow(); if (-not $process.WaitForExit(5000)) { $process.Kill() } }
    $resolved = [IO.Path]::GetFullPath($root)
    if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolved) -like 'Grok-Origin-Smoke-*' -and (Test-Path -LiteralPath $resolved -PathType Container)) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
