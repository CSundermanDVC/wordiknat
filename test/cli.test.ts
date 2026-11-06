import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type http from "node:http";
import { createServer as netServer, type AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main, runServe, type CliDeps } from "../src/cli.ts";
import { startServer } from "../src/server.ts";
import { cellToLatLon, KNMI_RADAR_GEOMETRY } from "../src/core/projection.ts";
import { SOURCE, SOURCE_HOURLY } from "../src/core/types.ts";
import {
  fakeFetch as fullFetch,
  HARMONIE_API,
  HARMONIE_INSIDE,
  HARMONIE_NOW,
} from "./helpers/fake-fetch.ts";

const KEY = "SENTINEL-KEY-123";
const API = "https://api.dataplatform.knmi.nl/open-data/v1/datasets/radar_forecast/versions/2.0/files";
const NAME = "RAD_NL25_RAC_FM_202611041100.h5";
const DOWNLOAD = "https://download.example/RAD.h5?X-Amz-Signature=abc";
const PDOK = "https://api.pdok.nl/bzk/locatieserver/search/v3_1";
const FIXTURE = new Uint8Array(readFileSync(fileURLToPath(new URL("./fixtures/radar-sample.h5", import.meta.url))));
const NOW = new Date("2026-11-04T11:01:00Z");
// Fixture crop cell (19,0) is source cell (349,55) of the full grid; it has rain (0.12 mm/u).
const INSIDE = cellToLatLon(349, 55, KNMI_RADAR_GEOMETRY);
// Utrecht is on the full radar grid but outside the fixture's 40 x 40 crop.
const OUTSIDE = { lat: 52.09126, lon: 5.10448 };
const FIELDS = ["dryUntil", "firstRainAt", "issuedAt", "location", "maxMmPerHour", "points", "source", "summary", "willRain"];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const pdok = (docs: unknown[]) => json({ response: { numFound: docs.length, docs } });

type Override = (url: string) => Response | Error | undefined;

/** Fake fetch for KNMI (listing, download URL, fixture bytes) and PDOK; `override` wins per URL. */
function fakeFetch(override?: Override, placeName = "Testdorp, Testgemeente") {
  const calls: string[] = [];
  const fetch = async (url: string, _init?: { headers?: Record<string, string> }) => {
    calls.push(url);
    const o = override?.(url);
    if (o instanceof Error) throw o;
    if (o) return o;
    if (url.startsWith(`${API}?`)) return json({ files: [{ filename: NAME }] });
    if (url === `${API}/${NAME}/url`) return json({ temporaryDownloadUrl: DOWNLOAD });
    if (url === DOWNLOAD) return new Response(FIXTURE);
    if (url.startsWith(`${PDOK}/free?`)) {
      return pdok([{ weergavenaam: placeName, centroide_ll: `POINT(${INSIDE.lon} ${INSIDE.lat})` }]);
    }
    if (url.startsWith(`${PDOK}/suggest?`)) return pdok([]);
    return new Response("nope", { status: 404 });
  };
  return { fetch, calls };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "wordiknat-cli-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function run(
  argv: string[],
  {
    fetch = fakeFetch().fetch,
    env = { KNMI_API_KEY: KEY } as Record<string, string | undefined>,
    cacheDir = dir,
    now = NOW,
  }: { fetch?: CliDeps["fetch"]; env?: Record<string, string | undefined>; cacheDir?: string; now?: Date } = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, {
    fetch,
    env,
    cwd: dir,
    now,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    cacheDir,
  });
  return { code, out, err, stdout: out.join(""), stderr: err.join("") };
}

const coords = (p: { lat: number; lon: number }) => ["--lat", String(p.lat), "--lon", String(p.lon)];

