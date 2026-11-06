// File cache for the newest KNMI file (NFR-002): at most one download per max age (radar: 5 minutes).
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, posix, win32 } from "node:path";
import type { KnmiClient } from "./knmi.ts";

const MAX_AGE_MS = 5 * 60_000;

type Meta = { fileName: string; downloadedAt: number };

export function cacheDir(env: Record<string, string | undefined>, platform: string, homedir: string): string {
  if (platform === "win32") {
    return win32.join(env.LOCALAPPDATA || win32.join(homedir, "AppData", "Local"), "wordiknat");
  }
  return posix.join(env.XDG_CACHE_HOME || posix.join(homedir, ".cache"), "wordiknat");
}

function isMeta(v: unknown): v is Meta {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Meta).fileName === "string" &&
    Number.isFinite((v as Meta).downloadedAt)
  );
}

/** Missing, unreadable or corrupt cache all count as empty. */
async function readCache(dir: string, fileName: string): Promise<{ meta: Meta; bytes: Uint8Array } | null> {
  try {
    const meta: unknown = JSON.parse(await readFile(join(dir, "meta.json"), "utf8"));
    if (!isMeta(meta)) return null;
    return { meta, bytes: new Uint8Array(await readFile(join(dir, fileName))) };
  } catch {
    return null;
  }
}

/** Temp file plus rename, so a concurrent reader never sees a half-written file. */
async function writeAtomic(path: string, data: Uint8Array | string): Promise<void> {
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

async function writeMeta(dir: string, meta: Meta): Promise<void> {
  await writeAtomic(join(dir, "meta.json"), JSON.stringify(meta));
}

export async function getLatestFile({
  client,
  dir,
  now,
  fileName = "latest.h5",
  maxAgeMs = MAX_AGE_MS,
}: {
  client: KnmiClient;
  dir: string;
  now: number;
  /** Local name of the cached file inside `dir`, not the KNMI name. */
  fileName?: string;
  maxAgeMs?: number;
}): Promise<Uint8Array> {
  const cached = await readCache(dir, fileName);
  // A downloadedAt in the future (clock set back) is treated as stale, not as fresh forever.
  const age = cached ? now - cached.meta.downloadedAt : -1;
  if (cached && age >= 0 && age < maxAgeMs) return cached.bytes;

  // shortcut: a listing failure is rethrown even with a cached file; serve stale data here if that proves too strict.
  const latest = await client.latestFileName();
  await mkdir(dir, { recursive: true });
  if (cached && cached.meta.fileName === latest) {
    await writeMeta(dir, { fileName: latest, downloadedAt: now });
    return cached.bytes;
  }

  const bytes = await client.download(latest);
  await writeAtomic(join(dir, fileName), bytes);
  await writeMeta(dir, { fileName: latest, downloadedAt: now });
  return bytes;
}
