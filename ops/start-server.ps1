[CmdletBinding()]
param([string]$ProjectRoot)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $candidate = Split-Path -Parent $PSScriptRoot
  $ProjectRoot = if ((Split-Path -Leaf $candidate) -eq 'data') {
    Split-Path -Parent $candidate
  } else {
    $candidate
  }
}
$projectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$serverRoot = Join-Path $projectRoot 'server'
$runtimeRoot = Join-Path $projectRoot 'runtime\server'
$nodePath = 'C:\Users\AdminStore\AppData\Local\pnpm\bin\node.exe'
$entryPoint = Join-Path $runtimeRoot 'index.js'
$expectedDataDir = Join-Path $projectRoot 'data'
$expectedDatabase = Join-Path $expectedDataDir 'quizz.db'
$logDir = Join-Path $projectRoot 'logs'
$logPath = Join-Path $logDir 'server.log'

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Write-OperationalLog([string] $Message) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message$([Environment]::NewLine)"
  [IO.File]::AppendAllText($logPath, $line, [Text.UTF8Encoding]::new($false))
}

try {
  foreach ($name in @('ADMIN_USERNAME', 'ADMIN_PASSWORD', 'JWT_SECRET', 'DATA_DIR')) {
    $value = [Environment]::GetEnvironmentVariable($name, 'Machine')
    if ([string]::IsNullOrWhiteSpace($value)) {
      throw "Required Machine environment variable is missing: $name"
    }
    Set-Item -LiteralPath "Env:$name" -Value $value
  }

  if ($env:JWT_SECRET.Length -lt 32) { throw 'JWT_SECRET must contain at least 32 characters' }
  if ([IO.Path]::GetFullPath($env:DATA_DIR) -ne [IO.Path]::GetFullPath($expectedDataDir)) {
    throw 'DATA_DIR does not point to the production data directory'
  }
  foreach ($path in @($nodePath, $entryPoint, $expectedDatabase)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "Required runtime file is missing: $path"
    }
  }

  $env:NODE_PATH = Join-Path $serverRoot 'node_modules'
  Set-Location -LiteralPath $serverRoot
  Write-OperationalLog "Starting TiL Quiz runtime $entryPoint with PID parent $PID"
  $commandLine = '"{0}" "{1}" >> "{2}" 2>&1' -f $nodePath, $entryPoint, $logPath
  & $env:ComSpec /d /s /c $commandLine
  $exitCode = $LASTEXITCODE
  Write-OperationalLog "TiL Quiz exited with code $exitCode"
  exit $exitCode
} catch {
  Write-OperationalLog "Startup failure: $($_.Exception.Message)"
  exit 1
}
