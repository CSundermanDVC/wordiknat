// The single guarded path for the KNMI key (SR-001): environment or <cwd>/.env, never printed.
import { join } from "node:path";
import { WordiknatError } from "./errors.ts";

/** Loads <cwd>/.env into process.env when present; variables already set keep their value. */
export function loadEnv(cwd: string): void {
  try {
    process.loadEnvFile(join(cwd, ".env"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export function getApiKey(env: Record<string, string | undefined>): string {
  const key = env.KNMI_API_KEY?.trim();
  if (!key) throw new WordiknatError("MISSING_KEY");
  return key;
}

export function redact(text: string, key: string): string {
  return key ? text.replaceAll(key, "***") : text;
}
