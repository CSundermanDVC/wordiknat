// Base-map tile proxy core (SR-005, NFR-006): strict validation, a fixed upstream host and a disk cache.
// Imports nothing that knows the KNMI key; the upstream request carries no headers at all.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { WordiknatError } from "./errors.ts";
import { tileAllowed } from "./map-grid.ts";

export type Tile = { z: number; x: number; y: number };
export type TileDeps = {
  fetch: (url: string, init?: { redirect: "error" }) => Promise<Response>;
  dir: string;
};

const MAX_BYTES = 524_288;
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// Digits only, no leading zeros, at most `n` digits.
const digits = (n: number) => new RegExp(`^(?:0|[1-9]\\d{0,${n - 1}})$`);
const Z_RE = digits(2);
const XY_RE = digits(6);

const bad = (): never => {
  throw new WordiknatError("BAD_ARGS", "Ongeldige kaarttegel.");
};

function int(v: unknown, re: RegExp): number {
  if (typeof v === "number") return Number.isSafeInteger(v) ? v : bad();
  return typeof v === "string" && re.test(v) ? Number(v) : bad();
}

export function parseTile(z: unknown, x: unknown, y: unknown): Tile {
  const t = { z: int(z, Z_RE), x: int(x, XY_RE), y: int(y, XY_RE) };
  return tileAllowed(t.z, t.x, t.y) ? t : bad();
}

// Short alias of the advertised kadaster/brt-achtergrondkaart path (docs/pdok-tiles.md); zoom is zero-padded.
export const tileUrl = ({ z, x, y }: Tile): string =>
  `https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/grijs/EPSG:3857/${String(z).padStart(2, "0")}/${x}/${y}.png`;

const isPng = (b: Uint8Array) => b.length >= SIGNATURE.length && SIGNATURE.every((v, i) => b[i] === v);

/** Body bytes, or null as soon as it exceeds MAX_BYTES (the rest is never read). */
async function readCapped(res: Response): Promise<Uint8Array | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return new Uint8Array(Buffer.concat(chunks));
    size += value.length;
    if (size > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
}

async function fetchTile(tile: Tile, fetch: TileDeps["fetch"]): Promise<Uint8Array> {
  try {
    const res = await fetch(tileUrl(tile), { redirect: "error" });
    if (res.status !== 200 || !(res.headers.get("content-type") ?? "").startsWith("image/png")) {
      await res.body?.cancel();
      throw new Error("bad response");
    }
    const bytes = await readCapped(res);
    if (!bytes || !isPng(bytes)) throw new Error("bad body");
    return bytes;
  } catch {
    throw new WordiknatError("TILE_UNAVAILABLE");
  }
}

async function readCached(path: string): Promise<Uint8Array | null> {
  try {
    const bytes = new Uint8Array(await readFile(path));
    return isPng(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

async function loadTile(tile: Tile, path: string, fetch: TileDeps["fetch"]): Promise<Uint8Array> {
  const cached = await readCached(path);
  if (cached) return cached;
  const bytes = await fetchTile(tile, fetch);
  // Temp file plus rename (as in cache.ts), so a concurrent reader never sees a half-written tile.
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, bytes);
  await rename(tmp, path);
  return bytes;
}

const inflight = new Map<string, Promise<Uint8Array>>();

// shortcut: cached tiles never expire, delete <cacheDir>/tiles to refresh; add an age check if BRT updates matter.
export async function getTile(tile: { z: unknown; x: unknown; y: unknown }, { fetch, dir }: TileDeps): Promise<Uint8Array> {
  const t = parseTile(tile.z, tile.x, tile.y);
  // Built only from the validated integers, so it cannot leave <dir>/tiles.
  const path = join(dir, "tiles", String(t.z), String(t.x), `${t.y}.png`);
  const pending = inflight.get(path);
  if (pending) return pending;
  const p = loadTile(t, path, fetch).finally(() => inflight.delete(path));
  inflight.set(path, p);
  return p;
}
