[CmdletBinding()]
param(
    [string]$Executable,
    [string]$ProbeScript = 'probe-renderer.mjs',
    [string]$ApplicationArguments = '',
    [string]$ProbeArgument = ''
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Executable)) {
    $Root = Split-Path -Parent $PSScriptRoot
    $Executable = Join-Path $Root 'release\win-unpacked\Grok Build Desktop.exe'
}
$Executable = [System.IO.Path]::GetFullPath($Executable)
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw "Executable not found: $Executable" }
$ProfileRoot = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ("Grok-Build-Desktop-smoke-{0}-{1}" -f $PID, [Guid]::NewGuid().ToString('N'))))
[IO.Directory]::CreateDirectory($ProfileRoot) | Out-Null
if ($ProbeScript -eq 'probe-v042-ui.mjs') {
    $ThemeDirectory = Join-Path $ProfileRoot 'themes'
    [IO.Directory]::CreateDirectory($ThemeDirectory) | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $ThemeDirectory 'background.png'), [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='))
    $ThemeSettings = @{
        theme = @{
            mode = 'dark'; customBase = 'dark'
            colors = @{ background = '#0d0f12'; surface = '#171a1f'; text = '#e7e9ec'; muted = '#9299a3'; accent = '#45a9df'; border = '#292e35' }
            background = @{ enabled = $true; scope = 'conversation'; fit = 'cover'; position = 'center'; opacity = 0.32; blur = 0; dim = 0.42 }
        }
    } | ConvertTo-Json -Depth 6
    [IO.File]::WriteAllText((Join-Path $ProfileRoot 'settings.json'), $ThemeSettings, [Text.UTF8Encoding]::new($false))
}

$Info = New-Object System.Diagnostics.ProcessStartInfo
$Info.FileName = $Executable
$Info.WorkingDirectory = Split-Path -Parent $Executable
$Info.UseShellExecute = $false
$DebugPort = Get-Random -Minimum 19000 -Maximum 25000
$HostedRunnerFlags = if ($env:GITHUB_ACTIONS -eq 'true') { '--disable-gpu' } else { '' }
$Info.Arguments = ("--remote-debugging-port=$DebugPort --user-data-dir=`"$ProfileRoot`" $HostedRunnerFlags $ApplicationArguments").Trim()
$Info.EnvironmentVariables['GROK_DESKTOP_OFFLINE_SMOKE'] = '1'
if ($ProbeScript -in @('probe-v061-ui.mjs', 'probe-v062-ui.mjs', 'probe-v063-ui.mjs', 'probe-v064-ui.mjs')) {
    $Info.EnvironmentVariables['GROK_DESKTOP_UI_FIXTURE'] = '1'
    $ThemeDirectory = Join-Path $ProfileRoot 'themes'
    [IO.Directory]::CreateDirectory($ThemeDirectory) | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $ThemeDirectory 'background.png'), [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='))
    if ($ProbeScript -in @('probe-v062-ui.mjs', 'probe-v063-ui.mjs', 'probe-v064-ui.mjs')) {
        $FixtureWorkspace = if ($ProbeScript -eq 'probe-v064-ui.mjs') { $ProfileRoot } else { (Split-Path -Parent $PSScriptRoot) }
        if ($ProbeScript -eq 'probe-v064-ui.mjs') {
            $FixtureSource = Join-Path $FixtureWorkspace 'src\renderer\src'
            [IO.Directory]::CreateDirectory($FixtureSource) | Out-Null
            [IO.File]::WriteAllText((Join-Path $FixtureSource 'App.tsx'), "export const fixture = 'app';`n", [Text.UTF8Encoding]::new($false))
            [IO.File]::WriteAllText((Join-Path $FixtureSource 'styles.css'), ".fixture { display: grid; }`n", [Text.UTF8Encoding]::new($false))
        }
        $ThemeSettings = @{
            activeWorkspace = $FixtureWorkspace
            theme = @{
                mode = 'dark'; customBase = 'dark'
                colors = @{ background = '#0d0f12'; surface = '#171a1f'; text = '#e7e9ec'; muted = '#9299a3'; accent = '#45a9df'; border = '#292e35' }
                background = @{ enabled = $true; scope = 'conversation'; fit = 'cover'; position = 'center'; opacity = 1; blur = 0; dim = 0 }
            }
        } | ConvertTo-Json -Depth 6
        [IO.File]::WriteAllText((Join-Path $ProfileRoot 'settings.json'), $ThemeSettings, [Text.UTF8Encoding]::new($false))
    }
}
$Process = [System.Diagnostics.Process]::Start($Info)
try {
    $Ready = $false
    for ($Attempt = 0; $Attempt -lt 30; $Attempt++) {
        Start-Sleep -Milliseconds 500
        $Process.Refresh()
        if ($Process.HasExited) { throw "Application exited before opening a window (code $($Process.ExitCode))." }
        if ($Process.MainWindowHandle -ne 0 -and $Process.MainWindowTitle -eq 'Grok Build Desktop') { $Ready = $true; break }
    }
    if (-not $Ready) { throw 'Application did not expose a visible Grok Build Desktop window within 15 seconds.' }
    if ($ProbeArgument) { & node (Join-Path $PSScriptRoot $ProbeScript) "http://127.0.0.1:$DebugPort" $ProbeArgument }
    else { & node (Join-Path $PSScriptRoot $ProbeScript) "http://127.0.0.1:$DebugPort" }
    if ($LASTEXITCODE -ne 0) { throw 'Renderer content verification failed.' }
    Write-Host "Visible renderer smoke test passed (handle $($Process.MainWindowHandle))." -ForegroundColor Green
} finally {
    if (-not $Process.HasExited) {
        [void]$Process.CloseMainWindow()
        if (-not $Process.WaitForExit(5000)) { $Process.Kill() }
    }
    if (Test-Path -LiteralPath $ProfileRoot -PathType Container) {
        $ResolvedProfile = (Resolve-Path -LiteralPath $ProfileRoot).Path
        $TempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        if ($ResolvedProfile.StartsWith($TempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $ResolvedProfile) -like 'Grok-Build-Desktop-smoke-*') {
            Remove-Item -LiteralPath $ResolvedProfile -Recurse -Force
        }
    }
}
