[CmdletBinding()]
param(
  [string]$GrokPath = "$env:USERPROFILE\.grok\bin\grok.exe",
  [string]$PluginName = "chrome-devtools-mcp"
)

$ErrorActionPreference = "Stop"
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$outRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot "out\computer-test"))
if (-not $outRoot.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to write plugin acceptance outside the repository"
}
New-Item -ItemType Directory -Force -Path $outRoot | Out-Null
$reportPath = Join-Path $outRoot "plugin-acceptance.json"

if (-not (Test-Path -LiteralPath $GrokPath -PathType Leaf)) {
  throw "Grok CLI was not found: $GrokPath"
}

function Invoke-GrokJson {
  param([string[]]$Arguments)
  $raw = & $GrokPath @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "grok $($Arguments -join ' ') failed: $($raw -join [Environment]::NewLine)"
  }
  return ($raw -join [Environment]::NewLine | ConvertFrom-Json)
}

function Invoke-GrokMutation {
  param([string[]]$Arguments)
  $raw = & $GrokPath @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "grok $($Arguments -join ' ') failed: $($raw -join [Environment]::NewLine)"
  }
  return ($raw -join [Environment]::NewLine).Trim()
}

function Get-Plugin {
  $plugins = @(Invoke-GrokJson -Arguments @("plugin", "list", "--json"))
  return $plugins | Where-Object { $_.name -eq $PluginName } | Select-Object -First 1
}

function Test-PluginDisabled {
  $configPath = Join-Path $env:USERPROFILE ".grok\config.toml"
  if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { return $false }
  $disabledLine = Get-Content -LiteralPath $configPath | Where-Object { $_ -match '^\s*disabled\s*=' } | Select-Object -First 1
  if (-not $disabledLine) { return $false }
  return [bool]([regex]::Match($disabledLine, '(?i)["'']' + [regex]::Escape($PluginName) + '["'']').Success)
}

function Get-Commit {
  param([object]$Plugin)
  if (-not $Plugin -or -not $Plugin.path -or -not (Test-Path -LiteralPath $Plugin.path -PathType Container)) { return $null }
  $commit = & git -C $Plugin.path rev-parse HEAD 2>$null
  if ($LASTEXITCODE -eq 0) { return ($commit | Select-Object -First 1).Trim() }
  return $null
}

$before = Get-Plugin
if (-not $before) {
  throw "The official $PluginName plugin is not installed; this probe will not silently trust or install a plugin"
}

$beforeStatus = if (Test-PluginDisabled) { "disabled" } else { "enabled" }
$beforeCommit = Get-Commit -Plugin $before
$transitions = [Collections.Generic.List[object]]::new()
$passed = $false
$failure = $null

try {
  if ($beforeStatus -eq "disabled") {
    $message = Invoke-GrokMutation -Arguments @("plugin", "enable", $PluginName)
    $enabled = Get-Plugin
    $transitions.Add([ordered]@{ action = "enable"; disabled = (Test-PluginDisabled); output = $message })
    if (Test-PluginDisabled) { throw "Plugin did not become enabled" }

    $message = Invoke-GrokMutation -Arguments @("plugin", "disable", $PluginName)
    $disabled = Get-Plugin
    $transitions.Add([ordered]@{ action = "disable"; disabled = (Test-PluginDisabled); output = $message })
    if (-not (Test-PluginDisabled)) { throw "Plugin did not return to disabled" }
  } else {
    $message = Invoke-GrokMutation -Arguments @("plugin", "disable", $PluginName)
    $disabled = Get-Plugin
    $transitions.Add([ordered]@{ action = "disable"; disabled = (Test-PluginDisabled); output = $message })
    if (-not (Test-PluginDisabled)) { throw "Plugin did not become disabled" }

    $message = Invoke-GrokMutation -Arguments @("plugin", "enable", $PluginName)
    $enabled = Get-Plugin
    $transitions.Add([ordered]@{ action = "enable"; disabled = (Test-PluginDisabled); output = $message })
    if (Test-PluginDisabled) { throw "Plugin did not return to enabled" }
  }
  $passed = $true
} catch {
  $failure = $_.Exception.Message
} finally {
  $current = Get-Plugin
  if ($current) {
    $currentlyDisabled = Test-PluginDisabled
    if ($beforeStatus -eq "disabled" -and -not $currentlyDisabled) {
      Invoke-GrokMutation -Arguments @("plugin", "disable", $PluginName) | Out-Null
    } elseif ($beforeStatus -ne "disabled" -and $currentlyDisabled) {
      Invoke-GrokMutation -Arguments @("plugin", "enable", $PluginName) | Out-Null
    }
  }
}

$after = Get-Plugin
$afterCommit = Get-Commit -Plugin $after
$identityFields = @("name", "repo_key", "version", "path", "source", "marketplace")
$identityRestored = $true
foreach ($field in $identityFields) {
  if ([string]$before.$field -cne [string]$after.$field) { $identityRestored = $false }
}
$commitRestored = [string]$beforeCommit -ceq [string]$afterCommit
$statusRestored = (Test-PluginDisabled) -eq ($beforeStatus -eq "disabled")
$passed = $passed -and $identityRestored -and $commitRestored -and $statusRestored

$report = [ordered]@{
  acceptedAt = (Get-Date).ToUniversalTime().ToString("o")
  plugin = $PluginName
  marketplace = $before.marketplace
  version = $before.version
  source = $before.source
  commit = $beforeCommit
  originalStatus = $beforeStatus
  transitions = $transitions
  identityRestored = $identityRestored
  commitRestored = $commitRestored
  statusRestored = $statusRestored
  passed = $passed
  failure = $failure
}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding utf8

if (-not $passed) {
  throw "Official plugin reversible acceptance failed; report: $reportPath; $failure"
}
Write-Host "Official plugin reversible acceptance passed and original state was restored: $PluginName $($before.version) ($beforeStatus)"
Write-Output $reportPath
