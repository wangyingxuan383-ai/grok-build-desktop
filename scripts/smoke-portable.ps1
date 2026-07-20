[CmdletBinding()]
param(
    [string]$Archive = '',
    [string]$DestinationRoot = [IO.Path]::GetTempPath()
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Version = (Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version
if (-not $Archive) { $Archive = Join-Path $Root "release\Grok-Build-Desktop-Portable-v$Version-x64.zip" }
$Archive = [IO.Path]::GetFullPath($Archive)
$DestinationRoot = [IO.Path]::GetFullPath($DestinationRoot)
if (-not (Test-Path -LiteralPath $Archive -PathType Leaf)) { throw "便携版压缩包不存在：$Archive" }
if (-not (Test-Path -LiteralPath $DestinationRoot -PathType Container)) { throw "测试根目录不存在：$DestinationRoot" }

$Target = [IO.Path]::GetFullPath((Join-Path $DestinationRoot ("便携版 中文路径 smoke-{0}-{1}" -f $PID, [Guid]::NewGuid().ToString('N'))))
$RootPrefix = $DestinationRoot.TrimEnd('\') + '\'
if (-not $Target.StartsWith($RootPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw '便携版测试目录越出指定根目录。' }

try {
    Expand-Archive -LiteralPath $Archive -DestinationPath $Target
    $Executable = Join-Path $Target 'Grok Build Desktop.exe'
    & (Join-Path $PSScriptRoot 'smoke-app.ps1') -Executable $Executable
    Write-Host "便携版中文/空格路径可见窗口验收通过：$Target" -ForegroundColor Green
} finally {
    if (Test-Path -LiteralPath $Target -PathType Container) {
        $Resolved = (Resolve-Path -LiteralPath $Target).Path
        if ($Resolved -eq $Target -and $Resolved.StartsWith($RootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $Resolved -Recurse -Force
        } else {
            Write-Warning "未清理意外路径：$Resolved"
        }
    }
}
