import { readFileSync } from "node:fs";
import { signWithTpm } from "./identity.ts";
try {
  const [challengeFile] = process.argv.slice(2);
  const {
    ACOS_TPM_HANDLE: handle,
    ACOS_ADMIN_IDENTITY_PUBLIC_KEY_FILE: keyFile,
    ACOS_IDENTITY_INSTALLATION: installation,
    ACOS_IDENTITY_HOST: host,
    ACOS_TPM_AUTH_FILE: authFile,
  } = process.env;
  if (!challengeFile || !handle || !keyFile || !installation || !host)
    throw new Error(
      "Set ACOS_TPM_HANDLE, ACOS_ADMIN_IDENTITY_PUBLIC_KEY_FILE, ACOS_IDENTITY_INSTALLATION and ACOS_IDENTITY_HOST; pass a challenge file.",
    );
  console.log(
    signWithTpm({
      token: readFileSync(challengeFile, "utf8").trim(),
      handle,
      pinnedKey: readFileSync(keyFile, "utf8"),
      installation,
      host,
      authFile,
    }),
  );
} catch (error) {
  // Do not expose tool stderr or authentication-file contents.
  console.error(
    error instanceof Error && !("stderr" in error)
      ? error.message
      : "TPM signing failed; check local provisioning and permissions.",
  );
  process.exitCode = 1;
}