describe("main --json success (US-005, DOD-0.4)", () => {
  it("prints exactly one JSON object with every field and exits 0", async () => {
    const r = await run([...coords(INSIDE), "--json"]);
    expect(r.code).toBe(0);
    expect(r.out).toHaveLength(1);
    expect(r.stdout.endsWith("\n")).toBe(true);
    expect(r.stderr).toBe("");

    const body = JSON.parse(r.stdout);
    expect(Object.keys(body).sort()).toEqual(FIELDS);
    expect(body.source).toBe(SOURCE);
    expect(body.issuedAt).toBe("2026-11-04T11:00:00.000Z");
    expect(body.location).toEqual({ name: expect.any(String), lat: INSIDE.lat, lon: INSIDE.lon });
    expect(body.points).toHaveLength(25);
    body.points.forEach((p: { time: string; mmPerHour: number }, i: number) => {
      expect(Object.keys(p).sort()).toEqual(["mmPerHour", "time"]);
      expect(p.time).toBe(new Date(Date.UTC(2026, 10, 4, 11, 5 * i)).toISOString());
      expect(typeof p.mmPerHour).toBe("number");
    });
    expect(body.points[0].mmPerHour).toBeCloseTo(0.12, 10);
    expect(body.willRain).toBe(true);
    expect(body.firstRainAt).toBe("2026-11-04T11:00:00.000Z");
    expect(typeof body.summary).toBe("string");
    expect(typeof body.maxMmPerHour).toBe("number");
  });

  it("geocodes a place name (multiple words joined) through PDOK", async () => {
    const { fetch, calls } = fakeFetch();
    const r = await run(["Test", "dorp", "--json"], { fetch });
    expect(r.code).toBe(0);
    const body = JSON.parse(r.stdout);
    expect(body.location).toEqual({ name: "Testdorp, Testgemeente", lat: INSIDE.lat, lon: INSIDE.lon });
    expect(new URL(calls[0]).searchParams.get("q")).toBe("Test dorp");
  });
});

describe("main --json errors", () => {
  const unknownPlace: Override = (url) => (url.startsWith(`${PDOK}/free?`) ? pdok([]) : undefined);

  it.each([
    ["unknown place", ["Nergenshuizen", "--json"], { fetch: fakeFetch(unknownPlace).fetch }, "UNKNOWN_PLACE"],
    ["missing key", [...coords(INSIDE), "--json"], { env: {} }, "MISSING_KEY"],
    ["blank key", [...coords(INSIDE), "--json"], { env: { KNMI_API_KEY: "  " } }, "MISSING_KEY"],
    ["--lat without --lon", ["--lat", "52", "--json"], {}, "BAD_ARGS"],
    ["--lon without --lat", ["--lon", "5", "--json"], {}, "BAD_ARGS"],
    ["non-numeric --lat", ["--lat", "abc", "--lon", "5", "--json"], {}, "BAD_ARGS"],
    ["empty --lat", ["--lat", "", "--lon", "5", "--json"], {}, "BAD_ARGS"],
    ["lat out of range", ["--lat", "91", "--lon", "5", "--json"], {}, "BAD_ARGS"],
    ["place and coordinates", ["Utrecht", ...coords(INSIDE), "--json"], {}, "BAD_ARGS"],
    ["unknown option", ["--foo", "--json"], {}, "BAD_ARGS"],
    ["no location", ["--json"], {}, "NO_LOCATION"],
    ["coordinate outside the grid", [...coords(OUTSIDE), "--json"], {}, "OUTSIDE_GRID"],
  ])("exit 2 for %s", async (_label, argv, opts, code) => {
    const r = await run(argv, opts);
    expect(r.code).toBe(2);
    expect(r.out).toHaveLength(1);
    expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout)).toEqual({ error: { code, message: expect.any(String) } });
  });

  it.each([
    ["KNMI 500", fakeFetch((url) => (url.startsWith(`${API}?`) ? new Response("", { status: 500 }) : undefined)), "SOURCE_HTTP"],
    ["a thrown network error", fakeFetch(() => new TypeError("fetch failed")), "NETWORK"],
  ])("exit 1 for %s", async (_label, { fetch }, code) => {
    const r = await run([...coords(INSIDE), "--json"], { fetch });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toEqual({ error: { code, message: expect.any(String) } });
  });

  it("reports a non-WordiknatError as SOURCE_HTTP with a generic message and no stack", async () => {
    const file = join(dir, "not-a-dir");
    await writeFile(file, "x");
    const r = await run([...coords(INSIDE), "--json"], { cacheDir: join(file, "sub") });
    expect(r.code).toBe(1);
    const body = JSON.parse(r.stdout);
    expect(body.error.code).toBe("SOURCE_HTTP");
    expect(r.stdout).not.toContain(dir);
    expect(r.stdout).not.toMatch(/ENOTDIR|EEXIST|\n\s+at /);
  });
});

