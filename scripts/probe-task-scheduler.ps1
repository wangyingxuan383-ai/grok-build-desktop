param(
  [Parameter(Mandatory = $true)]
  [string]$Executable,
  [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"

function Escape-Xml([string]$Value) {
  return [System.Security.SecurityElement]::Escape($Value)
}

function Invoke-Schtasks([string[]]$Arguments) {
  $scheduler = Join-Path $env:WINDIR 'System32\schtasks.exe'
  if (-not (Test-Path -LiteralPath $scheduler -PathType Leaf)) { throw "Task Scheduler executable not found: $scheduler" }
  # Windows PowerShell 5.1 promotes native stderr to ErrorRecord objects. Keep
  # native execution non-terminating here and make the exit code authoritative,
  # otherwise a best-effort cleanup can replace the real probe failure.
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = @(& $scheduler @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  return [pscustomobject]@{
    ExitCode = $exitCode
    Output = (($output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine).Trim()
  }
}

$resolvedExe = (Resolve-Path -LiteralPath $Executable).Path
$id = [Guid]::NewGuid().ToString("N")
$taskName = "Grok Build Desktop Probe $id"
$marker = Join-Path ([IO.Path]::GetTempPath()) "grok-build-desktop-scheduler-probe-$id.json"
$xmlPath = Join-Path ([IO.Path]::GetTempPath()) "grok-build-desktop-scheduler-probe-$id.xml"
$start = (Get-Date).AddMinutes(2).ToString("yyyy-MM-dd'T'HH:mm:ss")
$arguments = '--scheduler-probe "{0}"' -f $marker

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Grok Build Desktop isolated scheduler probe</Description></RegistrationInfo>
  <Triggers><TimeTrigger><StartBoundary>$start</StartBoundary><Enabled>true</Enabled></TimeTrigger></Triggers>
  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT5M</ExecutionTimeLimit></Settings>
  <Actions Context="Author"><Exec><Command>$(Escape-Xml $resolvedExe)</Command><Arguments>$(Escape-Xml $arguments)</Arguments></Exec></Actions>
</Task>
"@

$created = $false
$primaryFailure = $null
try {
  [IO.File]::WriteAllText($xmlPath, $xml, [Text.Encoding]::Unicode)
  $creation = Invoke-Schtasks @('/Create', '/TN', $taskName, '/XML', $xmlPath, '/F')
  if ($creation.ExitCode -ne 0) { throw "Task creation failed with exit code $($creation.ExitCode): $($creation.Output)" }
  $created = $true
  $startResult = Invoke-Schtasks @('/Run', '/TN', $taskName)
  if ($startResult.ExitCode -ne 0) { throw "Task start failed with exit code $($startResult.ExitCode): $($startResult.Output)" }

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while (-not (Test-Path -LiteralPath $marker) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
  if (-not (Test-Path -LiteralPath $marker)) { throw "Scheduled worker produced no marker within $TimeoutSeconds seconds" }
  $result = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
  if (-not $result.ok -or -not $result.pid) { throw "Scheduled worker marker is invalid" }
  Write-Host "Task Scheduler headless probe passed (PID $($result.pid))."
} catch {
  $primaryFailure = $_
}

$cleanupFailure = $null
if ($created) {
  try {
    $deletion = Invoke-Schtasks @('/Delete', '/TN', $taskName, '/F')
    if ($deletion.ExitCode -ne 0) { throw "Task cleanup failed with exit code $($deletion.ExitCode): $($deletion.Output)" }
  } catch {
    $cleanupFailure = $_
  }
}
Remove-Item -LiteralPath $marker, $xmlPath -Force -ErrorAction SilentlyContinue

if ($primaryFailure) {
  if ($cleanupFailure) { Write-Warning "任务调度探针清理也失败：$($cleanupFailure.Exception.Message)" }
  throw $primaryFailure
}
if ($cleanupFailure) { throw $cleanupFailure }
