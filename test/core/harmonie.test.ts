import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import h5wasm from "h5wasm/node";
import { beforeAll, describe, expect, it } from "vitest";
import {
  HARMONIE_GRID,
  hourlyValuesAt,
  latLonToHarmonieCell,
  readHarmonieFile,
  type HarmonieFile,
} from "../../src/core/harmonie.ts";

const FIXTURE = readFileSync(fileURLToPath(new URL("../fixtures/harmonie-sample.nc", import.meta.url)));
const outside = expect.objectContaining({ name: "WordiknatError", code: "OUTSIDE_GRID" });
const badFile = expect.objectContaining({ name: "WordiknatError", code: "HOURLY_BAD_FILE" });

describe("latLonToHarmonieCell on the full grid", () => {
  const g = HARMONIE_GRID;
  const lastLat = g.lat0 + (g.rows - 1) * g.dLat;
  const lastLon = g.lon0 + (g.cols - 1) * g.dLon;

  it("puts the south-west corner on cell (0, 0)", () => {
    expect(latLonToHarmonieCell(49, 0, g)).toEqual({ row: 0, col: 0 });
  });

  it("puts the south-east corner on cell (0, 389)", () => {
    expect(latLonToHarmonieCell(49, lastLon, g)).toEqual({ row: 0, col: 389 });
  });

  it("puts the north-west corner on cell (389, 0)", () => {
    expect(latLonToHarmonieCell(lastLat, 0, g)).toEqual({ row: 389, col: 0 });
  });

  it("puts the north-east corner on cell (389, 389)", () => {
    expect(latLonToHarmonieCell(56.002, 11.281, g)).toEqual({ row: 389, col: 389 });
  });

  it("puts the Utrecht cell centre (52.096, 5.133) on cell (172, 177)", () => {
    expect(latLonToHarmonieCell(52.096, 5.133, g)).toEqual({ row: 172, col: 177 });
  });

  it("puts Utrecht itself (52.0907, 5.1214) on the same cell", () => {
    expect(latLonToHarmonieCell(52.0907, 5.1214, g)).toEqual({ row: 172, col: 177 });
  });

  it("keeps a point just inside the south-west edge (less than half a cell out) on the corner cell", () => {
    expect(latLonToHarmonieCell(49 - 0.0089, 0 - 0.0144, g)).toEqual({ row: 0, col: 0 });
  });

  it("keeps a point just inside the north-east edge on the corner cell", () => {
    expect(latLonToHarmonieCell(lastLat + 0.0089, lastLon + 0.0144, g)).toEqual({ row: 389, col: 389 });
  });

  it("throws OUTSIDE_GRID more than half a cell south of the grid", () => {
    expect(() => latLonToHarmonieCell(49 - 0.0091, 5, g)).toThrow(outside);
  });

  it("throws OUTSIDE_GRID more than half a cell east of the grid", () => {
    expect(() => latLonToHarmonieCell(52, lastLon + 0.0146, g)).toThrow(outside);
  });

  it("throws OUTSIDE_GRID far away (New York)", () => {
    expect(() => latLonToHarmonieCell(40.71, -74.01, g)).toThrow(outside);
  });

  it("throws OUTSIDE_GRID on non-finite input", () => {
    expect(() => latLonToHarmonieCell(Number.NaN, 5, g)).toThrow(outside);
  });
});

describe("readHarmonieFile on the fixture", () => {
  let file: HarmonieFile;
  beforeAll(async () => {
    file = await readHarmonieFile(new Uint8Array(FIXTURE));
  });

  it("reads the run reference time as issuedAt", () => {
    expect(file.issuedAt.toISOString()).toBe("2026-11-06T07:00:00.000Z");
  });

  it("reads the cropped geometry from the latitude/longitude variables", () => {
    const { rows, cols, lat0, lon0, dLat, dLon } = file.geometry;
    expect({ rows, cols }).toEqual({ rows: 8, cols: 8 });
    expect([lat0, lon0, dLat, dLon].map((x) => x.toFixed(6))).toEqual(["52.024000", "5.017000", "0.018000", "0.029000"]);
  });

  it("has 60 hourly steps, each time the end of its hour, the first at reference + 1 h", () => {
    expect(file.times).toHaveLength(60);
    expect(file.steps).toHaveLength(60);
    expect(file.times[0].toISOString()).toBe("2026-11-06T08:00:00.000Z");
    expect(file.times[59].toISOString()).toBe("2026-11-08T19:00:00.000Z");
    expect(file.times.every((t, i) => t.getTime() === file.times[0].getTime() + i * 3_600_000)).toBe(true);
    expect(file.steps.every((s) => s.length === 64)).toBe(true);
  });

  it("finds Utrecht on crop cell (4, 4) and reads 0.11 mm at step 40", () => {
    const cell = latLonToHarmonieCell(52.0907, 5.1214, file.geometry);
    expect(cell).toEqual({ row: 4, col: 4 });
    const values = hourlyValuesAt(file, cell);
    expect(values).toHaveLength(60);
    expect(values[40]).toBeCloseTo(0.11, 2);
    expect(values.every((v) => v !== null && v >= 0)).toBe(true);
  });

  it("turns the documented NaN (cell (0, 0), step 0) into null and keeps the rest", () => {
    const values = hourlyValuesAt(file, { row: 0, col: 0 });
    expect(values[0]).toBeNull();
    expect(values.slice(1).every((v) => typeof v === "number")).toBe(true);
  });

  it("throws OUTSIDE_GRID for a cell outside the file's grid", () => {
    expect(() => hourlyValuesAt(file, { row: 8, col: 0 })).toThrow(outside);
  });
});