describe("main without --json", () => {
  it("prints the summary, a 13-row timeline and the source line (US-004, NFR-005)", async () => {
    const r = await run(coords(INSIDE));
    expect(r.code).toBe(0);
    expect(r.out).toHaveLength(1);
    expect(r.stderr).toBe("");
    const lines = r.stdout.split("\n");
    expect(lines.pop()).toBe("");
    expect(lines).toHaveLength(15);
    expect(lines[0]).toMatch(/^Regen /);
    expect(lines.at(-1)).toBe("Bron: KNMI (CC BY 4.0)");
    const rows = lines.slice(1, -1);
    rows.forEach((row, i) => {
      // 11:00 UTC is 12:00 in Amsterdam; rows step 10 minutes.
      const t = new Date(Date.UTC(2026, 10, 4, 11, 10 * i));
      const hhmm = `${String(t.getUTCHours() + 1).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`;
      expect(row).toMatch(new RegExp(`^${hhmm}  [█ ]{20}  \\d+,\\d\\d mm/u$`));
    });
    // 0.12 mm/u is rain: one block, Dutch decimal comma.
    expect(rows[0]).toBe(`12:00  █${" ".repeat(19)}  0,12 mm/u`);
  });

  it("draws an empty bar for 0 mm/u", async () => {
    const r = await run(coords(INSIDE));
    const zero = r.stdout.split("\n").find((l) => l.endsWith(" 0,00 mm/u"));
    // Two-space gaps around a 20-wide bar of spaces.
    expect(zero).toMatch(/^\d\d:\d\d {24}0,00 mm\/u$/);
  });

  it("writes the Dutch error message to stderr and returns the exit code", async () => {
    const r = await run(coords(INSIDE), { env: {} });
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("Geen KNMI-API-sleutel gevonden");
  });

  it("no location and no WORDIKNAT_LOCATION: NO_LOCATION message plus usage on stderr, exit 2 (US-007)", async () => {
    const r = await run([], { env: { KNMI_API_KEY: KEY } });
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("Geen locatie opgegeven");
    expect(r.stderr).toContain("Gebruik: wordiknat");
  });

  it("--help prints usage and exits 0 without a key or network", async () => {
    const { fetch, calls } = fakeFetch();
    const r = await run(["--help"], { fetch, env: {} });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Gebruik");
    expect(calls).toEqual([]);
  });
});

describe("the key never reaches stdout or stderr (SR-001, DOD-0.5)", () => {
  const status = (s: number): Override => (url) => (url.startsWith(`${API}?`) ? new Response(`bad ${KEY}`, { status: s }) : undefined);
  const paths: Array<[string, ReturnType<typeof fakeFetch>, string[]]> = [
    // The place name carries the key, so the success path proves redaction itself works.
    ["success", fakeFetch(undefined, `Dorp ${KEY}`), ["Dorp"]],
    ["401", fakeFetch(status(401)), coords(INSIDE)],
    ["429", fakeFetch(status(429)), coords(INSIDE)],
    ["500", fakeFetch(status(500)), coords(INSIDE)],
    ["network", fakeFetch(() => new TypeError(`fetch failed ${KEY}`)), coords(INSIDE)],
  ];

  it.each(paths.flatMap(([label, f, argv]) => [[`${label} --json`, f, [...argv, "--json"]], [label, f, argv]] as const))(
    "%s",
    async (_label, { fetch }, argv) => {
      const r = await run([...argv], { fetch });
      expect(r.stdout + r.stderr).not.toBe("");
      expect(r.stdout).not.toContain(KEY);
      expect(r.stderr).not.toContain(KEY);
    },
  );

  it("redacts the key in the JSON output", async () => {
    const r = await run(["Dorp", "--json"], { fetch: fakeFetch(undefined, `Dorp ${KEY}`).fetch });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).location.name).toBe("Dorp ***");
  });
});

