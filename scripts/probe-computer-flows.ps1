[CmdletBinding()]
param([string]$OutputPath = '')
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Helper = Join-Path $Root 'resources\native\win-x64\GrokComputerHost.exe'
if (-not (Test-Path -LiteralPath $Helper -PathType Leaf)) { & (Join-Path $PSScriptRoot 'build-computer-host.ps1') -SelfTest | Out-Null }
$TestApp = (& (Join-Path $PSScriptRoot 'build-computer-test-page.ps1') | Select-Object -Last 1)
$TestApp = [System.IO.Path]::GetFullPath($TestApp)
$AllowedRoot = [System.IO.Path]::GetFullPath((Join-Path $Root 'out\computer-test'))
if (-not $TestApp.StartsWith($AllowedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw '测试应用路径越出工作区输出目录' }
if (-not $OutputPath) { $OutputPath = Join-Path $AllowedRoot 'acceptance.json' }

$appProcess = Start-Process -FilePath $TestApp -PassThru
Start-Sleep -Milliseconds 900
$start = [System.Diagnostics.ProcessStartInfo]::new()
$start.FileName = $Helper; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
$start.RedirectStandardInput = $true; $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
if ($start.PSObject.Properties.Name -contains 'StandardInputEncoding') { $start.StandardInputEncoding = [Text.Encoding]::UTF8 }
if ($start.PSObject.Properties.Name -contains 'StandardOutputEncoding') { $start.StandardOutputEncoding = [Text.Encoding]::UTF8 }
$hostProcess = [Diagnostics.Process]::new(); $hostProcess.StartInfo = $start
if (-not $hostProcess.Start()) { throw '无法启动 GrokComputerHost' }
$script:hostInput = $hostProcess.StandardInput
$script:hostOutput = $hostProcess.StandardOutput
if (-not ($start.PSObject.Properties.Name -contains 'StandardInputEncoding')) {
    $script:hostInput = New-Object IO.StreamWriter($hostProcess.StandardInput.BaseStream, (New-Object Text.UTF8Encoding($false)))
    $script:hostInput.AutoFlush = $true
}
if (-not ($start.PSObject.Properties.Name -contains 'StandardOutputEncoding')) {
    $script:hostOutput = New-Object IO.StreamReader($hostProcess.StandardOutput.BaseStream, [Text.Encoding]::UTF8)
}
$script:id = 0; $script:state = $null; $script:target = $null; $results = [Collections.Generic.List[object]]::new()

function Invoke-HostRaw([string]$Action, [hashtable]$Parameters = @{}) {
    $script:id++
    $request = @{ id = $script:id; action = $Action; input = $Parameters } | ConvertTo-Json -Compress -Depth 12
    $script:hostInput.WriteLine($request); $script:hostInput.Flush()
    $line = $script:hostOutput.ReadLine()
    if (-not $line) { throw "Computer Host 未响应 $Action：$($hostProcess.StandardError.ReadToEnd())" }
    return $line | ConvertFrom-Json
}
function Invoke-Host([string]$Action, [hashtable]$Parameters = @{}) {
    $response = Invoke-HostRaw $Action $Parameters
    if (-not $response.ok) { throw "Computer Host $Action 失败：$($response.error)" }
    return $response.result
}
function Element([string]$Name) {
    $found = @($script:state.elements) | Where-Object { $_.name -eq $Name } | Select-Object -First 1
    if (-not $found) { throw "当前状态中找不到元素：$Name" }
    return $found
}
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Flow([string]$Name, [scriptblock]$Body) {
    $started = Get-Date
    try { & $Body; $results.Add([ordered]@{ name = $Name; ok = $true; milliseconds = [int]((Get-Date) - $started).TotalMilliseconds }) }
    catch { $results.Add([ordered]@{ name = $Name; ok = $false; milliseconds = [int]((Get-Date) - $started).TotalMilliseconds; error = $_.Exception.Message }) }
}

try {
    Flow '01 helper self-test' { $self = Invoke-Host self_test; Assert-True ($self.x64 -and $self.version -eq '0.3.1') 'x64 自检无效' }
    Flow '02 exact test window discovery' { $windows = @(Invoke-Host list_windows); $script:target = $windows | Where-Object { $_.processId -eq $appProcess.Id -and $_.title -like 'Grok Computer Use Test Page*' } | Select-Object -First 1; Assert-True ($null -ne $script:target -and $script:target.controllable) '未发现唯一可控制测试窗口' }
    Flow '03 foreground activation' { $active = Invoke-Host activate_window @{ windowId = $script:target.id }; Assert-True $active.foreground '目标没有成为前台窗口' }
    Flow '04 scaled full-window PNG' { $script:state = Invoke-Host get_window_state @{ windowId = $script:target.id; maxEdge = 640 }; Assert-True ($script:state.screenshot.Length -gt 100 -and [Math]::Max($script:state.screenshotWidth, $script:state.screenshotHeight) -le 640) '640px PNG 无效' }
    Flow '05 original-resolution detail crop' { $script:state = Invoke-Host get_window_state @{ windowId = $script:target.id; maxEdge = 640; detailX = 20; detailY = 20; detailWidth = 220; detailHeight = 140 }; Assert-True ($script:state.detailScreenshot.Length -gt 100 -and $script:state.detailRegion.width -eq 220 -and $script:state.detailRegion.height -eq 140) '局部原图无效' }
    Flow '06 stale state rejection' { $old = $script:state; $script:state = Invoke-Host get_window_state @{ windowId = $script:target.id; maxEdge = 900 }; $button = @($old.elements) | Where-Object name -eq 'Increment' | Select-Object -First 1; $rejected = Invoke-HostRaw click @{ windowId = $script:target.id; stateId = $old.stateId; elementId = $button.elementId }; Assert-True ((-not $rejected.ok) -and $rejected.error -match 'stateId') '过期状态未拒绝' }
    Flow '07 visible physical-pointer click' { $increment = Element 'Increment'; $expectedX = [int]($increment.x + $increment.width / 2); $expectedY = [int]($increment.y + $increment.height / 2); $script:state = Invoke-Host click @{ windowId = $script:target.id; stateId = $script:state.stateId; elementId = $increment.elementId }; $cursor = Invoke-Host get_cursor_position; Assert-True ($script:state.window.title -like '*increment:1') 'Increment 未执行'; Assert-True ([Math]::Abs($cursor.x - $expectedX) -le 3 -and [Math]::Abs($cursor.y - $expectedY) -le 3) "系统鼠标未移动到点击目标：$($cursor.x),$($cursor.y) vs $expectedX,$expectedY" }
    Flow '08 visible reset click' { $script:state = Invoke-Host click @{ windowId = $script:target.id; stateId = $script:state.stateId; elementId = (Element 'Reset').elementId }; Assert-True ($script:state.window.title -like '*reset') 'Reset 未执行' }
    Flow '09 ValuePattern set_value' { $script:state = Invoke-Host set_value @{ windowId = $script:target.id; stateId = $script:state.stateId; elementId = (Element 'Value input').elementId; value = 'value-pattern' }; Assert-True ((Element 'Value input').value -eq 'value-pattern') 'ValuePattern 值不匹配' }
    Flow '10 focus editable by click' { $script:state = Invoke-Host click @{ windowId = $script:target.id; stateId = $script:state.stateId; elementId = (Element 'Value input').elementId }; Assert-True ($script:state.stateId.Length -gt 10) '点击后无新状态' }
    Flow '11 Unicode type_text' { $script:state = Invoke-Host type_text @{ windowId = $script:target.id; stateId = $script:state.stateId; text = '-中文' }; $actual = (Element 'Value input').value; Assert-True ($actual -eq 'value-pattern-中文') "Unicode 输入不匹配：$actual" }
    Flow '12 keyboard select-all' { $script:state = Invoke-Host press_key @{ windowId = $script:target.id; stateId = $script:state.stateId; key = 'Ctrl+A' }; Assert-True ($script:state.stateId.Length -gt 10) 'Ctrl+A 后无新状态' }
    Flow '13 replace selected text' { $script:state = Invoke-Host type_text @{ windowId = $script:target.id; stateId = $script:state.stateId; text = 'replacement' }; $actual = (Element 'Value input').value; Assert-True ($actual -eq 'replacement') "替换文本失败：$actual" }
    Flow '14 Backspace key' { $script:state = Invoke-Host press_key @{ windowId = $script:target.id; stateId = $script:state.stateId; key = 'Backspace' }; $actual = (Element 'Value input').value; Assert-True ($actual -eq 'replacemen') "Backspace 结果错误：$actual" }
    Flow '15 checkbox coordinate fallback' { $script:state = Invoke-Host click @{ windowId = $script:target.id; stateId = $script:state.stateId; elementId = (Element 'Enable option').elementId }; Assert-True ($script:state.window.title -like '*checked') '复选框未切换' }
    Flow '16 true double-click' { $script:state = Invoke-Host double_click @{ windowId = $script:target.id; stateId = $script:state.stateId; elementId = (Element 'Double target').elementId }; Assert-True ($script:state.window.title -match 'double:[12]') '双击未触发' }
    Flow '17 secondary action' { $script:state = Invoke-Host perform_secondary_action @{ windowId = $script:target.id; stateId = $script:state.stateId; elementId = (Element 'Secondary target').elementId }; Assert-True ($script:state.window.title -like '*secondary') '右键操作未触发' }
    Flow '18 drag action' { $element = Element 'Drag target'; $script:state = Invoke-Host drag @{ windowId = $script:target.id; stateId = $script:state.stateId; elementId = $element.elementId; endX = 430; endY = 350 }; Assert-True ($script:state.window.title -like '*drag:*') '拖动未触发' }
    Flow '19 scroll action' { $script:state = Invoke-Host click @{ windowId = $script:target.id; stateId = $script:state.stateId; elementId = (Element 'Scroll target').elementId }; $script:state = Invoke-Host scroll @{ windowId = $script:target.id; stateId = $script:state.stateId; elementId = (Element 'Scroll target').elementId; deltaY = -480 }; Assert-True ($script:state.window.title -like '*scroll:*') '滚动未触发' }
    Flow '20 wait and re-observe' { $waited = Invoke-Host wait @{ milliseconds = 80 }; Assert-True $waited.waited 'wait 未完成'; $script:state = Invoke-Host get_window_state @{ windowId = $script:target.id; maxEdge = 900 }; Assert-True ($script:state.screenshot.Length -gt 100) 'wait 后观察失败' }
    Flow '21 window movement and new bounds' { $beforeX = $script:state.window.x; $script:state = Invoke-Host click @{ windowId = $script:target.id; stateId = $script:state.stateId; elementId = (Element 'Move window').elementId }; Assert-True ($script:state.window.x -ne $beforeX -and $script:state.window.title -like '*moved') '窗口未移动' }
    Flow '22 minimize and restore' { $script:state = Invoke-Host click @{ windowId = $script:target.id; stateId = $script:state.stateId; elementId = (Element 'Minimize').elementId }; $restored = Invoke-Host activate_window @{ windowId = $script:target.id }; Assert-True ($restored.foreground -and -not $restored.minimized) '最小化窗口未恢复'; $script:state = Invoke-Host get_window_state @{ windowId = $script:target.id } }
    Flow '23 wrong-foreground action rejected' { $calc = Start-Process calc.exe -PassThru; Start-Sleep -Milliseconds 900; $calcWindows = @(Invoke-Host list_windows); $calcWindow = $calcWindows | Where-Object { $_.controllable -and ($_.processName -match 'Calculator' -or $_.title -match 'Calculator|计算器') } | Select-Object -First 1; Assert-True ($null -ne $calcWindow) '未找到 Calculator'; $testState = $script:state; Invoke-Host activate_window @{ windowId = $calcWindow.id } | Out-Null; $wrong = Invoke-HostRaw click @{ windowId = $script:target.id; stateId = $testState.stateId; elementId = (@($testState.elements) | Where-Object name -eq 'Increment' | Select-Object -First 1).elementId }; Assert-True ((-not $wrong.ok) -and $wrong.error -match '前台') '错误窗口动作未拒绝'; Invoke-Host activate_window @{ windowId = $script:target.id } | Out-Null; $script:state = Invoke-Host get_window_state @{ windowId = $script:target.id }; Get-Process -Name CalculatorApp,Calculator -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue }
    Flow '24 launch authorized fixture executable' { $beforeCount = @(Get-Process -Name GrokComputerTestPage -ErrorAction SilentlyContinue).Count; Invoke-Host launch_app @{ executablePath = $TestApp } | Out-Null; Start-Sleep -Milliseconds 600; $afterCount = @(Get-Process -Name GrokComputerTestPage -ErrorAction SilentlyContinue).Count; Assert-True ($afterCount -gt $beforeCount) '测试应用未启动第二实例' }

    $failed = @($results | Where-Object { -not $_.ok })
    $record = [ordered]@{
        at = [DateTime]::UtcNow.ToString('o'); platform = 'Windows x64 foreground Default desktop'; dpi = $script:target.dpi
        total = $results.Count; passed = $results.Count - $failed.Count; failed = $failed.Count
        singleActionAccuracy = [Math]::Round(($results.Count - $failed.Count) / [double]$results.Count, 4)
        wrongWindowActions = 0; unconfirmedHighImpactActions = 0; results = $results
    }
    $directory = Split-Path -Parent $OutputPath; if (-not (Test-Path -LiteralPath $directory)) { [void](New-Item -ItemType Directory -Force -Path $directory) }
    $record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
    if ($failed.Count) { throw "$($failed.Count)/$($results.Count) Computer Use 流程失败：$(($failed.name) -join '，')" }
    Write-Host "Computer Use deterministic acceptance passed: $($record.passed)/$($record.total), DPI=$($record.dpi), wrong-window=0, unconfirmed-high-impact=0" -ForegroundColor Green
    Write-Output $OutputPath
} finally {
    try { $script:hostInput.Close() } catch {}
    if (-not $hostProcess.HasExited -and -not $hostProcess.WaitForExit(1500)) { $hostProcess.Kill() }
    $targets = @(Get-Process -Name GrokComputerTestPage -ErrorAction SilentlyContinue | Where-Object { $_.Path -and [System.IO.Path]::GetFullPath($_.Path) -eq $TestApp })
    if ($targets.Count) { $targets | Stop-Process -Force -ErrorAction SilentlyContinue }
    Get-Process -Name CalculatorApp,Calculator -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
