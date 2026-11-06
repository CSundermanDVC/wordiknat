import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, startServer } from "../src/server.ts";
import { tileRange } from "../src/core/map-grid.ts";
import { tileUrl } from "../src/core/tiles.ts";
import { SOURCE } from "../src/core/types.ts";
import {
  API,
  DOWNLOAD,
  fakeFetch,
  FIELDS,
  HARMONIE_API,
  HARMONIE_INSIDE,
  HARMONIE_NOW,
  INSIDE,
  KEY,
  NOW,
  OUTSIDE,
  PDOK,
  pdok,
  png,
  PNG,
  TILES,
  type Override,
} from "./helpers/fake-fetch.ts";

// The fixture crop spans 55.0-55.4 °N; lat 55 is the only request latitude (bound 49-55) that lands inside it.
const EDGE = { lat: 55, lon: 5.33 };
const CSP = "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const R8 = tileRange(8);
const TILE = { z: 8, x: R8.x0, y: R8.y0 };
const TILE_PATH = `/tiles/8/${TILE.x}/${TILE.y}.png`;

// Deps are getters over `state`, so one server per file can run every scenario.
type State = { fetch: ReturnType<typeof fakeFetch>; env: Record<string, string | undefined>; now: Date; stderr: string[] };
let state: State;
let root: string;
let cacheDir: string;
let server: http.Server;
let base: string;

