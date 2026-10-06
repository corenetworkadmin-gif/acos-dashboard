import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  lstatSync,
  realpathSync,
  openSync,
  closeSync,
  readSync,
  fsyncSync,
} from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { verifyRelease } from "./releases.ts";
const pointerSchema = z
  .object({
    current: z.string().uuid().nullable(),
    previous: z.string().uuid().nullable(),
    sequence: z.number().int().nonnegative(),
  })
  .strict();

// Minimal USTAR reader for our release format: regular files/directories only.
// No links, devices, ownership, permissions, extension records or extraction tools.
export function unpackRelease(archive: Buffer, destination: string) {
  const tar = gunzipSync(archive, { maxOutputLength: 32 * 1024 * 1024 });
  let cursor = 0,
    count = 0;
  const names = new Set<string>();
  while (cursor + 512 <= tar.length) {
    const header = tar.subarray(cursor, cursor + 512);
    if (header.every((byte) => byte === 0)) {
      if (!tar.subarray(cursor).every((byte) => byte === 0))
        throw new Error("Unexpected data after tar terminator.");
      break;
    }
    const text = (start: number, length: number) =>
      header
        .subarray(start, start + length)
        .toString("utf8")
        .split("\0")[0];
    const octal = (start: number, length: number) => {
      const value = text(start, length).trim();
      if (!/^[0-7]+$/.test(value)) throw new Error("Invalid tar integer.");
      return parseInt(value, 8);
    };
    const expected = octal(148, 8);
    let checksum = 0;
    for (let i = 0; i < 512; i++)
      checksum += i >= 148 && i < 156 ? 32 : header[i];
    if (checksum !== expected || text(257, 5) !== "ustar")
      throw new Error("Invalid USTAR header.");
    const prefix = text(345, 155);
    const name = (prefix ? prefix + "/" : "") + text(0, 100);
    const clean = name.replace(/\/$/, "");
    if (
      !/^(server\.mjs|web(?:\/[a-zA-Z0-9_.-]+)*)$/.test(clean) ||
      clean.split("/").some((part) => part === "." || part === "..") ||
      names.has(clean)
    )
      throw new Error("Invalid or duplicate release path.");
    names.add(clean);
    if (++count > 2000) throw new Error("Too many release files.");
    const size = octal(124, 12),
      type = text(156, 1);
    if (!["0", "", "5"].includes(type) || (type === "5" && size !== 0))
      throw new Error("Release links and special files are forbidden.");
    cursor += 512;
    if (cursor + size > tar.length)
      throw new Error("Truncated release archive.");
    const target = path.join(destination, clean);
    if (type === "5") mkdirSync(target, { recursive: true, mode: 0o700 });
    else {
      mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      writeFileSync(target, tar.subarray(cursor, cursor + size), {
        flag: "wx",
        mode: 0o600,
      });
    }
    cursor += Math.ceil(size / 512) * 512;
  }
  if (!names.has("server.mjs") || !names.has("web/index.html"))
    throw new Error("Release entry points missing.");
}

export class UpdateStore {
  readonly root: string;
  readonly publicKey: string;
  constructor(root: string, publicKey: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const info = lstatSync(root);
    if (
      !info.isDirectory() ||
      (process.getuid && info.uid !== process.getuid())
    )
      throw new Error("Update root must be an owned directory.");
    chmodSync(root, 0o700);
    this.root = realpathSync(root);
    this.publicKey = publicKey;
  }
  state() {
    const file = path.join(this.root, "active.json");
    return existsSync(file)
      ? pointerSchema.parse(JSON.parse(readFileSync(file, "utf8")))
      : { current: null, previous: null, sequence: 0 };
  }
  private save(value: z.infer<typeof pointerSchema>) {
    const temporary = path.join(this.root, randomUUID() + ".json");
    writeFileSync(temporary, JSON.stringify(value), {
      flag: "wx",
      mode: 0o600,
      flush: true,
    });
    renameSync(temporary, path.join(this.root, "active.json"));
    const directory = openSync(this.root, "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  }
  release(id: string) {
    return path.join(this.root, z.string().uuid().parse(id));
  }
  async apply(
    envelope: unknown,
    artifact: string,
    health: (directory: string) => Promise<void>,
  ) {
    const lock = path.join(this.root, "update.lock");
    writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
    const id = randomUUID(),
      directory = this.release(id);
    try {
      const previous = this.state();
      const manifest = verifyRelease(envelope, this.publicKey, {
        sequence: previous.sequence,
        platform: process.platform,
        architecture: process.arch,
      });
      // Cap desktop packages before reading into memory; copy immutable bytes into
      // the private stage, then verify that copy and only ever unpack those bytes.
      if (manifest.artifact.bytes > 16 * 1024 * 1024)
        throw new Error("Desktop package exceeds 16 MiB.");
      const descriptor = openSync(artifact, "r");
      const buffer = Buffer.alloc(manifest.artifact.bytes + 1);
      let size = 0;
      try {
        while (size < buffer.length) {
          const received = readSync(
            descriptor,
            buffer,
            size,
            buffer.length - size,
            null,
          );
          if (!received) break;
          size += received;
        }
      } finally {
        closeSync(descriptor);
      }
      const bytes = buffer.subarray(0, size);
      if (
        bytes.length !== manifest.artifact.bytes ||
        createHash("sha256").update(bytes).digest("hex") !==
          manifest.artifact.sha256
      )
        throw new Error("Release artifact integrity verification failed.");
      mkdirSync(directory, { mode: 0o700 });
      unpackRelease(bytes, directory);
      writeFileSync(
        path.join(directory, "manifest.json"),
        JSON.stringify(envelope),
        { flag: "wx", mode: 0o600 },
      );
      await health(directory);
      this.save({
        current: id,
        previous: previous.current,
        sequence: manifest.sequence,
      });
      return {
        version: manifest.version,
        sequence: manifest.sequence,
        directory,
      };
    } catch (error) {
      rmSync(directory, { recursive: true, force: true });
      throw error;
    } finally {
      rmSync(lock, { force: true });
    }
  }
  async rollback(health: (directory: string) => Promise<void>) {
    const lock = path.join(this.root, "update.lock");
    writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
    try {
      const state = this.state();
      if (!state.previous)
        throw new Error("No previously accepted release to roll back to.");
      await health(this.release(state.previous));
      // Keep the anti-replay high-water mark when restoring earlier application code.
      this.save({ ...state, current: state.previous, previous: state.current });
    } finally {
      rmSync(lock, { force: true });
    }
  }
}
