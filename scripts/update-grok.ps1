[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$CheckOnly,
    [switch]$StopAllGrokProcesses,
    [string]$Version = '',
    [string]$CliPath = '',
    [string]$ProbeWorkspace = (Join-Path $env:TEMP 'grok-build-desktop-update-probe')
)

$ErrorActionPreference = 'Stop'
$HistoryPath = Join-Path $env:APPDATA 'Grok Build Desktop\cli-update-history.jsonl'

function Add-UpdateHistory {
    param([string]$Status, [string]$From, [string]$To, [string]$Message)
    $Directory = Split-Path -Parent $HistoryPath
    if (-not (Test-Path -LiteralPath $Directory)) { [void](New-Item -ItemType Directory -Path $Directory -Force) }
    $SafeMessage = $Message -replace '(?i)(authorization\s*[:=]\s*bearer\s+)\S+', '$1[REDACTED]' -replace '(?i)\b(?:sk|xai)-[A-Za-z0-9_-]{12,}\b', '[REDACTED_API_KEY]'
    $Record = [ordered]@{ at = [DateTime]::UtcNow.ToString('o'); from = $From; to = $To; status = $Status; message = $SafeMessage }
    Add-Content -LiteralPath $HistoryPath -Value ($Record | ConvertTo-Json -Compress) -Encoding UTF8
}

function Resolve-GrokCli {
    param([string]$Configured)
    if ($Configured -and (Test-Path -LiteralPath $Configured -PathType Leaf)) {
        return [System.IO.Path]::GetFullPath($Configured)
    }
    $Default = Join-Path $HOME '.grok\bin\grok.exe'
    if (Test-Path -LiteralPath $Default -PathType Leaf) { return $Default }
    $Command = Get-Command grok -ErrorAction SilentlyContinue
    if ($Command) { return $Command.Source }
    throw 'Grok CLI was not found.'
}

function Invoke-GrokCapture {
    param([string]$Executable, [string[]]$Arguments, [int]$TimeoutSeconds = 120)
    $Psi = New-Object System.Diagnostics.ProcessStartInfo
    $Psi.FileName = $Executable
    $Psi.UseShellExecute = $false
    $Psi.CreateNoWindow = $true
    $Psi.RedirectStandardOutput = $true
    $Psi.RedirectStandardError = $true
    foreach ($Argument in $Arguments) { [void]$Psi.ArgumentList.Add($Argument) }
    $Process = New-Object System.Diagnostics.Process
    $Process.StartInfo = $Psi
    [void]$Process.Start()
    $StdoutTask = $Process.StandardOutput.ReadToEndAsync()
    $StderrTask = $Process.StandardError.ReadToEndAsync()
    if (-not $Process.WaitForExit($TimeoutSeconds * 1000)) {
        $Process.Kill($true)
        throw "Timed out: $Executable $($Arguments -join ' ')"
    }
    $Stdout = $StdoutTask.GetAwaiter().GetResult()
    $Stderr = $StderrTask.GetAwaiter().GetResult()
    if ($Process.ExitCode -ne 0) { throw "$Stdout`n$Stderr" }
    return $Stdout.Trim()
}

