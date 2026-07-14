#requires -Version 7.0

[CmdletBinding()]
param(
  [string]$SourceUrl = "https://download.geonames.org/export/dump/CN.zip",
  [string]$Output = ""
)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
if (-not $Output) {
  $Output = Join-Path $root "extension/core/china-location-data.mjs"
}
$outputPath = [System.IO.Path]::GetFullPath($Output)
$rootPrefix = $root.TrimEnd(
  [System.IO.Path]::DirectorySeparatorChar,
  [System.IO.Path]::AltDirectorySeparatorChar
) + [System.IO.Path]::DirectorySeparatorChar
if (-not $outputPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Output must stay inside the repository: $outputPath"
}

Add-Type -AssemblyName System.IO.Compression

function Get-TextAliases([string]$Name, [string]$AsciiName, [string]$LocalizedName) {
  $values = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($value in @($Name, $AsciiName, $LocalizedName)) {
    $text = [string]$value
    $text = $text.Trim()
    if (-not $text -or $text.Length -gt 40) { continue }
    if ($text -notmatch '[\u3400-\u9fff]' -and $text -notmatch '^[A-Za-z0-9 .''-]+$') { continue }
    $normalized = $text.Normalize([Text.NormalizationForm]::FormKC).ToLowerInvariant()
    $normalized = [regex]::Replace($normalized, '[^\p{L}\p{N}]', '')
    if ($normalized.Length -ge 2) { [void]$values.Add($normalized) }
  }
  return @($values | Sort-Object)
}

function Get-HanName([string]$Name, [string]$AlternateNames, [string]$FeatureCode) {
  $values = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  foreach ($value in @($Name) + $AlternateNames.Split(",")) {
    $text = ([string]$value).Trim()
    if ($text -match '^[\u3400-\u9fff·]{2,20}$' -and $text -notmatch '(?:街道|镇|乡)$') {
      [void]$values.Add($text)
    }
  }
  $suffix = switch -Regex ($FeatureCode) {
    '^ADM1$' { '(?:省|市|自治区|特别行政区)$'; break }
    '^(?:ADM2|PPLA2)$' { '(?:市|自治州|地区|盟)$'; break }
    '^(?:PPLA3)$' { '(?:市|县|区|自治县|旗|自治旗)$'; break }
    default { '(?:市|县|区|自治州|地区|盟|旗)$' }
  }
  $preferred = @($values | Where-Object { $_ -match $suffix } | Sort-Object Length, { $_ })
  if ($preferred.Count) { return $preferred[0] }
  $fallback = @($values | Sort-Object Length, { $_ })
  if ($fallback.Count) { return $fallback[0] }
  return $Name
}

function Read-GeoNamesArchive([byte[]]$Bytes) {
  $memory = [System.IO.MemoryStream]::new($Bytes)
  $archive = [System.IO.Compression.ZipArchive]::new(
    $memory,
    [System.IO.Compression.ZipArchiveMode]::Read,
    $false,
    [Text.Encoding]::UTF8
  )
  try {
    $entry = $archive.Entries | Where-Object { $_.Name -eq "CN.txt" } | Select-Object -First 1
    if (-not $entry) { throw "CN.txt was not found in the GeoNames archive." }
    $reader = [System.IO.StreamReader]::new($entry.Open(), [Text.Encoding]::UTF8)
    $admin1 = @{}
    $admin2 = @{}
    $places = [System.Collections.Generic.List[object]]::new()
    try {
      while (($line = $reader.ReadLine()) -ne $null) {
        $parts = $line.Split("`t")
        if ($parts.Length -lt 19) { continue }
        $featureClass = $parts[6]
        $featureCode = $parts[7]
        $admin1Code = $parts[10]
        $admin2Code = $parts[11]
        $record = [pscustomobject]@{
          id = [int64]$parts[0]
          name = $parts[1]
          asciiName = $parts[2]
          alternateNames = $parts[3]
          latitude = [double]::Parse($parts[4], [Globalization.CultureInfo]::InvariantCulture)
          longitude = [double]::Parse($parts[5], [Globalization.CultureInfo]::InvariantCulture)
          featureCode = $featureCode
          admin1Code = $admin1Code
          admin2Code = $admin2Code
          population = if ($parts[14]) { [int64]$parts[14] } else { 0 }
        }
        if ($featureClass -eq "A" -and $featureCode -eq "ADM1") {
          $admin1[$admin1Code] = $record
        } elseif ($featureClass -eq "A" -and $featureCode -eq "ADM2") {
          $admin2["$admin1Code.$admin2Code"] = $record
        } elseif ($featureClass -eq "P" -and $featureCode -match '^(?:PPLC|PPLA|PPLA2|PPLA3)$') {
          $places.Add($record)
        }
      }
    } finally {
      $reader.Dispose()
    }
    return [pscustomobject]@{ admin1 = $admin1; admin2 = $admin2; places = $places }
  } finally {
    $archive.Dispose()
    $memory.Dispose()
  }
}

