import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The fixture has no nodata cells, so the reader is stubbed to return one.
vi.mock("../../src/core/cache.ts", () => ({ getLatestFile: async () => new Uint8Array() }));
vi.mock("../../src/core/hdf5.ts", () => ({
  readRadarFile: async () => ({
    geometry: (await import("../../src/core/projection.ts")).KNMI_RADAR_GEOMETRY,
    issuedAt: new Date("2026-11-04T11:00:00Z"),
    steps: [{ time: new Date("2026-11-04T11:00:00Z") }, { time: new Date("2026-11-04T11:05:00Z") }],
  }),
  valuesAt: () => [0.1, null],
}));

import { getForecast } from "../../src/core/forecast.ts";

describe("getForecast nodata", () => {
  let cacheDir: string;
  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "wordiknat-nodata-"));
  });
  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("gives NO_DATA when any value at the cell is null", async () => {
    const fetch = async () => new Response("nope", { status: 404 });
    await expect(
      getForecast({ name: "x", lat: 52.37, lon: 4.9 }, { fetch, apiKey: "k", cacheDir, now: new Date() }),
    ).rejects.toMatchObject({ code: "NO_DATA" });
  });
});
