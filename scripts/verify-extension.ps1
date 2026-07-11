#requires -Version 7.0

[CmdletBinding()]
param(
  [switch]$Package
)

$ErrorActionPreference = "Stop"
$supportUrlPlaceholder = "__REQUIRED_SUPPORT_URL__"
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$rootPrefix = $root.TrimEnd(
  [System.IO.Path]::DirectorySeparatorChar,
  [System.IO.Path]::AltDirectorySeparatorChar
) + [System.IO.Path]::DirectorySeparatorChar

function Invoke-Node([string[]]$Arguments) {
  & node @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "node $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Assert-Toolchain {
  if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw "PowerShell 7 or newer is required."
  }
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) { throw "Node.js 20 or newer is required but node was not found." }
  $nodeVersionOutput = @(& node --version 2>&1)
  $nodeExitCode = $LASTEXITCODE
  $nodeVersion = if ($nodeVersionOutput.Count) { $nodeVersionOutput[0].ToString().Trim() } else { "" }
  if ($nodeExitCode -ne 0 -or $nodeVersion -notmatch '^v(?<major>\d+)\.') {
    throw "Unable to determine the Node.js version."
  }
  if ([int]$Matches.major -lt 20) {
    throw "Node.js 20 or newer is required; found $nodeVersion."
  }
}

function Resolve-RepositoryFile(
  [string]$BaseDirectory,
  [string]$Reference,
  [string]$Context
) {
  if ([string]::IsNullOrWhiteSpace($Reference)) {
    throw "Empty local resource reference in $Context."
  }

  $cleanReference = ($Reference -split '[?#]', 2)[0].Replace("/", [System.IO.Path]::DirectorySeparatorChar)
  if ([string]::IsNullOrWhiteSpace($cleanReference)) {
    throw "Invalid local resource reference '$Reference' in $Context."
  }

  if ($cleanReference.StartsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $candidate = Join-Path $root $cleanReference.TrimStart([System.IO.Path]::DirectorySeparatorChar)
  } else {
    $candidate = Join-Path $BaseDirectory $cleanReference
  }
  $fullPath = [System.IO.Path]::GetFullPath($candidate)
  if (-not $fullPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Resource escapes the repository in $Context`: $Reference"
  }
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    throw "Missing local resource in $Context`: $Reference"
  }
  return $fullPath
}

function Assert-ManifestResource([string]$Reference, [string]$Context) {
  if ([string]::IsNullOrWhiteSpace($Reference)) { return }
  if ($Reference -match '[*]') { return }
  [void](Resolve-RepositoryFile $root $Reference "manifest $Context")
}

function Assert-LocaleFile([System.IO.FileInfo]$LocaleFile) {
  $messages = Get-Content -Raw -LiteralPath $LocaleFile.FullName | ConvertFrom-Json
  foreach ($entry in $messages.PSObject.Properties) {
    if ($null -eq $entry.Value -or
      $entry.Value.message -isnot [string] -or
      [string]::IsNullOrWhiteSpace($entry.Value.message)) {
      throw "Locale message '$($entry.Name)' is empty or invalid in $($LocaleFile.FullName)."
    }
  }
  return $messages
}

