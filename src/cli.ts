// CLI logic (FR-006, FR-008). `main` has no side effects beyond the injected deps and `serve`; `run` wires in the real process.
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { cacheDir as defaultCacheDir } from "./core/cache.ts";
import { getApiKey, loadEnv, redact } from "./core/env.ts";
import { WordiknatError, toErrorJson } from "./core/errors.ts";
import { getForecast } from "./core/forecast.ts";
import { geocode } from "./core/geocode.ts";
import { buildReport } from "./core/report.ts";
import { summarize } from "./core/summary.ts";
import type { ForecastPoint, Location } from "./core/types.ts";
import { LOOPBACK, startServer } from "./server.ts";
import { parsePort } from "./validate.ts";

export type CliDeps = {
  fetch: (url: string, init?: { headers?: Record<string, string>; redirect?: "error" }) => Promise<Response>;
  env: Record<string, string | undefined>;
  cwd: string;
  now: Date;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cacheDir?: string;
  /** Injected so tests can bind 127.0.0.1 while asking for another host. */
  startServer?: typeof startServer;
};

type ServeArgs = { port: number; host: string };

const USAGE = `Gebruik: wordiknat [<plaats>] [--lat <n> --lon <n>] [--json] [--help]
       wordiknat serve [--port <n>] [--host <adres>]

wordiknat serve start de webinterface op http://127.0.0.1:5173 (bouw die eerst met npm run build).

Zonder plaats of coördinaten gebruikt wordiknat WORDIKNAT_LOCATION uit de omgeving of .env
(een plaatsnaam of "lat,lon"). Zet WORDIKNAT_DEBUG=1 om de verzoeken op stderr te zien.
`;

const BAR_WIDTH = 20;
const MM_PER_BLOCK = 0.5;
const hhmm = new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", hour: "2-digit", minute: "2-digit" });

/** One row per 10 minutes (every other 5-minute point): `HH:MM  <bar>  <n,nn> mm/u`. */
function timeline(points: readonly ForecastPoint[]): string[] {
  return points
    .filter((_, i) => i % 2 === 0)
    .map((p) => {
      // Below the summary's 0.1 mm/u rain threshold the bar stays empty.
      const blocks = p.mmPerHour < 0.1 ? 0 : Math.min(BAR_WIDTH, Math.ceil(p.mmPerHour / MM_PER_BLOCK));
      const bar = "█".repeat(blocks).padEnd(BAR_WIDTH);
      return `${hhmm.format(p.time)}  ${bar}  ${p.mmPerHour.toFixed(2).replace(".", ",")} mm/u`;
    });
}

type Args = { json: boolean; help: boolean; place: string; coords: { lat: number; lon: number } | null; serve: ServeArgs | null };

function num(s: string | undefined, max: number): number {
  const n = s === undefined || s.trim() === "" ? NaN : Number(s);
  if (!Number.isFinite(n) || Math.abs(n) > max) throw new WordiknatError("BAD_ARGS");
  return n;
}

/** Pure argument validation; messages are static so nothing from argv is echoed. */
function parse(argv: string[]): Args {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        lat: { type: "string" },
        lon: { type: "string" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
        port: { type: "string" },
        host: { type: "string" },
      },
    });
  } catch {
    throw new WordiknatError("BAD_ARGS");
  }
  const { values, positionals } = parsed;
  const place = positionals.join(" ").trim();
  const hasLat = values.lat !== undefined;
  if (hasLat !== (values.lon !== undefined) || (hasLat && place !== "")) throw new WordiknatError("BAD_ARGS");
  const coords = hasLat ? { lat: num(values.lat, 90), lon: num(values.lon, 180) } : null;
  const isServe = positionals.length === 1 && positionals[0] === "serve";
  if (!isServe && (values.port !== undefined || values.host !== undefined)) throw new WordiknatError("BAD_ARGS");
  // An empty host would make listen() bind every interface (SR-002).
  if (values.host !== undefined && !HOST.test(values.host)) throw new WordiknatError("BAD_ARGS");
  const serve = isServe
    ? { port: values.port === undefined ? 5173 : parsePort(values.port), host: values.host ?? "127.0.0.1" }
    : null;
  return { json: values.json, help: values.help, place, coords, serve };
}

