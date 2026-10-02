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
$ProfileRoot = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ("Grok-Build-Desktop-smoke-{0}-{1}" -f $PID, [Guid]::NewGuid().ToString('N').Substring(0,8))))
[IO.Directory]::CreateDirectory($ProfileRoot) | Out-Null
if ($ProbeScript -in @('probe-remaining-packaged.mjs', 'probe-library-packaged.mjs', 'probe-pages-packaged.mjs', 'probe-image-failure-packaged.mjs', 'probe-image-review-packaged.mjs', 'probe-image-options-packaged.mjs', 'probe-recovery-packaged.mjs', 'probe-experience-packaged.mjs')) {
    $IsolatedSettings = @{ activeWorkspace = $ProfileRoot; recentWorkspaces = @($ProfileRoot) } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $ProfileRoot 'settings.json'), $IsolatedSettings, [Text.UTF8Encoding]::new($false))
}
if ($ProbeScript -in @('probe-pages-packaged.mjs', 'probe-image-failure-packaged.mjs', 'probe-image-review-packaged.mjs', 'probe-image-options-packaged.mjs', 'probe-recovery-packaged.mjs', 'probe-experience-packaged.mjs')) {
    [IO.File]::WriteAllText((Join-Path $ProfileRoot 'onboarding.json'), '{"version":1,"completed":false,"skipped":true,"currentStep":0}', [Text.UTF8Encoding]::new($false))
}
if ($ProbeScript -eq 'probe-experience-packaged.mjs') {
    $ImageDirectory = Join-Path $ProfileRoot 'images'
    [IO.Directory]::CreateDirectory($ImageDirectory) | Out-Null
    $Rows = @('image-experience-one','image-experience-two') | ForEach-Object {
        $Directory = Join-Path $ImageDirectory $_
        [IO.Directory]::CreateDirectory($Directory) | Out-Null
        @{id=$_;title=$_;cwd=$Directory;createdAt=[DateTime]::UtcNow.ToString('o');updatedAt=[DateTime]::UtcNow.ToString('o');draft='';jobs=@()}
    }
    $State = @{version=1;outputRoot=$ImageDirectory;conversations=$Rows} | ConvertTo-Json -Depth 12
    [IO.File]::WriteAllText((Join-Path $ProfileRoot 'image-workspace.json'),$State,[Text.UTF8Encoding]::new($false))
}
if ($ProbeScript -eq 'probe-image-review-packaged.mjs') {
    $ImageDirectory = Join-Path $ProfileRoot 'images\image-review'
    [IO.Directory]::CreateDirectory($ImageDirectory) | Out-Null
    # Test deletion cares about paths, not codec validity. UI images use the known-valid inline fixture.
    $Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    foreach ($Name in @('a.png','b.png','partial.png','my-file.png')) { [IO.File]::WriteAllBytes((Join-Path $ImageDirectory $Name), [Convert]::FromBase64String($Png)) }
    $OutsideImage = Join-Path $ProfileRoot 'outside.png'
    [IO.File]::WriteAllBytes($OutsideImage, [Convert]::FromBase64String($Png))
    $Now = [DateTime]::UtcNow.ToString('o')
    $Artifacts = @('a','b') | ForEach-Object {
        $FilePath = [IO.Path]::GetFullPath((Join-Path $ImageDirectory ($_+'.png')))
        $Proof = @{path=$FilePath;root=[IO.Path]::GetFullPath($ImageDirectory);sha256=(Get-FileHash -LiteralPath $FilePath -Algorithm SHA256).Hash.ToLowerInvariant()}
        @{id=$_;media='image';source=$Png;isData=$true;mimeType='image/png';savedPath=$FilePath;ownedFiles=@($Proof)}
    }
    $Jobs = @(
        @{requestId='batch';prompt='batch';job=@{jobId='batch';sessionId='image-review';kind='image';route='cli';status='completed';message='done';artifacts=@($Artifacts);startedAt=$Now;updatedAt=$Now}},
        @{requestId='partial';prompt='partial';job=@{jobId='partial';sessionId='image-review';kind='image';route='cli';status='failed';message='partial';artifacts=@(@{id='partial';media='image';source=$Png;isData=$true;mimeType='image/png';savedPath=(Join-Path $ImageDirectory 'partial.png')});startedAt=$Now;updatedAt=$Now}},
        @{requestId='blocked';prompt='blocked';job=@{jobId='blocked';sessionId='image-review';kind='image';route='cli';status='failed';message='failed';artifacts=@();savedProjectFiles=@($OutsideImage);startedAt=$Now;updatedAt=$Now}}
    )
    $ImageFixture = @{version=1;outputRoot=(Join-Path $ProfileRoot 'images');conversations=@(@{id='image-review';title='隔离审查';cwd=$ImageDirectory;createdAt=$Now;updatedAt=$Now;draft='';jobs=$Jobs})} | ConvertTo-Json -Depth 15
    [IO.File]::WriteAllText((Join-Path $ProfileRoot 'image-workspace.json'), $ImageFixture, [Text.UTF8Encoding]::new($false))
}
if ($ProbeScript -eq 'probe-image-failure-packaged.mjs') {
    $ImageProbeWorkspace = Join-Path $ProfileRoot 'workspace'
    [IO.Directory]::CreateDirectory($ImageProbeWorkspace) | Out-Null
    [IO.File]::WriteAllText((Join-Path $ProfileRoot 'outside.log'), 'external read probe', [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $ProfileRoot 'settings.json'), (@{activeWorkspace=$ImageProbeWorkspace;recentWorkspaces=@($ImageProbeWorkspace)} | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    $ImageFixture = @{ version=1; outputRoot=(Join-Path $ProfileRoot 'images'); conversations=@(@{id='image-failure-probe';title='隔离失败图像';cwd=$ProfileRoot;createdAt='';updatedAt='';draft='';jobs=@(@{requestId='failure-probe';prompt='isolated';job=@{jobId='failure-job';sessionId='image-failure-probe';kind='image';route='cli';status='running';message='interrupted';artifacts=@();startedAt='';updatedAt=''}})}) } | ConvertTo-Json -Depth 10
    [IO.File]::WriteAllText((Join-Path $ProfileRoot 'image-workspace.json'), $ImageFixture, [Text.UTF8Encoding]::new($false))
}
if ($ProbeScript -eq 'probe-library-packaged.mjs') {
    [IO.File]::WriteAllText((Join-Path $ProfileRoot 'onboarding.json'), '{"version":1,"completed":false,"skipped":true,"currentStep":0}', [Text.UTF8Encoding]::new($false))
    $CatalogRoot = Join-Path (Join-Path $ProfileRoot 'offline-cli\sessions') ([Uri]::EscapeDataString($ProfileRoot))
    foreach ($SessionId in @('library-one', 'library-two')) {
        $SessionRoot = Join-Path $CatalogRoot $SessionId
        [IO.Directory]::CreateDirectory($SessionRoot) | Out-Null
        $Summary = @{ generated_title = $SessionId; created_at = '2026-09-28T00:00:00Z'; num_chat_messages = 2 } | ConvertTo-Json
        [IO.File]::WriteAllText((Join-Path $SessionRoot 'summary.json'), $Summary, [Text.UTF8Encoding]::new($false))
    }
    [IO.File]::WriteAllText((Join-Path $ProfileRoot 'session-metadata.json'), '{"archived":{"library-two":true}}', [Text.UTF8Encoding]::new($false))
}
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
$Info.EnvironmentVariables.Remove('ELECTRON_RUN_AS_NODE')
$Info.EnvironmentVariables['GROK_HOME'] = Join-Path $ProfileRoot 'offline-cli'
if ($ProbeScript -in @('probe-v061-ui.mjs', 'probe-v062-ui.mjs', 'probe-v063-ui.mjs', 'probe-v064-ui.mjs', 'probe-v065-ui.mjs', 'probe-v066-ui.mjs', 'probe-v070-ui.mjs')) {
    $Info.EnvironmentVariables['GROK_DESKTOP_UI_FIXTURE'] = '1'
    if ($ProbeScript -eq 'probe-v070-ui.mjs') {
        # The responder is a main-process-only state machine for the isolated
        # v0.7 fixture. Never enable it for ordinary smoke runs or older probes.
        $Info.EnvironmentVariables['GROK_DESKTOP_UI_RESPONDER'] = '1'
    }
    $ThemeDirectory = Join-Path $ProfileRoot 'themes'
    [IO.Directory]::CreateDirectory($ThemeDirectory) | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $ThemeDirectory 'background.png'), [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='))
    if ($ProbeScript -in @('probe-v062-ui.mjs', 'probe-v063-ui.mjs', 'probe-v064-ui.mjs', 'probe-v065-ui.mjs', 'probe-v066-ui.mjs', 'probe-v070-ui.mjs')) {
        $FixtureWorkspace = if ($ProbeScript -in @('probe-v064-ui.mjs', 'probe-v065-ui.mjs', 'probe-v066-ui.mjs', 'probe-v070-ui.mjs')) { $ProfileRoot } else { (Split-Path -Parent $PSScriptRoot) }
        if ($ProbeScript -in @('probe-v064-ui.mjs', 'probe-v065-ui.mjs', 'probe-v066-ui.mjs', 'probe-v070-ui.mjs')) {
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
$Process = $null
$ExpectedWindowTitle = if (-not [string]::IsNullOrWhiteSpace($ApplicationArguments) -and [IO.Path]::GetFileName($Executable) -ieq 'electron.exe') { 'Grok Build Desktop Source' } else { 'Grok Build Desktop' }
$PreviousExpectedAppVersion = $env:GROK_EXPECTED_APP_VERSION
try {
    $Process = [System.Diagnostics.Process]::Start($Info)
    if (-not $Process) { throw 'Application process could not be started.' }
    $Ready = $false
    for ($Attempt = 0; $Attempt -lt 30; $Attempt++) {
        Start-Sleep -Milliseconds 500
        $Process.Refresh()
        if ($Process.HasExited) { throw "Application exited before opening a window (code $($Process.ExitCode))." }
        if ($Process.MainWindowHandle -ne 0 -and $Process.MainWindowTitle -eq $ExpectedWindowTitle) { $Ready = $true; break }
    }
    if (-not $Ready) { throw 'Application did not expose a visible Grok Build Desktop window within 15 seconds.' }
    # Legacy probes may compare against the current package dynamically. The
    # v0.7 gate deliberately hard-codes its release contract and must not be
    # made to accept an older packaged shell through an environment override.
    if ($ProbeScript -eq 'probe-v070-ui.mjs') { Remove-Item Env:GROK_EXPECTED_APP_VERSION -ErrorAction SilentlyContinue }
    else { $env:GROK_EXPECTED_APP_VERSION = (Get-Content (Join-Path (Split-Path -Parent $PSScriptRoot) 'package.json') -Raw | ConvertFrom-Json).version }
    if ($ProbeArgument) { & node (Join-Path $PSScriptRoot $ProbeScript) "http://127.0.0.1:$DebugPort" $ProbeArgument }
    else { & node (Join-Path $PSScriptRoot $ProbeScript) "http://127.0.0.1:$DebugPort" }
    if ($LASTEXITCODE -ne 0) { throw 'Renderer content verification failed.' }
    Write-Host "Visible renderer smoke test passed (handle $($Process.MainWindowHandle))." -ForegroundColor Green
} finally {
    if ($null -eq $PreviousExpectedAppVersion) { Remove-Item Env:GROK_EXPECTED_APP_VERSION -ErrorAction SilentlyContinue }
    else { $env:GROK_EXPECTED_APP_VERSION = $PreviousExpectedAppVersion }
    try {
        if ($Process -and -not $Process.HasExited) {
            [void]$Process.CloseMainWindow()
            if (-not $Process.WaitForExit(5000)) { $Process.Kill() }
        }
    } catch { Write-Warning "应用冒烟进程清理失败：$($_.Exception.Message)" }
    try {
        if (Test-Path -LiteralPath $ProfileRoot -PathType Container) {
            $ResolvedProfile = (Resolve-Path -LiteralPath $ProfileRoot).Path
            $TempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
            if ($ResolvedProfile.StartsWith($TempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $ResolvedProfile) -like 'Grok-Build-Desktop-smoke-*') {
                $CleanupError = $null
                for ($Attempt = 0; $Attempt -lt 8; $Attempt++) {
                    try {
                        Remove-Item -LiteralPath $ResolvedProfile -Recurse -Force -ErrorAction Stop
                        $CleanupError = $null
                        break
                    } catch {
                        $CleanupError = $_
                        Start-Sleep -Milliseconds (150 * ($Attempt + 1))
                    }
                }
                if ($CleanupError) { throw $CleanupError }
            }
        }
    } catch { Write-Warning "应用冒烟临时目录清理失败：$($_.Exception.Message)" }
}