$client = [System.Net.Http.HttpClient]::new()
try {
  $bytes = $client.GetByteArrayAsync($SourceUrl).GetAwaiter().GetResult()
} finally {
  $client.Dispose()
}
$source = Read-GeoNamesArchive $bytes
$admin1ChineseNames = @{
  "01" = "安徽省"; "02" = "浙江省"; "03" = "江西省"; "04" = "江苏省"; "05" = "吉林省"
  "06" = "青海省"; "07" = "福建省"; "08" = "黑龙江省"; "09" = "河南省"; "10" = "河北省"
  "11" = "湖南省"; "12" = "湖北省"; "13" = "新疆维吾尔自治区"; "14" = "西藏自治区"; "15" = "甘肃省"
  "16" = "广西壮族自治区"; "18" = "贵州省"; "19" = "辽宁省"; "20" = "内蒙古自治区"; "21" = "宁夏回族自治区"
  "22" = "北京市"; "23" = "上海市"; "24" = "山西省"; "25" = "山东省"; "26" = "陕西省"
  "28" = "天津市"; "29" = "云南省"; "30" = "广东省"; "31" = "海南省"; "32" = "四川省"
  "33" = "重庆市"; "34" = "香港特别行政区"
}
$records = [System.Collections.Generic.List[object]]::new()
foreach ($place in $source.places) {
  $admin1 = $source.admin1[$place.admin1Code]
  $admin2 = $source.admin2["$($place.admin1Code).$($place.admin2Code)"]
  if (-not $admin1) { continue }
  $placeZh = Get-HanName $place.name $place.alternateNames $place.featureCode
  $records.Add([ordered]@{
    id = $place.id
    zh = $placeZh
    en = $place.name
    a1zh = if ($admin1ChineseNames[$place.admin1Code]) { $admin1ChineseNames[$place.admin1Code] } else { Get-HanName $admin1.name $admin1.alternateNames "ADM1" }
    a1en = $admin1.name
    a2zh = if ($admin2) { Get-HanName $admin2.name $admin2.alternateNames "ADM2" } else { "" }
    a2en = if ($admin2) { $admin2.name } else { "" }
    lat = [Math]::Round($place.latitude, 6)
    lon = [Math]::Round($place.longitude, 6)
    f = $place.featureCode
    p = $place.population
    keys = @(Get-TextAliases $place.name $place.asciiName $placeZh)
  })
}
$ordered = @($records | Sort-Object @{ Expression = "id"; Ascending = $true })
$json = $ordered | ConvertTo-Json -Depth 4 -Compress
$generatedOn = Get-Date -AsUTC -Format "yyyy-MM-dd"
$contents = @"
// Generated by scripts/generate-china-locations.ps1 from GeoNames CN.zip on $generatedOn.
// GeoNames data is licensed under CC BY 4.0: https://www.geonames.org/
export const CHINA_LOCATION_RECORDS = Object.freeze($json);
"@
[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($outputPath)) | Out-Null
[System.IO.File]::WriteAllText($outputPath, $contents, [Text.UTF8Encoding]::new($false))
Write-Output "$($ordered.Count) locations -> $outputPath"