describe("readHarmonieFile on invalid input", () => {
  const VAR = "total-precipitation-accumulation-01h-gl";
  const REF = 1_793_948_400;
  const SECONDS = "seconds since 1970-01-01T00:00:00+00:00";

  type Opts = { name?: string; shape?: number[]; lat?: number[]; lon?: number[]; times?: number[]; fill?: number; first?: number };

  // A minimal NetCDF4-like file in the documented layout; each bad case overrides one part.
  async function nc(opts: Opts = {}): Promise<Uint8Array> {
    const lat = opts.lat ?? [52, 52.018, 52.036];
    const lon = opts.lon ?? [5, 5.029];
    const times = opts.times ?? Array.from({ length: 24 }, (_, i) => REF + (i + 1) * 3600);
    const shape = opts.shape ?? [times.length, 1, lat.length, lon.length];
    await h5wasm.ready;
    const dir = mkdtempSync(join(tmpdir(), "wordiknat-test-"));
    try {
      const path = join(dir, "x.nc");
      const f = new h5wasm.File(path, "w");
      f.create_dataset({ name: "forecast_reference_time", data: BigInt64Array.of(BigInt(REF)), shape: [], dtype: "<q" })
        .create_attribute("units", SECONDS);
      f.create_dataset({ name: "time", data: BigInt64Array.from(times, BigInt), dtype: "<q" }).create_attribute("units", SECONDS);
      f.create_dataset({ name: "latitude", data: Float64Array.from(lat) });
      f.create_dataset({ name: "longitude", data: Float64Array.from(lon) });
      const data = new Float32Array(shape.reduce((a, b) => a * b, 1));
      if (opts.first !== undefined) data[0] = opts.first;
      const v = f.create_dataset({ name: opts.name ?? VAR, data, shape });
      v.create_attribute("units", "mm");
      if (opts.fill !== undefined) v.create_attribute("_FillValue", opts.fill, [], "<f");
      f.close();
      return new Uint8Array(readFileSync(path));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("reads the valid baseline built here (so the cases below fail for their own reason)", async () => {
    const file = await readHarmonieFile(await nc());
    expect({ steps: file.steps.length, rows: file.geometry.rows, cols: file.geometry.cols }).toEqual({ steps: 24, rows: 3, cols: 2 });
  });

  it("throws HOURLY_BAD_FILE on non-HDF5 bytes", async () => {
    const bytes = Uint8Array.from({ length: 4096 }, (_, i) => (i * 7919 + 13) % 256);
    await expect(readHarmonieFile(bytes)).rejects.toThrow(badFile);
  });

  it("throws HOURLY_BAD_FILE on a truncated file", async () => {
    await expect(readHarmonieFile(new Uint8Array(FIXTURE.subarray(0, 2048)))).rejects.toThrow(badFile);
  });

  it("throws HOURLY_BAD_FILE when the precipitation variable is missing (other name)", async () => {
    await expect(readHarmonieFile(await nc({ name: "rainfall-accumulation-01h-gl" }))).rejects.toThrow(badFile);
  });

  it("throws HOURLY_BAD_FILE on a wrong data shape", async () => {
    await expect(readHarmonieFile(await nc({ shape: [24, 3, 2] }))).rejects.toThrow(badFile);
  });

  it("throws HOURLY_BAD_FILE when the shape does not match the lat/lon lengths", async () => {
    await expect(readHarmonieFile(await nc({ shape: [24, 1, 2, 3] }))).rejects.toThrow(badFile);
  });

  it("throws HOURLY_BAD_FILE on an irregular latitude axis", async () => {
    await expect(readHarmonieFile(await nc({ lat: [52, 52.018, 52.05] }))).rejects.toThrow(badFile);
  });

  it("throws HOURLY_BAD_FILE on an irregular longitude axis", async () => {
    await expect(readHarmonieFile(await nc({ lon: [5, 5.029, 5.03] }))).rejects.toThrow(badFile);
  });

  it("throws HOURLY_BAD_FILE when time is not strictly increasing", async () => {
    const times = Array.from({ length: 24 }, (_, i) => REF + (i + 1) * 3600);
    await expect(readHarmonieFile(await nc({ times: [...times.slice(0, 5), times[3], ...times.slice(6)] }))).rejects.toThrow(badFile);
  });

  it("throws HOURLY_BAD_FILE with fewer than 24 steps", async () => {
    const times = Array.from({ length: 23 }, (_, i) => REF + (i + 1) * 3600);
    await expect(readHarmonieFile(await nc({ times }))).rejects.toThrow(badFile);
  });

  it("throws HOURLY_BAD_FILE when time steps are increasing but not hourly", async () => {
    const times = Array.from({ length: 24 }, (_, i) => REF + (i + 1) * 1800);
    await expect(readHarmonieFile(await nc({ times }))).rejects.toThrow(badFile);
  });

  it("turns a numeric _FillValue into null and keeps real values", async () => {
    const file = await readHarmonieFile(await nc({ fill: -9999, first: -9999 }));
    const values = hourlyValuesAt(file, { row: 0, col: 0 });
    expect([values[0], values[1]]).toEqual([null, 0]);
  });

  it("throws OUTSIDE_GRID for a non-integer cell", async () => {
    const file = await readHarmonieFile(await nc());
    expect(() => hourlyValuesAt(file, { row: 0.5, col: 0 })).toThrow(outside);
  });
});