beforeAll(async () => {
  server = createServer({
    get fetch() {
      return state.fetch.fetch;
    },
    get env() {
      return state.env;
    },
    now: () => state.now,
    get cacheDir() {
      return cacheDir;
    },
    stderr: (t) => state.stderr.push(t),
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = await mkdtemp(join(tmpdir(), "wordiknat-server-"));
  cacheDir = root;
  state = { fetch: fakeFetch(), env: { KNMI_API_KEY: KEY }, now: NOW, stderr: [] };
});
afterAll(() => rm(root, { recursive: true, force: true }));

async function get(path: string, init?: RequestInit) {
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  return { res, text, body: text ? JSON.parse(text) : undefined };
}

/** Raw request so the Host header can be set (fetch forbids it). */
function raw(path: string, host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${path}`, { headers: { host } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

type RawReply = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };

/** Sends `path` byte for byte (no dot-segment normalising, no implicit Accept-Encoding) to the shared server. */
function send(path: string, headers: Record<string, string> = {}, method = "GET"): Promise<RawReply> {
  return new Promise((resolve, reject) => {
    const port = (server.address() as AddressInfo).port;
    const req = http.request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

const coords = (p: { lat: number; lon: number }) => `lat=${p.lat}&lon=${p.lon}`;
const errorBody = (code: string) => ({ error: { code, message: expect.any(String) } });
const knmiStatus = (s: number): Override => (url) => (url.startsWith(`${API}?`) ? new Response(`bad ${KEY}`, { status: s }) : undefined);
const harmonieStatus = (s: number): Override => (url) =>
  url.startsWith(`${HARMONIE_API}?`) ? new Response(`bad ${KEY}`, { status: s }) : undefined;
// The geocoder answers with a place on the HARMONIE fixture's crop.
const harmoniePlace = (name = "Utrecht, Utrecht"): Override => (url) =>
  url.startsWith(`${PDOK}/free?`) ? pdok([{ weergavenaam: name, centroide_ll: `POINT(${HARMONIE_INSIDE.lon} ${HARMONIE_INSIDE.lat})` }]) : undefined;
const HOURLY_FIELDS = ["dryUntil", "firstRainAt", "hours", "intensity", "issuedAt", "location", "maxMmPerHour", "source", "summary", "willRain"];
const harmonieCalls = () => state.fetch.calls.filter((u) => u.startsWith(HARMONIE_API));
const noHits: Override = (url) => (url.startsWith(`${PDOK}/free?`) ? pdok([]) : undefined);
const htmlTile: Override = (url) => (url.startsWith(TILES) ? png("<html></html>", "text/html") : undefined);
const tileCalls = () => state.fetch.calls.filter((u) => u.startsWith(TILES));

describe("GET /api/forecast", () => {
  it("lat/lon: 200 with every US-005 field and 25 points", async () => {
    const { res, body } = await get(`/api/forecast?${coords(EDGE)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(body).sort()).toEqual(FIELDS);
    expect(body.points).toHaveLength(25);
    expect(body.source).toBe(SOURCE);
    expect(body.location).toEqual({ name: "55, 5.33", lat: 55, lon: 5.33 });
  });

  it("q: 200 with the geocoded location", async () => {
    const { res, body } = await get("/api/forecast?q=Testdorp");
    expect(res.status).toBe(200);
    expect(body.location).toEqual({ name: "Testdorp, Testgemeente", lat: INSIDE.lat, lon: INSIDE.lon });
  });

  it.each([
    ["lat 56", "lat=56&lon=5"],
    ["lon -1", "lat=52&lon=-1"],
    ["q of 101 characters", `q=${"a".repeat(101)}`],
    ["q together with lat", "q=Utrecht&lat=52"],
    ["no parameters", ""],
  ])("400 BAD_ARGS for %s without calling fetch", async (_label, query) => {
    const { res, body } = await get(`/api/forecast?${query}`);
    expect(res.status).toBe(400);
    expect(body).toEqual(errorBody("BAD_ARGS"));
    expect(state.fetch.calls).toEqual([]);
  });

  it("unknown place: 404 without echoing the query", async () => {
    state.fetch = fakeFetch(noHits);
    const { res, body, text } = await get("/api/forecast?q=Nergenshuizen");
    expect(res.status).toBe(404);
    expect(body).toEqual(errorBody("UNKNOWN_PLACE"));
    expect(text).not.toContain("Nergenshuizen");
  });

  it("valid coordinate outside the grid: 400 OUTSIDE_GRID", async () => {
    const { res, body } = await get(`/api/forecast?${coords(OUTSIDE)}`);
    expect(res.status).toBe(400);
    expect(body).toEqual(errorBody("OUTSIDE_GRID"));
  });

  it("missing key: 500 MISSING_KEY with the Dutch message", async () => {
    state.env = {};
    const { res, body } = await get(`/api/forecast?${coords(EDGE)}`);
    expect(res.status).toBe(500);
    expect(body.error.code).toBe("MISSING_KEY");
    expect(body.error.message).toContain("Geen KNMI-API-sleutel gevonden");
  });

  it.each([
    ["KNMI 401", fakeFetch(knmiStatus(401)), 500, "INVALID_KEY"],
    ["KNMI 429", fakeFetch(knmiStatus(429)), 503, "RATE_LIMITED"],
    ["KNMI 500", fakeFetch(knmiStatus(500)), 502, "SOURCE_HTTP"],
    ["a thrown network error", fakeFetch(() => new TypeError("fetch failed")), 502, "NETWORK"],
  ])("%s", async (_label, f, status, code) => {
    state.fetch = f;
    const { res, body } = await get(`/api/forecast?${coords(EDGE)}`);
    expect(res.status).toBe(status);
    expect(body).toEqual(errorBody(code));
  });

  it("an unexpected error gives 502 SOURCE_HTTP without paths or stack", async () => {
    // A file where the cache directory should be: mkdir fails with ENOTDIR, a non-WordiknatError.
    await writeFile(join(root, "file"), "x");
    cacheDir = join(root, "file", "sub");
    const { res, body, text } = await get(`/api/forecast?${coords(EDGE)}`);
    expect(res.status).toBe(502);
    expect(body).toEqual(errorBody("SOURCE_HTTP"));
    expect(text).not.toContain(root);
    expect(text).not.toMatch(/ENOTDIR|EEXIST/);
    expect(text).not.toMatch(/\n\s+at /);
  });

  it("two requests within five minutes download the KNMI file once (NFR-002)", async () => {
    await get(`/api/forecast?${coords(EDGE)}`);
    state.now = new Date(NOW.getTime() + 4 * 60_000);
    const { res } = await get(`/api/forecast?${coords(EDGE)}`);
    expect(res.status).toBe(200);
    expect(state.fetch.calls.filter((u) => u === DOWNLOAD)).toHaveLength(1);
  });

  it("makes no HARMONIE request", async () => {
    const { res } = await get(`/api/forecast?${coords(EDGE)}`);
    expect(res.status).toBe(200);
    expect(state.fetch.calls.some((u) => u.startsWith(API))).toBe(true);
    expect(harmonieCalls()).toEqual([]);
  });
});

