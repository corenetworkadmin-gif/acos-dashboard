# ACOS native isolation helper — build & validate
#
# `acos-isolate.exe` is the native Windows half of the isolation adapter declared
# in `src/host/isolation.ts` (`WindowsIsolationAdapter`). It is the only component
# that calls Windows security APIs. The TypeScript adapter passes it a JSON job
# spec on the command line:
#
#     acos-isolate.exe --job-spec <json>
#
# The JSON contract (`WindowsJobSpec` in `src/host/isolation.ts`) is:
#
#     {
#       "version": 1,
#       "jobName": "ACOS-Engine-<uuid>",
#       "command": ["C:\\...\\llama-completion.exe", "-m", "..."],
#       "readOnlyPaths": [{ "source": "C:\\engine", "target": "C:\\engine" }],
#       "writablePaths": ["C:\\scratch"],
#       "workdir": "C:\\engine",
#       "env": { "LD_LIBRARY_PATH": "C:\\engine" },
#       "limits": {
#         "processMemoryBytes": 2147483648,
#         "jobMemoryBytes": 4294967296,
#         "cpuRateHundredths": 5000,
#         "activeProcessLimit": 1,
#         "wallClockMs": 120000
#       },
#       "appContainer": "capability-free",
#       "network": "deny",
#       "integrity": "low"
#     }
#
# ## Build (MSVC Developer Command Prompt, x64)
#
#     cl /std:c++17 /EHsc /O2 acos-isolate.cpp ^
#        /link Advapi32.lib Userenv.lib Kernel32.lib Fwpuclnt.lib Ws2_32.lib
#
# Copy the resulting `acos-isolate.exe` next to the ACOS launcher, e.g.
# `%LOCALAPPDATA%\ACOS\acos-isolate.exe`, or point `ACOS_ISOLATE_HELPER` at it.
#
# ## Status
#
# Authored, not yet compiled or validated. This is a reference implementation.
# Do not describe native Windows isolation as working until
# `src/windows/verify-windows.ps1 -Runtime native` reports every check PASS on a
# real Windows 11 machine. Until then the supported Windows path is the managed
# WSL2 guest runtime, which reuses the tested Linux adapter unchanged.
#
# ## What the helper guarantees
#
#   1. Filesystem confinement  — AppContainer SID with read access only to the
#      declared read-only paths and full access only to scratch paths.
#   2. Network denial          — capability-free AppContainer plus a WFP block
#      filter scoped to the SID.
#   3. Cleared environment     — an explicitly constructed environment block; the
#      host environment is never inherited.
#   4. Bounded memory/CPU      — Job Object memory, active-process and CPU-rate
#      limits, enforced by the OS.
#   5. Reliable termination    — JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE plus
#      TerminateJobObject on the wall-clock deadline.
#   6. Privilege containment   — restricted low-integrity token, no
#      SeDebugPrivilege, no access to the administrator window station/desktop.