function Test-GrokCli {
    param([string]$Executable)
    $VersionJson = Invoke-GrokCapture $Executable @('version', '--json') 30
    [void]($VersionJson | ConvertFrom-Json)
    $Models = Invoke-GrokCapture $Executable @('models') 60
    if (-not $Models) { throw 'grok models returned no output.' }
    $ProbeScript = Join-Path $PSScriptRoot 'probe-grok.mjs'
    $ProbeResult = & node $ProbeScript --cli $Executable --cwd $ProbeWorkspace --effort low 2>&1
    if ($LASTEXITCODE -ne 0) { throw "ACP initialize/session/new probe failed: $ProbeResult" }
    $ProbeJson = ($ProbeResult | Select-Object -Last 1) | ConvertFrom-Json
    if (-not $ProbeJson.ok) { throw 'ACP initialize/session/new probe did not report success.' }
    # Optional extension failures must not roll back an otherwise ACP-compatible
    # CLI. They are diagnosed separately and the app disables only that surface.
    try {
        $Root = Split-Path -Parent $PSScriptRoot
        $ComputerPlugin = Join-Path $Root 'resources\plugins\grok-computer-use'
        if (-not (Test-Path -LiteralPath $ComputerPlugin -PathType Container)) { throw 'Built-in Computer Use plugin directory is missing.' }
        $ExtensionProbe = & node $ProbeScript --cli $Executable --cwd $ProbeWorkspace --require-extensions --plugin-dir $ComputerPlugin 2>&1
        if ($LASTEXITCODE -ne 0) { throw "pluginDirs/extension probe failed: $ExtensionProbe" }
        $ExtensionJson = ($ExtensionProbe | Select-Object -Last 1) | ConvertFrom-Json
        if (-not $ExtensionJson.extensionProbe.computerCommand) { throw 'Built-in /computer Skill was not published.' }
        & (Join-Path $PSScriptRoot 'probe-plugin-restore.ps1') -GrokPath $Executable | Write-Host
        Write-Host 'Optional Computer Use pluginDirs probe passed.' -ForegroundColor Green
    } catch {
        Write-Warning "Optional plugin/Computer Use compatibility probe failed: $($_.Exception.Message)"
    }
    try {
        & (Join-Path $PSScriptRoot 'build-computer-host.ps1') -SelfTest | Write-Host
        & (Join-Path $PSScriptRoot 'probe-computer-host.ps1') | Write-Host
        & (Join-Path $PSScriptRoot 'probe-computer-flows.ps1') | Write-Host
    } catch {
        Write-Warning "Optional Computer Host compatibility probe failed: $($_.Exception.Message)"
    }
    try {
        & (Join-Path $PSScriptRoot 'probe-v020-compatibility.ps1') -CliPath $Executable | Write-Host
    } catch {
        Write-Warning "Optional Codex reader/quota compatibility probe failed: $($_.Exception.Message)"
    }
    return $true
}

$Cli = Resolve-GrokCli $CliPath
$Before = (Invoke-GrokCapture $Cli @('version', '--json') 30 | ConvertFrom-Json).currentVersion
$StatusJson = Invoke-GrokCapture $Cli @('update', '--check', '--json') 60
$Status = $StatusJson | ConvertFrom-Json
$Status | ConvertTo-Json -Depth 5
Add-UpdateHistory 'checked' ([string]$Status.currentVersion) ([string]$Status.latestVersion) ($(if ($Status.updateAvailable) { '发现可用更新' } else { '已是最新版本' }))

if ($CheckOnly -or ((-not $Version) -and (-not $Status.updateAvailable))) {
    Write-Host "No update applied. Current version: $Before" -ForegroundColor Green
    return
}

$OldVersion = ([regex]::Match([string]$Before, '\d+\.\d+\.\d+')).Value
$UpdateArguments = @('update')
if ($Version) { $UpdateArguments += @('--version', $Version) }

$TargetVersion = if ($Version) { $Version } else { 'latest' }
if (-not $PSCmdlet.ShouldProcess($Cli, "Install Grok CLI $TargetVersion")) { return }

try {
    $RunningGrok = @(Get-Process -Name 'grok' -ErrorAction SilentlyContinue)
    if ($RunningGrok.Count -gt 0) {
        if (-not $StopAllGrokProcesses) {
            throw "检测到 $($RunningGrok.Count) 个 Grok 进程。请先关闭 Grok Build Desktop/VS Code 中的 Grok 任务，或明确传入 -StopAllGrokProcesses。"
        }
        $RunningGrok | Stop-Process -Force
        Start-Sleep -Milliseconds 800
    }
    [void](Invoke-GrokCapture $Cli $UpdateArguments 300)
    [void](Test-GrokCli $Cli)
    $After = (Invoke-GrokCapture $Cli @('version', '--json') 30 | ConvertFrom-Json).currentVersion
    Add-UpdateHistory 'updated' ([string]$Before) ([string]$After) '更新后 models 与 ACP initialize/session/new 验证通过'
    Write-Host "Grok CLI update verified: $Before -> $After" -ForegroundColor Green
} catch {
    $Failure = $_.Exception.Message
    Write-Warning "Update validation failed: $Failure"
    if (-not $OldVersion) { throw }
    Write-Host "Rolling back to $OldVersion ..." -ForegroundColor Yellow
    try {
        [void](Invoke-GrokCapture $Cli @('update', '--version', $OldVersion) 300)
        [void](Test-GrokCli $Cli)
        Add-UpdateHistory 'rolled-back' '' $OldVersion "新版本验证失败，已回滚：$Failure"
        throw "Update failed and Grok CLI was rolled back to $OldVersion. Cause: $Failure"
    } catch {
        if ($_.Exception.Message -like 'Update failed and Grok CLI was rolled back*') { throw }
        Add-UpdateHistory 'failed' ([string]$Before) '' "更新与回滚均失败：$($_.Exception.Message)"
        throw
    }
}