describe("GET /api/hourly (US-020, FR-018)", () => {
  beforeEach(() => {
    state.now = HARMONIE_NOW;
  });

  it("lat/lon: 200 with the hourly report keys and 24 hours, CSP and no-store", async () => {
    const { res, body } = await get(`/api/hourly?${coords(HARMONIE_INSIDE)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toBe(CSP);
    expect(Object.keys(body).sort()).toEqual(HOURLY_FIELDS);
    expect(body.hours).toHaveLength(24);
    expect(body.location).toEqual({ name: `${HARMONIE_INSIDE.lat}, ${HARMONIE_INSIDE.lon}`, lat: HARMONIE_INSIDE.lat, lon: HARMONIE_INSIDE.lon });
    // No radar request: the hourly route only talks to HARMONIE.
    expect(state.fetch.calls.some((u) => u.startsWith(API))).toBe(false);
  });

  it("q: 200 with the geocoded location", async () => {
    state.fetch = fakeFetch(harmoniePlace());
    const { res, body } = await get("/api/hourly?q=Utrecht");
    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(HOURLY_FIELDS);
    expect(body.hours).toHaveLength(24);
    expect(body.location).toEqual({ name: "Utrecht, Utrecht", lat: HARMONIE_INSIDE.lat, lon: HARMONIE_INSIDE.lon });
  });

  it.each([
    ["no parameters", ""],
    ["lat only", "lat=52"],
    ["lat 56", "lat=56&lon=5"],
    ["lon -1", "lat=52&lon=-1"],
    ["non-numeric lat", "lat=abc&lon=5"],
    ["non-numeric lon", "lat=52&lon=5e0"],
    ["q of 101 characters", `q=${"a".repeat(101)}`],
    ["q together with lat", "q=Utrecht&lat=52"],
  ])("400 BAD_ARGS for %s without calling fetch", async (_label, query) => {
    const { res, body, text } = await get(`/api/hourly?${query}`);
    expect(res.status).toBe(400);
    expect(res.headers.get("content-security-policy")).toBe(CSP);
    expect(body).toEqual(errorBody("BAD_ARGS"));
    expect(text).not.toContain("aaaa");
    expect(state.fetch.calls).toEqual([]);
  });

  it("a listing 404 gives 502 HOURLY_UNAVAILABLE", async () => {
    state.fetch = fakeFetch(harmonieStatus(404));
    const { res, body } = await get(`/api/hourly?${coords(HARMONIE_INSIDE)}`);
    expect(res.status).toBe(502);
    expect(res.headers.get("content-security-policy")).toBe(CSP);
    expect(body).toEqual(errorBody("HOURLY_UNAVAILABLE"));
    expect(body.error.message).toContain("24-uursverwachting");
  });

  it("an unreadable model file gives 502 HOURLY_BAD_FILE", async () => {
    state.fetch = fakeFetch((url) => (url.startsWith("https://download.example/HARMONIE") ? new Response("not netcdf") : undefined));
    const { res, body } = await get(`/api/hourly?${coords(HARMONIE_INSIDE)}`);
    expect(res.status).toBe(502);
    expect(body).toEqual(errorBody("HOURLY_BAD_FILE"));
  });

  it.each([
    ["KNMI 401", 401, 500, "INVALID_KEY"],
    ["KNMI 429", 429, 503, "RATE_LIMITED"],
  ])("%s", async (_label, s, status, code) => {
    state.fetch = fakeFetch(harmonieStatus(s));
    const { res, body } = await get(`/api/hourly?${coords(HARMONIE_INSIDE)}`);
    expect(res.status).toBe(status);
    expect(body).toEqual(errorBody(code));
  });

  it("missing key: 500 MISSING_KEY without any request", async () => {
    state.env = {};
    const { res, body } = await get(`/api/hourly?${coords(HARMONIE_INSIDE)}`);
    expect(res.status).toBe(500);
    expect(body).toEqual(errorBody("MISSING_KEY"));
    expect(state.fetch.calls).toEqual([]);
  });

  it("unknown place: 404 without echoing the query", async () => {
    state.fetch = fakeFetch(noHits);
    const { res, body, text } = await get("/api/hourly?q=Nergenshuizen");
    expect(res.status).toBe(404);
    expect(body).toEqual(errorBody("UNKNOWN_PLACE"));
    expect(text).not.toContain("Nergenshuizen");
  });
});

describe("GET /api/geocode", () => {
  it("returns the results", async () => {
    const { res, body } = await get("/api/geocode?q=Utr");
    expect(res.status).toBe(200);
    expect(body).toEqual({ results: [{ name: "Testdorp, Testgemeente", lat: INSIDE.lat, lon: INSIDE.lon }] });
  });

  it("no hits gives an empty list", async () => {
    state.fetch = fakeFetch(noHits);
    const { res, body } = await get("/api/geocode?q=Nergenshuizen");
    expect(res.status).toBe(200);
    expect(body).toEqual({ results: [] });
  });

  it("missing q: 400", async () => {
    const { res, body } = await get("/api/geocode");
    expect(res.status).toBe(400);
    expect(body).toEqual(errorBody("BAD_ARGS"));
    expect(state.fetch.calls).toEqual([]);
  });
});

describe("headers and routing (SR-004)", () => {
  it.each([
    ["200", `/api/forecast?${coords(EDGE)}`, 200],
    ["400", "/api/forecast?lat=56&lon=5", 400],
    ["404 api", "/api/nope", 404],
    ["404 other", "/index.html", 404],
    ["200 tile", TILE_PATH, 200],
    ["400 tile", "/tiles/99/1/1.png", 400],
    ["200 radar", "/api/radar", 200],
    ["200 hourly", `/api/hourly?${coords(HARMONIE_INSIDE)}`, 200],
    ["400 hourly", "/api/hourly?lat=56&lon=5", 400],
  ])("CSP, nosniff and no-referrer on a %s", async (_label, path, status) => {
    const r = await send(path);
    expect(r.status).toBe(status);
    expect(r.headers["content-security-policy"]).toBe(CSP);
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["referrer-policy"]).toBe("no-referrer");
    if (status === 404) expect(JSON.parse(r.body.toString()).error.code).toBe("NOT_FOUND");
  });

  it.each(["/api/forecast", "/api/radar", "/api/hourly", TILE_PATH])("POST %s gets 405 with Allow: GET, HEAD", async (path) => {
    const { res } = await get(path, { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
    expect(res.headers.get("content-security-policy")).toBe(CSP);
    expect(state.fetch.calls).toEqual([]);
  });

  it("HEAD is accepted without a body", async () => {
    const { res, text } = await get("/api/nope", { method: "HEAD" });
    expect(res.status).toBe(404);
    expect(text).toBe("");
  });

  it("rejects a foreign Host header with 403 and accepts localhost", async () => {
    const port = (server.address() as AddressInfo).port;
    const evil = await raw("/api/geocode?q=Utr", "evil.example");
    expect(evil.status).toBe(403);
    expect(JSON.parse(evil.body).error.message).toMatch(/alleen bereikbaar/);
    expect(state.fetch.calls).toEqual([]);
    expect((await raw("/api/geocode?q=Utr", `localhost:${port}`)).status).toBe(200);
    expect((await raw("/api/geocode?q=Utr", `[::1]:${port}`)).status).toBe(200);
    expect((await raw("/api/geocode?q=Utr", "localhost.evil.example")).status).toBe(403);
  });
});

describe("startServer (SR-002)", () => {
  it("binds to 127.0.0.1 when no host is given", async () => {
    const s = await startServer({ port: 0, fetch: fakeFetch().fetch, env: {}, now: () => NOW, cacheDir });
    try {
      expect(s.address()).toMatchObject({ address: "127.0.0.1" });
    } finally {
      await new Promise((r) => s.close(r));
    }
  });
});

describe("configured host", () => {
  it("accepts the configured non-default host and still rejects others", async () => {
    const s = createServer({ fetch: fakeFetch().fetch, env: {}, now: () => NOW, cacheDir, host: "Wordiknat.Local" });
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const port = (s.address() as AddressInfo).port;
    const ask = (host: string) =>
      new Promise<number>((resolve, reject) => {
        const req = http.request(`http://127.0.0.1:${port}/api/nope`, { headers: { host } }, (res) => (res.resume(), resolve(res.statusCode ?? 0)));
        req.on("error", reject);
        req.end();
      });
    try {
      expect(await ask(`wordiknat.local:${port}`)).toBe(404);
      expect(await ask("evil.example")).toBe(403);
    } finally {
      await new Promise((r) => s.close(r));
    }
  });
});

