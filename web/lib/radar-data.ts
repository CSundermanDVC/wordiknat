import { RADAR_GRID, RADAR_ZOOM, unpackClasses } from "../../src/core/map-grid.ts";
import { ApiError } from "./api.ts";

export type RadarView = {
  issuedAt: Date;
  times: Date[];
  width: number;
  height: number;
  originX: number;
  originY: number;
  zoom: number;
  frames: Uint8Array[];
};

// Same wording as api.ts (its constants are private).
const GENERIC_NETWORK = "Geen verbinding met de server. Controleer of Wordiknat draait en probeer het opnieuw.";
const GENERIC_BAD = "Onverwacht antwoord van de server. Probeer het later opnieuw.";
const STEPS = 25;
const MAX_CELLS = 250_000;
const STEP_MS = 5 * 60_000;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const isPosInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

function toDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Decoded bytes when `v` is base64 of exactly `bytes` bytes, otherwise null. Length is checked first, so oversize input is never decoded. */
function decodeFrame(v: unknown, bytes: number): Uint8Array | null {
  if (typeof v !== "string" || v.length !== 4 * Math.ceil(bytes / 3) || !BASE64.test(v)) return null;
  const bin = atob(v);
  if (bin.length !== bytes) return null;
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function toRadar(v: unknown): RadarView | null {
  if (!isRec(v)) return null;
  const { width, height, originX, originY, zoom } = v;
  if (
    zoom !== RADAR_ZOOM ||
    !isPosInt(width) ||
    !isPosInt(height) ||
    width * height > MAX_CELLS ||
    width !== RADAR_GRID.width ||
    height !== RADAR_GRID.height ||
    !Number.isInteger(originX) ||
    !Number.isInteger(originY) ||
    !Array.isArray(v.times) ||
    v.times.length !== STEPS ||
    !Array.isArray(v.frames) ||
    v.frames.length !== STEPS
  ) {
    return null;
  }
  const issuedAt = toDate(v.issuedAt);
  const times = v.times.map(toDate);
  if (!issuedAt || times.some((t) => t === null)) return null;
  const cells = width * height;
  const frames: Uint8Array[] = [];
  for (const f of v.frames) {
    const bytes = decodeFrame(f, Math.ceil(cells / 4));
    if (!bytes) return null;
    frames.push(unpackClasses(bytes, cells));
  }
  return {
    issuedAt,
    times: times as Date[],
    width,
    height,
    originX: originX as number,
    originY: originY as number,
    zoom,
    frames,
  };
}

export async function fetchRadar(fetchFn: typeof fetch = fetch): Promise<RadarView> {
  let res: Response;
  try {
    res = await fetchFn("/api/radar", { signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new ApiError("NETWORK", GENERIC_NETWORK);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError("BAD_RESPONSE", GENERIC_BAD);
  }
  if (isRec(body) && isRec(body.error)) {
    const { code, message } = body.error;
    if (typeof code === "string" && typeof message === "string") throw new ApiError(code, message);
    throw new ApiError("BAD_RESPONSE", GENERIC_BAD);
  }
  const radar = res.ok ? toRadar(body) : null;
  if (!radar) throw new ApiError("BAD_RESPONSE", GENERIC_BAD);
  return radar;
}

/** The step containing `now`: the first whose 5-minute window has not ended, clamped to the last step. */
export function nowIndex(times: Date[], now: Date): number {
  const i = times.findIndex((t) => t.getTime() + STEP_MS > now.getTime());
  return i < 0 ? Math.max(0, times.length - 1) : i;
}
