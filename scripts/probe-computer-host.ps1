[CmdletBinding()]
param([switch]$RunSafeAction)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Helper = Join-Path $Root 'resources\native\win-x64\GrokComputerHost.exe'
if (-not (Test-Path -LiteralPath $Helper -PathType Leaf)) { & (Join-Path $PSScriptRoot 'build-computer-host.ps1') -SelfTest | Out-Null }

$alreadyRunning = @(Get-Process -Name CalculatorApp,Calculator -ErrorAction SilentlyContinue).Count -gt 0
if ($RunSafeAction -and -not $alreadyRunning) { Start-Process calc.exe; Start-Sleep -Milliseconds 1200 }

$start = [System.Diagnostics.ProcessStartInfo]::new()
$start.FileName = $Helper
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardInput = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
if ($start.PSObject.Properties.Name -contains 'StandardInputEncoding') { $start.StandardInputEncoding = [System.Text.Encoding]::UTF8 }
if ($start.PSObject.Properties.Name -contains 'StandardOutputEncoding') { $start.StandardOutputEncoding = [System.Text.Encoding]::UTF8 }
$process = [System.Diagnostics.Process]::new(); $process.StartInfo = $start
if (-not $process.Start()) { throw '无法启动 GrokComputerHost' }
$script:hostInput = $process.StandardInput
$script:hostOutput = $process.StandardOutput
if (-not ($start.PSObject.Properties.Name -contains 'StandardInputEncoding')) {
    $script:hostInput = New-Object IO.StreamWriter($process.StandardInput.BaseStream, (New-Object Text.UTF8Encoding($false)))
    $script:hostInput.AutoFlush = $true
}
if (-not ($start.PSObject.Properties.Name -contains 'StandardOutputEncoding')) {
    $script:hostOutput = New-Object IO.StreamReader($process.StandardOutput.BaseStream, [Text.Encoding]::UTF8)
}
$script:id = 0
function Invoke-HostAction([string]$Action, [hashtable]$Parameters = @{}) {
    $script:id++
    $request = @{ id = $script:id; action = $Action; input = $Parameters } | ConvertTo-Json -Compress -Depth 8
    $script:hostInput.WriteLine($request); $script:hostInput.Flush()
    $line = $script:hostOutput.ReadLine()
    if (-not $line) { throw "Computer Host 未响应 $Action：$($process.StandardError.ReadToEnd())" }
    $response = $line | ConvertFrom-Json
    if (-not $response.ok) { throw "Computer Host $Action 失败：$($response.error)" }
    return $response.result
}

try {
    $self = Invoke-HostAction self_test
    if (-not $self.x64) { throw 'Computer Host 不是 x64' }
    $windows = @(Invoke-HostAction list_windows)
    if (-not $RunSafeAction) { Write-Host "Computer Host probe passed: $($windows.Count) visible windows" -ForegroundColor Green; return }
    $target = $windows | Where-Object { $_.controllable -and ($_.processName -match 'Calculator' -or $_.title -match 'Calculator|计算器') } | Select-Object -First 1
    if (-not $target) { throw '未找到可控制的 Calculator 窗口' }
    Invoke-HostAction activate_window @{ windowId = $target.id } | Out-Null
    $before = Invoke-HostAction get_window_state @{ windowId = $target.id; maxEdge = 1600 }
    if (-not $before.stateId -or $before.screenshot.Length -lt 100 -or $before.screenshotWidth -lt 1 -or $before.screenshotHeight -lt 1 -or $before.coordinateSpace -ne 'screenshot-pixels') { throw 'Calculator 初始状态、坐标空间或 PNG 截图无效' }
    $button = @($before.elements) | Where-Object { $_.controlType -eq 'Button' -and $_.enabled -and $_.name -match '^(1|One|一)$' } | Select-Object -First 1
    if (-not $button) { $button = @($before.elements) | Where-Object { $_.controlType -eq 'Button' -and $_.enabled } | Select-Object -First 1 }
    if (-not $button) { throw 'Calculator UIA 树没有可操作按钮' }
    $after = Invoke-HostAction click @{ windowId = $target.id; stateId = $before.stateId; elementId = $button.elementId; maxEdge = 1600 }
    if (-not $after.stateId -or $after.stateId -eq $before.stateId -or $after.screenshot.Length -lt 100) { throw '单步动作后没有返回新的状态与 PNG' }
    $script:id++
    $staleRequest = @{ id = $script:id; action = 'click'; input = @{ windowId = $target.id; stateId = $before.stateId; elementId = $button.elementId; maxEdge = 1600 } } | ConvertTo-Json -Compress -Depth 8
    $script:hostInput.WriteLine($staleRequest); $script:hostInput.Flush()
    $stale = $script:hostOutput.ReadLine() | ConvertFrom-Json
    if ($stale.ok -or $stale.error -notmatch 'stateId') { throw '过期 stateId 未被辅助程序拒绝' }
    Write-Host "Computer Host Calculator loop passed: DPI=$($after.window.dpi), elements=$(@($after.elements).Count), action=$($button.name)" -ForegroundColor Green
} finally {
    try { $script:hostInput.Close() } catch {}
    if (-not $process.WaitForExit(1500)) { $process.Kill() }
    if ($RunSafeAction -and -not $alreadyRunning) { Get-Process -Name CalculatorApp,Calculator -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue }
}