describe("the key never reaches a response or stderr (SR-001, DOD-1.8)", () => {
  const paths: Array<[string, ReturnType<typeof fakeFetch>, string]> = [
    // The place name carries the key, so the success path proves redaction itself works.
    ["success", fakeFetch(undefined, `Dorp ${KEY}`), "/api/forecast?q=Dorp"],
    ["geocode", fakeFetch(undefined, `Dorp ${KEY}`), "/api/geocode?q=Dorp"],
    ["bad args", fakeFetch(), "/api/forecast?lat=56&lon=5"],
    ["unknown place", fakeFetch(noHits), "/api/forecast?q=Nergens"],
    ["outside grid", fakeFetch(), `/api/forecast?${coords(OUTSIDE)}`],
    ["401", fakeFetch(knmiStatus(401)), `/api/forecast?${coords(EDGE)}`],
    ["429", fakeFetch(knmiStatus(429)), `/api/forecast?${coords(EDGE)}`],
    ["500", fakeFetch(knmiStatus(500)), `/api/forecast?${coords(EDGE)}`],
    ["network", fakeFetch(() => new TypeError(`fetch failed ${KEY}`)), `/api/forecast?${coords(EDGE)}`],
    ["not found", fakeFetch(), "/nope"],
    ["radar", fakeFetch(), "/api/radar"],
    ["radar 401", fakeFetch(knmiStatus(401)), "/api/radar"],
    ["radar network", fakeFetch(() => new TypeError(`fetch failed ${KEY}`)), "/api/radar"],
    ["radar query", fakeFetch(), "/api/radar?x=1"],
    ["tile", fakeFetch(), TILE_PATH],
    ["bad tile", fakeFetch(), "/tiles/99/1/1.png"],
    ["tile upstream html", fakeFetch(htmlTile), TILE_PATH],
    ["hourly success", fakeFetch(harmoniePlace(`Utrecht ${KEY}`)), "/api/hourly?q=Utrecht"],
    ["hourly bad args", fakeFetch(), "/api/hourly?lat=56&lon=5"],
    ["hourly 401", fakeFetch(harmonieStatus(401)), `/api/hourly?${coords(HARMONIE_INSIDE)}`],
    ["hourly 404", fakeFetch(harmonieStatus(404)), `/api/hourly?${coords(HARMONIE_INSIDE)}`],
    ["hourly 429", fakeFetch(harmonieStatus(429)), `/api/hourly?${coords(HARMONIE_INSIDE)}`],
    ["hourly network", fakeFetch(() => new TypeError(`fetch failed ${KEY}`)), `/api/hourly?${coords(HARMONIE_INSIDE)}`],
  ];

  it.each(paths)("%s", async (_label, f, path) => {
    state.fetch = f;
    state.env = { KNMI_API_KEY: KEY, WORDIKNAT_DEBUG: "1" };
    const r = await send(path);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body.toString("latin1")).not.toContain(KEY);
    expect(JSON.stringify(r.headers)).not.toContain(KEY);
    expect(state.stderr.join("")).not.toContain(KEY);
  });

  it("redacts the key in the body and logs host and status only", async () => {
    state.fetch = fakeFetch(undefined, `Dorp ${KEY}`);
    state.env = { KNMI_API_KEY: KEY, WORDIKNAT_DEBUG: "1" };
    const { body } = await get("/api/forecast?q=Dorp");
    expect(body.location.name).toBe("Dorp ***");
    const log = state.stderr.join("");
    expect(log).toContain("debug: api.pdok.nl 200");
    expect(log).toContain("debug: api.dataplatform.knmi.nl 200");
    expect(log).toContain("debug: download.example 200");
    expect(log).not.toContain("X-Amz-Signature");
  });

  it("the tile debug line names the host and status only", async () => {
    state.env = { KNMI_API_KEY: KEY, WORDIKNAT_DEBUG: "1" };
    expect((await send(TILE_PATH)).status).toBe(200);
    const log = state.stderr.join("");
    expect(log).toBe("debug: service.pdok.nl 200\n");
  });

  it("logs nothing without WORDIKNAT_DEBUG=1", async () => {
    await get(`/api/forecast?${coords(EDGE)}`);
    expect(state.stderr).toEqual([]);
  });
});

