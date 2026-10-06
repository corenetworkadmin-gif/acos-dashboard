import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { generateStorageKey } from "./crypto.ts";
const parse = (value: string) => {
  if (!/^[a-f0-9]{64}$/.test(value))
    throw new Error(
      "Storage key is missing or malformed. Restore the trusted key before startup.",
    );
  return Buffer.from(value, "hex");
};
export function loadStorageKey(directory: string) {
  const file = path.join(directory, "storage.key");
  const existing = existsSync(file) ? readFileSync(file, "utf8").trim() : null;
  if (existing !== null) parse(existing);
  const provider = process.env.ACOS_STORAGE_KEY_PROVIDER ?? "file";
  if (provider === "file") {
    if (existing !== null) {
      chmodSync(file, 0o600);
      return parse(existing);
    }
    if (existsSync(path.join(directory, "acos.sqlite")))
      throw new Error(
        "Storage key lost; refusing to replace it for an existing database.",
      );
    const key = generateStorageKey();
    writeFileSync(file, key.toString("hex"), {
      mode: 0o600,
      flag: "wx",
      flush: true,
    });
    return key;
  }
  if (provider !== "secret-service" || process.platform !== "linux")
    throw new Error("Unsupported storage keystore provider.");
  const id = createHash("sha256").update(path.resolve(directory)).digest("hex");
  const environment = Object.fromEntries(
    [
      "HOME",
      "PATH",
      "DBUS_SESSION_BUS_ADDRESS",
      "XDG_RUNTIME_DIR",
      "DISPLAY",
      "LANG",
    ].flatMap((name) =>
      process.env[name] ? [[name, process.env[name]!]] : [],
    ),
  );
  const lookup = () =>
    spawnSync(
      "/usr/bin/secret-tool",
      ["lookup", "application", "acos", "instance", id],
      { env: environment, encoding: "utf8", timeout: 10_000, maxBuffer: 4096 },
    );
  const found = lookup();
  if (found.error)
    throw new Error("Secret Service is unavailable; storage startup refused.");
  let value = found.status === 0 ? found.stdout.trim() : null;
  if (value !== null) {
    parse(value);
    if (existing !== null && existing !== value)
      throw new Error("File and keystore storage keys disagree.");
  } else {
    if (!existing && existsSync(path.join(directory, "acos.sqlite")))
      throw new Error("Keystore key missing for existing storage.");
    value = existing ?? generateStorageKey().toString("hex");
    const stored = spawnSync(
      "/usr/bin/secret-tool",
      [
        "store",
        "--label=ACOS companion storage",
        "application",
        "acos",
        "instance",
        id,
      ],
      {
        input: value,
        env: environment,
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 4096,
      },
    );
    if (stored.status !== 0 || lookup().stdout.trim() !== value)
      throw new Error(
        "Keystore storage verification failed; original key preserved.",
      );
  }
  // Delete the legacy plaintext file only after an independently read-back key
  // matches. This is explicitly requested by selecting the keystore provider.
  if (existing !== null) unlinkSync(file);
  return parse(value);
}
