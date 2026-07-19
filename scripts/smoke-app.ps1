[CmdletBinding()]
param(
    [string]$Executable = (Join-Path (Split-Path -Parent $PSScriptRoot) 'release\win-unpacked\Grok Build Desktop.exe')
)

$ErrorActionPreference = 'Stop'
$Executable = [System.IO.Path]::GetFullPath($Executable)
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw "Executable not found: $Executable" }
if (Get-Process -Name 'Grok Build Desktop' -ErrorAction SilentlyContinue) { throw 'Close the running Grok Build Desktop instance before the smoke test.' }

$Info = New-Object System.Diagnostics.ProcessStartInfo
$Info.FileName = $Executable
$Info.WorkingDirectory = Split-Path -Parent $Executable
$Info.UseShellExecute = $true
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
    Write-Host "Visible window smoke test passed (handle $($Process.MainWindowHandle))." -ForegroundColor Green
} finally {
    if (-not $Process.HasExited) {
        [void]$Process.CloseMainWindow()
        if (-not $Process.WaitForExit(5000)) { $Process.Kill() }
    }
}
