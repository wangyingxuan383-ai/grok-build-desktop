[CmdletBinding()]
param(
    [string]$Executable = (Join-Path (Split-Path -Parent $PSScriptRoot) 'release\win-unpacked\Grok Build Desktop.exe')
)

$ErrorActionPreference = 'Stop'
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
