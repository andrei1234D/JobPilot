<#
.SYNOPSIS
  Creates "JobPilot" shortcuts on the Desktop and in the Start Menu.

.DESCRIPTION
  Prefers the packaged desktop app (apps\desktop\release\win-unpacked\JobPilot.exe).
  If it has not been built, the shortcut starts the same app through the
  development Electron binary. Either way: no terminal, one double-click.

  Build the packaged app first with:   pnpm --filter @jobpilot/desktop pack

.PARAMETER Remove
  Deletes the shortcuts instead of creating them.
#>
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'JobPilot.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'JobPilot.lnk')
)

if ($Remove) {
  foreach ($path in $targets) { if (Test-Path $path) { Remove-Item $path; Write-Host "Removed $path" } }
  return
}

$packaged = Join-Path $repo 'apps\desktop\release\win-unpacked\JobPilot.exe'
$devElectron = Join-Path $repo 'apps\desktop\node_modules\electron\dist\electron.exe'
$desktopDir = Join-Path $repo 'apps\desktop'

if (Test-Path $packaged) {
  $exe = $packaged; $arguments = ''; $workDir = Split-Path -Parent $packaged
} elseif ((Test-Path $devElectron) -and (Test-Path (Join-Path $desktopDir 'dist\main.cjs'))) {
  $exe = $devElectron; $arguments = "`"$desktopDir`""; $workDir = $desktopDir
} else {
  throw "Nothing to point a shortcut at. Run 'pnpm install' and 'pnpm --filter @jobpilot/desktop pack' first."
}

$shell = New-Object -ComObject WScript.Shell
foreach ($path in $targets) {
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = $exe
  $shortcut.Arguments = $arguments
  $shortcut.WorkingDirectory = $workDir
  $shortcut.IconLocation = (Join-Path $desktopDir 'assets\icon.ico')
  $shortcut.Description = 'JobPilot: your job hunt at a glance'
  $shortcut.Save()
  Write-Host "Created $path"
}
Write-Host "Shortcut target: $exe $arguments"
