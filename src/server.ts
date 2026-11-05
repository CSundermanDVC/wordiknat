// Local HTTP server (FR-008): JSON API and the built web UI. Binds to 127.0.0.1 unless told otherwise (SR-002).
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import { extname, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { getApiKey, redact } from "./core/env.ts";
import { WordiknatError, toErrorJson, type ErrorCode } from "./core/errors.ts";
import { getForecast } from "./core/forecast.ts";
import { geocode, searchPlaces } from "./core/geocode.ts";
import { getRadar } from "./core/radar.ts";
import { buildReport } from "./core/report.ts";
import { summarize } from "./core/summary.ts";
import { getTile } from "./core/tiles.ts";
import type { Location } from "./core/types.ts";
import { parseForecastQuery, parseGeocodeQuery } from "./validate.ts";

// `init` is optional so the same fetch serves KNMI (headers), the geocoder (none) and tiles (redirect only).
type Fetch = (url: string, init?: { headers?: Record<string, string>; redirect?: "error" }) => Promise<Response>;

export type ServerDeps = {
  fetch: Fetch;
  env: Record<string, string | undefined>;
  now: () => Date;
  cacheDir: string;
  staticDir?: string;
  host?: string;
  stderr?: (text: string) => void;
};

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export const LOOPBACK = ["127.0.0.1", "localhost", "::1"];

// Errors the server answers itself; messages are static and never echo the request.
const FORBIDDEN = { error: { code: "FORBIDDEN_HOST", message: "Deze server is alleen bereikbaar via 127.0.0.1 of localhost." } };
const NOT_ALLOWED = { error: { code: "METHOD_NOT_ALLOWED", message: "Alleen GET- en HEAD-verzoeken zijn toegestaan." } };
const NOT_FOUND = { error: { code: "NOT_FOUND", message: "Deze pagina of API-route bestaat niet." } };
const NO_BUILD = { error: { code: "NO_BUILD", message: "De webinterface is nog niet gebouwd. Voer eerst `npm run build` uit." } };
// geocode's own UNKNOWN_PLACE message quotes the query; the server must not echo input.
const UNKNOWN_PLACE = "Plaats niet gevonden. Controleer de spelling of kies een andere plaats.";

const STATUS: Partial<Record<ErrorCode, number>> = {
  BAD_ARGS: 400,
  NO_LOCATION: 400,
  OUTSIDE_GRID: 400,
  UNKNOWN_PLACE: 404,
  MISSING_KEY: 500,
  INVALID_KEY: 500,
  RATE_LIMITED: 503,
};

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

type StaticFile = { data: Uint8Array; type: string; cache: string };
type Reply = [status: number, body: unknown, file?: StaticFile];

function errorResponse(e: unknown): Reply {
  // Unexpected errors (fs, bugs) get the generic message: no stack, paths or raw text.
  const err = !(e instanceof WordiknatError)
    ? new WordiknatError("SOURCE_HTTP")
    : e.code === "UNKNOWN_PLACE"
      ? new WordiknatError("UNKNOWN_PLACE", UNKNOWN_PLACE)
      : e;
  return [STATUS[err.code] ?? 502, toErrorJson(err)];
}

/** Host header without port; IPv6 brackets stripped. */
function hostName(header: string | undefined): string {
  const h = (header ?? "").toLowerCase();
  return h.startsWith("[") ? h.slice(1, h.indexOf("]")) : h.split(":")[0];
}

/** Debug lines name the host and status only: paths and queries can carry signed URLs. */
function debugFetch(fetch: Fetch, log: (text: string) => void): Fetch {
  return async (url, init) => {
    const host = new URL(url).host;
    try {
      const res = await fetch(url, init);
      log(`debug: ${host} ${res.status}\n`);
      return res;
    } catch (e) {
      log(`debug: ${host} netwerkfout\n`);
      throw e;
    }
  };
}

async function forecast(params: URLSearchParams, deps: ServerDeps, fetch: Fetch) {
  const query = parseForecastQuery(params);
  const apiKey = getApiKey(deps.env);
  const location: Location = "q" in query ? await geocode(query.q, { fetch }) : { name: `${query.lat}, ${query.lon}`, ...query };
  const now = deps.now();
  // shortcut: concurrent requests on a stale cache each download; add in-flight dedupe if clients start to race.
  const f = await getForecast(location, { fetch, apiKey, cacheDir: deps.cacheDir, now });
  return buildReport(f, summarize(f.points, now));
}

const TILE_PATH = /^\/tiles\/([^/]+)\/([^/]+)\/([^/]+)\.png$/;
const GZIP_MIN = 1024;

/** True when Accept-Encoding lists gzip without q=0. */
function acceptsGzip(header = ""): boolean {
  return header.split(",").some((t) => {
    const [name, q] = t.split(/;\s*q=/i);
    return name.trim().toLowerCase() === "gzip" && Number(q) !== 0;
  });
}

/** A file from `dir`; 404 for anything that does not resolve to a readable file inside it. */
async function staticFile(pathname: string, dir: string): Promise<Reply> {
  let rel: string;
  try {
    // Decoding after URL parsing catches %2f and %5c that the parser leaves alone.
    rel = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  } catch {
    return [404, NOT_FOUND];
  }
  const root = resolve(dir);
  const file = resolve(root, `.${rel}`);
  if (rel.includes("\0") || !file.startsWith(root + sep)) return [404, NOT_FOUND];
  if (!(await stat(root).catch(() => null))?.isDirectory()) return [503, NO_BUILD];
  // shortcut: symlinks inside dir are followed; fine for Vite output, use realpath if dir ever holds user content.
  const data = await readFile(file).catch(() => null);
  if (!data) return [404, NOT_FOUND];
  const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
  // Vite hashes every file name under /assets/, so those never change.
  const cache = rel.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
  return [200, null, { data, type, cache }];
}

async function route(req: http.IncomingMessage, deps: ServerDeps, fetch: Fetch): Promise<Reply> {
  const allowed = deps.host ? [...LOOPBACK, deps.host.toLowerCase()] : LOOPBACK;
  if (!allowed.includes(hostName(req.headers.host))) return [403, FORBIDDEN];
  if (req.method !== "GET" && req.method !== "HEAD") return [405, NOT_ALLOWED];
  const url = URL.parse(req.url ?? "/", "http://localhost");
  if (!url) throw new WordiknatError("BAD_ARGS");
  if (url.pathname === "/api/forecast") return [200, await forecast(url.searchParams, deps, fetch)];
  if (url.pathname === "/api/geocode") {
    const { q } = parseGeocodeQuery(url.searchParams);
    return [200, { results: await searchPlaces(q, { fetch }) }];
  }
  if (url.pathname === "/api/radar") {
    if (url.search) throw new WordiknatError("BAD_ARGS", "Deze route accepteert geen parameters.");
    const apiKey = getApiKey(deps.env);
    return [200, await getRadar({ fetch, apiKey, cacheDir: deps.cacheDir, now: deps.now() })];
  }
  if (url.pathname.startsWith("/tiles/")) {
    // A non-matching path leaves the parts undefined, so parseTile rejects it before any file or network access.
    const [, z, x, y] = TILE_PATH.exec(url.pathname) ?? [];
    const data = await getTile({ z, x, y }, { fetch, dir: deps.cacheDir });
    return [200, null, { data, type: "image/png", cache: "public, max-age=86400" }];
  }
  if (url.pathname.startsWith("/api/") || !deps.staticDir) return [404, NOT_FOUND];
  return staticFile(url.pathname, deps.staticDir);
}

export function createServer(deps: ServerDeps): http.Server {
  return http.createServer(async (req, res) => {
    // Read per request: the key may be added to the environment while the server runs.
    const key = deps.env.KNMI_API_KEY?.trim() ?? "";
    const log = (text: string) => (deps.stderr ?? ((t) => process.stderr.write(t)))(redact(text, key));
    const fetch = deps.env.WORDIKNAT_DEBUG === "1" ? debugFetch(deps.fetch, log) : deps.fetch;
    const [status, body, file] = await route(req, deps, fetch).catch(errorResponse);
    // Redact before compressing: the key could not be found in gzip output afterwards.
    const json = file ? "" : redact(JSON.stringify(body), key);
    const gzip = !file && Buffer.byteLength(json) > GZIP_MIN && acceptsGzip(req.headers["accept-encoding"]);
    const text = file ? file.data : gzip ? gzipSync(json) : json;
    res.writeHead(status, {
      ...SECURITY_HEADERS,
      ...(file ? {} : { Vary: "Accept-Encoding" }),
      ...(gzip ? { "Content-Encoding": "gzip" } : {}),
      "Content-Type": file?.type ?? "application/json; charset=utf-8",
      "Cache-Control": file?.cache ?? "no-store",
      "Content-Length": Buffer.byteLength(text),
      ...(status === 405 ? { Allow: "GET, HEAD" } : {}),
    });
    res.end(text);
  });
}

/** Listens on `port` at `host` (default 127.0.0.1) and resolves once the server accepts connections. */
export function startServer({ port, host = "127.0.0.1", ...deps }: ServerDeps & { port: number }): Promise<http.Server> {
  const server = createServer({ ...deps, host });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}
