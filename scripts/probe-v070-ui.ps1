[CmdletBinding()]
param(
    [string]$Executable
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($Executable)) {
    $DevelopmentElectron = Join-Path $Root 'node_modules\electron\dist\electron.exe'
    if (Test-Path -LiteralPath $DevelopmentElectron -PathType Leaf) {
        & (Join-Path $PSScriptRoot 'smoke-app.ps1') -Executable $DevelopmentElectron -ApplicationArguments ('"{0}"' -f $Root) -ProbeScript 'probe-v070-ui.mjs'
        exit $LASTEXITCODE
    }
    $Executable = Join-Path $Root 'release\win-unpacked\Grok Build Desktop.exe'
}
& (Join-Path $PSScriptRoot 'smoke-app.ps1') -Executable $Executable -ProbeScript 'probe-v070-ui.mjs'