const HOST = /^[\w.:-]{1,253}$/;
const COORDS = /^([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)$/;

/** WORDIKNAT_LOCATION is a place name or "lat,lon" (US-007). */
function envLocation(value: string | undefined): Pick<Args, "place" | "coords"> {
  const v = value?.trim() ?? "";
  const m = COORDS.exec(v);
  return m ? { place: "", coords: { lat: num(m[1], 90), lon: num(m[2], 180) } } : { place: v, coords: null };
}

const IN_USE = "Deze poort is al in gebruik. Kies een andere met --port <n> of stop het programma dat hem gebruikt.";
const NO_LISTEN = "De server kon niet starten op dit adres. Controleer --host en --port.";
const PUBLIC =
  "Let op: de pagina is nu bereikbaar vanaf het netwerk en heeft geen authenticatie. Gebruik --host alleen op een vertrouwd netwerk.\n";

/** Starts the server for `wordiknat serve`, prints its URL and resolves once it listens. */
export async function runServe({ port, host }: ServeArgs, deps: CliDeps): Promise<http.Server> {
  if (!LOOPBACK.includes(host.toLowerCase())) deps.stderr(PUBLIC);
  const server = await (deps.startServer ?? startServer)({
    port,
    host,
    fetch: deps.fetch,
    env: deps.env,
    now: () => new Date(),
    cacheDir: deps.cacheDir ?? defaultCacheDir(deps.env, process.platform, homedir()),
    staticDir: fileURLToPath(new URL("../dist/web", import.meta.url)),
    stderr: deps.stderr,
  }).catch((e: NodeJS.ErrnoException) => {
    throw new WordiknatError("NETWORK", e.code === "EADDRINUSE" ? IN_USE : NO_LISTEN);
  });
  const url = host.includes(":") ? `[${host}]` : host;
  deps.stdout(`Wordiknat draait op http://${url}:${(server.address() as AddressInfo).port} (Ctrl+C om te stoppen)\n`);
  return server;
}

export async function main(argv: string[], deps: CliDeps): Promise<number> {
  // Fallback for when parsing itself fails; parse() decides once it succeeds.
  let json = argv.includes("--json");
  let key = "";
  const write = (out: (text: string) => void, text: string) => out(redact(text, key));
  try {
    const args = parse(argv);
    json = args.json;
    if (args.help) {
      deps.stdout(USAGE);
      return 0;
    }
    // Inside the try: an unreadable .env (EACCES, EISDIR) must get the generic error, not a stack trace.
    loadEnv(deps.cwd);
    // The listening server keeps the process alive after main returns.
    if (args.serve) {
      await runServe(args.serve, deps);
      return 0;
    }
    const loc = args.coords || args.place ? args : envLocation(deps.env.WORDIKNAT_LOCATION);
    if (!loc.coords && loc.place === "") throw new WordiknatError("NO_LOCATION");
    key = getApiKey(deps.env);
    // Debug lines name the host and status only: paths and queries can carry signed URLs.
    const fetch: CliDeps["fetch"] =
      deps.env.WORDIKNAT_DEBUG === "1"
        ? async (url, init) => {
            const host = new URL(url).host;
            try {
              const res = await deps.fetch(url, init);
              write(deps.stderr, `debug: ${host} ${res.status}\n`);
              return res;
            } catch (e) {
              write(deps.stderr, `debug: ${host} netwerkfout\n`);
              throw e;
            }
          }
        : deps.fetch;
    const location: Location = loc.coords
      ? { name: `${loc.coords.lat}, ${loc.coords.lon}`, ...loc.coords }
      : await geocode(loc.place, { fetch });
    const forecast = await getForecast(location, {
      fetch,
      apiKey: key,
      cacheDir: deps.cacheDir ?? defaultCacheDir(deps.env, process.platform, homedir()),
      now: deps.now,
    });
    const s = summarize(forecast.points, deps.now);
    if (!json) {
      write(deps.stdout, `${[s.summary, ...timeline(forecast.points), "Bron: KNMI (CC BY 4.0)"].join("\n")}\n`);
      return 0;
    }
    write(deps.stdout, `${JSON.stringify(buildReport(forecast, s))}\n`);
    return 0;
  } catch (e) {
    // Unexpected errors (fs, bugs) get the generic message: no stack, paths or raw text in output.
    const err = e instanceof WordiknatError ? e : new WordiknatError("SOURCE_HTTP");
    if (json) write(deps.stdout, `${JSON.stringify(toErrorJson(err))}\n`);
    else write(deps.stderr, `${err.message}\n${err.code === "NO_LOCATION" ? USAGE : ""}`);
    return err.exitCode;
  }
}

/** Process entry point for bin/wordiknat.js. */
export async function run(): Promise<void> {
  process.exitCode = await main(process.argv.slice(2), {
    fetch: (url, init) => globalThis.fetch(url, init),
    env: process.env,
    cwd: process.cwd(),
    now: new Date(),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
}
