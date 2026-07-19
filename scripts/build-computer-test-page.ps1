[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $Csc -PathType Leaf)) { throw "未找到 Windows x64 C# 编译器：$Csc" }
$TargetDir = Join-Path $Root 'out\computer-test'
[void](New-Item -ItemType Directory -Force -Path $TargetDir)
$Target = Join-Path $TargetDir 'GrokComputerTestPage.exe'
& $Csc /nologo /platform:x64 /optimize+ /target:winexe "/out:$Target" /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll (Join-Path $Root 'native\GrokComputerTestPage.cs')
if ($LASTEXITCODE -ne 0) { throw "Computer Test Page 编译失败 ($LASTEXITCODE)" }
Write-Output $Target
