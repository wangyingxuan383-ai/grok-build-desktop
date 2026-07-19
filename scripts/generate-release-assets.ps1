[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Release = Join-Path $Root 'release'
if (-not (Test-Path -LiteralPath $Release -PathType Container)) { throw 'release 目录不存在，请先打包应用。' }
$Version = (Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version

$Sbom = Join-Path $Release "Grok-Build-Desktop-$Version-SBOM.cdx.json"
$SbomText = (& npm sbom --omit=dev --sbom-format cyclonedx 2>&1) -join "`n"
if ($LASTEXITCODE -ne 0) { throw "SBOM 生成失败：$SbomText" }
[IO.File]::WriteAllText($Sbom, $SbomText + "`n", [Text.UTF8Encoding]::new($false))

npx license-checker-rseidelsohn --production --json --out (Join-Path $Release 'THIRD_PARTY_LICENSES.json')
if ($LASTEXITCODE -ne 0) { throw '第三方许可证报告生成失败。' }

$Artifacts = Get-ChildItem -LiteralPath $Release -File | Where-Object {
    $_.Name -match '\.(exe|zip|json)$' -and $_.Name -ne 'builder-debug.yml'
} | Sort-Object Name
$Lines = foreach ($Artifact in $Artifacts) {
    $Stream = [IO.File]::OpenRead($Artifact.FullName)
    $Sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $Hash = ([BitConverter]::ToString($Sha256.ComputeHash($Stream))).Replace('-', '').ToLowerInvariant()
    } finally {
        $Sha256.Dispose()
        $Stream.Dispose()
    }
    "$Hash  $($Artifact.Name)"
}
[IO.File]::WriteAllLines((Join-Path $Release 'SHA256SUMS.txt'), $Lines, [Text.UTF8Encoding]::new($false))
Write-Host "已生成 SHA256SUMS、SBOM 和第三方许可证报告。" -ForegroundColor Green
