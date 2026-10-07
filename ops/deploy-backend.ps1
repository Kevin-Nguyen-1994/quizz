[CmdletBinding()]
param(
  [string]$ProjectRoot,
  [string]$TaskName = 'TiL Quiz Server',
  [string]$SmokeUrl = 'http://localhost:3000/',
  [int]$Retention = 3,
  [switch]$RollbackLatest,
  [string]$RollbackVersion,
  [switch]$ForceActiveAttempts
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

function Assert-BackendArtifact([string]$Directory) {
  foreach ($file in @('index.js', 'db.js', 'config.js', 'assignmentService.js')) {
    $path = Join-Path $Directory $file
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "Backend artifact is incomplete; missing $path"
    }
  }
}

function Wait-Backend([string]$BaseUrl, [int]$TimeoutSeconds = 30) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $lastError = $null
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $BaseUrl -TimeoutSec 5
      if ($response.StatusCode -eq 200) {
        $socketUrl = [Uri]::new(
          [Uri]$BaseUrl,
          "/socket.io/?EIO=4&transport=polling&t=$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
        ).AbsoluteUri
        $socketResponse = Invoke-WebRequest -UseBasicParsing -Uri $socketUrl -TimeoutSec 5
        if ($socketResponse.StatusCode -eq 200 -and $socketResponse.Content.StartsWith('0')) {
          return [pscustomobject]@{ HttpStatus = 200; SocketStatus = 200 }
        }
      }
    } catch {
      $lastError = $_.Exception.Message
    }
    Start-Sleep -Seconds 1
  }
  throw "Backend smoke test failed within $TimeoutSeconds seconds. Last error: $lastError"
}

function Stop-BackendTask([string]$Name, [string]$BaseUrl, [int]$TimeoutSeconds = 20) {
  Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
  $port = ([Uri]$BaseUrl).Port
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $task = Get-ScheduledTask -TaskName $Name
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($task.State -ne 'Running' -and -not $listener) { return }
    Start-Sleep -Milliseconds 500
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Scheduled Task $Name did not stop cleanly within $TimeoutSeconds seconds."
}

if ($Retention -lt 3) { throw 'Retention must be at least 3.' }
if ($RollbackLatest -and $RollbackVersion) {
  throw 'Use either -RollbackLatest or -RollbackVersion, not both.'
}

$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$artifactDir = Assert-WithinProject (Join-Path $ProjectRoot 'artifacts\server-dist') $ProjectRoot
$runtimeParent = Assert-WithinProject (Join-Path $ProjectRoot 'runtime') $ProjectRoot
$productionDir = Assert-WithinProject (Join-Path $runtimeParent 'server') $ProjectRoot
$versionsDir = Assert-WithinProject (Join-Path $ProjectRoot 'deployments\backend') $ProjectRoot
$databasePath = Assert-WithinProject (Join-Path $ProjectRoot 'data\quizz.db') $ProjectRoot
$nodePath = 'C:\Users\AdminStore\AppData\Local\pnpm\bin\node.exe'
$attemptCheck = Assert-WithinProject (Join-Path $ProjectRoot 'server\scripts\check-active-attempts.mjs') $ProjectRoot

foreach ($path in @($nodePath, $databasePath, $attemptCheck)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required file is missing: $path" }
}

if (-not $ForceActiveAttempts) {
  $attemptJson = & $nodePath $attemptCheck --database $databasePath
  $attemptExit = $LASTEXITCODE
  if ($attemptExit -eq 3) {
    $attemptState = $attemptJson | ConvertFrom-Json
    throw "Deployment blocked: $($attemptState.activeCount) Assignment attempt(s) are in progress."
  }
  if ($attemptExit -ne 0) { throw "Active-attempt check failed with exit code $attemptExit" }
}

New-Item -ItemType Directory -Path $runtimeParent -Force | Out-Null
New-Item -ItemType Directory -Path $versionsDir -Force | Out-Null

