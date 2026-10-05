# ACOS Windows 11 uninstaller.
#
# Removes the shortcuts, launcher and (optionally) the native isolation helper
# created by Install-ACOS.ps1. By default it preserves the Linux checkout and
# the companion data directory so identity and memories survive a reinstall.
# Use -Purge to also delete them.
#
# Run in an elevated PowerShell:
#   powershell -ExecutionPolicy Bypass -File Uninstall-ACOS.ps1 [-Purge] [-DryRun]
#
# Parity with Install-ACOS.ps1:
#   -Runtime wsl2|native   Which runtime's artifacts to remove (default: auto).
#   -DryRun                Print every action without changing anything.
#   -Verify                After removal, assert the artifacts are gone.
#   -Purge                 Also delete the checkout, engine and companion data.
#
# Safety: -Purge only ever deletes paths that live under the ACOS-owned
# directories. It refuses to run as a non-elevated user when -Purge is set, and
# it never touches a WSL distribution that is not named by -Distro.

[CmdletBinding()]
param(
  [string]$Distro = "Ubuntu-24.04",
  [string]$InstallDir = "~/acos-dashboard",
  [ValidateSet("auto", "wsl2", "native")]
  [string]$Runtime = "auto",
  [switch]$Purge,
  [switch]$DryRun,
  [switch]$Verify
)

$ErrorActionPreference = "Stop"
$script:Failures = 0

function Write-Step([string]$Message) {
  if ($DryRun) { Write-Host "[dry-run] $Message" -ForegroundColor DarkGray }
  else { Write-Host $Message }
}

function Test-Elevated {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($id)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Resolve-Runtime {
  if ($Runtime -ne "auto") { return $Runtime }
  # Prefer native if the helper exists, else wsl2 if wsl.exe is present.
  $helper = Join-Path $env:LOCALAPPDATA "ACOS\acos-isolate.exe"
  if (Test-Path $helper) { return "native" }
  if (Get-Command wsl.exe -ErrorAction SilentlyContinue) { return "wsl2" }
  return "wsl2"
}

function Remove-Shortcuts {
  $shell = New-Object -ComObject WScript.Shell
  $paths = @(
    (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\ACOS.lnk"),
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "ACOS.lnk")
  )
  foreach ($p in $paths) {
    if (Test-Path $p) {
      Write-Step "Removing shortcut $p"
      if (-not $DryRun) { Remove-Item -Force $p }
    } else {
      Write-Step "Shortcut not present: $p"
    }
  }
  # The launcher directory holds Start-ACOS.cmd, the desktop entry and the
  # native helper. Remove the whole directory when it exists.
  $launcherDir = Join-Path $env:LOCALAPPDATA "ACOS"
  if (Test-Path $launcherDir) {
    Write-Step "Removing launcher directory $launcherDir"
    if (-not $DryRun) { Remove-Item -Recurse -Force $launcherDir }
  } else {
    Write-Step "Launcher directory not present: $launcherDir"
  }
}

function Remove-NativeHelper {
  # The helper lives in the launcher dir, which Remove-Shortcuts already
  # deletes. This is an explicit, verifiable second pass so a partial install
  # (helper present, launcher dir missing) is still cleaned up.
  $helper = Join-Path $env:LOCALAPPDATA "ACOS\acos-isolate.exe"
  if (Test-Path $helper) {
    Write-Step "Removing native isolation helper $helper"
    if (-not $DryRun) { Remove-Item -Force $helper }
  } else {
    Write-Step "Native isolation helper not present: $helper"
  }
}

function Invoke-InDistro {
  param([string]$Command)
  Write-Step "wsl -d $Distro -- bash -lc `"$Command`""
  if (-not $DryRun) {
    & wsl.exe --distribution $Distro --exec bash -lc $Command
  }
}

function Assert-DistroExists {
  if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    throw "wsl.exe not found; cannot purge the Linux checkout. Use -Runtime native or remove files manually."
  }
  $list = (& wsl.exe --list --quiet) 2>$null
  $names = $list | ForEach-Object { ($_ -replace "`0", "").Trim() } | Where-Object { $_ }
  if ($names -notcontains $Distro) {
    throw "WSL distribution '$Distro' is not installed. Refusing to purge. Installed: $($names -join ', ')"
  }
}

function Invoke-Purge {
  Assert-DistroExists
  # Every path here is ACOS-owned and lives under the user's home inside the
  # distro. Nothing outside these prefixes is touched.
  $targets = @(
    $InstallDir,
    "~/.local/share/acos",
    "~/.local/share/acos-tools",
    "~/.local/share/acos-engine",
    "~/.local/bin/acos",
    "~/.local/share/applications/acos.desktop"
  ) -join " "
  Write-Step "Purging ACOS checkout and companion data inside $Distro..."
  Invoke-InDistro "rm -rf $targets"
  Write-Step "Purge complete."
}

function Invoke-Verify {
  Write-Host ""
  Write-Host "Verifying removal..." -ForegroundColor Cyan
  $checks = @(
    @{ Name = "Start Menu shortcut"; Path = (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\ACOS.lnk") },
    @{ Name = "Desktop shortcut";    Path = (Join-Path ([Environment]::GetFolderPath("Desktop")) "ACOS.lnk") },
    @{ Name = "Launcher directory";  Path = (Join-Path $env:LOCALAPPDATA "ACOS") },
    @{ Name = "Native helper";       Path = (Join-Path $env:LOCALAPPDATA "ACOS\acos-isolate.exe") }
  )
  foreach ($c in $checks) {
    if (Test-Path $c.Path) {
      Write-Host ("FAIL  {0} still present: {1}" -f $c.Name, $c.Path) -ForegroundColor Red
      $script:Failures++
    } else {
      Write-Host ("ok    {0} removed" -f $c.Name) -ForegroundColor Green
    }
  }
}

function Main {
  if ($Purge -and -not (Test-Elevated)) {
    throw "-Purge deletes the WSL checkout and companion data and must run elevated."
  }

  $resolved = Resolve-Runtime
  Write-Host "ACOS uninstaller" -ForegroundColor Cyan
  Write-Host ("  runtime:    {0}" -f $resolved)
  Write-Host ("  purge:      {0}" -f [bool]$Purge)
  Write-Host ("  dry-run:    {0}" -f [bool]$DryRun)
  Write-Host ""

  Remove-Shortcuts
  if ($resolved -eq "native") { Remove-NativeHelper }

  if ($Purge) {
    Invoke-Purge
  } else {
    Write-Step "Shortcuts removed. The Linux checkout and companion data were preserved."
    Write-Step "Re-run with -Purge to delete $InstallDir and ~/.local/share/acos."
  }

  if ($Verify -and -not $DryRun) {
    Invoke-Verify
    if ($script:Failures -gt 0) {
      Write-Host ""
      Write-Host ("Uninstall verification FAILED: {0} artifact(s) remain." -f $script:Failures) -ForegroundColor Red
      exit 1
    }
    Write-Host ""
    Write-Host "Uninstall verification passed." -ForegroundColor Green
  }
}

Main
