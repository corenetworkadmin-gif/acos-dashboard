import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  renameSync,
  lstatSync,
  rmSync,
} from "node:fs";
import { z } from "zod";
const configSchema = z
  .object({
    secret: z.string().regex(/^[A-Z2-7]{32}$/),
    lastCounter: z.number().int().min(-1),
  })
  .strict();
function decode(secret: string) {
  let bits = "";
  for (const c of secret)
    bits += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
      .indexOf(c)
      .toString(2)
      .padStart(5, "0");
  return Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
}
export function totp(secret: Buffer, counter: number, digits = 6) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(bytes).digest();
  const offset = hmac[hmac.length - 1] & 15;
  return String(
    (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits,
  ).padStart(digits, "0");
}
export class TotpGate {
  private file: string;
  constructor(file: string) {
    this.file = file;
    this.read();
  }
  private read() {
    const info = lstatSync(this.file);
    if (
      !info.isFile() ||
      info.mode & 0o077 ||
      (process.getuid && info.uid !== process.getuid())
    )
      throw new Error("MFA configuration must be an owner-only regular file.");
    return configSchema.parse(JSON.parse(readFileSync(this.file, "utf8")));
  }
  verify(code: string, now = Date.now()) {
    if (!/^\d{6}$/.test(code)) return false;
    const config = this.read();
    const current = Math.floor(now / 30_000);
    for (const step of [current, current - 1, current + 1]) {
      if (step < 0 || step <= config.lastCounter) continue;
      if (
        !timingSafeEqual(
          Buffer.from(code),
          Buffer.from(totp(decode(config.secret), step)),
        )
      )
        continue;
      // Commit the replay fence before issuing a session; a write error denies login.
      const temporary = this.file + "." + randomUUID() + ".pending";
      try {
        writeFileSync(
          temporary,
          JSON.stringify({ ...config, lastCounter: step }),
          { mode: 0o600, flag: "wx", flush: true },
        );
        renameSync(temporary, this.file);
      } finally {
        rmSync(temporary, { force: true });
      }
      return true;
    }
    return false;
  }
}
