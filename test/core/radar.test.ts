import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getForecast } from "../../src/core/forecast.ts";
import { readRadarFile, STEP_COUNT, type RadarFile } from "../../src/core/hdf5.ts";
import { pixelToLonLat, RADAR_GRID, unpackClasses } from "../../src/core/map-grid.ts";
import { latLonToCell, KNMI_RADAR_GEOMETRY as G } from "../../src/core/projection.ts";
import { buildRadar, getRadar, radarCellMap } from "../../src/core/radar.ts";
import { DOWNLOAD, fakeFetch, INSIDE, KEY, NOW } from "../helpers/fake-fetch.ts";

const { width, height, originX, originY, zoom } = RADAR_GRID;
const UTRECHT = { lat: 52.0907, lon: 5.1214 }; // docs/knmi-format.md
const expected = (i: number, j: number): number => {
  const { lon, lat } = pixelToLonLat(originX + i + 0.5, originY + j + 0.5, zoom);
  try {
    const c = latLonToCell(lat, lon, G);
    return c.row * G.columns + c.col;
  } catch {
    return -1;
  }
};

describe("radarCellMap", () => {
  it("keeps at most two geometries memoised", () => {
    const first = radarCellMap(G);
    radarCellMap({ ...G, columns: 1, rows: 1 });
    radarCellMap({ ...G, columns: 2, rows: 2 });
    expect(radarCellMap(G)).not.toBe(first);
  });

  it("agrees with latLonToCell on a lattice, the corners and Utrecht", () => {
    const map = radarCellMap(G);
    expect(map.length).toBe(width * height);
    const cells: [number, number][] = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]];
    for (let j = 0; j < height; j += 25) for (let i = 0; i < width; i += 25) cells.push([i, j]);
    const u = { x: 0, y: 0 };
    // Utrecht's target cell
    const phi = (UTRECHT.lat * Math.PI) / 180;
    const w = 256 * 2 ** zoom;
    u.x = Math.floor(((UTRECHT.lon + 180) / 360) * w) - originX;
    u.y = Math.floor(((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * w) - originY;
    cells.push([u.x, u.y]);
    expect(cells.length).toBeGreaterThanOrEqual(200);
    for (const [i, j] of cells) expect(map[j * width + i]).toBe(expected(i, j));
    expect(latLonToCell(UTRECHT.lat, UTRECHT.lon, G)).toEqual({ col: 365, row: 429 });
    // The cell centre is not the city point (a z7 cell is ~1.2 km), so allow a one-cell neighbour.
    const got = map[u.y * width + u.x];
    expect(got).not.toBe(-1);
    expect(Math.abs((got % G.columns) - 365)).toBeLessThanOrEqual(1);
    expect(Math.abs(Math.floor(got / G.columns) - 429)).toBeLessThanOrEqual(1);
  });

  it("is memoised per geometry", () => {
    expect(radarCellMap(G)).toBe(radarCellMap({ ...G }));
  });
});

function synthetic(setup: (steps: Uint16Array[]) => void): RadarFile {
  const steps = Array.from({ length: STEP_COUNT }, () => new Uint16Array(G.columns * G.rows));
  setup(steps);
  const t0 = Date.parse("2026-11-04T11:00:00Z");
  return {
    issuedAt: new Date(t0),
    geometry: G,
    steps: steps.map((pixels, i) => ({ time: new Date(t0 + i * 300_000), pixels, scale: 0.12, offset: 0, nodata: [65534, 65535] })),
  };
}

const decode = (b64: string) => unpackClasses(new Uint8Array(Buffer.from(b64, "base64")), width * height);

describe("buildRadar", () => {
  const utrecht = 429 * G.columns + 365;
  const pvs = [0, 1, 8, 9, 20, 21, 65534, 65535];
  const want = [0, 1, 1, 2, 2, 3, 0, 0];
  const file = synthetic((steps) => pvs.forEach((pv, k) => (steps[k][utrecht] = pv)));
  const payload = buildRadar(file);
  const map = radarCellMap(G);

  it("maps PV values to classes only inside the marked KNMI cell", () => {
    const frames = payload.frames.map(decode);
    pvs.forEach((_, k) => {
      let marked = 0;
      const mismatches: number[] = [];
      map.forEach((idx, n) => {
        const expected = idx === utrecht ? want[k] : 0;
        if (idx === utrecht) marked++;
        if (frames[k][n] !== expected) mismatches.push(n);
      });
      // Assert the count, not the array: a real regression can mismatch ~1.7M cells.
      expect(mismatches.length, `frame ${k}, first mismatches: ${mismatches.slice(0, 10)}`).toBe(0);
      expect(marked).toBeGreaterThan(0);
    });
  });

  it("has the payload shape", () => {
    expect(payload.frames).toHaveLength(STEP_COUNT);
    expect(payload.times).toEqual(file.steps.map((s) => s.time.toISOString()));
    expect(payload).toMatchObject({ width, height, originX, originY, zoom, issuedAt: "2026-11-04T11:00:00.000Z" });
  });

  it("gives all-zero frames for the fixture crop outside the map", async () => {
    const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL("../fixtures/radar-sample.h5", import.meta.url))));
    const p = buildRadar(await readRadarFile(bytes));
    expect(p.frames).toHaveLength(STEP_COUNT);
    for (const f of p.frames) expect(decode(f).every((c) => c === 0)).toBe(true);
  });
});

describe("getRadar", () => {
  let dir: string;
  beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), "wordiknat-radar-"))));
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("shares one KNMI download with getForecast and never leaks the key", async () => {
    const { fetch, calls } = fakeFetch();
    const deps = { fetch, apiKey: KEY, cacheDir: dir, now: NOW };
    await getForecast({ name: "x", ...INSIDE }, deps);
    const p = await getRadar(deps);
    expect(calls.filter((u) => u === DOWNLOAD)).toHaveLength(1);
    expect(p.frames).toHaveLength(STEP_COUNT);
    expect(JSON.stringify(p)).not.toContain(KEY);
  });
});
