[CmdletBinding()]
param(
    [string]$Installer = '',
    [switch]$AllowMutation
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
if (-not $Installer) {
    $Version = (Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version
    $Installer = Join-Path $Root "release\Grok-Build-Desktop-Setup-v$Version-x64.exe"
}
$Installer = [IO.Path]::GetFullPath($Installer)
if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) { throw "安装器不存在：$Installer" }
if (-not $AllowMutation -or $env:CI -ne 'true') {
    throw '安装器生命周期测试只允许在显式传入 -AllowMutation 的一次性 CI Windows 环境运行。'
}

$TestRoot = [IO.Path]::GetFullPath((Join-Path $env:RUNNER_TEMP ("GrokDesktopInstaller-{0}" -f [Guid]::NewGuid().ToString('N'))))
$InstallDir = Join-Path $TestRoot '中文 安装目录'
$DataDir = Join-Path $env:APPDATA 'Grok Build Desktop'
$Marker = Join-Path $DataDir 'ci-retention-marker.txt'
$Uninstaller = Join-Path $InstallDir 'Uninstall Grok Build Desktop.exe'

function Invoke-Installer {
    $Process = Start-Process -FilePath $Installer -ArgumentList "/S /D=$InstallDir" -Wait -PassThru -WindowStyle Hidden
    if ($Process.ExitCode -ne 0) { throw "安装器退出码异常：$($Process.ExitCode)" }
    if (-not (Test-Path -LiteralPath (Join-Path $InstallDir 'Grok Build Desktop.exe') -PathType Leaf)) { throw '安装后未找到主程序。' }
}

try {
    [void](New-Item -ItemType Directory -Force -Path $TestRoot)
    Invoke-Installer
    [void](New-Item -ItemType Directory -Force -Path $DataDir)
    [IO.File]::WriteAllText($Marker, 'retain-user-data', [Text.UTF8Encoding]::new($false))

    Invoke-Installer
    if (-not (Test-Path -LiteralPath $Marker -PathType Leaf)) { throw '覆盖升级删除了 AppData 用户数据。' }
    if (-not (Test-Path -LiteralPath $Uninstaller -PathType Leaf)) { throw '未找到卸载程序。' }

    $Uninstall = Start-Process -FilePath $Uninstaller -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
    if ($Uninstall.ExitCode -ne 0) { throw "卸载程序退出码异常：$($Uninstall.ExitCode)" }
    for ($Attempt = 0; $Attempt -lt 20 -and (Test-Path -LiteralPath $InstallDir); $Attempt++) { Start-Sleep -Milliseconds 500 }
    if (Test-Path -LiteralPath $InstallDir) { throw '卸载后安装目录仍然存在。' }
    if (-not (Test-Path -LiteralPath $Marker -PathType Leaf)) { throw '卸载程序删除了默认应保留的 AppData 用户数据。' }
    Write-Host 'NSIS 首次安装、覆盖升级、卸载与 AppData 保留测试通过。' -ForegroundColor Green
} finally {
    if (Test-Path -LiteralPath $Marker -PathType Leaf) { Remove-Item -LiteralPath $Marker -Force }
    if ((Test-Path -LiteralPath $DataDir -PathType Container) -and @(Get-ChildItem -LiteralPath $DataDir -Force).Count -eq 0) { Remove-Item -LiteralPath $DataDir -Force }
    if ((Test-Path -LiteralPath $TestRoot -PathType Container) -and @(Get-ChildItem -LiteralPath $TestRoot -Force).Count -eq 0) { Remove-Item -LiteralPath $TestRoot -Force }
}
