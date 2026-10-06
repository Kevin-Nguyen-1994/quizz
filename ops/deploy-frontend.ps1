[CmdletBinding()]
param(
  [string]$ProjectRoot,
  [string]$SmokeUrl = 'http://localhost:3000/',
  [int]$Retention = 3,
  [switch]$RollbackLatest,
  [string]$RollbackVersion
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = Split-Path -Parent $PSScriptRoot
}

function Assert-WithinProject([string]$Candidate, [string]$Root) {
  $full = [IO.Path]::GetFullPath($Candidate)
  $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
  if (-not $full.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Path is outside project root: $full"
  }
  return $full
}

function Copy-DirectoryContents([string]$Source, [string]$Destination) {
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Destination -Recurse -Force
}

function New-VersionName {
  return (Get-Date -Format 'yyyy-MM-dd-HHmmss-fff')
}

function Get-Sha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  try {
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
      return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '')
    } finally {
      $sha.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

if ($Retention -lt 3) { throw 'Retention must be at least 3.' }
if ($RollbackLatest -and $RollbackVersion) {
  throw 'Use either -RollbackLatest or -RollbackVersion, not both.'
}

$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$stagingDir = Assert-WithinProject (Join-Path $ProjectRoot 'artifacts\client-dist') $ProjectRoot
$productionDir = Assert-WithinProject (Join-Path $ProjectRoot 'client\dist') $ProjectRoot
$versionsDir = Assert-WithinProject (Join-Path $ProjectRoot 'deployments\frontend') $ProjectRoot
$clientDir = Assert-WithinProject (Join-Path $ProjectRoot 'client') $ProjectRoot

New-Item -ItemType Directory -Path $versionsDir -Force | Out-Null

$isRollback = $RollbackLatest -or -not [string]::IsNullOrWhiteSpace($RollbackVersion)
if ($isRollback) {
  $available = @(Get-ChildItem -LiteralPath $versionsDir -Directory | Sort-Object Name -Descending)
  if ($RollbackVersion) {
    $source = $available | Where-Object Name -EQ $RollbackVersion | Select-Object -First 1
  } else {
    $source = $available | Select-Object -First 1
  }
  if (-not $source) { throw 'No matching frontend rollback version was found.' }
  $sourceDir = Assert-WithinProject $source.FullName $ProjectRoot
  $action = 'rollback'
} else {
  $sourceDir = $stagingDir
  $action = 'deploy'
}

$sourceIndex = Join-Path $sourceDir 'index.html'
if (-not (Test-Path -LiteralPath $sourceIndex -PathType Leaf)) {
  throw "Frontend source is incomplete; index.html not found: $sourceIndex"
}

$sourceHtml = Get-Content -LiteralPath $sourceIndex -Raw
$assetMatch = [regex]::Match($sourceHtml, '(?:src|href)="(/assets/[^"]+\.(?:js|css))"')
if (-not $assetMatch.Success) { throw 'No JS/CSS asset reference was found in source index.html.' }
$expectedAsset = $assetMatch.Groups[1].Value

$token = [Guid]::NewGuid().ToString('N')
$candidateDir = Assert-WithinProject (Join-Path $clientDir ".dist-deploy-$token") $ProjectRoot
$previousDir = Assert-WithinProject (Join-Path $clientDir ".dist-previous-$token") $ProjectRoot
$backupDir = Assert-WithinProject (Join-Path $versionsDir (New-VersionName)) $ProjectRoot
$swapped = $false
$previousMoved = $false

try {
  Copy-DirectoryContents $sourceDir $candidateDir
  $metadata = [ordered]@{
    action = $action
    deployedAt = (Get-Date).ToString('o')
    sourceIndexSha256 = Get-Sha256 $sourceIndex
  }
  $metadata | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $candidateDir 'deployment.json') -Encoding UTF8

  if (Test-Path -LiteralPath $productionDir) {
    Copy-DirectoryContents $productionDir $backupDir
    Move-Item -LiteralPath $productionDir -Destination $previousDir
    $previousMoved = $true
  }
  Move-Item -LiteralPath $candidateDir -Destination $productionDir
  $swapped = $true

  $response = Invoke-WebRequest -UseBasicParsing -Uri $SmokeUrl -TimeoutSec 20
  if ($response.StatusCode -ne 200 -or -not $response.Content.Contains($expectedAsset)) {
    throw "Smoke test did not serve expected asset $expectedAsset"
  }
  $assetUrl = [Uri]::new([Uri]$SmokeUrl, $expectedAsset).AbsoluteUri
  $assetResponse = Invoke-WebRequest -UseBasicParsing -Uri $assetUrl -TimeoutSec 20
  if ($assetResponse.StatusCode -ne 200) { throw "Asset smoke test failed: $assetUrl" }

  if (Test-Path -LiteralPath $previousDir) {
    Remove-Item -LiteralPath $previousDir -Recurse -Force
    $previousMoved = $false
  }
  $versions = @(Get-ChildItem -LiteralPath $versionsDir -Directory | Sort-Object Name -Descending)
  foreach ($old in $versions | Select-Object -Skip $Retention) {
    $safeOld = Assert-WithinProject $old.FullName $ProjectRoot
    Remove-Item -LiteralPath $safeOld -Recurse -Force
  }
  Write-Output "Frontend $action successful. Asset: $expectedAsset"
  Write-Output "Previous version: $backupDir"
} catch {
  if ($swapped -and (Test-Path -LiteralPath $productionDir)) {
    $failedDir = Assert-WithinProject (Join-Path $clientDir ".dist-failed-$token") $ProjectRoot
    Move-Item -LiteralPath $productionDir -Destination $failedDir
    Remove-Item -LiteralPath $failedDir -Recurse -Force
  }
  if ($previousMoved -and (Test-Path -LiteralPath $previousDir)) {
    Move-Item -LiteralPath $previousDir -Destination $productionDir
  }
  if (Test-Path -LiteralPath $candidateDir) {
    Remove-Item -LiteralPath $candidateDir -Recurse -Force
  }
  throw
}
