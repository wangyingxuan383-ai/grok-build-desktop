[CmdletBinding()]
param(
    [switch]$SkipVerification,
    [switch]$ReleaseArtifactsOnly
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root
$env:APP_BUILD_PROFILE = 'public'
$Version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$Release = [IO.Path]::GetFullPath((Join-Path $Root 'release'))
$RootPrefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
if (-not $Release.StartsWith($RootPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'release 目录越出仓库根目录。' }
if (Test-Path -LiteralPath $Release -PathType Container) {
    $EscapedVersion = [Regex]::Escape($Version)
    Get-ChildItem -LiteralPath $Release -File | Where-Object { $_.Name -match "^Grok-Build-Desktop-(?:Setup-v|Portable-v)?$EscapedVersion(?:-|\.)" -or $_.Name -in @('SHA256SUMS.txt','THIRD_PARTY_LICENSES.json','builder-debug.yml','builder-effective-config.yaml','latest.yml') } | Remove-Item -Force
    $Unpacked = [IO.Path]::GetFullPath((Join-Path $Release 'win-unpacked'))
    if ((Test-Path -LiteralPath $Unpacked -PathType Container) -and $Unpacked.StartsWith($Release.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $Unpacked -Recurse -Force }
}

function Wait-ReleaseFile([string]$Path, [int]$TimeoutSeconds = 600) {
    $Deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $PreviousLength = -1L
    $StableChecks = 0
    while ([DateTime]::UtcNow -lt $Deadline) {
        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            $Length = (Get-Item -LiteralPath $Path).Length
            if ($Length -gt 0 -and $Length -eq $PreviousLength) { $StableChecks++ } else { $StableChecks = 0; $PreviousLength = $Length }
            if ($StableChecks -ge 2) { return }
        }
        Start-Sleep -Seconds 1
    }
    throw "等待发布文件超时：$Path"
}

if (-not $SkipVerification) { & (Join-Path $PSScriptRoot 'check-public-safety.ps1') }
node (Join-Path $PSScriptRoot 'ensure-electron.mjs')
if ($LASTEXITCODE -ne 0) { throw "Electron 二进制准备失败 ($LASTEXITCODE)" }
npm run build:resources
if ($LASTEXITCODE -ne 0) { throw "资源构建失败 ($LASTEXITCODE)" }
if (-not $ReleaseArtifactsOnly) {
    npm run typecheck
    if ($LASTEXITCODE -ne 0) { throw "类型检查失败 ($LASTEXITCODE)" }
    npm test
    if ($LASTEXITCODE -ne 0) { throw "自动化测试失败 ($LASTEXITCODE)" }
}
npm run build
if ($LASTEXITCODE -ne 0) { throw "生产构建失败 ($LASTEXITCODE)" }
npx electron-builder --win nsis zip --x64 --publish never
if ($LASTEXITCODE -ne 0) { throw "electron-builder 失败 ($LASTEXITCODE)" }
$ExpectedExecutable = Join-Path $Root 'release\win-unpacked\Grok Build Desktop.exe'
$ExpectedSetup = Join-Path $Root "release\Grok-Build-Desktop-Setup-v$Version-x64.exe"
$ExpectedZip = Join-Path $Root "release\Grok-Build-Desktop-$Version-x64.zip"
Wait-ReleaseFile $ExpectedExecutable
Wait-ReleaseFile $ExpectedSetup
Wait-ReleaseFile $ExpectedZip
Remove-Item -LiteralPath (Join-Path $Root 'release\builder-debug.yml'),(Join-Path $Root 'release\builder-effective-config.yaml') -Force -ErrorAction SilentlyContinue
Get-ChildItem -LiteralPath (Join-Path $Root 'release') -Filter '*.blockmap' -File -ErrorAction SilentlyContinue | Remove-Item -Force
node (Join-Path $PSScriptRoot 'verify-fuses.mjs') $ExpectedExecutable
if ($LASTEXITCODE -ne 0) { throw 'Electron Fuses 校验失败。' }

$GenericZip = Join-Path $Root "release\Grok-Build-Desktop-$Version-x64.zip"
$PortableZip = Join-Path $Root "release\Grok-Build-Desktop-Portable-v$Version-x64.zip"
if (Test-Path -LiteralPath $GenericZip) {
    if (Test-Path -LiteralPath $PortableZip) { [IO.File]::Delete($PortableZip) }
    [IO.File]::Move($GenericZip, $PortableZip)
}
if ($ReleaseArtifactsOnly) {
    Write-Host '仅生成并校验发布资产；产品验收复用同一提交已通过的 CI 与本机发布门槛。' -ForegroundColor Cyan
} elseif ($env:GITHUB_ACTIONS -eq 'true') {
    # GitHub's Windows virtual desktop becomes unreliable after several
    # consecutive Electron/CDP processes even when every process exits cleanly.
    # Verify the packaged shell, overlay host and feature entry points in one
    # fresh Renderer. Hosted virtual graphics deadlock when those heavy panels
    # are clicked through CDP; local acceptance below retains the real 4K,
    # focus, Escape and per-process overlay stress flows.
    # Run the headless Task Scheduler process before the sole GUI process.
    # Hosted Windows can leave Electron desktop resources unavailable after a
    # Renderer exits even though the process tree is gone. The fresh download
    # job independently launches the extracted Portable build.
    & (Join-Path $PSScriptRoot 'probe-task-scheduler.ps1') -Executable $ExpectedExecutable
    & (Join-Path $PSScriptRoot 'smoke-app.ps1') -Executable $ExpectedExecutable -ProbeScript 'probe-hosted-release-ui.mjs'
    & (Join-Path $PSScriptRoot 'smoke-portable.ps1') -Archive $PortableZip -StructureOnly
} else {
    & (Join-Path $PSScriptRoot 'smoke-app.ps1') -Executable $ExpectedExecutable
    & (Join-Path $PSScriptRoot 'smoke-app.ps1') -Executable $ExpectedExecutable -ProbeScript 'probe-v042-ui.mjs'
    & (Join-Path $PSScriptRoot 'smoke-app.ps1') -Executable $ExpectedExecutable -ProbeScript 'probe-v062-ui.mjs'
    foreach ($OverlayEntry in @('.task-entry', '.extensions-entry', '.media-entry')) {
        & (Join-Path $PSScriptRoot 'smoke-app.ps1') -Executable $ExpectedExecutable -ProbeScript 'probe-overlay-entry.mjs' -ProbeArgument $OverlayEntry
    }
    & (Join-Path $PSScriptRoot 'smoke-app.ps1') -Executable $ExpectedExecutable -ApplicationArguments '--open-task-center' -ProbeArgument '.task-center'
    & (Join-Path $PSScriptRoot 'probe-task-scheduler.ps1') -Executable $ExpectedExecutable
    & (Join-Path $PSScriptRoot 'smoke-portable.ps1') -Archive $PortableZip
}
& (Join-Path $PSScriptRoot 'check-public-safety.ps1') -ArtifactPath (Join-Path $Root 'release')
& (Join-Path $PSScriptRoot 'generate-release-assets.ps1')
& (Join-Path $PSScriptRoot 'check-public-safety.ps1') -ArtifactPath (Join-Path $Root 'release')
Write-Host "Windows 公开产物已生成：$PortableZip" -ForegroundColor Green
