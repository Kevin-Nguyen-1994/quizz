[CmdletBinding()]
param(
  [string]$ProjectRoot,
  [string]$TaskName = 'TiL Quiz Server'
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$sourceWrapper = Join-Path $ProjectRoot 'ops\start-server.ps1'
$runtimeEntry = Join-Path $ProjectRoot 'runtime\server\index.js'
$dataOpsDir = Join-Path $ProjectRoot 'data\ops'
$installedWrapper = Join-Path $dataOpsDir 'start-server.ps1'

foreach ($path in @($sourceWrapper, $runtimeEntry)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Required file is missing: $path"
  }
}

New-Item -ItemType Directory -Path $dataOpsDir -Force | Out-Null
Copy-Item -LiteralPath $sourceWrapper -Destination $installedWrapper -Force

$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass ' +
  "-File `"$installedWrapper`" -ProjectRoot `"$ProjectRoot`""
$action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments -WorkingDirectory $ProjectRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT15S'
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName
[pscustomobject]@{
  TaskName = $task.TaskName
  State = $task.State
  Account = $task.Principal.UserId
  RunLevel = $task.Principal.RunLevel
  Execute = $task.Actions.Execute
  Arguments = $task.Actions.Arguments
  WorkingDirectory = $task.Actions.WorkingDirectory
  RuntimeEntry = $runtimeEntry
  Wrapper = $installedWrapper
}