function Assert-LocalModuleImports([System.IO.FileInfo]$Module) {
  $text = Get-Content -Raw -LiteralPath $Module.FullName
  $relative = [System.IO.Path]::GetRelativePath($root, $Module.FullName).Replace("\", "/")

  if ($text -match '(?s)\bimport\s*\(\s*(?!["''])') {
    throw "Non-literal dynamic import is not allowed in $relative."
  }
  if ($text -match '(?i)\bimportScripts\s*\(') {
    throw "importScripts is not allowed in $relative."
  }
  if ($text -match '(?i)(?:\.\s*(?:innerHTML|outerHTML|srcdoc)|\[\s*["''](?:innerHTML|outerHTML|srcdoc)["'']\s*\])\s*(?:(?:\|\||&&|\?\?|[+\-*/%&|^])?=)|(?i)\.\s*(?:insertAdjacentHTML|setHTMLUnsafe)\s*\(|(?i)\bdocument\s*\.\s*writeln?\s*\(') {
    throw "Unsafe HTML DOM sink in $relative."
  }

  $patterns = @(
    '(?ms)^\s*(?:import|export)\b(?:(?!;).)*?\bfrom\s*(?<quote>["''])(?<specifier>[^"'']+)\k<quote>',
    '(?m)^\s*import\s*(?<quote>["''])(?<specifier>[^"'']+)\k<quote>\s*;?',
    '(?s)\bimport\s*\(\s*(?<quote>["''])(?<specifier>[^"'']+)\k<quote>'
  )
  $specifiers = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  foreach ($pattern in $patterns) {
    foreach ($match in [regex]::Matches($text, $pattern)) {
      [void]$specifiers.Add($match.Groups['specifier'].Value)
    }
  }

  foreach ($specifier in $specifiers) {
    if (-not ($specifier.StartsWith("./") -or $specifier.StartsWith("../"))) {
      throw "Non-local module import '$specifier' in $relative."
    }
    [void](Resolve-RepositoryFile $Module.DirectoryName $specifier "module $relative")
  }
}

function Assert-HtmlAssetReferences([System.IO.FileInfo]$HtmlFile) {
  $text = Get-Content -Raw -LiteralPath $HtmlFile.FullName
  $relative = [System.IO.Path]::GetRelativePath($root, $HtmlFile.FullName).Replace("\", "/")
  $pattern = '(?is)<(?<tag>script|link|img)\b[^>]*?\b(?<attribute>src|href)\s*=\s*(?<quote>["''])(?<reference>.*?)\k<quote>'
  foreach ($match in [regex]::Matches($text, $pattern)) {
    $tag = $match.Groups['tag'].Value.ToLowerInvariant()
    $reference = $match.Groups['reference'].Value.Trim()
    if (-not $reference -or $reference.StartsWith("#")) { continue }
    if ($reference -match '(?i)^javascript:') {
      throw "JavaScript URL in HTML asset reference in $relative`: $reference"
    }
    if ($reference.StartsWith("//")) {
      throw "Protocol-relative HTML asset reference in $relative`: $reference"
    }
    if ($reference -match '^[a-zA-Z][a-zA-Z0-9+.-]*:') {
      if ($tag -eq "script") {
        throw "Remote script reference in $relative`: $reference"
      }
      continue
    }
    [void](Resolve-RepositoryFile $HtmlFile.DirectoryName $reference "HTML $relative")
  }
}

function Assert-DocsLinks([System.IO.FileInfo]$HtmlFile) {
  $text = Get-Content -Raw -LiteralPath $HtmlFile.FullName
  $relative = [System.IO.Path]::GetRelativePath($root, $HtmlFile.FullName).Replace("\", "/")
  $pattern = '(?is)<a\b[^>]*?\bhref\s*=\s*(?<quote>["''])(?<reference>.*?)\k<quote>'
  foreach ($match in [regex]::Matches($text, $pattern)) {
    $reference = $match.Groups['reference'].Value.Trim()
    if (-not $reference -or $reference.StartsWith("#")) { continue }
    if ($reference -eq $supportUrlPlaceholder) { continue }
    if ($reference -match '(?i)^(?:javascript|data|vbscript):') {
      throw "Unsafe link in $relative`: $reference"
    }
    if ($reference.StartsWith("//")) {
      throw "Protocol-relative link in $relative`: $reference"
    }
    if ($reference -match '^[a-zA-Z][a-zA-Z0-9+.-]*:') {
      if ($reference -notmatch '^https://') {
        throw "Public documentation link must use HTTPS in $relative`: $reference"
      }
      continue
    }
    [void](Resolve-RepositoryFile $HtmlFile.DirectoryName $reference "documentation link $relative")
  }
}

function Assert-ReleaseMetadata([System.IO.FileInfo[]]$DocsHtmlFiles) {
  $supportUrl = [string]$env:REQUIRED_SUPPORT_URL
  if ([string]::IsNullOrWhiteSpace($supportUrl)) {
    throw "REQUIRED_SUPPORT_URL is not set. Configure the real HTTPS support endpoint and replace $supportUrlPlaceholder in docs/ before packaging."
  }
  $supportUrl = $supportUrl.Trim()
  $supportUri = $null
  if (-not [System.Uri]::TryCreate($supportUrl, [System.UriKind]::Absolute, [ref]$supportUri) -or
    $supportUri.Scheme -ne "https" -or
    [string]::IsNullOrWhiteSpace($supportUri.Host) -or
    -not [string]::IsNullOrEmpty($supportUri.UserInfo)) {
    throw "REQUIRED_SUPPORT_URL must be an absolute HTTPS URL without embedded credentials."
  }
  if ($supportUri.IsLoopback -or
    -not $supportUri.Host.Contains(".") -or
    $supportUri.Host -match '(?i)(?:^|\.)(?:example\.(?:com|org|net)|invalid|test|localhost)$') {
    throw "REQUIRED_SUPPORT_URL must be a real public endpoint, not localhost or an example domain."
  }

  $encodedSupportUrl = [System.Net.WebUtility]::HtmlEncode($supportUrl)
  $supportDocuments = @(
    "docs/privacy.html",
    "docs/support.html",
    "docs/zh-TW/privacy.html",
    "docs/zh-TW/support.html",
    "docs/en/privacy.html",
    "docs/en/support.html"
  )
  foreach ($relative in $supportDocuments) {
    $path = Join-Path $root $relative
    $text = Get-Content -Raw -LiteralPath $path
    if (-not $text.Contains("href=`"$encodedSupportUrl`"")) {
      throw "$relative must contain a clickable support link whose href exactly matches REQUIRED_SUPPORT_URL."
    }
  }

  $releaseFiles = @($DocsHtmlFiles) + @(
    Get-ChildItem -LiteralPath (Join-Path $root "store") -Recurse -File -Filter "*.md"
  ) + @((Get-Item -LiteralPath (Join-Path $root "README.md")))
  $placeholderPatterns = @(
    '__REQUIRED_[A-Z0-9_]+__',
    '(?i)\b(?:REPLACE[_ -]?ME|YOUR_(?:SUPPORT_)?URL)\b',
    '(?i)https?://(?:www\.)?example\.(?:com|org|net)(?:/|$)',
    '(?i)<!--\s*(?:TODO|TBD|FIXME)\b'
  )
  foreach ($file in $releaseFiles) {
    $text = Get-Content -Raw -LiteralPath $file.FullName
    foreach ($pattern in $placeholderPatterns) {
      if ($text -match $pattern) {
        $relative = [System.IO.Path]::GetRelativePath($root, $file.FullName).Replace("\", "/")
        throw "Unresolved release placeholder in $relative`: $($Matches[0])"
      }
    }
  }
}

Push-Location $root
try {
  Assert-Toolchain
  $tests = Get-ChildItem -LiteralPath (Join-Path $root "tests") -File -Filter "*.mjs" | Sort-Object Name
  if (-not $tests.Count) { throw "No top-level tests/*.mjs files found." }
  foreach ($test in $tests) { Invoke-Node @($test.FullName) }

  $moduleRoots = @(
    (Join-Path $root "extension"),
    (Join-Path $root "assets\client")
  )
  $modules = Get-ChildItem -LiteralPath $moduleRoots -Recurse -File -Filter "*.mjs" | Sort-Object FullName
  if (-not $modules.Count) { throw "No extension modules found." }
  foreach ($module in $modules) {
    Invoke-Node @("--check", $module.FullName)
    Assert-LocalModuleImports $module
  }

  $manifestPath = Join-Path $root "manifest.json"
  $manifestText = Get-Content -Raw -LiteralPath $manifestPath
  $manifest = $manifestText | ConvertFrom-Json
  if ($manifest.manifest_version -ne 3) { throw "Manifest is not Manifest V3." }

  $defaultLocalePath = Join-Path $root "_locales\$($manifest.default_locale)\messages.json"
  if (-not (Test-Path -LiteralPath $defaultLocalePath -PathType Leaf)) {
    throw "Manifest default locale does not exist: $($manifest.default_locale)"
  }
  $defaultMessages = Assert-LocaleFile (Get-Item -LiteralPath $defaultLocalePath)
  $defaultMessageNames = @($defaultMessages.PSObject.Properties.Name)
  foreach ($match in [regex]::Matches($manifestText, '__MSG_(?<key>[A-Za-z0-9_@]+)__')) {
    $key = $match.Groups['key'].Value
    if ($defaultMessageNames -notcontains $key) {
      throw "Manifest message key '$key' is missing from the default locale."
    }
  }
  Get-ChildItem -LiteralPath (Join-Path $root "_locales") -Recurse -File -Filter "messages.json" |
    Sort-Object FullName |
    ForEach-Object { [void](Assert-LocaleFile $_) }

  Assert-ManifestResource $manifest.background.service_worker "background.service_worker"
  if ($manifest.chrome_url_overrides) {
    foreach ($property in $manifest.chrome_url_overrides.PSObject.Properties) {
      Assert-ManifestResource ([string]$property.Value) "chrome_url_overrides.$($property.Name)"
    }
  }
  if ($manifest.icons) {
    foreach ($property in $manifest.icons.PSObject.Properties) {
      Assert-ManifestResource ([string]$property.Value) "icons.$($property.Name)"
    }
  }
  if ($manifest.action.default_icon) {
    foreach ($property in $manifest.action.default_icon.PSObject.Properties) {
      Assert-ManifestResource ([string]$property.Value) "action.default_icon.$($property.Name)"
    }
  }
  Assert-ManifestResource $manifest.action.default_popup "action.default_popup"
  Assert-ManifestResource $manifest.options_page "options_page"
  Assert-ManifestResource $manifest.options_ui.page "options_ui.page"
  Assert-ManifestResource $manifest.devtools_page "devtools_page"
  Assert-ManifestResource $manifest.side_panel.default_path "side_panel.default_path"
  foreach ($contentScript in @($manifest.content_scripts)) {
    foreach ($reference in @($contentScript.js) + @($contentScript.css)) {
      Assert-ManifestResource ([string]$reference) "content_scripts"
    }
  }
  foreach ($entry in @($manifest.web_accessible_resources)) {
    foreach ($reference in @($entry.resources)) {
      Assert-ManifestResource ([string]$reference) "web_accessible_resources"
    }
  }

  Get-ChildItem -LiteralPath $root -File -Filter "*.html" |
    Sort-Object FullName |
    ForEach-Object { Assert-HtmlAssetReferences $_ }

  $docsHtmlFiles = @(Get-ChildItem -LiteralPath (Join-Path $root "docs") -Recurse -File -Filter "*.html" | Sort-Object FullName)
  if (-not $docsHtmlFiles.Count) { throw "No docs/**/*.html files found." }
  foreach ($htmlFile in $docsHtmlFiles) {
    Assert-HtmlAssetReferences $htmlFile
    Assert-DocsLinks $htmlFile
  }

  if ($Package) {
    Assert-ReleaseMetadata $docsHtmlFiles
    & (Join-Path $PSScriptRoot "package-extension.ps1")
  }
} finally {
  Pop-Location
}
