#requires -Version 7.0

[CmdletBinding()]
param(
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$dist = [System.IO.Path]::GetFullPath((Join-Path $root "dist"))

$files = @(
  "manifest.json",
  "dashboard.html",
  "favicon.svg",
  "favicon-light.svg",
  "favicon-dark.svg",
  "THIRD_PARTY_NOTICES.txt",
  "assets/dashboard.css",
  "assets/extension.css",
  "assets/logo-purple.svg"
)
$directories = @("assets/client", "assets/icons", "assets/presets", "assets/styles", "extension", "_locales")

function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  [System.IO.File]::WriteAllText($Path, $Text, [System.Text.UTF8Encoding]::new($false))
}

function Assert-PathWithin([string]$Candidate, [string]$Parent, [string]$Description) {
  $parentPrefix = $Parent.TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  ) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $Candidate.StartsWith($parentPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe $Description path: $Candidate"
  }
}

# Complete environment and source validation before any existing release artifact is replaced.
if ($PSVersionTable.PSVersion.Major -lt 7) {
  throw "PowerShell 7 or newer is required."
}
if (-not (Test-Path -LiteralPath $root -PathType Container)) {
  throw "Repository root does not exist: $root"
}
if ((Test-Path -LiteralPath $dist) -and -not (Test-Path -LiteralPath $dist -PathType Container)) {
  throw "Release output path exists but is not a directory: $dist"
}
foreach ($file in $files) {
  $source = Join-Path $root $file
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Required package input is missing: $file"
  }
  if ((Get-Item -LiteralPath $source).Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
    throw "Package source cannot be a reparse point: $file"
  }
}
foreach ($directory in $directories) {
  $source = Join-Path $root $directory
  if (-not (Test-Path -LiteralPath $source -PathType Container)) {
    throw "Required package input directory is missing: $directory"
  }
  $reparsePoint = Get-ChildItem -LiteralPath $source -Recurse -Force |
    Where-Object { $_.Attributes -band [System.IO.FileAttributes]::ReparsePoint } |
    Select-Object -First 1
  if ($reparsePoint) {
    throw "Package source cannot contain a reparse point: $($reparsePoint.FullName)"
  }
}

$presetImageDirectory = Join-Path $root "assets/presets/inspiration"
$presetImages = @(Get-ChildItem -LiteralPath $presetImageDirectory -File -Filter "*.webp")
if ($presetImages.Count -ne 24) {
  throw "The inspiration preset must contain exactly 24 WebP covers; found $($presetImages.Count)."
}
$oversizedPresetImage = $presetImages | Where-Object { $_.Length -gt 200KB } | Select-Object -First 1
if ($oversizedPresetImage) {
  throw "Preset cover exceeds 200 KiB: $($oversizedPresetImage.Name)"
}
$presetImageBytes = [int64](($presetImages | Measure-Object -Property Length -Sum).Sum)
if ($presetImageBytes -gt 3.5MB) {
  throw "Preset covers exceed the 3.5 MiB total budget: $presetImageBytes bytes"
}

