import { describe, expect, it, vi } from "vitest";
import { summarize } from "../../src/core/summary.ts";
import type { ForecastPoint } from "../../src/core/types.ts";

// 2026-07-01 12:00 UTC = 14:00 Amsterdam (CEST)
const T0 = Date.UTC(2026, 6, 1, 12, 0);
const at = (min: number) => new Date(T0 + min * 60_000);
const series = (mm: number[], start = 0): ForecastPoint[] =>
  mm.map((v, i) => ({ time: at(start + i * 5), mmPerHour: v }));
const NOW = at(0);

describe("summarize sentences", () => {
  it("dry throughout", () => {
    const s = summarize(series([0, 0, 0, 0, 0]), NOW);
    expect(s.summary).toBe("Droog tot ten minste 14:20");
    expect(s).toMatchObject({ willRain: false, firstRainAt: null, maxMmPerHour: 0, intensity: null });
    expect(s.dryUntil).toEqual(at(20));
  });

  it("dry now, rain later", () => {
    const s = summarize(series([0, 0, 0.5, 1.5, 0]), NOW);
    expect(s.summary).toBe("Regen vanaf 14:10 (matig)");
    expect(s).toMatchObject({ willRain: true, maxMmPerHour: 1.5, intensity: "matig" });
    expect(s.firstRainAt).toEqual(at(10));
    expect(s.dryUntil).toEqual(at(10));
  });

  it("rain now, dry later", () => {
    const s = summarize(series([0.4, 0.4, 0, 0, 0]), NOW);
    expect(s.summary).toBe("Regen tot 14:10 (licht)");
    expect(s.firstRainAt).toEqual(at(0));
    expect(s.dryUntil).toBeNull();
  });

  it("rain in every remaining point", () => {
    const s = summarize(series([3, 0.5, 0.5]), NOW);
    expect(s.summary).toBe("Regen de komende twee uur (zwaar)");
    expect(s.willRain).toBe(true);
    expect(s.dryUntil).toBeNull();
  });

  it("no remaining points", () => {
    const s = summarize(series([1, 1]), at(60));
    expect(s).toMatchObject({ willRain: false, firstRainAt: null, dryUntil: null, maxMmPerHour: 0, intensity: null });
    expect(s.summary).toBe("Geen verwachting beschikbaar");
  });
});

describe("intensity classes", () => {
  const cls = (mm: number) => summarize(series([mm]), NOW).intensity;
  it.each([
    [0.1, "licht"], [0.24, "licht"], [0.25, "licht"], [0.99, "licht"],
    [1, "matig"], [2.49, "matig"], [2.5, "zwaar"],
  ])("%s mm/u is %s", (mm, expected) => {
    expect(cls(mm)).toBe(expected);
  });
});

describe("threshold", () => {
  it("0.09 is dry, 0.1 is rain", () => {
    expect(summarize(series([0.09]), NOW).willRain).toBe(false);
    expect(summarize(series([0.1]), NOW).willRain).toBe(true);
  });
});

describe("time handling", () => {
  it("ignores points before the step containing now", () => {
    // the +0 step (rain) is past at now=+7; +5 and +10 are dry
    const s = summarize(series([5, 0, 0, 2]), at(7));
    expect(s.summary).toBe("Regen vanaf 14:15 (matig)");
    expect(s.maxMmPerHour).toBe(2);
    // the step containing now (+5) is still used
    expect(summarize(series([0, 5, 0]), at(7)).firstRainAt).toEqual(at(5));
    // a step that ended exactly at now is dropped
    expect(summarize(series([5, 0]), at(5)).willRain).toBe(false);
  });

  it("renders Amsterdam time regardless of TZ, summer and winter", () => {
    vi.stubEnv("TZ", "UTC");
    const winter = Date.UTC(2026, 0, 15, 12, 0); // 13:00 CET
    const pts = [
      { time: new Date(winter), mmPerHour: 0 },
      { time: new Date(winter + 600_000), mmPerHour: 0 },
    ];
    expect(summarize(pts, new Date(winter)).summary).toBe("Droog tot ten minste 13:10");
    expect(summarize(series([0, 0]), NOW).summary).toBe("Droog tot ten minste 14:05");
    vi.unstubAllEnvs();
  });

  it("does not mutate the input", () => {
    const pts = series([0, 1, 0]);
    const copy = JSON.parse(JSON.stringify(pts));
    summarize(pts, NOW);
    expect(JSON.parse(JSON.stringify(pts))).toEqual(copy);
    expect(Object.isFrozen(pts)).toBe(false);
    summarize(Object.freeze(pts.map((p) => Object.freeze(p))) as ForecastPoint[], NOW);
  });
});

describe("edge cases", () => {
  it("empty input", () => {
    expect(summarize([], NOW)).toMatchObject({ summary: "Geen verwachting beschikbaar", willRain: false, intensity: null });
  });

  it("intensity is the strongest of the remaining points, also after a dry gap", () => {
    const s = summarize(series([0.3, 0, 3]), NOW);
    expect(s.summary).toBe("Regen tot 14:05 (zwaar)");
    expect(s.maxMmPerHour).toBe(3);
  });

  it("a single dry point", () => {
    expect(summarize(series([0]), NOW).summary).toBe("Droog tot ten minste 14:00");
  });
});
