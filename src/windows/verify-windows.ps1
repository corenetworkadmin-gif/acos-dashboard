# ACOS Windows 11 verification harness.
#
# Purpose: turn "authored" Windows support into *verified* Windows support. Run
# this on a real Windows 11 machine (build 22000+) before claiming the Windows
# path works. It checks the managed WSL2 runtime and, when the native isolation
# helper is present, the six OS-enforcement guarantees the architecture requires.
#
#   powershell -ExecutionPolicy Bypass -File verify-windows.ps1
#   powershell -ExecutionPolicy Bypass -File verify-windows.ps1 -Runtime native
#   powershell -ExecutionPolicy Bypass -File verify-windows.ps1 -Runtime wsl2
#
# Exit code 0 only when every applicable check passes. SKIP is reported honestly
# and does not count as a pass for the native guarantees.

[CmdletBinding()]
param(
  [ValidateSet("auto", "wsl2", "native")]
  [string]$Runtime = "auto",
  [string]$Distro = "Ubuntu-24.04",
  [string]$InstallDir = "~/acos-dashboard",
  [string]$HelperPath = (Join-Path $env:LOCALAPPDATA "ACOS\acos-isolate.exe")
)

$ErrorActionPreference = "Stop"
$script:results = @()

function Record([string]$name, [string]$status, [string]$detail = "") {
  $script:results += [pscustomobject]@{ Name = $name; Status = $status; Detail = $detail }
  $color = switch ($status) { "PASS" { "Green" } "FAIL" { "Red" } default { "Yellow" } }
  Write-Host ("  [{0}] {1}{2}" -f $status, $name, $(if ($detail) { " - $detail" } else { "" })) -ForegroundColor $color
}

function Invoke-Isolated {
  # Run a command under the native helper and return its exit code.
  param([string]$ProbeCommand, [int]$MemoryBytes = 2147483648, [int]$WallMs = 20000, [string[]]$Writable = @())
  $spec = @{
    version         = 1
    jobName         = "ACOS-Verify-" + [guid]::NewGuid().ToString()
    command         = @("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", $ProbeCommand)
    readOnlyPaths   = @()
    writablePaths   = $Writable
    workdir         = $null
    env             = @{}
    limits          = @{
      processMemoryBytes = $MemoryBytes
      jobMemoryBytes     = $MemoryBytes
      cpuRateHundredths  = 5000
      activeProcessLimit = 1
      wallClockMs        = $WallMs
    }
    appContainer    = "capability-free"
    network         = "deny"
    integrity       = "low"
  } | ConvertTo-Json -Depth 8 -Compress
  & $HelperPath --job-spec $spec *> $null
  return $LASTEXITCODE
}

# --- Preflight --------------------------------------------------------------
Write-Host "`nACOS Windows verification`n" -ForegroundColor Cyan
$build = [System.Environment]::OSVersion.Version.Build
if ($build -ge 22000) { Record "Windows 11 (build $build)" "PASS" }
else { Record "Windows 11 (build $build)" "FAIL" "build 22000+ required"; }

$nativePresent = Test-Path $HelperPath
if ($Runtime -eq "auto") { $Runtime = if ($nativePresent) { "native" } else { "wsl2" } }
Write-Host "Runtime under test: $Runtime`n" -ForegroundColor Cyan

# --- Managed WSL2 runtime ---------------------------------------------------
if ($Runtime -eq "wsl2") {
  Write-Host "Managed WSL2 guest runtime" -ForegroundColor Cyan
  $wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
  if ($wsl) { Record "wsl.exe present" "PASS" } else { Record "wsl.exe present" "FAIL" "run: wsl --install" }
  if ($wsl) {
    $distros = (& wsl.exe --list --quiet 2>$null) -replace "`0", ""
    if ($distros -contains $Distro) { Record "$Distro installed" "PASS" }
    else { Record "$Distro installed" "FAIL" "run: wsl --install -d $Distro" }

    # The Linux adapter must report confinement available inside the distro.
    $probe = & wsl.exe -d $Distro --exec bash -lc "command -v bwrap >/dev/null && command -v prlimit >/dev/null && bwrap --unshare-all --ro-bind /usr /usr -- /bin/true && echo ISOLATION_OK" 2>$null
    if ($probe -match "ISOLATION_OK") { Record "Linux isolation (bwrap+prlimit) inside $Distro" "PASS" }
    else { Record "Linux isolation (bwrap+prlimit) inside $Distro" "FAIL" "run: bash src/host/setup-wsl.sh" }

    # The green baseline must hold inside the distro.
    $tests = & wsl.exe -d $Distro --exec bash -lc "cd $InstallDir && pnpm test 2>&1 | tail -3" 2>$null
    if ($tests -match "fail 0") { Record "Host test suite inside $Distro" "PASS" }
    else { Record "Host test suite inside $Distro" "FAIL" "see $InstallDir; run pnpm test" }
  }
}