$supportUrl = [string]$env:REQUIRED_SUPPORT_URL
if ([string]::IsNullOrWhiteSpace($supportUrl)) {
  throw "REQUIRED_SUPPORT_URL is not set. Configure the real HTTPS support endpoint before packaging."
}
$supportUrl = $supportUrl.Trim()
$supportUri = $null
if (-not [System.Uri]::TryCreate($supportUrl, [System.UriKind]::Absolute, [ref]$supportUri) -or
  $supportUri.Scheme -ne "https" -or
  [string]::IsNullOrWhiteSpace($supportUri.Host) -or
  -not [string]::IsNullOrEmpty($supportUri.UserInfo) -or
  $supportUri.IsLoopback -or
  -not $supportUri.Host.Contains(".") -or
  $supportUri.Host -match '(?i)(?:^|\.)(?:example\.(?:com|org|net)|invalid|test|localhost)$') {
  throw "REQUIRED_SUPPORT_URL must be a real public HTTPS URL without embedded credentials."
}
$encodedSupportUrl = [System.Net.WebUtility]::HtmlEncode($supportUrl)
foreach ($relative in @(
  "docs/privacy.html",
  "docs/support.html",
  "docs/zh-TW/privacy.html",
  "docs/zh-TW/support.html",
  "docs/en/privacy.html",
  "docs/en/support.html"
)) {
  $path = Join-Path $root $relative
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Required release document is missing: $relative"
  }
  $text = Get-Content -Raw -LiteralPath $path
  if (-not $text.Contains("href=`"$encodedSupportUrl`"")) {
    throw "$relative must contain a clickable support link whose href exactly matches REQUIRED_SUPPORT_URL."
  }
}

$sourceManifestPath = Join-Path $root "manifest.json"
try {
  $sourceManifest = Get-Content -Raw -LiteralPath $sourceManifestPath | ConvertFrom-Json
} catch {
  throw "manifest.json is not valid JSON: $($_.Exception.Message)"
}
if ($sourceManifest.manifest_version -ne 3) {
  throw "Source manifest is not Manifest V3."
}
if (-not $Version) { $Version = [string]$sourceManifest.version }
$Version = [string]$Version
if ($Version -ne [string]$sourceManifest.version) {
  throw "Requested version $Version does not match manifest version $($sourceManifest.version)."
}
if ($Version -notmatch '^(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){0,3}$') {
  throw "Invalid Chrome extension version: $Version"
}
foreach ($part in $Version.Split('.')) {
  if ([int]$part -gt 65535) { throw "Invalid Chrome extension version component: $part" }
}

try {
  Add-Type -AssemblyName System.IO.Compression
} catch {
  throw "The .NET ZIP runtime is unavailable: $($_.Exception.Message)"
}

$nonce = [System.Guid]::NewGuid().ToString("N")
$stage = [System.IO.Path]::GetFullPath((Join-Path $dist ".ampira-stage-$nonce"))
$temporaryZip = [System.IO.Path]::GetFullPath((Join-Path $dist ".ampira-$Version-$nonce.zip"))
$temporarySha = [System.IO.Path]::GetFullPath((Join-Path $dist ".ampira-$Version-$nonce.zip.sha256"))
$temporaryManifest = [System.IO.Path]::GetFullPath((Join-Path $dist ".ampira-$Version-$nonce.manifest.json"))
$zip = [System.IO.Path]::GetFullPath((Join-Path $dist "ampira-$Version.zip"))
$shaSidecar = [System.IO.Path]::GetFullPath((Join-Path $dist "ampira-$Version.zip.sha256"))
$packageManifest = [System.IO.Path]::GetFullPath((Join-Path $dist "ampira-$Version.manifest.json"))
foreach ($candidate in @($stage, $temporaryZip, $temporarySha, $temporaryManifest, $zip, $shaSidecar, $packageManifest)) {
  Assert-PathWithin $candidate $dist "release output"
}

$allowedFiles = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$files | ForEach-Object { [void]$allowedFiles.Add($_.Replace("\", "/")) }
$allowedPatterns = @(
  '^assets/client/(?:[a-z0-9-]+/)*[a-z0-9-]+\.mjs$',
  '^assets/icons/[a-z0-9-]+\.svg$',
  '^assets/presets/inspiration/[a-z0-9-]+\.webp$',
  '^assets/styles/[a-z0-9-]+\.css$',
  '^extension/service-worker\.mjs$',
  '^extension/core/[a-z0-9-]+\.mjs$',
  '^extension/runtime/(?:[a-z0-9-]+/)*[a-z0-9-]+\.mjs$',
  '^extension/icons/icon-(?:16|32|48|128)\.png$',
  '^_locales/(?:en|zh_CN|zh_TW)/messages\.json$'
)
$localAbsolutePathPattern = '(?im)(?:\b[A-Z]:[\\/]|file:(?:/{2,3}|\\\\)|\\\\[A-Za-z0-9._-]+\\[A-Za-z0-9._-]+(?:\\|$)|(?:^|[\s"''])/(?:Users|home|private|tmp|var/folders|mnt/[A-Za-z]|Volumes|etc|opt|root|srv|usr|workspace)(?:/|$))'
$fixedTimestamp = [System.DateTimeOffset]::new(2000, 1, 1, 0, 0, 0, [System.TimeSpan]::Zero)

New-Item -ItemType Directory -Force -Path $dist | Out-Null
New-Item -ItemType Directory -Path $stage | Out-Null

try {
  foreach ($file in $files) {
    $source = Join-Path $root $file
    $target = Join-Path $stage $file
    New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
    Copy-Item -LiteralPath $source -Destination $target
  }

  foreach ($directory in $directories) {
    $source = Join-Path $root $directory
    $target = Join-Path $stage $directory
    New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Recurse
  }

  $manifest = Get-Content -Raw -LiteralPath (Join-Path $stage "manifest.json") | ConvertFrom-Json
  if ($manifest.manifest_version -ne 3) { throw "Packaged manifest is not Manifest V3." }
  if ([string]$manifest.version -ne $Version) {
    throw "Requested version $Version does not match manifest version $($manifest.version)."
  }

  $stagedFiles = @(Get-ChildItem -LiteralPath $stage -Recurse -File | Sort-Object {
    [System.IO.Path]::GetRelativePath($stage, $_.FullName).Replace("\", "/")
  })
  if (-not $stagedFiles.Count) { throw "No files were staged for packaging." }

  $fileRecords = @()
  foreach ($item in $stagedFiles) {
    $relative = [System.IO.Path]::GetRelativePath($stage, $item.FullName).Replace("\", "/")
    $allowed = $allowedFiles.Contains($relative) -or $allowedPatterns.Where({ $relative -match $_ }).Count -gt 0
    if (-not $allowed) { throw "Non-allowlisted package file: $relative" }
    if ($relative -match '(^|/)(dashboard-cache|tests?|output|dist)(/|$)|(^|/)\.(env|git)') {
      throw "Forbidden package path: $relative"
    }
    if ($item.Extension -in @(".mjs", ".js", ".json", ".html", ".css", ".md", ".txt", ".svg")) {
      $text = Get-Content -Raw -LiteralPath $item.FullName
      if ($text -match '(?i)(sk-[a-z0-9_-]{20,}|BSA[a-z0-9_-]{20,})') {
        throw "Possible API key in package: $relative"
      }
      if ($text -match '(?i)(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[A-Za-z0-9-]{20,})') {
        throw "Possible credential in package: $relative"
      }
      if ($text -match '(?i)<script[^>]+src=["'']https?://') {
        throw "Remote script in package: $relative"
      }
      if ($text -match $localAbsolutePathPattern) {
        throw "Local absolute path in package: $relative"
      }
    }
    $fileRecords += [ordered]@{
      path = $relative
      size = [int64]$item.Length
      sha256 = Get-Sha256 $item.FullName
    }
  }

  $zipStream = [System.IO.File]::Open(
    $temporaryZip,
    [System.IO.FileMode]::CreateNew,
    [System.IO.FileAccess]::ReadWrite,
    [System.IO.FileShare]::None
  )
  try {
    $archive = [System.IO.Compression.ZipArchive]::new(
      $zipStream,
      [System.IO.Compression.ZipArchiveMode]::Create,
      $true,
      [System.Text.Encoding]::UTF8
    )
    try {
      foreach ($item in $stagedFiles) {
        $relative = [System.IO.Path]::GetRelativePath($stage, $item.FullName).Replace("\", "/")
        $entry = $archive.CreateEntry($relative, [System.IO.Compression.CompressionLevel]::Optimal)
        $entry.LastWriteTime = $fixedTimestamp
        $entry.ExternalAttributes = 0
        $inputStream = [System.IO.File]::OpenRead($item.FullName)
        $entryStream = $entry.Open()
        try {
          $inputStream.CopyTo($entryStream)
        } finally {
          $entryStream.Dispose()
          $inputStream.Dispose()
        }
      }
    } finally {
      $archive.Dispose()
    }
  } finally {
    $zipStream.Dispose()
  }

  $zipSize = [int64](Get-Item -LiteralPath $temporaryZip).Length
  if ($zipSize -gt 4.5MB) {
    throw "Packaged ZIP exceeds the 4.5 MiB release budget: $zipSize bytes"
  }

  $archive = [System.IO.Compression.ZipFile]::OpenRead($temporaryZip)
  try {
    $archiveFiles = @($archive.Entries | Where-Object { $_.Name } | ForEach-Object { $_.FullName.Replace("\", "/") })
    $stagedRelativeFiles = @($fileRecords | ForEach-Object { $_.path })
    if ($archiveFiles -notcontains "manifest.json") { throw "Packaged ZIP has no root manifest.json." }
    $pathDifference = @(Compare-Object ($stagedRelativeFiles | Sort-Object) ($archiveFiles | Sort-Object))
    if ($pathDifference.Count) {
      throw "Packaged ZIP paths do not match staging: $($pathDifference.InputObject -join ', ')"
    }
    foreach ($relative in $archiveFiles) {
      if ($relative.StartsWith("/") -or $relative.Contains("../")) { throw "Unsafe ZIP entry: $relative" }
    }
  } finally {
    $archive.Dispose()
  }

  $zipHash = Get-Sha256 $temporaryZip
  $zipName = [System.IO.Path]::GetFileName($zip)
  Write-Utf8NoBom $temporarySha "$zipHash  $zipName`n"

  $githubSha = if ([string]::IsNullOrWhiteSpace($env:GITHUB_SHA)) { $null } else { $env:GITHUB_SHA.Trim() }
  $metadata = [ordered]@{
    schemaVersion = 1
    package = [ordered]@{
      file = $zipName
      version = $Version
      sha256 = $zipHash
      size = [int64](Get-Item -LiteralPath $temporaryZip).Length
      deterministicTimestamp = $fixedTimestamp.ToString("yyyy-MM-ddTHH:mm:ssZ")
    }
    source = [ordered]@{
      githubSha = $githubSha
    }
    files = $fileRecords
  }
  Write-Utf8NoBom $temporaryManifest (($metadata | ConvertTo-Json -Depth 6) + "`n")

  # Only validated temporary outputs can replace the final versioned artifacts.
  [System.IO.File]::Move($temporaryZip, $zip, $true)
  [System.IO.File]::Move($temporarySha, $shaSidecar, $true)
  [System.IO.File]::Move($temporaryManifest, $packageManifest, $true)

  Write-Output $zip
  Write-Output $shaSidecar
  Write-Output $packageManifest
} finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  foreach ($temporaryPath in @($temporaryZip, $temporarySha, $temporaryManifest)) {
    if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force }
  }
}
