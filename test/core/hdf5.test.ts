import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import h5wasm from "h5wasm/node";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { readRadarFile, valuesAt, type RadarFile } from "../../src/core/hdf5.ts";
import { cellToLatLon, latLonToCell } from "../../src/core/projection.ts";

const FIXTURE = readFileSync(fileURLToPath(new URL("../fixtures/radar-sample.h5", import.meta.url)));

describe("readRadarFile on the fixture", () => {
  let file: RadarFile;
  beforeAll(async () => {
    file = await readRadarFile(new Uint8Array(FIXTURE));
  });

  it("has 25 steps 5 minutes apart, the first at issuedAt (image1 = issue time)", () => {
    expect(file.issuedAt.toISOString()).toBe("2026-11-04T11:00:00.000Z");
    expect(file.steps).toHaveLength(25);
    file.steps.forEach((s, i) => expect(s.time.getTime()).toBe(file.issuedAt.getTime() + i * 5 * 60_000));
    expect(file.steps[24].time.toISOString()).toBe("2026-11-04T13:00:00.000Z");
  });

  it("builds the crop geometry from the file attributes", () => {
    expect(file.geometry).toEqual({
      originX: 330,
      originY: -3705,
      pixelSizeX: 1,
      pixelSizeY: -1,
      columns: 40,
      rows: 40,
      a: 6378137,
      b: 6356752,
      latTs: 60,
    });
  });

  it("calibrates a known rain cell: image1 row 0 col 19 has PV 1 = 0.01 mm/5 min = 0.12 mm/u", () => {
    expect(file.steps[0].pixels[0 * 40 + 19]).toBe(1);
    const values = valuesAt(file, { col: 19, row: 0 });
    expect(values).toHaveLength(25);
    expect(values[0]).toBeCloseTo(0.12, 10);
    for (const v of values) expect(v === 0 || Math.abs((v ?? -1) - 0.12) < 1e-9).toBe(true);
  });

  it("round-trips fixture geometry through cellToLatLon / latLonToCell", () => {
    for (const [col, row] of [[0, 0], [19, 0], [39, 39], [20, 25]]) {
      const { lat, lon } = cellToLatLon(col, row, file.geometry);
      expect(latLonToCell(lat, lon, file.geometry)).toEqual({ col, row });
    }
    // Upper-left grid corner from @geo_product_corners lies at the north-west edge of cell (0,0).
    expect(latLonToCell(55.36129379272461 - 0.002, 5.089836597442627 + 0.002, file.geometry)).toEqual({ col: 0, row: 0 });
  });

  it("returns null for nodata (65534 missing, 65535 out of image) cells", () => {
    const withNodata = (step: RadarFile["steps"][number], i: number) => {
      const pixels = Uint16Array.from(step.pixels);
      pixels[5 * 40 + 7] = i % 2 === 0 ? 65534 : 65535;
      return { ...step, pixels };
    };
    const patched: RadarFile = { ...file, steps: file.steps.map(withNodata) };
    expect(valuesAt(patched, { col: 7, row: 5 })).toEqual(Array(25).fill(null));
  });

  it("throws OUTSIDE_GRID for a cell outside the file's grid", () => {
    expect(() => valuesAt(file, { col: 40, row: 0 })).toThrow(expect.objectContaining({ code: "OUTSIDE_GRID" }));
    expect(() => valuesAt(file, { col: 0, row: -1 })).toThrow(expect.objectContaining({ code: "OUTSIDE_GRID" }));
  });
});

describe("readRadarFile on invalid input", () => {
  const badFile = expect.objectContaining({ name: "WordiknatError", code: "BAD_FILE" });

  it("throws BAD_FILE on an empty array", async () => {
    await expect(readRadarFile(new Uint8Array(0))).rejects.toThrow(badFile);
  });

  it("throws BAD_FILE on random bytes", async () => {
    const bytes = Uint8Array.from({ length: 4096 }, (_, i) => (i * 7919 + 13) % 256);
    await expect(readRadarFile(bytes)).rejects.toThrow(badFile);
  });

  it("throws BAD_FILE on a truncated HDF5 file", async () => {
    await expect(readRadarFile(new Uint8Array(FIXTURE.subarray(0, 2048)))).rejects.toThrow(badFile);
  });

  // Valid HDF5 that is not a KNMI radar file: missing groups and a wrong image count must be BAD_FILE.
  async function h5(build: (f: InstanceType<typeof h5wasm.File>) => void): Promise<Uint8Array> {
    await h5wasm.ready;
    const dir = mkdtempSync(join(tmpdir(), "wordiknat-test-"));
    try {
      const path = join(dir, "x.h5");
      const f = new h5wasm.File(path, "w");
      build(f);
      f.close();
      return new Uint8Array(readFileSync(path));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("throws BAD_FILE on valid HDF5 without the overview group", async () => {
    await expect(readRadarFile(await h5(() => {}))).rejects.toThrow(badFile);
  });

  it("throws BAD_FILE when the image count is not 25", async () => {
    const bytes = await h5((f) => {
      const o = f.create_group("overview");
      o.create_attribute("number_image_groups", 24, null, "<i");
      for (let i = 1; i <= 24; i++) f.create_group(`image${i}`);
    });
    await expect(readRadarFile(bytes)).rejects.toThrow(badFile);
  });
});
