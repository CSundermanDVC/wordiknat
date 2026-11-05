import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getForecast } from "../../src/core/forecast.ts";
import { cellToLatLon, KNMI_RADAR_GEOMETRY } from "../../src/core/projection.ts";
import { SOURCE } from "../../src/core/types.ts";

const KEY = "SENTINEL-KEY-123";
const API = "https://api.dataplatform.knmi.nl/open-data/v1/datasets/radar_forecast/versions/2.0/files";
const NAME = "RAD_NL25_RAC_FM_202611041100.h5";
const DOWNLOAD = "https://download.example/RAD.h5";
const FIXTURE = new Uint8Array(readFileSync(fileURLToPath(new URL("../fixtures/radar-sample.h5", import.meta.url))));
const T0 = new Date("2026-11-04T11:01:00Z");
// Fixture crop cell (19,0) is source cell (349,55) of the full grid.
const INSIDE = { name: "Noordzee", ...cellToLatLon(349, 55, KNMI_RADAR_GEOMETRY) };

function fakeFetch() {
  const calls: string[] = [];
  const fetch = async (url: string) => {
    calls.push(url);
    if (url.startsWith(`${API}?`)) return Response.json({ files: [{ filename: NAME }] });
    if (url === `${API}/${NAME}/url`) return Response.json({ temporaryDownloadUrl: DOWNLOAD });
    if (url === DOWNLOAD) return new Response(FIXTURE);
    return new Response("nope", { status: 404 });
  };
  return { fetch, calls };
}

describe("getForecast", () => {
  let cacheDir: string;
  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "wordiknat-forecast-"));
  });
  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("returns 25 points in mm/u for the cell, with issue time, location and source", async () => {
    const { fetch } = fakeFetch();
    const f = await getForecast(INSIDE, { fetch, apiKey: KEY, cacheDir, now: T0 });
    expect(f.location).toBe(INSIDE);
    expect(f.source).toBe(SOURCE);
    expect(f.issuedAt.toISOString()).toBe("2026-11-04T11:00:00.000Z");
    expect(f.points).toHaveLength(25);
    f.points.forEach((p, i) => {
      expect(p.time.getTime()).toBe(f.issuedAt.getTime() + i * 5 * 60_000);
      expect(p.mmPerHour === 0 || Math.abs(p.mmPerHour - 0.12) < 1e-9).toBe(true);
    });
    expect(f.points[0].mmPerHour).toBeCloseTo(0.12, 10);
  });

  it("called twice within 5 minutes downloads once", async () => {
    const { fetch, calls } = fakeFetch();
    await getForecast(INSIDE, { fetch, apiKey: KEY, cacheDir, now: T0 });
    await getForecast(INSIDE, { fetch, apiKey: KEY, cacheDir, now: new Date(T0.getTime() + 4 * 60_000) });
    expect(calls.filter((u) => u === DOWNLOAD)).toHaveLength(1);
    expect(calls).toHaveLength(3);
  });

  it("gives OUTSIDE_GRID for a coordinate outside the file's grid", async () => {
    const { fetch } = fakeFetch();
    await expect(
      getForecast({ name: "Utrecht", lat: 52.09126, lon: 5.10448 }, { fetch, apiKey: KEY, cacheDir, now: T0 }),
    ).rejects.toMatchObject({ code: "OUTSIDE_GRID" });
  });
});