describe("WORDIKNAT_LOCATION default (US-007)", () => {
  it("geocodes a place name when no argument is given", async () => {
    const { fetch, calls } = fakeFetch();
    const r = await run(["--json"], { fetch, env: { KNMI_API_KEY: KEY, WORDIKNAT_LOCATION: "Utrecht" } });
    expect(r.code).toBe(0);
    expect(new URL(calls[0]).searchParams.get("q")).toBe("Utrecht");
    expect(JSON.parse(r.stdout).location.name).toBe("Testdorp, Testgemeente");
  });

  it("uses lat,lon directly without geocoding", async () => {
    const { fetch, calls } = fakeFetch();
    const env = { KNMI_API_KEY: KEY, WORDIKNAT_LOCATION: ` ${INSIDE.lat} , ${INSIDE.lon} ` };
    const r = await run(["--json"], { fetch, env });
    expect(r.code).toBe(0);
    expect(calls.some((u) => u.startsWith(PDOK))).toBe(false);
    expect(JSON.parse(r.stdout).location).toMatchObject({ lat: INSIDE.lat, lon: INSIDE.lon });
  });

  it("rejects out-of-range coordinates with BAD_ARGS", async () => {
    const r = await run(["--json"], { env: { KNMI_API_KEY: KEY, WORDIKNAT_LOCATION: "95,5" } });
    expect(r.code).toBe(2);
    expect(JSON.parse(r.stdout).error.code).toBe("BAD_ARGS");
  });

  it("an explicit argument wins over WORDIKNAT_LOCATION", async () => {
    const { fetch, calls } = fakeFetch();
    const r = await run(["Dorp", "--json"], { fetch, env: { KNMI_API_KEY: KEY, WORDIKNAT_LOCATION: "Utrecht" } });
    expect(r.code).toBe(0);
    expect(new URL(calls[0]).searchParams.get("q")).toBe("Dorp");
  });
});

describe("WORDIKNAT_DEBUG=1 (SR-001, DOD-0.5)", () => {
  it("writes host and status per request to stderr without the key or URL paths", async () => {
    const { fetch } = fakeFetch(undefined, `Dorp ${KEY}`);
    const r = await run(["Dorp"], { fetch, env: { KNMI_API_KEY: KEY, WORDIKNAT_DEBUG: "1" } });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("debug: api.pdok.nl 200");
    expect(r.stderr).toContain("debug: api.dataplatform.knmi.nl 200");
    expect(r.stderr).toContain("debug: download.example 200");
    expect(r.stderr).not.toContain("X-Amz-Signature");
    expect(r.stdout + r.stderr).not.toContain(KEY);
  });

  it("logs failed requests and keeps --json stdout clean", async () => {
    const { fetch } = fakeFetch(() => new TypeError(`fetch failed ${KEY}`));
    const r = await run([...coords(INSIDE), "--json"], { fetch, env: { KNMI_API_KEY: KEY, WORDIKNAT_DEBUG: "1" } });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("debug: api.dataplatform.knmi.nl netwerkfout");
    expect(JSON.parse(r.stdout).error.code).toBe("NETWORK");
    expect(r.stdout + r.stderr).not.toContain(KEY);
  });
});

describe("bin/wordiknat.js (TR-004, DOD-0.9.2)", () => {
  it("--help exits 0 with usage on stdout", () => {
    const bin = fileURLToPath(new URL("../bin/wordiknat.js", import.meta.url));
    const r = spawnSync(process.execPath, [bin, "--help"], { cwd: dir, encoding: "utf8", env: { PATH: process.env.PATH } });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Gebruik: wordiknat");
    expect(r.stdout).toContain("wordiknat serve");
    expect(r.stdout).toContain("--24u");
  });
});

describe("human-mode gaps (DOD-0.9)", () => {
  it("unknown place: Dutch message on stderr, empty stdout, exit 2", async () => {
    const { fetch } = fakeFetch((url) => (url.startsWith(`${PDOK}/free?`) ? pdok([]) : undefined));
    const r = await run(["Nergenshuizen"], { fetch });
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).not.toBe("");
  });

  it("WORDIKNAT_LOCATION as lat,lon gives the human timeline without geocoding", async () => {
    const { fetch, calls } = fakeFetch();
    const r = await run([], { fetch, env: { KNMI_API_KEY: KEY, WORDIKNAT_LOCATION: `${INSIDE.lat},${INSIDE.lon}` } });
    expect(r.code).toBe(0);
    expect(r.stdout.split("\n")).toHaveLength(16);
    expect(calls.some((u) => u.startsWith(PDOK))).toBe(false);
  });

  it("unreadable .env: generic error, no stack or path, exit 1", async () => {
    await mkdir(join(dir, ".env"));
    const human = await run(coords(INSIDE));
    expect(human.code).toBe(1);
    expect(human.stdout).toBe("");
    expect(human.stderr).not.toContain(dir);
    const r = await run([...coords(INSIDE), "--json"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).error.code).toBe("SOURCE_HTTP");
    expect(r.stdout + r.stderr).not.toContain(dir);
  });

  it("no debug lines without WORDIKNAT_DEBUG=1", async () => {
    const r = await run(coords(INSIDE), { env: { KNMI_API_KEY: KEY, WORDIKNAT_DEBUG: "0" } });
    expect(r.stderr).toBe("");
  });
});

