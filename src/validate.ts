// Pure validation of untrusted server input. Messages are static: they never echo the input.
import { WordiknatError } from "./core/errors.ts";

const MAX_QUERY = 100;
const CONTROL = /[\u0000-\u001f\u007f]/;
const DECIMAL = /^-?\d+(\.\d+)?$/;

const PARAMS = "Ongeldige parameters. Gebruik ?q=<plaats> of ?lat=<n>&lon=<n>.";
const COORDS = "Ongeldige coördinaten. Gebruik lat tussen 49 en 55 en lon tussen 0 en 10, als decimaal getal.";
const QUERY = `Ongeldige plaatsnaam. Geef een naam van 1 tot ${MAX_QUERY} tekens.`;
const PORT = "Ongeldige poort. Gebruik een geheel getal van 1 tot en met 65535.";

const fail = (message: string): never => {
  throw new WordiknatError("BAD_ARGS", message);
};

// Rejects unknown and repeated parameters; returns the single value per allowed key.
function single(params: URLSearchParams, allowed: readonly string[]): Map<string, string> {
  const seen = new Map<string, string>();
  for (const [key, value] of params) {
    if (!allowed.includes(key) || seen.has(key)) fail(PARAMS);
    seen.set(key, value);
  }
  return seen;
}

function coord(s: string, min: number, max: number): number {
  const n = DECIMAL.test(s) ? Number(s) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : fail(COORDS);
}

function query(raw: string): string {
  const q = raw.trim();
  return q === "" || q.length > MAX_QUERY || CONTROL.test(raw) ? fail(QUERY) : q;
}

export function parseForecastQuery(params: URLSearchParams): { lat: number; lon: number } | { q: string } {
  const p = single(params, ["lat", "lon", "q"]);
  const q = p.get("q");
  if (q !== undefined) return p.size === 1 ? { q: query(q) } : fail(PARAMS);
  const lat = p.get("lat");
  const lon = p.get("lon");
  if (lat === undefined || lon === undefined) return fail(PARAMS);
  return { lat: coord(lat, 49, 55), lon: coord(lon, 0, 10) };
}

export function parseGeocodeQuery(params: URLSearchParams): { q: string } {
  const q = single(params, ["q"]).get("q");
  return q === undefined ? fail(PARAMS) : { q: query(q) };
}

export function parsePort(value: string): number {
  const n = /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : fail(PORT);
}
