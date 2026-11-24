[CmdletBinding()]
param([string]$ArtifactPath = '')

$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$Excluded = @('node_modules', '.git', 'out', 'release', 'local', 'coverage', 'test-results', 'playwright-report')
$TextExtensions = @('.ts','.tsx','.js','.mjs','.cjs','.json','.md','.yml','.yaml','.ps1','.cs','.kt','.gradle','.xml','.html','.css','.toml','.txt','.svg')
$Failures = New-Object 'Collections.Generic.List[string]'

$Paths = & git -C $Root -c core.quotepath=false ls-files --cached --others --exclude-standard 2>$null
$Inventory = if ($LASTEXITCODE -eq 0) { $Paths | ForEach-Object { Get-Item -LiteralPath (Join-Path $Root $_) -ErrorAction SilentlyContinue } } else { Get-ChildItem -LiteralPath $Root -Recurse -File -Force }
$Files = $Inventory | Where-Object {
    $RelativePath = $_.FullName.Substring($Root.Length).TrimStart('\')
    -not ($Excluded | Where-Object { $RelativePath -eq $_ -or $RelativePath.StartsWith("$_\", [StringComparison]::OrdinalIgnoreCase) }) -and
    ($TextExtensions -contains $_.Extension.ToLowerInvariant())
}

$CurrentHome = [Environment]::GetFolderPath('UserProfile')
$CurrentUser = [Environment]::UserName

function Test-EncodedArtifact([string]$Path, [Text.Encoding]$Encoding, [string[]]$Needles) {
    if (-not $Needles.Count) { return $false }
    $Stream = [IO.File]::OpenRead($Path)
    $Decoder = $Encoding.GetDecoder()
    $Bytes = [byte[]]::new(1024 * 1024)
    $Chars = [char[]]::new($Encoding.GetMaxCharCount($Bytes.Length))
    $Carry = ''
    $CarryLength = [Math]::Max(0, (($Needles | ForEach-Object Length | Measure-Object -Maximum).Maximum - 1))
    try {
        while (($Read = $Stream.Read($Bytes, 0, $Bytes.Length)) -gt 0) {
            $CharCount = $Decoder.GetChars($Bytes, 0, $Read, $Chars, 0, $false)
            $Content = ($Carry + [string]::new($Chars, 0, $CharCount)).ToLowerInvariant()
            foreach ($Needle in $Needles) { if ($Content.Contains($Needle)) { return $true } }
            $Carry = if ($CarryLength -and $Content.Length -gt $CarryLength) { $Content.Substring($Content.Length - $CarryLength) } else { $Content }
        }
        return $false
    } finally {
        $Stream.Dispose()
    }
}

$Patterns = @(
    @{ Name = '当前用户主目录'; Regex = [regex]::Escape($CurrentHome) },
    @{ Name = '非占位 Windows 用户路径'; Regex = '(?i)[A-Z]:\\Users\\(?!TestUser(?:\\|$)|Public(?:\\|$)|Default(?:\\|$))[^\\/\r\n]+' },
    @{ Name = '旧本机代理'; Regex = '127\.0\.0\.1:7897' },
    @{ Name = '真实邮箱'; Regex = '(?i)\b[A-Z0-9._%+-]+@(?!example\.(?:com|invalid)\b)[A-Z0-9.-]+\.[A-Z]{2,}\b' }
)
if ($CurrentUser -and $CurrentUser.Length -ge 3) {
    $EscapedUser = [regex]::Escape($CurrentUser)
    $Patterns += @{ Name = '当前用户名'; Regex = "(?i)(?<![A-Za-z0-9_])$EscapedUser(?![A-Za-z0-9_])" }
}
# Detect current adapter addresses without recording them in source or diagnostics.
# Exclude loopback/link-local/unspecified, RFC 2544 benchmark / TUN adapters (198.18.0.0/15),
# RFC 5737 documentation ranges, CGNAT base 100.64.0.0, and .0 CIDR network base literals.
$CurrentAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
    $_.IPAddress -notmatch '^(?:127\.|169\.254\.|0\.|198\.1[89]\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|100\.64\.0\.0$)' -and
    $_.IPAddress -notmatch '\.0$'
} | Select-Object -ExpandProperty IPAddress -Unique)
$MediaCacheRfcTestVectors = @('10.1.2.3', '100.64.0.1', '172.16.0.1', '192.168.1.1', '192.168.1.9', '224.0.0.1')
foreach ($Address in $CurrentAddresses) {
    $Patterns += @{ Name = '当前网卡地址'; Address = $Address; Regex = '(?<![0-9.])' + [regex]::Escape($Address) + '(?![0-9.])' }
}

foreach ($File in $Files) {
    $RelativePath = $File.FullName.Substring($Root.Length).TrimStart('\')
    if ($RelativePath -match '(?i)^docs\\.*(?:HANDOFF|SESSION_TRANSFER|AUDIT_FIXES_).*\.md$') { $Failures.Add("$RelativePath：内部交接不属于公开文档") }
    $Content = Get-Content -LiteralPath $File.FullName -Raw -ErrorAction SilentlyContinue
    if ($null -eq $Content) { continue }
    if ($File.Extension -eq '.md' -and $RelativePath -ne 'AGENTS.md' -and $Content -match '(?:用户原话|用户已经对|已拍板|给 Codex 用|给 Claude 用|可粘贴提示词|用户：|\[Mid-task message:|<handover from=)') { $Failures.Add("$RelativePath：含内部对话或交接口吻") }

    foreach ($Pattern in $Patterns) {
        $IsPackageLockEmail = ($RelativePath -eq 'package-lock.json' -and $Pattern.Name -eq '真实邮箱')
        $IsMediaCacheRfcVector = ($RelativePath -ieq 'src\main\services\media-cache-service.test.ts' -and $Pattern.Name -eq '当前网卡地址' -and ($MediaCacheRfcTestVectors -contains $Pattern.Address))
        if ($Content -match $Pattern.Regex -and -not $IsPackageLockEmail -and -not $IsMediaCacheRfcVector) { $Failures.Add("$RelativePath：$($Pattern.Name)") }
    }
    if ($RelativePath -notmatch '(?i)\.test\.(ts|tsx)$' -and $Content -match '(?i)\b(?:xai-|sk-)[A-Za-z0-9_-]{16,}\b') {
        $Failures.Add("$RelativePath：疑似真实 API Key")
    }
}

foreach ($Forbidden in @('app.local.json','.env','auth.json','accounts.vault')) {
    if (Test-Path -LiteralPath (Join-Path $Root $Forbidden) -PathType Leaf) { $Failures.Add("禁止提交的本地文件存在：$Forbidden") }
}

if ($ArtifactPath) {
    $ArtifactCandidate = if ([IO.Path]::IsPathRooted($ArtifactPath)) { $ArtifactPath } else { Join-Path $Root $ArtifactPath }
    $ResolvedArtifacts = [IO.Path]::GetFullPath($ArtifactCandidate)
    if (-not $ResolvedArtifacts.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) { throw '构建产物路径必须位于仓库内。' }
    $ArtifactNeedles = @($CurrentHome, $(if ($CurrentUser) { "\Users\$CurrentUser" } else { '' })) + $CurrentAddresses | Where-Object { $_ } | ForEach-Object { $_.ToLowerInvariant() }
    foreach ($Artifact in Get-ChildItem -LiteralPath $ResolvedArtifacts -Recurse -File -ErrorAction SilentlyContinue) {
        if ($Artifact.Name -in @('builder-debug.yml','builder-effective-config.yaml')) { continue }
        if ((Test-EncodedArtifact $Artifact.FullName ([Text.Encoding]::UTF8) $ArtifactNeedles) -or (Test-EncodedArtifact $Artifact.FullName ([Text.Encoding]::Unicode) $ArtifactNeedles)) {
            $Failures.Add("构建产物包含本机构建路径：$($Artifact.Name)")
        }
    }
}

if ($Failures.Count) {
    $Failures | Sort-Object -Unique | ForEach-Object { Write-Error $_ }
    throw "公开安全检查失败，共 $($Failures.Count) 项。"
}
Write-Host "公开安全检查通过（$($Files.Count) 个文本文件）。" -ForegroundColor Green
