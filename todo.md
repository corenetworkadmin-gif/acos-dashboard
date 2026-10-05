# ACOS — P1 (Windows 11 delivery) + P3 (providers & authority)

Branch: `acos/p1-windows-delivery` (based on published `main` @ 1758a40).
Rule: finish P1 → update GitHub → finish P3 → update GitHub. Leave credit headroom.

## P1 — Windows 11 first delivery
- [x] 1. `src/host/isolation.ts`: IsolationAdapter interface + Linux adapter (bwrap/prlimit) + Windows adapter (AppContainer/Job Object/native helper boundary)
- [x] 2. Refactor `engine.ts` to launch through the adapter (Linux behaviour unchanged; tests stay green)
- [x] 3. Unit tests for the adapter (Linux argv, Windows limit/env mapping, probe decisions) — 94/94 pass, real inference verified
- [x] 4. `src/windows/native/acos-isolate.cpp`: native helper source (authored, not compiled here) + README
- [x] 5. `src/windows/verify-windows.ps1`: 6-point OS-enforcement verification harness
- [x] 6a. Harden `Install-ACOS.ps1` (-Verify, -DryRun, -Runtime wsl2|native, native helper build, preflight)
- [x] 6b. Harden `Uninstall-ACOS.ps1` (-DryRun / -Verify parity, native helper removal, WSL distro safety)
- [x] 7. `src/macos/install-macos.sh` (app bundle + CLI launcher + LaunchAgent) + `DarwinIsolationAdapter` + `docs/macos.md`
- [x] 8. Docs: `windows-native-isolation.md` (implemented status), `windows.md` (flags + verifier), new `macos.md`
- [x] 9. Green baseline (typecheck/lint/test/launch/build) + commit + push + merge to main
      (5265a3f merged to main; 99/99 tests, build green, 2/2 launch)

## P3 — providers and authority
- [x] 10. `src/host/providers.ts`: governed provider registry (probe/attach/detach/execute), capabilities derive attach+availability
- [x] 11. Network provider `network.request` (target-constrained, real, tested)
- [x] 12. Device providers `device.microphone` / `device.camera` (contract + mock-tested)
- [x] 13. Remote execution `remote.execute` (contract + mock-tested)
- [x] 14. `src/host/extensions.ts`: extension lifecycle (manifests, registry, non-escalation guarantee)
- [x] 15. Wire providers into runtime pipeline + tools + server commands
- [x] 16. Tests for providers + extensions; docs update
      (25 new tests: providers.test.ts, extensions.test.ts, governed-providers.test.ts; new
      docs/providers-and-authority.md; status/checklist/report/README corrected — 124/124 pass)
- [ ] 17. Green baseline + commit + push + merge to main
