import type { ForecastPoint, Intensity, Location } from "../../src/core/types.ts";

export type ForecastView = {
  summary: string;
  willRain: boolean;
  firstRainAt: Date | null;
  dryUntil: Date | null;
  maxMmPerHour: number;
  location: Location;
  issuedAt: Date;
  points: ForecastPoint[];
  source: string;
};

export type HourlyView = Omit<ForecastView, "points"> & { intensity: Intensity | null; hours: ForecastPoint[] };

export class ApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

const GENERIC_NETWORK = "Geen verbinding met de server. Controleer of Wordiknat draait en probeer het opnieuw.";
const GENERIC_BAD = "Onverwacht antwoord van de server. Probeer het later opnieuw.";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function toDate(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const toIsoDate = (v: unknown): Date | null => (typeof v === "string" && ISO.test(v) ? toDate(v) : null);
const isAmount = (v: unknown): v is number => isNum(v) && v >= 0;
const INTENSITIES: readonly unknown[] = ["licht", "matig", "zwaar"];

function toLocation(v: unknown): Location | null {
  if (!isRec(v)) return null;
  const { name, lat, lon } = v;
  if (typeof name !== "string" || name.length === 0 || !isNum(lat) || !isNum(lon)) return null;
  return { name, lat, lon };
}

function toForecast(v: unknown): ForecastView | null {
  if (!isRec(v) || !Array.isArray(v.points) || v.points.length > 25) return null;
  const location = toLocation(v.location);
  const issuedAt = toDate(v.issuedAt);
  const firstRainAt = v.firstRainAt === null ? null : toDate(v.firstRainAt);
  const dryUntil = v.dryUntil === null ? null : toDate(v.dryUntil);
  if (
    typeof v.summary !== "string" ||
    typeof v.willRain !== "boolean" ||
    typeof v.source !== "string" ||
    !isNum(v.maxMmPerHour) ||
    !location ||
    !issuedAt ||
    (v.firstRainAt !== null && !firstRainAt) ||
    (v.dryUntil !== null && !dryUntil)
  ) {
    return null;
  }
  const points: ForecastPoint[] = [];
  for (const p of v.points) {
    if (!isRec(p)) return null;
    const time = toDate(p.time);
    if (!time || !isNum(p.mmPerHour)) return null;
    points.push({ time, mmPerHour: p.mmPerHour });
  }
  return {
    summary: v.summary,
    willRain: v.willRain,
    firstRainAt,
    dryUntil,
    maxMmPerHour: v.maxMmPerHour,
    location,
    issuedAt,
    points,
    source: v.source,
  };
}

/** Strict: anything outside the `/api/hourly` contract (exactly 24 hours, ISO times, amounts >= 0) is rejected. */
function toHourly(v: unknown): HourlyView | null {
  if (!isRec(v) || !Array.isArray(v.hours) || v.hours.length !== 24) return null;
  const location = toLocation(v.location);
  const issuedAt = toIsoDate(v.issuedAt);
  const firstRainAt = v.firstRainAt === null ? null : toIsoDate(v.firstRainAt);
  const dryUntil = v.dryUntil === null ? null : toIsoDate(v.dryUntil);
  const intensity = v.intensity === null ? null : INTENSITIES.includes(v.intensity) ? (v.intensity as Intensity) : undefined;
  if (
    typeof v.summary !== "string" ||
    typeof v.willRain !== "boolean" ||
    typeof v.source !== "string" ||
    !isAmount(v.maxMmPerHour) ||
    intensity === undefined ||
    !location ||
    !issuedAt ||
    (v.firstRainAt !== null && !firstRainAt) ||
    (v.dryUntil !== null && !dryUntil)
  ) {
    return null;
  }
  const hours: ForecastPoint[] = [];
  for (const h of v.hours) {
    if (!isRec(h)) return null;
    const time = toIsoDate(h.time);
    if (!time || !isAmount(h.mmPerHour)) return null;
    hours.push({ time, mmPerHour: h.mmPerHour });
  }
  return {
    summary: v.summary,
    willRain: v.willRain,
    firstRainAt,
    dryUntil,
    maxMmPerHour: v.maxMmPerHour,
    intensity,
    location,
    issuedAt,
    hours,
    source: v.source,
  };
}

async function getJson(path: string, fetchFn: typeof fetch): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(path, { signal: AbortSignal.timeout(30_000) });
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
  if (!res.ok) throw new ApiError("BAD_RESPONSE", GENERIC_BAD);
  return body;
}

type Target = { lat: number; lon: number } | { q: string };

const query = (target: Target): string =>
  "q" in target
    ? `q=${encodeURIComponent(target.q)}`
    : `lat=${encodeURIComponent(target.lat)}&lon=${encodeURIComponent(target.lon)}`;

export async function fetchForecast(target: Target, fetchFn: typeof fetch = fetch): Promise<ForecastView> {
  const forecast = toForecast(await getJson(`/api/forecast?${query(target)}`, fetchFn));
  if (!forecast) throw new ApiError("BAD_RESPONSE", GENERIC_BAD);
  return forecast;
}

export async function fetchHourly(target: Target, fetchFn: typeof fetch = fetch): Promise<HourlyView> {
  const hourly = toHourly(await getJson(`/api/hourly?${query(target)}`, fetchFn));
  if (!hourly) throw new ApiError("BAD_RESPONSE", GENERIC_BAD);
  return hourly;
}

export async function searchPlaces(q: string, fetchFn: typeof fetch = fetch): Promise<Location[]> {
  const body = await getJson(`/api/geocode?q=${encodeURIComponent(q)}`, fetchFn);
  if (!isRec(body) || !Array.isArray(body.results)) throw new ApiError("BAD_RESPONSE", GENERIC_BAD);
  const out: Location[] = [];
  for (const r of body.results) {
    const loc = toLocation(r);
    if (!loc) throw new ApiError("BAD_RESPONSE", GENERIC_BAD);
    out.push(loc);
  }
  return out;
}
