import { describe, expect, it } from "vitest";
import type { HourlyView } from "../../web/lib/api.ts";
import { buildHourlyModel, selectHour } from "../../web/lib/hourly.ts";

const HOUR = 3_600_000;
// 2026-11-06 is CET (UTC+1, no DST change that day): now 14:05 local, first bar is the 14:00 hour.
const NOW = new Date("2026-11-06T13:05:00Z");
const T0 = Date.UTC(2026, 10, 6, 13);

function view(values: number[]): HourlyView {
  return {
    summary: "Regen vanaf 17:00 (zwaar)",
    willRain: true,
    firstRainAt: null,
    dryUntil: null,
    maxMmPerHour: Math.max(0, ...values),
    intensity: "zwaar",
    location: { name: "Utrecht", lat: 52.09, lon: 5.1 },
    issuedAt: new Date(T0),
    hours: values.map((mmPerHour, i) => ({ time: new Date(T0 + i * HOUR), mmPerHour })),
    source: "KNMI HARMONIE-model uwcw-ha-det-nl-s1 1.0 (CC BY 4.0)",
  };
}
const pad = (vals: number[]) => [...vals, ...Array(24 - vals.length).fill(0)];

describe("buildHourlyModel scale", () => {
  it.each([
    [[0], 3],
    [[2.9], 3],
    [[3], 4],
    [[10], 11],
  ])("y-scale for max %j is %i", (vals, max) => {
    expect(buildHourlyModel(view(pad(vals)), NOW).yMax).toBe(max);
  });

  it("puts the matig and zwaar reference lines at their share of the scale", () => {
    expect(buildHourlyModel(view(pad([0])), NOW).refs).toEqual([
      { label: "matig 1", pct: (1 / 3) * 100 },
      { label: "zwaar 2,5", pct: (2.5 / 3) * 100 },
    ]);
  });

  it("keeps the summary from the server", () => {
    expect(buildHourlyModel(view(pad([0])), NOW).summary).toBe("Regen vanaf 17:00 (zwaar)");
  });
});

describe("buildHourlyModel bars", () => {
  it.each([
    [0, null],
    [0.09, null],
    [0.1, "licht"],
    [0.99, "licht"],
    [1, "matig"],
    [2.49, "matig"],
    [2.5, "zwaar"],
    [8, "zwaar"],
  ])("%d mm is class %s", (mm, cls) => {
    expect(buildHourlyModel(view(pad([mm])), NOW).hours[0]!.cls).toBe(cls);
  });

  it("scales wet bars linearly from zero and gives dry hours no height", () => {
    const m = buildHourlyModel(view(pad([0, 0.09, 0.1, 1.5, 6])), NOW);
    expect(m.yMax).toBe(7);
    expect(m.hours.slice(0, 5).map((h) => h.heightPct)).toEqual([0, 0, (0.1 / 7) * 100, (1.5 / 7) * 100, (6 / 7) * 100]);
    expect(m.hours).toHaveLength(24);
  });
});

describe("buildHourlyModel labels", () => {
  const m = buildHourlyModel(view(pad([0.8])), NOW);

  it("labels hours in Europe/Amsterdam and wraps past midnight with morgen", () => {
    expect(m.hours.map((h) => h.time)).toEqual([
      ...Array.from({ length: 10 }, (_, i) => `${14 + i}:00`),
      ...Array.from({ length: 14 }, (_, i) => `morgen ${String(i).padStart(2, "0")}:00`),
    ]);
  });

  it("ticks every 3 hours from the current hour, marking every 6th", () => {
    expect(m.ticks).toEqual([
      { index: 0, text: "14:00", every6: true },
      { index: 3, text: "17:00", every6: false },
      { index: 6, text: "20:00", every6: true },
      { index: 9, text: "23:00", every6: false },
      { index: 12, text: "02:00", every6: true },
      { index: 15, text: "05:00", every6: false },
      { index: 18, text: "08:00", every6: true },
      { index: 21, text: "11:00", every6: false },
    ]);
  });

  it("uses the Amsterdam date for morgen, not the UTC date", () => {
    // 23:30 UTC on the 6th is already 00:30 on the 7th in Amsterdam: the 00:00 hour is today.
    const late = new Date("2026-11-06T23:30:00Z");
    const v = { ...view(pad([])), hours: [0, 1].map((i) => ({ time: new Date(Date.UTC(2026, 10, 6, 23) + i * HOUR), mmPerHour: 0 })) };
    expect(buildHourlyModel(v, late).hours.map((h) => h.time)).toEqual(["00:00", "01:00"]);
  });
});

describe("buildHourlyModel strings", () => {
  const m = buildHourlyModel(view(pad([0.8, 0, 0.06, 2.5, ...Array(7).fill(0), 0.4])), NOW);

  it("formats the readout and amounts like Wanneer", () => {
    expect(m.hours[0]).toMatchObject({ time: "14:00", amount: "0,8 mm", valueText: "14:00, 0,8 mm" });
    expect(m.hours[1]!.amount).toBe("0 mm");
    expect(m.hours[2]!.amount).toBe("0,06 mm");
    expect(m.hours[3]!.amount).toBe("2,5 mm");
  });

  it("never shows a dry hour as 0,1 mm or more", () => {
    const dry = buildHourlyModel(view(pad([0.096, 0.0999])), NOW);
    expect(dry.hours[0]!.amount).toBe("0,09 mm");
    expect(dry.hours[1]!.amount).toBe("0,09 mm");
  });

  it("says morgen in the readout and value text after midnight", () => {
    expect(m.hours[11]).toMatchObject({ time: "morgen 01:00", amount: "0,4 mm", valueText: "morgen 01:00, 0,4 mm" });
  });
});

describe("selectHour", () => {
  it.each([
    [0, 5, 24, 5],
    [5, -1, 24, 0],
    [5, 30, 24, 23],
    [5, 23, 24, 23],
    [5, 2.6, 24, 3],
    [5, Number.NaN, 24, 5],
    [0, 3, 0, 0],
  ])("selectHour(%d, %d, %d) = %d", (current, next, length, expected) => {
    expect(selectHour(current, next, length)).toBe(expected);
  });

  it("returns the current index unchanged so the caller can skip a redraw", () => {
    expect(selectHour(7, 7, 24)).toBe(7);
    expect(selectHour(23, 99, 24)).toBe(23);
  });
});
