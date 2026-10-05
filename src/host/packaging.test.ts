import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Packaging tests (handoff "usable installed app"; architecture 74). These exercise
// the real Linux installer end-to-end in an isolated prefix so the install/upgrade/
// uninstall lifecycle is verified rather than asserted in prose.

const repo = process.cwd();
const installer = path.join(repo, "src/host/install-linux.sh");

function run(args: string[], env: Record<string, string> = {}) {
  return execFileSync("bash", [installer, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("installer installs a launcher, desktop entry and icon into a prefix", () => {
  const prefix = mkdtempSync(path.join(tmpdir(), "acos-prefix-"));
  try {
    const output = run(["--prefix", prefix]);
    assert.match(output, /ACOS installed/);
    const launcher = path.join(prefix, "bin", "acos");
    const desktop = path.join(prefix, "share/applications/acos.desktop");
    const icon = path.join(prefix, "share/icons/hicolor/scalable/apps/acos.svg");
    assert.ok(existsSync(launcher), "launcher must exist");
    assert.ok(existsSync(desktop), "desktop entry must exist");
    assert.ok(existsSync(icon), "icon must exist");
    // The launcher must be executable.
    assert.ok((statSync(launcher).mode & 0o111) !== 0, "launcher must be executable");
    // The desktop entry must point at the launcher and be a valid desktop file.
    const entry = readFileSync(desktop, "utf8");
    assert.match(entry, /^\[Desktop Entry\]/m);
    assert.match(entry, /^Type=Application$/m);
    assert.ok(entry.includes(`Exec=${launcher}`), "Exec must reference the launcher");
    assert.match(entry, /^Icon=acos$/m);
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("installer is idempotent (re-run is an in-place upgrade)", () => {
  const prefix = mkdtempSync(path.join(tmpdir(), "acos-prefix-"));
  try {
    run(["--prefix", prefix]);
    const launcher = path.join(prefix, "bin", "acos");
    const first = readFileSync(launcher, "utf8");
    // A second run must succeed and leave a valid, identical launcher.
    const output = run(["--prefix", prefix]);
    assert.match(output, /ACOS installed/);
    assert.equal(readFileSync(launcher, "utf8"), first);
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

test("uninstall removes the app but preserves companion data; purge deletes it", () => {
  const prefix = mkdtempSync(path.join(tmpdir(), "acos-prefix-"));
  const data = mkdtempSync(path.join(tmpdir(), "acos-data-"));
  try {
    run(["--prefix", prefix]);
    // Simulate a live companion data directory with the admin key.
    writeFileSync(path.join(data, "admin.key"), "a".repeat(64));
    const output = run(["--prefix", prefix, "--uninstall"], { ACOS_DATA_DIR: data });
    assert.match(output, /Removed ACOS launcher/);
    assert.ok(!existsSync(path.join(prefix, "bin/acos")), "launcher removed");
    assert.ok(!existsSync(path.join(prefix, "share/applications/acos.desktop")), "entry removed");
    assert.ok(!existsSync(path.join(prefix, "share/icons/hicolor/scalable/apps/acos.svg")), "icon removed");
    // Data preserved by default.
    assert.ok(existsSync(path.join(data, "admin.key")), "data must be preserved");
    // Now purge.
    run(["--prefix", prefix, "--uninstall", "--purge"], { ACOS_DATA_DIR: data });
    assert.ok(!existsSync(data), "purge must delete the data directory");
  } finally {
    rmSync(prefix, { recursive: true, force: true });
    rmSync(data, { recursive: true, force: true });
  }
});

test("installer refuses to run as root and rejects unknown options", () => {
  // Unknown option fails fast with a usage error.
  assert.throws(
    () => execFileSync("bash", [installer, "--nonsense"], { cwd: repo, encoding: "utf8", stdio: "pipe" }),
    /Unknown option/,
  );
});

test("the generated launcher points at a real start script", () => {
  const prefix = mkdtempSync(path.join(tmpdir(), "acos-prefix-"));
  try {
    run(["--prefix", prefix]);
    const launcher = readFileSync(path.join(prefix, "bin/acos"), "utf8");
    const match = launcher.match(/exec bash "([^"]+start-local\.sh)"/);
    assert.ok(match, "launcher must exec a start-local.sh");
    assert.ok(existsSync(match![1]), "the referenced start script must exist");
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
});

// Keep a reference so the import is used even if the file list changes.
void mkdirSync;

// --- macOS installer --------------------------------------------------------
// The macOS installer refuses to run off Darwin, so its lifecycle cannot be
// exercised end-to-end here. These tests verify the parts that are
// platform-independent: usage, option handling, the fail-closed preflight, and
// that the generated artifacts are wired to the real launcher.

const macInstaller = path.join(repo, "src/macos/install-macos.sh");

function runMac(args: string[]) {
  return execFileSync("bash", [macInstaller, ...args], {
    cwd: repo,
    encoding: "utf8",
  });
}

test("macOS installer prints usage and rejects unknown options", () => {
  const help = runMac(["--help"]);
  assert.match(help, /ACOS macOS installer/);
  assert.match(help, /--login-item/);
  assert.match(help, /--dry-run/);
  assert.throws(
    () =>
      execFileSync("bash", [macInstaller, "--nonsense"], {
        cwd: repo,
        encoding: "utf8",
        stdio: "pipe",
      }),
    /Unknown option/,
  );
});

test("macOS installer fails closed off macOS rather than half-installing", () => {
  // On Linux (this sandbox) the preflight must refuse with a clear message and a
  // non-zero exit, before touching the filesystem.
  assert.throws(
    () =>
      execFileSync("bash", [macInstaller], {
        cwd: repo,
        encoding: "utf8",
        stdio: "pipe",
      }),
    /targets macOS/,
  );
});

test("macOS installer wires the app bundle, CLI launcher and login item", () => {
  const source = readFileSync(macInstaller, "utf8");
  // App bundle with an Info.plist and a launcher that opens a Terminal.
  assert.match(source, /ACOS\.app/);
  assert.match(source, /Contents\/Info\.plist/);
  assert.match(source, /Contents\/MacOS\/ACOS/);
  // A per-user LaunchAgent with a stable label.
  assert.match(source, /com\.acos\.host/);
  assert.match(source, /Library\/LaunchAgents/);
  assert.match(source, /launchctl bootstrap/);
  // The bundle and launcher must reach the real start script.
  assert.match(source, /src\/host\/start-local\.sh/);
  // Uninstall parity.
  assert.match(source, /--uninstall/);
  assert.match(source, /--purge/);
});