$isRollback = $RollbackLatest -or -not [string]::IsNullOrWhiteSpace($RollbackVersion)
if ($isRollback) {
  $available = @(Get-ChildItem -LiteralPath $versionsDir -Directory | Sort-Object Name -Descending)
  $source = if ($RollbackVersion) {
    $available | Where-Object Name -EQ $RollbackVersion | Select-Object -First 1
  } else {
    $available | Select-Object -First 1
  }
  if (-not $source) { throw 'No matching backend rollback version was found.' }
  $sourceDir = Assert-WithinProject $source.FullName $ProjectRoot
  $action = 'rollback'
} else {
  $sourceDir = $artifactDir
  $action = 'deploy'
}
Assert-BackendArtifact $sourceDir

$token = [Guid]::NewGuid().ToString('N')
$candidateDir = Assert-WithinProject (Join-Path $runtimeParent ".server-deploy-$token") $ProjectRoot
$previousDir = Assert-WithinProject (Join-Path $runtimeParent ".server-previous-$token") $ProjectRoot
$backupDir = Assert-WithinProject (
  Join-Path $versionsDir (Get-Date -Format 'yyyy-MM-dd-HHmmss-fff')
) $ProjectRoot
$swapped = $false
$previousMoved = $false

try {
  Copy-DirectoryContents $sourceDir $candidateDir
  $metadata = [ordered]@{
    action = $action
    deployedAt = (Get-Date).ToString('o')
    sourceIndexSha256 = Get-Sha256 (Join-Path $sourceDir 'index.js')
  }
  $metadata | ConvertTo-Json | Set-Content -LiteralPath (
    Join-Path $candidateDir 'deployment.json'
  ) -Encoding UTF8

  if (Test-Path -LiteralPath $productionDir) {
    Assert-BackendArtifact $productionDir
    Copy-DirectoryContents $productionDir $backupDir
  }

  Stop-BackendTask $TaskName $SmokeUrl
  if (Test-Path -LiteralPath $productionDir) {
    Move-Item -LiteralPath $productionDir -Destination $previousDir
    $previousMoved = $true
  }
  Move-Item -LiteralPath $candidateDir -Destination $productionDir
  $swapped = $true

  Start-ScheduledTask -TaskName $TaskName
  $smoke = Wait-Backend $SmokeUrl

  if (Test-Path -LiteralPath $previousDir) {
    Remove-Item -LiteralPath $previousDir -Recurse -Force
    $previousMoved = $false
  }
  $versions = @(Get-ChildItem -LiteralPath $versionsDir -Directory | Sort-Object Name -Descending)
  foreach ($old in $versions | Select-Object -Skip $Retention) {
    $safeOld = Assert-WithinProject $old.FullName $ProjectRoot
    Remove-Item -LiteralPath $safeOld -Recurse -Force
  }
  Write-Output "Backend $action successful. Runtime: $productionDir"
  Write-Output "Runtime index SHA256: $($metadata.sourceIndexSha256)"
  Write-Output "HTTP smoke: $($smoke.HttpStatus); Socket.IO smoke: $($smoke.SocketStatus)"
  if (Test-Path -LiteralPath $backupDir) { Write-Output "Previous version: $backupDir" }
} catch {
  $failure = $_
  Stop-BackendTask $TaskName $SmokeUrl
  if ($swapped -and (Test-Path -LiteralPath $productionDir)) {
    $failedDir = Assert-WithinProject (Join-Path $runtimeParent ".server-failed-$token") $ProjectRoot
    Move-Item -LiteralPath $productionDir -Destination $failedDir
    Remove-Item -LiteralPath $failedDir -Recurse -Force
  }
  if ($previousMoved -and (Test-Path -LiteralPath $previousDir)) {
    Move-Item -LiteralPath $previousDir -Destination $productionDir
    Start-ScheduledTask -TaskName $TaskName
    Wait-Backend $SmokeUrl | Out-Null
  }
  if (Test-Path -LiteralPath $candidateDir) {
    Remove-Item -LiteralPath $candidateDir -Recurse -Force
  }
  throw $failure
}