describe("packaging (DOD-0.9.3, DOD-0.9.5)", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  it("declares bin.wordiknat and only h5wasm as runtime dependency", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.bin.wordiknat).toBe("bin/wordiknat.js");
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(["h5wasm"]);
  });

  it("src and bin do not reference workflow documents", () => {
    const r = spawnSync("grep", ["-rnE", "MISSION|PRD|ROADMAP|DESIGN\\.md|CLAUDE\\.md|\\.plans|\\.claude", "src", "bin"], { cwd: root, encoding: "utf8" });
    expect(r.stdout).toBe("");
  });
});

describe("wordiknat serve (US-008, SR-002, DOD-1.4.3)", () => {
  it.each([
    ["--port abc", ["serve", "--port", "abc"]],
    ["--port 0", ["serve", "--port", "0"]],
    ["--port 65536", ["serve", "--port", "65536"]],
    ["--port 1.5", ["serve", "--port", "1.5"]],
  ])("%s: exit 2 with the Dutch port message", async (_label, argv) => {
    const r = await run(argv);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Ongeldige poort");
    expect(r.stdout).toBe("");
  });

  it.each([
    ["serve with --lat/--lon", ["serve", "--lat", "52", "--lon", "5", "--json"]],
    ["--port without serve", ["Utrecht", "--port", "8080", "--json"]],
    ["--host without serve", ["--host", "0.0.0.0", "--json"]],
    ["an empty --host", ["serve", "--host", "", "--json"]],
    ["a --host with a space", ["serve", "--host", "a b", "--json"]],
  ])("%s is BAD_ARGS", async (_label, argv) => {
    const r = await run(argv);
    expect(r.code).toBe(2);
    expect(JSON.parse(r.stdout).error.code).toBe("BAD_ARGS");
  });

  const deps = (out: string[], err: string[], extra: Partial<CliDeps> = {}): CliDeps => ({
    fetch: fakeFetch().fetch,
    env: {},
    cwd: dir,
    now: NOW,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    cacheDir: dir,
    ...extra,
  });
  const close = (s: http.Server) => new Promise((r) => s.close(r));

  it("runServe binds 127.0.0.1, prints the URL and warns about nothing", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const s = await runServe({ port: 0, host: "127.0.0.1" }, deps(out, err));
    try {
      const { address, port } = s.address() as AddressInfo;
      expect(address).toBe("127.0.0.1");
      expect(out.join("")).toBe(`Wordiknat draait op http://127.0.0.1:${port} (Ctrl+C om te stoppen)\n`);
      expect(err).toEqual([]);
    } finally {
      await close(s);
    }
  });

  it("a non-loopback --host warns on stderr that the page is reachable without authentication", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const asked: string[] = [];
    // Bind loopback while the CLI believes it asked for 0.0.0.0, so the test never opens a public port.
    const fakeStart: typeof startServer = (o) => (asked.push(o.host ?? ""), startServer({ ...o, host: "127.0.0.1" }));
    const s = await runServe({ port: 0, host: "0.0.0.0" }, deps(out, err, { startServer: fakeStart }));
    try {
      expect(asked).toEqual(["0.0.0.0"]);
      expect(err.join("")).toMatch(/bereikbaar vanaf het netwerk.*geen authenticatie/);
      expect(out.join("")).toMatch(/^Wordiknat draait op http:\/\/0\.0\.0\.0:\d+ /);
    } finally {
      await close(s);
    }
  });

  it.each(["localhost", "::1"])("%s is loopback: no warning", async (host) => {
    const err: string[] = [];
    const fakeStart: typeof startServer = (o) => startServer({ ...o, host: "127.0.0.1" });
    const s = await runServe({ port: 0, host }, deps([], err, { startServer: fakeStart }));
    await close(s);
    expect(err).toEqual([]);
  });

  it("main serve: a port in use gives the Dutch message and exit 1", async () => {
    const blocker = netServer();
    await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", r));
    const port = (blocker.address() as AddressInfo).port;
    try {
      const r = await run(["serve", "--port", String(port)]);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("al in gebruik");
      expect(r.stdout).toBe("");
    } finally {
      await new Promise((r) => blocker.close(r));
    }
  });

  it("main serve starts the server and returns 0 while it keeps listening", async () => {
    const servers: http.Server[] = [];
    const out: string[] = [];
    const asked: Array<[number, string | undefined]> = [];
    const fakeStart: typeof startServer = async (o) => {
      asked.push([o.port, o.host]);
      const s = await startServer({ ...o, port: 0 });
      servers.push(s);
      return s;
    };
    const code = await main(["serve"], deps(out, [], { startServer: fakeStart }));
    try {
      expect(code).toBe(0);
      expect(asked).toEqual([[5173, "127.0.0.1"]]);
      expect(servers[0].listening).toBe(true);
      expect(out.join("")).toMatch(/^Wordiknat draait op http:\/\/127\.0\.0\.1:\d+ \(Ctrl\+C om te stoppen\)\n$/);
    } finally {
      await close(servers[0]);
    }
  });
});