describe("static files from staticDir (US-008, DOD-1.4.1)", () => {
  const HTML = "<!doctype html><title>Wordiknat</title>";
  let outer: string;
  let web: string;
  let s: http.Server;
  let port: number;

  /** Sends `path` byte for byte: fetch and URL would normalise the dot segments away. */
  const send = (path: string, method = "GET") =>
    new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path, method }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      });
      req.on("error", reject);
      req.end();
    });

  beforeAll(async () => {
    // A file right next to staticDir: what a traversal would reach first.
    outer = await mkdtemp(join(tmpdir(), "wordiknat-web-"));
    web = join(outer, "web");
    await mkdir(join(web, "assets"), { recursive: true });
    await writeFile(join(outer, "package.json"), "SECRET-OUTSIDE");
    await writeFile(join(web, "index.html"), HTML);
    await writeFile(join(web, "assets", "app-abc123.js"), "console.log(1)");
    await writeFile(join(web, "favicon.svg"), "<svg/>");
    s = await startServer({ port: 0, fetch: fakeFetch().fetch, env: { KNMI_API_KEY: KEY }, now: () => NOW, cacheDir: web, staticDir: web });
    port = (s.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise((r) => s.close(r));
    await rm(outer, { recursive: true, force: true });
  });

  it("/ serves index.html as html with CSP, nosniff and no-cache", async () => {
    const r = await send("/");
    expect(r.status).toBe(200);
    expect(r.body).toBe(HTML);
    expect(r.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(r.headers["content-security-policy"]).toBe(CSP);
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["cache-control"]).toBe("no-cache");
  });

  it("/assets/ files are js and cached as immutable", async () => {
    const r = await send("/assets/app-abc123.js");
    expect(r.status).toBe(200);
    expect(r.body).toBe("console.log(1)");
    expect(r.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(r.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("other files get their type and no-cache", async () => {
    const r = await send("/favicon.svg");
    expect(r.headers["content-type"]).toBe("image/svg+xml");
    expect(r.headers["cache-control"]).toBe("no-cache");
  });

  it("HEAD returns the headers without a body", async () => {
    const r = await send("/", "HEAD");
    expect(r.status).toBe(200);
    expect(r.headers["content-length"]).toBe(String(HTML.length));
    expect(r.body).toBe("");
  });

  it.each(["/missing", "/assets/", "/assets", "/index.html/x"])("%s: 404 in Dutch with the CSP", async (path) => {
    const r = await send(path);
    expect(r.status).toBe(404);
    expect(JSON.parse(r.body).error.message).toBe("Deze pagina of API-route bestaat niet.");
    expect(r.headers["content-security-policy"]).toBe(CSP);
  });

  it.each([
    "/../package.json",
    "/%2e%2e/package.json",
    "/..%2fpackage.json",
    "/..%2F..%2F..%2Fetc%2Fpasswd",
    "/assets/..%2f..%2fpackage.json",
    "/..%5cpackage.json",
    "/%2e%2e%2f%2e%2e%2fetc/passwd",
    "/index.html%00.js",
    "/%00",
    "/%E0%A4%A",
  ])("never serves outside staticDir: %s", async (path) => {
    const r = await send(path);
    expect([400, 404]).toContain(r.status);
    expect(r.body).not.toContain("SECRET-OUTSIDE");
    expect(r.body).not.toContain("root:");
  });

  it("an API path that does not exist stays a JSON 404 and does not fall through to static files", async () => {
    const r = await send("/api/index.html");
    expect(r.status).toBe(404);
    expect(r.headers["content-type"]).toBe("application/json; charset=utf-8");
  });
});

describe("missing staticDir (no build yet)", () => {
  it("starts anyway: 503 with a build hint for /, the API still works", async () => {
    const s = await startServer({
      port: 0,
      fetch: fakeFetch().fetch,
      env: { KNMI_API_KEY: KEY },
      now: () => NOW,
      cacheDir,
      staticDir: join(root, "does-not-exist"),
    });
    const at = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
    try {
      const page = await fetch(`${at}/`);
      expect(page.status).toBe(503);
      expect(page.headers.get("content-security-policy")).toBe(CSP);
      expect((await page.json()).error.message).toContain("npm run build");
      const api = await fetch(`${at}/api/forecast?${coords(EDGE)}`);
      expect(api.status).toBe(200);
    } finally {
      await new Promise((r) => s.close(r));
    }
  });
});

describe("GET /tiles/{z}/{x}/{y}.png (US-015, SR-005)", () => {
  it("serves an allowed tile as png with the security headers, then from the disk cache", async () => {
    const r = await send(TILE_PATH);
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toBe("image/png");
    expect(r.headers["cache-control"]).toBe("public, max-age=86400");
    expect(r.headers["content-security-policy"]).toBe(CSP);
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["content-length"]).toBe(String(PNG.length));
    expect(r.headers.vary).toBeUndefined();
    expect([...r.body]).toEqual([...PNG]);
    expect(state.fetch.calls).toEqual([tileUrl(TILE)]);
    // No headers at all, so no Authorization: the KNMI key never goes to PDOK.
    expect(state.fetch.inits).toEqual([{ redirect: "error" }]);

    const again = await send(TILE_PATH);
    expect(again.status).toBe(200);
    expect([...again.body]).toEqual([...PNG]);
    expect(state.fetch.calls).toHaveLength(1);
  });

  it("ignores the query string", async () => {
    const r = await send(`${TILE_PATH}?x=1`);
    expect(r.status).toBe(200);
    expect(state.fetch.calls).toEqual([tileUrl(TILE)]);
  });

  it("is not gzipped even when the client accepts it", async () => {
    const r = await send(TILE_PATH, { "accept-encoding": "gzip" });
    expect(r.headers["content-encoding"]).toBeUndefined();
    expect([...r.body]).toEqual([...PNG]);
  });

  it.each([
    "/tiles/99/1/1.png",
    `/tiles/8/${R8.x1 + 1}/${R8.y0}.png`,
    "/tiles/8/a/1.png",
    "/tiles/8/1.5/1.png",
    `/tiles/8/${TILE.x}/${TILE.y}.jpg`,
    "/tiles/8/1",
    `/tiles/8/${TILE.x}/${TILE.y}/1.png`,
    `/tiles/8/%2e%2e/${TILE.y}.png`,
    `/tiles/8/${TILE.x}/..%2f${TILE.y}.png`,
    `/tiles/08/${TILE.x}/${TILE.y}.png`,
    "/tiles/",
  ])("400 BAD_ARGS without fetch or echo for %s", async (path) => {
    const r = await send(path);
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body.toString())).toEqual(errorBody("BAD_ARGS"));
    expect(r.body.toString()).not.toContain("tiles/");
    expect(r.headers["content-security-policy"]).toBe(CSP);
    expect(state.fetch.calls).toEqual([]);
  });

  it("an upstream html answer gives 502 TILE_UNAVAILABLE and is not cached", async () => {
    state.fetch = fakeFetch(htmlTile);
    const bad = await send(TILE_PATH);
    expect(bad.status).toBe(502);
    expect(JSON.parse(bad.body.toString())).toEqual({
      error: { code: "TILE_UNAVAILABLE", message: expect.stringContaining("kaartondergrond") },
    });
    state.fetch = fakeFetch();
    const good = await send(TILE_PATH);
    expect(good.status).toBe(200);
    expect(tileCalls()).toEqual([tileUrl(TILE)]);
  });
});

