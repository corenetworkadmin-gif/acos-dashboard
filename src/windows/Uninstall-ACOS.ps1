# ACOS Windows 11 uninstaller.
#
# Removes the shortcuts and launcher created by Install-ACOS.ps1. By default it
# preserves the Linux checkout and the companion data directory so identity and
# memories survive a reinstall. Use -Purge to also delete them.
#
# Run in an elevated PowerShell:
#   powershell -ExecutionPolicy Bypass -File Uninstall-ACOS.ps1 [-Purge]

[CmdletBinding()]
param(
  [string]$Distro = "Ubuntu-24.04",
  [string]$InstallDir = "~/acos-dashboard",
  [switch]$Purge
)

$ErrorActionPreference = "Stop"

function Remove-Shortcuts {
  $shell = New-Object -ComObject WScript.Shell
  $paths = @(
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\ACOS.lnk"),
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "ACOS.lnk")
  )
  foreach ($p in $paths) {
    if (Test-Path $p) { Remove-Item -Force $p; Write-Host "Removed $p" }
  }
  $launcherDir = Join-Path $env:LOCALAPPDATA "ACOS"
  if (Test-Path $launcherDir) { Remove-Item -Recurse -Force $launcherDir; Write-Host "Removed $launcherDir" }
}

function Invoke-InDistro {
  param([string]$Command)
  & wsl.exe --distribution $Distro --exec bash -lc $Command
}

function Main {
  Remove-Shortcuts
  if ($Purge) {
    Write-Host "Purging the ACOS checkout and companion data inside $Distro..."
    Invoke-InDistro "rm -rf $InstallDir ~/.local/share/acos ~/.local/share/acos-tools ~/.local/share/acos-engine ~/.local/bin/acos ~/.local/share/applications/acos.desktop"
    Write-Host "Purge complete."
  } else {
    Write-Host "Shortcuts removed. The Linux checkout and companion data were preserved."
    Write-Host "Re-run with -Purge to delete $InstallDir and ~/.local/share/acos."
  }
}

Main
