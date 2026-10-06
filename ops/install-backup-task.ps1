[CmdletBinding()]
param(
  [string]$ProjectRoot,
  [string]$NodePath = 'C:\Users\AdminStore\AppData\Local\pnpm\bin\node.exe',
  [string]$TaskName = 'TiL Quiz Database Backup',
  [switch]$RunNow,
  [string]$StatusPath
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$backupScript = Join-Path $ProjectRoot 'server\scripts\backup-database.mjs'
$database = Join-Path $ProjectRoot 'data\quizz.db'
$backupDir = Join-Path $ProjectRoot 'data\backups\daily'
$log = Join-Path $ProjectRoot 'logs\backup.log'

foreach ($required in @($NodePath, $backupScript, $database)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "Required file not found: $required"
  }
}

$arguments = @(
  "`"$backupScript`"",
  '--database', "`"$database`"",
  '--backup-dir', "`"$backupDir`"",
  '--log', "`"$log`"",
  '--retention', '30'
) -join ' '

$action = New-ScheduledTaskAction -Execute $NodePath -Argument $arguments -WorkingDirectory $ProjectRoot
$trigger = New-ScheduledTaskTrigger -Daily -At '22:30'
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable `
  -RestartCount 2 `
  -RestartInterval (New-TimeSpan -Minutes 5) `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Description 'Daily online SQLite backup for TiL Quiz; retains 30 verified backups.' `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName

if ($RunNow) {
  $before = Get-ScheduledTaskInfo -TaskName $TaskName
  Start-ScheduledTask -TaskName $TaskName
  $deadline = (Get-Date).AddSeconds(60)
  do {
    Start-Sleep -Seconds 1
    $task = Get-ScheduledTask -TaskName $TaskName
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
  } while (
    (Get-Date) -lt $deadline -and
    ($task.State -eq 'Running' -or $info.LastRunTime -le $before.LastRunTime)
  )
  if ($task.State -eq 'Running' -or $info.LastRunTime -le $before.LastRunTime) {
    throw 'Scheduled backup test did not finish within 60 seconds.'
  }
} else {
  $info = Get-ScheduledTaskInfo -TaskName $TaskName
}

$status = [ordered]@{
  taskName = $task.TaskName
  state = [string]$task.State
  userId = $task.Principal.UserId
  logonType = [string]$task.Principal.LogonType
  runLevel = [string]$task.Principal.RunLevel
  triggerStart = $task.Triggers[0].StartBoundary
  multipleInstances = [string]$task.Settings.MultipleInstances
  startWhenAvailable = $task.Settings.StartWhenAvailable
  restartCount = $task.Settings.RestartCount
  actionExecute = $task.Actions[0].Execute
  actionArguments = $task.Actions[0].Arguments
  workingDirectory = $task.Actions[0].WorkingDirectory
  lastRunTime = $info.LastRunTime.ToString('o')
  lastTaskResult = $info.LastTaskResult
  nextRunTime = $info.NextRunTime.ToString('o')
}

if ([string]::IsNullOrWhiteSpace($StatusPath)) {
  [pscustomobject]$status
} else {
  $statusDirectory = Split-Path -Parent $StatusPath
  New-Item -ItemType Directory -Path $statusDirectory -Force | Out-Null
  $status | ConvertTo-Json | Set-Content -LiteralPath $StatusPath -Encoding UTF8
}
