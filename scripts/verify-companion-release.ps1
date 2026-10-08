[CmdletBinding()]
param([string]$Directory='release', [string]$SdkRoot=$env:ANDROID_HOME)
$ErrorActionPreference='Stop'
$Root=Split-Path -Parent $PSScriptRoot
$Config=(Get-Content -LiteralPath (Join-Path $Root 'apps/mobile/app.json') -Raw | ConvertFrom-Json).expo
$Apk=Join-Path $Directory "Grok-Remote-v$($Config.version).apk"
node (Join-Path $PSScriptRoot 'verify-companion-release.mjs') $Directory
if($LASTEXITCODE -ne 0){throw 'Companion source/checksum scan failed.'}
$Tools=Get-ChildItem -LiteralPath (Join-Path $SdkRoot 'build-tools') -Directory | Sort-Object Name -Descending | Where-Object {Test-Path -LiteralPath (Join-Path $_.FullName 'apksigner.bat')} | Select-Object -First 1
if(-not $Tools){throw 'Android build tools with apksigner are required.'}
$Signature=(& (Join-Path $Tools.FullName 'apksigner.bat') verify --print-certs $Apk 2>&1) -join "`n"
if($LASTEXITCODE -ne 0 -or $Signature -notmatch '87e00a382a5e0e76772583964ea9c2b695eaf80e75ac4241cf07aa6767f2b114'){throw 'APK signature is invalid or does not match the existing companion.'}
$Badging=(& (Join-Path $Tools.FullName 'aapt.exe') dump badging $Apk 2>&1) -join "`n"
if($LASTEXITCODE -ne 0 -or $Badging -notmatch "name='$([Regex]::Escape($Config.android.package))' versionCode='$($Config.android.versionCode)' versionName='$([Regex]::Escape($Config.version))'"){throw 'APK package name/version does not match source.'}
Write-Output 'Companion APK signature, package identity and version verified.'
