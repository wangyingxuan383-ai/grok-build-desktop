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
$LiveGateResults = [System.Collections.Generic.List[object]]::new()

function Add-LiveGateResult([string]$Name, [ValidateSet('passed', 'skipped', 'failed')][string]$Status, [string]$Detail) {
    [void]$LiveGateResults.Add([pscustomobject]@{ Name = $Name; Status = $Status; Detail = $Detail })
}

function Invoke-LiveGate([string]$Name, [string]$SuccessDetail, [scriptblock]$Action) {
    try {
        & $Action
        Add-LiveGateResult $Name 'passed' $SuccessDetail
    } catch {
        Add-LiveGateResult $Name 'failed' $_.Exception.Message
        throw
    }
}

function Write-LiveGateSummary {
    Write-Host ''
    Write-Host '== 真实环境门禁摘要 ==' -ForegroundColor Cyan
    foreach ($Result in $LiveGateResults) {
        $Color = if ($Result.Status -eq 'passed') { 'Green' } elseif ($Result.Status -eq 'failed') { 'Red' } else { 'Yellow' }
        Write-Host ("[{0}] {1}: {2}" -f $Result.Status.ToUpperInvariant(), $Result.Name, $Result.Detail) -ForegroundColor $Color
    }
}

function Add-DependentLiveSkips([string]$Reason) {
    $RequiredNames = @('CLI ACP', 'Plan 生命周期', 'Provider 回环传输', '当前 Provider 推理', '双会话并行启动', '双会话并行回合与队列/插话')
    foreach ($Name in $RequiredNames) {
        if (-not ($LiveGateResults | Where-Object { $_.Name -eq $Name })) {
            Add-LiveGateResult $Name 'skipped' $Reason
        }
    }
}

function Start-CapturedNode([string[]]$Arguments, [string]$StdoutPath, [string]$StderrPath) {
    $Node = (Get-Command node -ErrorAction Stop).Source
    $Info = [System.Diagnostics.ProcessStartInfo]::new()
    $Info.FileName = $Node
    $Info.Arguments = ($Arguments | ForEach-Object { '"' + ([string]$_).Replace('"', '\"') + '"' }) -join ' '
    $Info.UseShellExecute = $false
    $Info.CreateNoWindow = $true
    $Info.RedirectStandardOutput = $true
    $Info.RedirectStandardError = $true
    $Process = [System.Diagnostics.Process]::new()
    $Process.StartInfo = $Info
    if (-not $Process.Start()) { throw '无法启动并行 ACP 探针。' }
    [pscustomobject]@{
        Process = $Process
        StdoutPath = $StdoutPath
        StderrPath = $StderrPath
        StdoutTask = $Process.StandardOutput.ReadToEndAsync()
        StderrTask = $Process.StandardError.ReadToEndAsync()
    }
}