describe("GET /api/radar (US-015, FR-011)", () => {
  it("25 frames of the right size, times and issuedAt equal the forecast's, one KNMI download", async () => {
    const f = await get(`/api/forecast?${coords(EDGE)}`);
    const { res, body } = await get("/api/radar");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(body.frames).toHaveLength(25);
    expect(body.times).toHaveLength(25);
    const bytes = Math.ceil((body.width * body.height) / 4);
    for (const frame of body.frames) expect(Buffer.from(frame, "base64").length).toBe(bytes);
    expect(body.times).toEqual(f.body.points.map((p: { time: string }) => p.time));
    expect(body.issuedAt).toBe(f.body.issuedAt);
    expect(state.fetch.calls.filter((u) => u === DOWNLOAD)).toHaveLength(1);
  });

  it("400 BAD_ARGS for a query string without fetch", async () => {
    const r = await send("/api/radar?x=1");
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body.toString())).toEqual(errorBody("BAD_ARGS"));
    expect(state.fetch.calls).toEqual([]);
  });

  it("missing key: 500 MISSING_KEY with the forecast's Dutch message", async () => {
    state.env = {};
    const radar = await get("/api/radar");
    const forecast = await get(`/api/forecast?${coords(EDGE)}`);
    expect(radar.res.status).toBe(500);
    expect(radar.body).toEqual(forecast.body);
    expect(radar.body.error.code).toBe("MISSING_KEY");
    expect(state.fetch.calls).toEqual([]);
  });

  it.each([
    ["KNMI 401", fakeFetch(knmiStatus(401)), 500, "INVALID_KEY"],
    ["KNMI 429", fakeFetch(knmiStatus(429)), 503, "RATE_LIMITED"],
    ["a thrown network error", fakeFetch(() => new TypeError("fetch failed")), 502, "NETWORK"],
  ])("%s", async (_label, f, status, code) => {
    state.fetch = f;
    const { res, body } = await get("/api/radar");
    expect(res.status).toBe(status);
    expect(body).toEqual(errorBody(code));
  });
});

