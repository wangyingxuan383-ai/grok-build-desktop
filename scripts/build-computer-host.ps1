param([switch]$SelfTest)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $csc)) { throw "未找到 Windows x64 C# 编译器: $csc" }
$targetDir = Join-Path $root "resources\native\win-x64"
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
$target = Join-Path $targetDir "GrokComputerHost.exe"
$automationClient = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\WPF\UIAutomationClient.dll"
$automationTypes = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\WPF\UIAutomationTypes.dll"
$windowsBase = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\WPF\WindowsBase.dll"
& $csc /nologo /platform:x64 /optimize+ /target:exe "/out:$target" `
  /reference:System.dll /reference:System.Core.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll `
  "/reference:$windowsBase" "/reference:$automationClient" "/reference:$automationTypes" `
  (Join-Path $root "native\GrokComputerHost.cs")
if ($LASTEXITCODE -ne 0) { throw "GrokComputerHost 编译失败 ($LASTEXITCODE)" }
if ($SelfTest) {
  $result = & $target --self-test
  if ($LASTEXITCODE -ne 0) { throw "GrokComputerHost 自检失败: $result" }
  $json = $result | ConvertFrom-Json
  if (-not $json.ok -or $json.platform -ne "win-x64") { throw "GrokComputerHost 自检响应无效: $result" }
  Write-Host "GrokComputerHost self-test passed: $($json.version) $($json.platform)"
}
Write-Output $target
