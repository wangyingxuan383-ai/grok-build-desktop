param(
  [Parameter(Mandatory = $true)]
  [string]$Executable,
  [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"

function Escape-Xml([string]$Value) {
  return [System.Security.SecurityElement]::Escape($Value)
}

$resolvedExe = (Resolve-Path -LiteralPath $Executable).Path
$id = [Guid]::NewGuid().ToString("N")
$taskName = "Grok Build Desktop Probe $id"
$marker = Join-Path ([IO.Path]::GetTempPath()) "grok-build-desktop-scheduler-probe-$id.json"
$xmlPath = Join-Path ([IO.Path]::GetTempPath()) "grok-build-desktop-scheduler-probe-$id.xml"
$start = (Get-Date).AddMinutes(2).ToString("yyyy-MM-dd'T'HH:mm:ss")
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$arguments = '--scheduler-probe "{0}"' -f $marker

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Grok Build Desktop isolated scheduler probe</Description></RegistrationInfo>
  <Triggers><TimeTrigger><StartBoundary>$start</StartBoundary><Enabled>true</Enabled></TimeTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>$(Escape-Xml $user)</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT5M</ExecutionTimeLimit></Settings>
  <Actions Context="Author"><Exec><Command>$(Escape-Xml $resolvedExe)</Command><Arguments>$(Escape-Xml $arguments)</Arguments></Exec></Actions>
</Task>
"@

try {
  [IO.File]::WriteAllText($xmlPath, $xml, [Text.Encoding]::Unicode)
  & schtasks.exe /Create /TN $taskName /XML $xmlPath /F | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Task creation failed with exit code $LASTEXITCODE" }
  & schtasks.exe /Run /TN $taskName | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Task start failed with exit code $LASTEXITCODE" }

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while (-not (Test-Path -LiteralPath $marker) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
  if (-not (Test-Path -LiteralPath $marker)) { throw "Scheduled worker produced no marker within $TimeoutSeconds seconds" }
  $result = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
  if (-not $result.ok -or -not $result.pid) { throw "Scheduled worker marker is invalid" }
  Write-Host "Task Scheduler headless probe passed (PID $($result.pid))."
} finally {
  & schtasks.exe /Delete /TN $taskName /F 2>$null | Out-Null
  Remove-Item -LiteralPath $marker, $xmlPath -Force -ErrorAction SilentlyContinue
}