describe("gzip for large JSON (NFR-002)", () => {
  it("gzips the radar payload when asked; the gunzipped body equals the plain one", async () => {
    const plain = await send("/api/radar");
    const gz = await send("/api/radar", { "accept-encoding": "gzip, deflate" });
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(plain.headers.vary).toBe("Accept-Encoding");
    expect(gz.status).toBe(200);
    expect(gz.headers["content-encoding"]).toBe("gzip");
    expect(gz.headers.vary).toBe("Accept-Encoding");
    expect(gz.headers["content-length"]).toBe(String(gz.body.length));
    expect(plain.headers["content-length"]).toBe(String(plain.body.length));
    expect(JSON.parse(gunzipSync(gz.body).toString())).toEqual(JSON.parse(plain.body.toString()));
    expect(gz.body.length).toBeLessThan(plain.body.length);
  });

  it.each(["identity", "gzip;q=0", "br"])("no gzip for Accept-Encoding: %s", async (enc) => {
    const r = await send("/api/radar", { "accept-encoding": enc });
    expect(r.headers["content-encoding"]).toBeUndefined();
    expect(JSON.parse(r.body.toString()).frames).toHaveLength(25);
  });

  it("small JSON stays plain but still varies on Accept-Encoding", async () => {
    const r = await send("/api/nope", { "accept-encoding": "gzip" });
    expect(r.status).toBe(404);
    expect(r.headers["content-encoding"]).toBeUndefined();
    expect(r.headers.vary).toBe("Accept-Encoding");
  });

  it("the key is redacted before compression", async () => {
    // A long place name pushes the forecast body over the gzip threshold and carries the key.
    state.fetch = fakeFetch(undefined, `Dorp ${KEY} ${"x".repeat(1100)}`);
    const r = await send("/api/forecast?q=Dorp", { "accept-encoding": "gzip" });
    expect(r.headers["content-encoding"]).toBe("gzip");
    const text = gunzipSync(r.body).toString();
    expect(text).toContain("Dorp ***");
    expect(text).not.toContain(KEY);
  });
});
