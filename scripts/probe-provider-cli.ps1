param(
  [string]$CliPath = "$env:USERPROFILE\.grok\bin\grok.exe"
)

$ErrorActionPreference = "Stop"
$probeHome = Join-Path ([System.IO.Path]::GetTempPath()) ("grok-desktop-provider-probe-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $probeHome | Out-Null
$previousHome = $env:GROK_HOME
$previousKey = $env:GROK_DESKTOP_PROBE_KEY
$previousHeader = $env:GROK_DESKTOP_PROBE_HEADER
try {
  @'
[model."grok-desktop-probe"]
model = "upstream-probe"
base_url = "http://127.0.0.1:19876/v1"
name = "Grok Desktop Probe"
env_key = "GROK_DESKTOP_PROBE_KEY"
api_backend = "chat_completions"
context_window = 4096
max_completion_tokens = 1024
reasoning_efforts = [{ value = "low", label = "Low" }, { value = "high", label = "High" }]
extra_headers = { "X-Probe" = "${GROK_DESKTOP_PROBE_HEADER}" }
'@ | Set-Content -LiteralPath (Join-Path $probeHome "config.toml") -Encoding UTF8
  $env:GROK_HOME = $probeHome
  $env:GROK_DESKTOP_PROBE_KEY = "public-test-placeholder"
  $env:GROK_DESKTOP_PROBE_HEADER = "public-test-header"
  function Invoke-CliProbe([string[]]$Arguments) {
    $start = [System.Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $CliPath
    $start.Arguments = ($Arguments | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }) -join ' '
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $start
    if (-not $process.Start()) { throw "无法启动 Grok CLI 探针" }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(30000)) { $process.Kill(); throw "Grok CLI 探针超时：$($Arguments -join ' ')" }
    [pscustomobject]@{ ExitCode = $process.ExitCode; Out = $stdoutTask.GetAwaiter().GetResult(); Error = $stderrTask.GetAwaiter().GetResult() }
  }
  $inspect = Invoke-CliProbe @("inspect", "--json")
  if ($inspect.ExitCode -ne 0) { throw "inspect probe failed: $($inspect.Error)" }
  $version = Invoke-CliProbe @("version")
  $inspectJson = $inspect.Out | ConvertFrom-Json
  $warnings = @($inspectJson.modelOverrideWarnings | Where-Object { $null -ne $_ })
  [pscustomobject]@{
    cli = $version.Out.Trim()
    inspectAccepted = $true
    customModelAccepted = -not [bool]$warnings.Count
    warnings = $warnings
  } | ConvertTo-Json
}
finally {
  $env:GROK_HOME = $previousHome
  $env:GROK_DESKTOP_PROBE_KEY = $previousKey
  $env:GROK_DESKTOP_PROBE_HEADER = $previousHeader
  Remove-Item -LiteralPath $probeHome -Recurse -Force -ErrorAction SilentlyContinue
}
