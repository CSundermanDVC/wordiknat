import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.ts";
import { getForecast } from "../src/core/forecast.ts";
import { cellToLatLon, KNMI_RADAR_GEOMETRY } from "../src/core/projection.ts";
import { buildHourlyReport, buildReport } from "../src/core/report.ts";
import { summarizeHourly } from "../src/core/hourly-summary.ts";
import { summarize } from "../src/core/summary.ts";
import { SOURCE_HOURLY } from "../src/core/types.ts";

const API = "https://api.dataplatform.knmi.nl/open-data/v1/datasets/radar_forecast/versions/2.0/files";
const NAME = "RAD_NL25_RAC_FM_202611041100.h5";
const DOWNLOAD = "https://download.example/RAD.h5";
const FIXTURE = new Uint8Array(readFileSync(fileURLToPath(new URL("./fixtures/radar-sample.h5", import.meta.url))));
const NOW = new Date("2026-11-04T11:01:00Z");
const INSIDE = cellToLatLon(349, 55, KNMI_RADAR_GEOMETRY);
const US005 = ["summary", "willRain", "firstRainAt", "dryUntil", "maxMmPerHour", "location", "issuedAt", "points", "source"];

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const fetch = async (url: string) => {
  if (url.startsWith(`${API}?`)) return json({ files: [{ filename: NAME }] });
  if (url === `${API}/${NAME}/url`) return json({ temporaryDownloadUrl: DOWNLOAD });
  if (url === DOWNLOAD) return new Response(FIXTURE);
  return new Response("nope", { status: 404 });
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "wordiknat-report-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("buildReport (US-005, FR-008)", () => {
  it("has exactly the nine US-005 keys in order and equals the CLI --json output", async () => {
    const out: string[] = [];
    const code = await main(["--lat", String(INSIDE.lat), "--lon", String(INSIDE.lon), "--json"], {
      fetch,
      env: { KNMI_API_KEY: "test-key" },
      cwd: dir,
      now: NOW,
      stdout: (s) => out.push(s),
      stderr: () => {},
      cacheDir: dir,
    });
    expect(code).toBe(0);

    const location = { name: `${INSIDE.lat}, ${INSIDE.lon}`, ...INSIDE };
    const forecast = await getForecast(location, { fetch, apiKey: "test-key", cacheDir: dir, now: NOW });
    const report = buildReport(forecast, summarize(forecast.points, NOW));

    expect(Object.keys(report)).toEqual(US005);
    expect(report.issuedAt).toBeInstanceOf(Date);
    expect(`${JSON.stringify(report)}\n`).toBe(out.join(""));
  });
});

describe("buildHourlyReport (FR-016)", () => {
  it("has the fixed key order and keeps Dates", () => {
    const hours = Array.from({ length: 24 }, (_, i) => ({ time: new Date(Date.UTC(2026, 6, 1, 12 + i)), mmPerHour: 0 }));
    const location = { name: "x", lat: 52, lon: 5 };
    const issuedAt = new Date(Date.UTC(2026, 6, 1, 9));
    const report = buildHourlyReport(
      { location, issuedAt, hours, source: SOURCE_HOURLY },
      summarizeHourly(hours, new Date(Date.UTC(2026, 6, 1, 12))),
    );
    expect(Object.keys(report)).toEqual([
      "summary", "willRain", "firstRainAt", "dryUntil", "maxMmPerHour", "intensity", "location", "issuedAt", "hours", "source",
    ]);
    expect(report.issuedAt).toBeInstanceOf(Date);
    expect(report.hours).toHaveLength(24);
  });
});