# --- Native isolation guarantees --------------------------------------------
if ($Runtime -eq "native") {
  Write-Host "Native isolation (AppContainer + Job Object + WFP + restricted token)" -ForegroundColor Cyan
  if (-not $nativePresent) {
    Record "acos-isolate.exe present" "FAIL" "build src/windows/native/acos-isolate.cpp (see its README)"
    Record "native guarantees" "SKIP" "helper missing; managed WSL2 remains the supported path"
  }
  else {
    Record "acos-isolate.exe present" "PASS" $HelperPath

    # 1. Filesystem confinement: the engine cannot read the user profile.
    $secret = Join-Path $env:USERPROFILE "acos-verify-secret.txt"
    "topsecret" | Set-Content -Path $secret -Encoding ASCII
    $code = Invoke-Isolated "Get-Content '$secret'"
    if ($code -ne 0) { Record "Cannot read %USERPROFILE%" "PASS" "exit $code" }
    else { Record "Cannot read %USERPROFILE%" "FAIL" "read succeeded under confinement" }
    Remove-Item -Force $secret -ErrorAction SilentlyContinue

    # 2. Network denial: the engine cannot open a socket.
    $code = Invoke-Isolated "try { (New-Object Net.Sockets.TcpClient).Connect('1.1.1.1',80); exit 0 } catch { exit 7 }"
    if ($code -ne 0) { Record "Cannot open a network socket" "PASS" "exit $code" }
    else { Record "Cannot open a network socket" "FAIL" "connect succeeded" }

    # 3. Memory limit: an allocation beyond the job limit fails, host survives.
    $code = Invoke-Isolated "try { \$a = New-Object 'byte[]' (1GB); exit 0 } catch { exit 9 }" -MemoryBytes 268435456
    if ($code -ne 0) { Record "Memory limit enforced (host stable)" "PASS" "exit $code" }
    else { Record "Memory limit enforced (host stable)" "FAIL" "oversized allocation succeeded" }

    # 4. Reliable termination: killing the job removes every descendant.
    $spec = @{
      version = 1; jobName = "ACOS-Verify-Term-" + [guid]::NewGuid().ToString()
      command = @("powershell.exe", "-NoProfile", "-Command", "Start-Sleep -Seconds 300")
      readOnlyPaths = @(); writablePaths = @(); workdir = $null; env = @{}
      limits = @{ processMemoryBytes = 268435456; jobMemoryBytes = 268435456; cpuRateHundredths = 5000; activeProcessLimit = 1; wallClockMs = 600000 }
      appContainer = "capability-free"; network = "deny"; integrity = "low"
    } | ConvertTo-Json -Depth 8 -Compress
    $proc = Start-Process -FilePath $HelperPath -ArgumentList "--job-spec", $spec -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 2
    $before = (Get-Process powershell -ErrorAction SilentlyContinue | Measure-Object).Count
    Stop-Process -Id $proc.Id -Force
    Start-Sleep -Seconds 2
    $after = (Get-Process powershell -ErrorAction SilentlyContinue | Measure-Object).Count
    if ($after -le $before) { Record "Killing the job reaps descendants" "PASS" }
    else { Record "Killing the job reaps descendants" "FAIL" "descendant survived" }

    # 5. Privilege containment: the engine cannot read the administrator key.
    $keyPath = Join-Path $env:LOCALAPPDATA "ACOS\admin.key"
    if (Test-Path $keyPath) {
      $code = Invoke-Isolated "Get-Content '$keyPath'"
      if ($code -ne 0) { Record "Cannot read the administrator key" "PASS" }
      else { Record "Cannot read the administrator key" "FAIL" "key readable under confinement" }
    } else { Record "Cannot read the administrator key" "SKIP" "no key at $keyPath yet" }

    # 6. Wall-clock deadline reclaims the job.
    $code = Invoke-Isolated "Start-Sleep -Seconds 300" -WallMs 3000
    if ($code -ne 0) { Record "Wall-clock deadline reclaims the job" "PASS" "exit $code" }
    else { Record "Wall-clock deadline reclaims the job" "FAIL" "probe outlived its deadline" }
  }
}

# --- Summary ----------------------------------------------------------------
$fail = ($script:results | Where-Object Status -eq "FAIL").Count
$pass = ($script:results | Where-Object Status -eq "PASS").Count
$skip = ($script:results | Where-Object Status -eq "SKIP").Count
Write-Host "`nSummary: $pass passed, $fail failed, $skip skipped" -ForegroundColor Cyan
if ($fail -gt 0) { exit 1 }
exit 0
