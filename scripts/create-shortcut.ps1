[CmdletBinding()]
param(
    [string]$Executable
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Executable)) {
    $Root = Split-Path -Parent $PSScriptRoot
    $Executable = Join-Path $Root 'release\win-unpacked\Grok Build Desktop.exe'
}
$ResolvedExecutable = [System.IO.Path]::GetFullPath($Executable)
if (-not (Test-Path -LiteralPath $ResolvedExecutable -PathType Leaf)) {
    throw "Executable not found: $ResolvedExecutable"
}

$Desktop = [Environment]::GetFolderPath('Desktop')
$ShortcutPath = Join-Path $Desktop 'Grok Build Desktop.lnk'
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $ResolvedExecutable
$Shortcut.WorkingDirectory = Split-Path -Parent $ResolvedExecutable
$Shortcut.Description = 'Grok Build CLI desktop client'
$Shortcut.IconLocation = "$ResolvedExecutable,0"
$Shortcut.Save()

Write-Host "Desktop shortcut created: $ShortcutPath" -ForegroundColor Green
