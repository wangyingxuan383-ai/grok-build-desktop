[CmdletBinding()]
param(
    [switch]$RequireQuota,
    [string]$CliPath = (Join-Path $HOME '.grok\bin\grok.exe')
)

$ErrorActionPreference = 'Stop'
$Result = [ordered]@{ reader = 'skipped'; quotaWeekly = 'skipped'; quotaMonthly = 'skipped'; diagnostics = @() }

$Reader = Join-Path $HOME '.grok\bundled\skills\shared\resume-session\session_reader.py'
$CodexFile = Get-ChildItem -LiteralPath (Join-Path $HOME '.codex\sessions') -Filter '*.jsonl' -Recurse -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if ((Test-Path -LiteralPath $Reader -PathType Leaf) -and $CodexFile -and (Get-Command python -ErrorAction SilentlyContinue)) {
    try {
        $ReaderJson = & python $Reader codex show $CodexFile.FullName --json 2>$null | Out-String
        $Parsed = $ReaderJson | ConvertFrom-Json
        if (-not $Parsed.session_id) { throw 'reader output has no session_id' }
        $Result.reader = 'ok'
    } catch {
        $Result.reader = 'unavailable'
        $Result.diagnostics += "Codex reader: $($_.Exception.Message)"
    }
} else {
    $Result.reader = 'unavailable'
    $Result.diagnostics += 'Codex reader or a Codex JSONL session was not found.'
}

$AuthPath = Join-Path $HOME '.grok\auth.json'
if (Test-Path -LiteralPath $AuthPath -PathType Leaf) {
    try {
        $Auth = Get-Content -LiteralPath $AuthPath -Raw | ConvertFrom-Json
        $Credential = $Auth.PSObject.Properties | Select-Object -First 1
        $Token = [string]$Credential.Value.key
        $UserId = [string]$Credential.Value.user_id
        if (-not $Token -or -not $UserId) { throw 'OAuth token or user_id missing' }
        $Version = if (Test-Path -LiteralPath $CliPath) { ((& $CliPath --version 2>$null | Out-String) -replace '^.*?(\d+\.\d+\.\d+).*$','$1').Trim() } else { 'unknown' }
        $Headers = @{ Authorization = "Bearer $Token"; 'x-userid' = $UserId; 'x-xai-token-auth' = 'xai-grok-cli'; 'x-grok-client-version' = $Version }
        $Proxy = $env:HTTPS_PROXY
        if (-not $Proxy) { $Proxy = $env:HTTP_PROXY }
        $SettingsPath = Join-Path $env:APPDATA 'Grok Build Desktop\settings.json'
        if (Test-Path -LiteralPath $SettingsPath) {
            $Settings = Get-Content -LiteralPath $SettingsPath -Raw | ConvertFrom-Json
            if ($Settings.httpsProxy) { $Proxy = [string]$Settings.httpsProxy } elseif ($Settings.httpProxy) { $Proxy = [string]$Settings.httpProxy }
        }
        $Invoke = @{ Headers = $Headers; TimeoutSec = 30; ErrorAction = 'Stop' }
        if ($Proxy) { $Invoke.Proxy = $Proxy }
        [void](Invoke-RestMethod 'https://cli-chat-proxy.grok.com/v1/billing?format=credits' @Invoke)
        $Result.quotaWeekly = 'ok'
        [void](Invoke-RestMethod 'https://cli-chat-proxy.grok.com/v1/billing' @Invoke)
        $Result.quotaMonthly = 'ok'
    } catch {
        if ($Result.quotaWeekly -ne 'ok') { $Result.quotaWeekly = 'unavailable' } else { $Result.quotaMonthly = 'unavailable' }
        $Result.diagnostics += "Quota adapter: $($_.Exception.Message -replace '(?i)Bearer\s+\S+','Bearer [REDACTED]')"
        if ($RequireQuota) { throw "OAuth quota compatibility probe failed: $($_.Exception.Message)" }
    }
} elseif ($RequireQuota) {
    throw 'OAuth quota compatibility probe requires ~/.grok/auth.json.'
}

$Result | ConvertTo-Json -Compress
