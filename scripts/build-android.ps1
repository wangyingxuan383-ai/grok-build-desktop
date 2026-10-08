[CmdletBinding()]
param(
  [string]$SdkRoot=$env:ANDROID_HOME,
  [string]$JavaRoot=$env:JAVA_HOME,
  [string]$SigningStore=$env:GROK_ANDROID_KEYSTORE,
  [string]$Architectures='arm64-v8a,x86_64',
  [switch]$InstallDependencies
)
$ErrorActionPreference='Stop'
$Root=Split-Path -Parent $PSScriptRoot
$Mobile=Join-Path $Root 'apps\mobile'
if(-not $SdkRoot -or -not (Test-Path -LiteralPath (Join-Path $SdkRoot 'platform-tools\adb.exe'))){throw 'Provide an installed Android SDK with -SdkRoot or ANDROID_HOME.'}
if($SdkRoot -match '\s'){throw 'Use an SDK path without spaces on Windows (NDK C++ driver requirement).'}
if(-not $JavaRoot -or -not (Test-Path -LiteralPath (Join-Path $JavaRoot 'bin\java.exe'))){throw 'Provide JDK 17 with -JavaRoot or JAVA_HOME.'}
if(-not $SigningStore -or -not (Test-Path -LiteralPath $SigningStore) -or -not $env:GROK_ANDROID_STORE_PASSWORD -or -not $env:GROK_ANDROID_KEY_PASSWORD){throw 'Provide a private signing store and its passwords through the documented environment variables.'}
if($Architectures -notmatch '^(arm64-v8a|x86_64|armeabi-v7a)(,(arm64-v8a|x86_64|armeabi-v7a))*$'){throw 'Invalid architecture list.'}
$env:JAVA_HOME=$JavaRoot;$env:ANDROID_HOME=$SdkRoot;$env:GROK_ANDROID_KEYSTORE=$SigningStore;$env:CI='1'
Push-Location -LiteralPath $Mobile
try {
 if($InstallDependencies){npm ci;if($LASTEXITCODE -ne 0){throw 'Mobile dependency installation failed.'}}
 npm run typecheck;if($LASTEXITCODE -ne 0){throw 'Mobile typecheck failed.'}
 npm run test:startup;if($LASTEXITCODE -ne 0){throw 'Mobile startup checks failed.'}
 npm test;if($LASTEXITCODE -ne 0){throw 'Mobile contract tests failed.'}
 npm run test:workflow;if($LASTEXITCODE -ne 0){throw 'Mobile submission workflow checks failed.'}
 npm run test:ui;if($LASTEXITCODE -ne 0){throw 'Mobile UI workflow checks failed.'}
 npm run prebuild;if($LASTEXITCODE -ne 0){throw 'Android prebuild failed.'}
 Push-Location -LiteralPath (Join-Path $Mobile 'android')
 try{& .\gradlew.bat :app:assembleRelease "-PreactNativeArchitectures=$Architectures" --no-daemon --console=plain;if($LASTEXITCODE -ne 0){throw 'Android build failed.'}}finally{Pop-Location}
 $Version=(Get-Content -LiteralPath (Join-Path $Mobile 'package.json') -Raw | ConvertFrom-Json).version
 $Artifacts=Join-Path $Root 'out\android-companion'
 [IO.Directory]::CreateDirectory($Artifacts)|Out-Null
 $Apk=Join-Path $Artifacts "Grok-Remote-v$Version-preview.apk"
 Copy-Item -LiteralPath (Join-Path $Mobile 'android\app\build\outputs\apk\release\app-release.apk') -Destination $Apk -Force
 & (Join-Path $SdkRoot 'build-tools\36.0.0\apksigner.bat') verify --verbose $Apk
 if($LASTEXITCODE -ne 0){throw 'APK signature verification failed.'}
 node (Join-Path $PSScriptRoot 'check-mobile-artifact.mjs') $Apk
 if($LASTEXITCODE -ne 0){throw 'APK native contract or artifact check failed.'}
 $Hash=(Get-FileHash -LiteralPath $Apk -Algorithm SHA256).Hash.ToLowerInvariant()
 [IO.File]::WriteAllText((Join-Path $Artifacts 'SHA256SUMS.txt'),"$Hash  $([IO.Path]::GetFileName($Apk))`n",[Text.UTF8Encoding]::new($false))
 Copy-Item -LiteralPath (Join-Path $Mobile 'THIRD_PARTY_NOTICES.md'),(Join-Path $Mobile 'LICENSE-APACHE-2.0.txt') -Destination $Artifacts -Force
 Write-Output "Signed APK ready: $Apk"
}finally{Pop-Location}