describe("--24u (US-019, FR-017, DOD-6.5)", () => {
  const HOURLY_FIELDS = [
    "dryUntil",
    "firstRainAt",
    "hours",
    "intensity",
    "issuedAt",
    "location",
    "maxMmPerHour",
    "source",
    "summary",
    "willRain",
  ];
  const HERE = coords(HARMONIE_INSIDE);
  const hourly = (argv: string[], f = fullFetch(), env: Record<string, string | undefined> = { KNMI_API_KEY: KEY }) =>
    run(argv, { fetch: f.fetch, env, now: HARMONIE_NOW });
  const isRadar = (url: string) => url.startsWith(API);
  const isHarmonie = (url: string) => url.startsWith(HARMONIE_API);
  const listing = (res: () => Response): Override => (url) => (url.startsWith(`${HARMONIE_API}?`) ? res() : undefined);

  it("--json prints one object with exactly the hourly report fields and 24 hours, exit 0, no radar request", async () => {
    const f = fullFetch();
    const r = await hourly([...HERE, "--24u", "--json"], f);
    expect(r.code).toBe(0);
    expect(r.out).toHaveLength(1);
    expect(r.stderr).toBe("");
    const body = JSON.parse(r.stdout);
    expect(Object.keys(body).sort()).toEqual(HOURLY_FIELDS);
    expect(body.hours).toHaveLength(24);
    expect(body.hours[0]).toEqual({ time: "2026-11-06T09:00:00.000Z", mmPerHour: expect.any(Number) });
    expect(body.source).toBe(SOURCE_HOURLY);
    expect(body.location).toMatchObject({ lat: HARMONIE_INSIDE.lat, lon: HARMONIE_INSIDE.lon });
    expect(f.calls.some(isHarmonie)).toBe(true);
    expect(f.calls.some(isRadar)).toBe(false);
  });

  it("human output: summary, 24 hourly lines and the HARMONIE source line", async () => {
    const r = await hourly([...HERE, "--24u"]);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    const lines = r.stdout.split("\n");
    expect(lines.pop()).toBe("");
    expect(lines).toHaveLength(26);
    expect(lines[0]).toMatch(/^(Droog|Regen) /);
    const rows = lines.slice(1, -1);
    // 09:00 UTC is 10:00 in Amsterdam; rows step one hour.
    expect(rows[0]).toMatch(/^10:00  /);
    rows.forEach((row) => expect(row).toMatch(/^\d\d:\d\d  [█ ]{20}  \d+,\d mm$/));
    expect(lines.at(-1)).toMatch(/HARMONIE/);
    expect(lines.at(-1)).toContain("CC BY 4.0");
  });

  it("a plain call makes no HARMONIE request and keeps its fields", async () => {
    const f = fullFetch();
    const r = await run([...coords(INSIDE), "--json"], { fetch: f.fetch });
    expect(r.code).toBe(0);
    expect(Object.keys(JSON.parse(r.stdout)).sort()).toEqual(FIELDS);
    expect(f.calls.some(isHarmonie)).toBe(false);
  });

  it("unknown place: exit 2 UNKNOWN_PLACE", async () => {
    const f = fullFetch((url) => (url.startsWith(`${PDOK}/free?`) ? pdok([]) : undefined));
    const r = await hourly(["Nergenshuizen", "--24u", "--json"], f);
    expect(r.code).toBe(2);
    expect(JSON.parse(r.stdout)).toEqual({ error: { code: "UNKNOWN_PLACE", message: expect.any(String) } });
    expect(f.calls.some(isHarmonie)).toBe(false);
  });

  it("invalid key (401): exit 2 INVALID_KEY", async () => {
    const r = await hourly([...HERE, "--24u", "--json"], fullFetch(listing(() => new Response("", { status: 401 }))));
    expect(r.code).toBe(2);
    expect(JSON.parse(r.stdout).error.code).toBe("INVALID_KEY");
  });

  it("listing 404: HOURLY_UNAVAILABLE with exit 1, in JSON and in text", async () => {
    const f = () => fullFetch(listing(() => new Response("", { status: 404 })));
    const j = await hourly([...HERE, "--24u", "--json"], f());
    expect(j.code).toBe(1);
    expect(j.stderr).toBe("");
    expect(JSON.parse(j.stdout)).toEqual({ error: { code: "HOURLY_UNAVAILABLE", message: expect.any(String) } });
    const t = await hourly([...HERE, "--24u"], f());
    expect(t.code).toBe(1);
    expect(t.stdout).toBe("");
    expect(t.stderr).toContain("24-uursverwachting");
  });

  it("missing key: exit 2 MISSING_KEY before any request", async () => {
    const f = fullFetch();
    const r = await hourly([...HERE, "--24u", "--json"], f, {});
    expect(r.code).toBe(2);
    expect(JSON.parse(r.stdout).error.code).toBe("MISSING_KEY");
    expect(f.calls).toEqual([]);
  });

  it("--24u with serve is BAD_ARGS", async () => {
    const r = await run(["serve", "--24u", "--json"]);
    expect(r.code).toBe(2);
    expect(JSON.parse(r.stdout).error.code).toBe("BAD_ARGS");
  });

  it("--help lists --24u", async () => {
    const r = await run(["--help"]);
    expect(r.stdout).toContain("--24u");
  });

  describe("the key never reaches stdout or stderr", () => {
    const keyedPlace: Override = (url) =>
      url.startsWith(`${PDOK}/free?`)
        ? pdok([{ weergavenaam: `Dorp ${KEY}`, centroide_ll: `POINT(${HARMONIE_INSIDE.lon} ${HARMONIE_INSIDE.lat})` }])
        : undefined;
    const keyed = (s: number) => listing(() => new Response(`bad ${KEY}`, { status: s }));
    const paths: Array<[string, () => ReturnType<typeof fullFetch>, string[]]> = [
      // The place name carries the key, so the success path proves redaction itself works.
      ["success", () => fullFetch(keyedPlace), ["Dorp"]],
      ["unknown place", () => fullFetch((url) => (url.startsWith(`${PDOK}/free?`) ? pdok([]) : undefined)), [KEY]],
      ["401", () => fullFetch(keyed(401)), HERE],
      ["404", () => fullFetch(keyed(404)), HERE],
      ["500", () => fullFetch(keyed(500)), HERE],
      ["network", () => fullFetch(() => new TypeError(`fetch failed ${KEY}`)), HERE],
    ];

    it.each(paths.flatMap(([label, f, argv]) => [[`${label} --json`, f, [...argv, "--json"]], [label, f, argv]] as const))(
      "%s",
      async (label, f, argv) => {
        const r = await hourly([...argv, "--24u"], f());
        if (label.startsWith("success")) expect(r.code).toBe(0);
        expect(r.stdout + r.stderr).not.toBe("");
        expect(r.stdout).not.toContain(KEY);
        expect(r.stderr).not.toContain(KEY);
      },
    );
  });
});
