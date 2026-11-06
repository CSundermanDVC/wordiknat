import { describe, expect, it } from "vitest";
import { selectHours, summarizeHourly } from "../../src/core/hourly-summary.ts";
import type { ForecastPoint } from "../../src/core/types.ts";

const H = 3_600_000;
// 2026-07-01 12:00 UTC = 14:00 Amsterdam (CEST)
const T0 = Date.UTC(2026, 6, 1, 12, 0);
const hour = (i: number) => new Date(T0 + i * H);
const series = (mm: number[], start = 0): ForecastPoint[] =>
  mm.map((v, i) => ({ time: hour(start + i), mmPerHour: v }));
const dry = (n: number) => new Array<number>(n).fill(0);

describe("selectHours", () => {
  const points = series(dry(48));
  it("starts at the running hour", () => {
    const got = selectHours(points, new Date(T0 + 30 * 60_000));
    expect(got).toHaveLength(24);
    expect(got[0]!.time).toEqual(hour(0));
  });
  it("skips hours that have passed", () => {
    const got = selectHours(points, new Date(T0 + 2 * H + 10 * 60_000));
    expect(got[0]!.time).toEqual(hour(2));
    expect(got).toHaveLength(24);
  });
  it("treats an hour boundary as the end of the previous hour", () => {
    expect(selectHours(points, hour(1))[0]!.time).toEqual(hour(1));
  });
  it("returns fewer points when the run is too short", () => {
    expect(selectHours(series(dry(10)), hour(4))).toHaveLength(6);
    expect(selectHours(series(dry(3)), hour(5))).toEqual([]);
  });
  it("honours count", () => {
    expect(selectHours(points, hour(0), 3)).toHaveLength(3);
  });
});

describe("summarizeHourly", () => {
  const now = new Date(T0 + 10 * 60_000);
  it("dry throughout", () => {
    const s = summarizeHourly(series(dry(24)), now);
    expect(s.summary).toBe("Droog de komende 24 uur");
    expect(s).toMatchObject({ willRain: false, firstRainAt: null, maxMmPerHour: 0, intensity: null });
  });
  it("rain later", () => {
    const s = summarizeHourly(series([0, 0, 0.5, 0]), now);
    expect(s.summary).toBe("Regen vanaf 16:00 (licht)");
    expect(s.firstRainAt).toEqual(hour(2));
    expect(s.dryUntil).toEqual(hour(2));
  });
  it("rain now, dry later", () => {
    const s = summarizeHourly(series([0.4, 0.4, 0, 0]), now);
    expect(s.summary).toBe("Regen tot 16:00 (licht)");
    expect(s.firstRainAt).toEqual(hour(0));
  });
  it("rain throughout", () => {
    expect(summarizeHourly(series([0.4, 0.4]), now).summary).toBe("Regen de komende 24 uur (licht)");
  });
  it("empty list", () => {
    expect(summarizeHourly([], now)).toMatchObject({ summary: "Geen verwachting beschikbaar", willRain: false, intensity: null });
  });
  it("classifies at the boundaries", () => {
    const i = (mm: number) => summarizeHourly(series([mm]), now).intensity;
    expect(i(0.1)).toBe("licht");
    expect(i(0.99)).toBe("licht");
    expect(i(1)).toBe("matig");
    expect(i(2.49)).toBe("matig");
    expect(i(2.5)).toBe("zwaar");
    expect(i(0.09)).toBeNull();
  });
  it("uses the maximum for intensity", () => {
    expect(summarizeHourly(series([0.2, 3, 0.2]), now).intensity).toBe("zwaar");
  });
});