function Complete-CapturedNode([object]$Capture, [int]$TimeoutMilliseconds) {
    if (-not $Capture.Process.WaitForExit($TimeoutMilliseconds)) {
        if (-not $Capture.Process.HasExited) {
            if ($IsWindows -or $env:OS -eq 'Windows_NT') { & taskkill /PID $Capture.Process.Id /T /F *> $null } else { $Capture.Process.Kill() }
        }
        throw '并行 ACP 探针超时。'
    }
    $Stdout = $Capture.StdoutTask.GetAwaiter().GetResult()
    $Stderr = $Capture.StderrTask.GetAwaiter().GetResult()
    [IO.File]::WriteAllText($Capture.StdoutPath, $Stdout, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($Capture.StderrPath, $Stderr, [Text.UTF8Encoding]::new($false))
    if ($Capture.Process.ExitCode -ne 0) {
        throw "并行 ACP 探针失败（退出码 $($Capture.Process.ExitCode)）：$($Stderr.Trim())"
    }
}

function Invoke-ParallelSessionStartup([string]$CliPath, [string]$ScriptsRoot = $PSScriptRoot) {
    $Probe = Join-Path $ScriptsRoot 'probe-grok.mjs'
    $RunRoot = Join-Path ([IO.Path]::GetTempPath()) ("grok-v070-parallel-" + [Guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($RunRoot) | Out-Null
    $Captures = @()
    try {
        foreach ($Index in 1..2) {
            $Captures += Start-CapturedNode @($Probe, '--cli', $CliPath, '--cwd', (Join-Path $RunRoot "session-$Index"), '--effort', 'low') (Join-Path $RunRoot "session-$Index.out") (Join-Path $RunRoot "session-$Index.err")
        }
        foreach ($Capture in $Captures) { Complete-CapturedNode $Capture 180000 }
        $Payloads = foreach ($Capture in $Captures) { Get-Content -LiteralPath $Capture.StdoutPath -Raw | ConvertFrom-Json }
        if (@($Payloads | Where-Object { $_.ok -and $_.sessionId }).Count -ne 2) { throw '并行 ACP 探针没有返回两个独立会话。' }
        if (@($Payloads.sessionId | Select-Object -Unique).Count -ne 2) { throw '并行 ACP 探针返回了重复会话 ID。' }
    } finally {
        foreach ($Capture in $Captures) {
            if ($Capture.Process -and -not $Capture.Process.HasExited) {
                if ($IsWindows -or $env:OS -eq 'Windows_NT') { & taskkill /PID $Capture.Process.Id /T /F *> $null } else { $Capture.Process.Kill() }
            }
            if ($Capture.Process) { $Capture.Process.Dispose() }
        }
        Remove-Item -LiteralPath $RunRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host '== Grok Build Desktop 真实环境验收 ==' -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'verify.ps1') -SkipBuild:$SkipBuild

$LiveFailure = $null
try {
    if ($SkipLiveCli) {
        Add-DependentLiveSkips '调用者显式使用 -SkipLiveCli；这些结果不能作为完整真实验收证据。'
    } else {
        $Cli = Join-Path $HOME '.grok\bin\grok.exe'
        if (-not (Test-Path -LiteralPath $Cli -PathType Leaf)) {
            $Found = Get-Command grok -ErrorAction SilentlyContinue
            if ($Found) { $Cli = $Found.Source }
        }
        if (-not (Test-Path -LiteralPath $Cli -PathType Leaf)) {
            Add-LiveGateResult 'CLI ACP' 'failed' '未找到 Grok CLI；如需有意跳过，必须显式传入 -SkipLiveCli。'
            Add-DependentLiveSkips 'CLI 不可用，依赖它的真实门禁未执行。'
            throw 'Grok CLI was not found; live acceptance cannot pass.'
        }

        Invoke-LiveGate 'CLI ACP' 'initialize、session/new、媒体、扩展与 effort 握手通过。' {
            node (Join-Path $PSScriptRoot 'probe-grok.mjs') --cli $Cli --effort low --require-media --require-extensions --plugin-dir (Join-Path $Root 'resources\plugins\grok-computer-use')
            if ($LASTEXITCODE -ne 0) { throw 'Real Grok CLI ACP probe failed.' }
        }

        Invoke-LiveGate 'CLI 插件与兼容性' '官方 Marketplace、插件恢复、credits 当前周期额度及托管 Provider 配置探针通过。' {
            $AvailablePlugins = & $Cli --no-auto-update plugin list --available --json | ConvertFrom-Json
            if (-not ($AvailablePlugins | Where-Object { $_.name -in @('chrome-devtools', 'chrome-devtools-mcp') })) { throw 'Grok extension fallback probe did not find the official Chrome DevTools plugin.' }
            $Marketplaces = @(& $Cli --no-auto-update plugin marketplace list --json | ConvertFrom-Json)
            $Official = $Marketplaces | Where-Object { $_.name -eq 'xAI Official' -and $_.source.url } | Select-Object -First 1
            if (-not $Official) { throw 'The xAI Official plugin marketplace source was not found.' }
            $ResolvedCommit = (& git ls-remote ([string]$Official.source.url) HEAD 2>$null | Select-Object -First 1) -split '\s+' | Select-Object -First 1
            if ($LASTEXITCODE -ne 0 -or $ResolvedCommit -notmatch '^[0-9a-f]{40}$') { throw 'The xAI Official marketplace source could not be resolved to a fixed commit.' }
            Write-Host "Official marketplace source pinned for review: $ResolvedCommit" -ForegroundColor Green
            & (Join-Path $PSScriptRoot 'probe-plugin-restore.ps1') -GrokPath $Cli
            & (Join-Path $PSScriptRoot 'probe-v020-compatibility.ps1') -CliPath $Cli -RequireQuota
            & (Join-Path $PSScriptRoot 'probe-provider-cli.ps1') -CliPath $Cli
        }

        Invoke-LiveGate 'Provider 回环传输' '真实 CLI 经隔离配置到达本地 OpenAI-compatible SSE 端点。' {
            $PreviousProviderFlag = $env:GROK_LIVE_PROVIDER_PROBE
            try {
                $env:GROK_LIVE_PROVIDER_PROBE = '1'
                npx vitest run src/main/services/provider-cli-environment.live.test.ts --reporter verbose
                if ($LASTEXITCODE -ne 0) { throw 'Real loopback Provider transport acceptance failed.' }
            } finally {
                $env:GROK_LIVE_PROVIDER_PROBE = $PreviousProviderFlag
            }
        }

        if ($env:GROK_CURRENT_PROVIDER_PROBE -eq '1') {
            Invoke-LiveGate '当前 Provider 推理' '用户显式选择的当前 Provider 完成最小真实回合。' {
                npx vitest run src/main/services/provider-current.live.test.ts --reporter verbose
                if ($LASTEXITCODE -ne 0) { throw 'Current managed Provider live acceptance failed.' }
            }
        } else {
            Add-LiveGateResult '当前 Provider 推理' 'skipped' '未设置 GROK_CURRENT_PROVIDER_PROBE=1；未发送真实 Provider 推理请求。'
        }

        Invoke-LiveGate 'Plan 生命周期' '真实只读 Plan 回合无权限卡、无写入并正确结束。' {
            $PreviousPlanFlag = $env:GROK_RUN_PLAN_LIVE
            try {
                $env:GROK_RUN_PLAN_LIVE = '1'
                npx vitest run src/main/services/grok-plan-mode.live.test.ts --reporter verbose
                if ($LASTEXITCODE -ne 0) { throw 'Real Grok Plan lifecycle acceptance failed.' }
            } finally {
                $env:GROK_RUN_PLAN_LIVE = $PreviousPlanFlag
            }
        }

        Invoke-LiveGate '双会话并行启动' '两个独立 Grok ACP 进程同时完成 initialize/session/new/effort。' {
            Invoke-ParallelSessionStartup $Cli
        }
        Add-LiveGateResult '双会话并行回合与队列/插话' 'skipped' '当前自动化只验证并行 ACP 启动；真实双回合、队列和插话顺序仍需安装版实机验收。'

        if ($RequireLiveComputerAction) {
            Invoke-LiveGate 'Computer Use 实机动作' '真实视觉/风险动作验收通过。' {
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
            Add-LiveGateResult 'Computer Use 实机动作' 'skipped' '未传入 -RequireLiveComputerAction。'
        }
    }

    Invoke-LiveGate 'npm 安全审计' 'high 级别依赖审计通过。' {
        npm audit --audit-level=high
        if ($LASTEXITCODE -ne 0) { throw "npm 安全审计失败 ($LASTEXITCODE)" }
    }

    if (-not $SkipWindowSmoke) {
        $PackagedExe = Join-Path $Root 'release\win-unpacked\Grok Build Desktop.exe'
        if (Test-Path -LiteralPath $PackagedExe -PathType Leaf) {
            Invoke-LiveGate '打包窗口与任务调度' '打包窗口及 Task Scheduler 探针通过。' {
                & (Join-Path $PSScriptRoot 'smoke-app.ps1') -Executable $PackagedExe
                & (Join-Path $PSScriptRoot 'probe-task-scheduler.ps1') -Executable $PackagedExe
            }
        } else {
            Add-LiveGateResult '打包窗口与任务调度' 'skipped' 'release\win-unpacked 不存在。'
        }
    } else {
        Add-LiveGateResult '打包窗口与任务调度' 'skipped' '调用者显式使用 -SkipWindowSmoke。'
    }

    if ($RequirePackagedUi) {
        $PackagedExe = Join-Path $Root 'release\win-unpacked\Grok Build Desktop.exe'
        if (-not (Test-Path -LiteralPath $PackagedExe -PathType Leaf)) { throw 'Packaged executable is required for the v0.7.0 UI acceptance.' }
        Invoke-LiveGate '打包 v0.7 UI' '当前版本完整 UI 夹具通过。' {
            & (Join-Path $PSScriptRoot 'probe-v070-ui.ps1') -Executable $PackagedExe
            if ($LASTEXITCODE -ne 0) { throw 'Packaged v0.7.0 UI acceptance failed.' }
        }
    } else {
        Add-LiveGateResult '打包 v0.7 UI' 'skipped' '未传入 -RequirePackagedUi；离线 verify 仍已运行开发版 v0.7 UI 探针。'
    }
} catch {
    $LiveFailure = $_
    Add-DependentLiveSkips '更早的真实门禁失败，后续依赖项未执行。'
} finally {
    Write-LiveGateSummary
}

if ($LiveFailure) { throw $LiveFailure }
$SkippedCount = @($LiveGateResults | Where-Object { $_.Status -eq 'skipped' }).Count
if ($SkippedCount) {
    Write-Host "真实环境验收执行完成，但有 $SkippedCount 项显式跳过；本次结果不得标记为完整 live 通过。" -ForegroundColor Yellow
} else {
    Write-Host '真实环境验收全部通过。' -ForegroundColor Green
}
