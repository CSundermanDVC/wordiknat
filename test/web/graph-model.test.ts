import { describe, expect, it } from "vitest";
import { buildGraphModel, nearestIndex, stepIndex, yMax } from "../../web/lib/graph-model.ts";

const pad0 = { top: 0, right: 0, bottom: 0, left: 0 };

function series(startIso: string, values: number[]) {
  const t0 = new Date(startIso).getTime();
  return values.map((mmPerHour, i) => ({ time: new Date(t0 + i * 5 * 60000), mmPerHour }));
}

describe("yMax", () => {
  it.each([
    [[0, 0, 0], 3],
    [[2], 3],
    [[2.9], 3],
    [[3], 4],
    [[10], 11],
    [[40], 41],
    [[], 3],
  ])("yMax(%j) = %i", (values, expected) => {
    expect(yMax(values)).toBe(expected);
  });
});

describe("buildGraphModel", () => {
  const size = { width: 240, height: 100, padding: pad0 };

  it("places reference lines", () => {
    const m = buildGraphModel(series("2026-07-01T10:00:00Z", [0, 1]), new Date(0), size);
    expect(m.yMax).toBe(3);
    expect(m.lines.map((l) => l.label)).toEqual(["licht", "matig", "zwaar"]);
    expect(m.lines[0].y).toBeCloseTo(91.67, 2);
    expect(m.lines[1].y).toBeCloseTo(66.67, 2);
    expect(m.lines[2].y).toBeCloseTo(16.67, 2);
  });

  it("scales lines for a larger yMax", () => {
    const m = buildGraphModel(series("2026-07-01T10:00:00Z", [0, 10]), new Date(0), size);
    expect(m.yMax).toBe(11);
    expect(m.lines[1].y).toBeCloseTo(100 - 100 / 11, 2);
  });

  it("spreads xs evenly across the padded width", () => {
    const m = buildGraphModel(
      series("2026-07-01T10:00:00Z", Array(25).fill(0)),
      new Date(0),
      { width: 240, height: 100, padding: { top: 5, right: 20, bottom: 5, left: 10 } },
    );
    expect(m.xs).toHaveLength(25);
    expect(m.xs[0]).toBe(10);
    expect(m.xs[24]).toBe(220);
    expect(m.xs[1] - m.xs[0]).toBeCloseTo(m.xs[24] - m.xs[23], 6);
  });

  it("area path starts and ends on the baseline; zero rain is flat", () => {
    const m = buildGraphModel(series("2026-07-01T10:00:00Z", [0, 0, 0]), new Date(0), size);
    expect(m.areaPath.startsWith("M0,100")).toBe(true);
    expect(m.areaPath).toMatch(/240,100 ?Z?$/);
    expect(m.ys.every((y) => y === 100)).toBe(true);
  });

  it("handles one point without NaN", () => {
    const m = buildGraphModel(series("2026-07-01T10:00:00Z", [1]), new Date(0), size);
    expect(m.xs.every(Number.isFinite)).toBe(true);
    expect(m.areaPath).not.toContain("NaN");
    expect(m.linePath).not.toContain("NaN");
  });

  it("labels :00 and :30 in Amsterdam time", () => {
    // 10:00Z = 12:00 CEST
    const m = buildGraphModel(series("2026-07-01T10:00:00Z", Array(25).fill(0)), new Date(0), size);
    expect(m.timeLabels.map((l) => l.text)).toEqual(["12:00", "12:30", "13:00", "13:30", "14:00"]);
    const m2 = buildGraphModel(series("2026-07-01T10:10:00Z", Array(25).fill(0)), new Date(0), size);
    expect(m2.timeLabels[0].text).toBe("12:30");
  });

  it("labels winter dates in Amsterdam time", () => {
    const m = buildGraphModel(series("2026-01-15T11:00:00Z", Array(25).fill(0)), new Date(0), size);
    expect(m.timeLabels[0].text).toBe("12:00");
  });

  it("interpolates nowX and nulls it outside the range", () => {
    const pts = series("2026-07-01T10:00:00Z", [0, 0, 0]);
    const mid = new Date(pts[0].time.getTime() + 2.5 * 60000);
    expect(buildGraphModel(pts, mid, size).nowX).toBeCloseTo(60, 6);
    expect(buildGraphModel(pts, new Date(pts[0].time.getTime() - 1), size).nowX).toBeNull();
    expect(buildGraphModel(pts, new Date(pts[2].time.getTime() + 1), size).nowX).toBeNull();
  });
});

describe("nearestIndex / stepIndex", () => {
  const xs = [0, 10, 20];
  it("finds the nearest", () => {
    expect(nearestIndex(10, xs)).toBe(1);
    expect(nearestIndex(14, xs)).toBe(1);
    expect(nearestIndex(16, xs)).toBe(2);
    expect(nearestIndex(-50, xs)).toBe(0);
    expect(nearestIndex(500, xs)).toBe(2);
    expect(nearestIndex(5, [])).toBe(-1);
  });
  it("steps with clamping", () => {
    expect(stepIndex(1, "ArrowRight", 3)).toBe(2);
    expect(stepIndex(2, "ArrowRight", 3)).toBe(2);
    expect(stepIndex(1, "ArrowLeft", 3)).toBe(0);
    expect(stepIndex(0, "ArrowLeft", 3)).toBe(0);
    expect(stepIndex(1, "Home", 3)).toBe(0);
    expect(stepIndex(1, "End", 3)).toBe(2);
  });
});

describe("buildGraphModel edge cases", () => {
  const size = { width: 240, height: 100, padding: pad0 };

  it("handles empty input", () => {
    const m = buildGraphModel([], new Date(0), size);
    expect(m.yMax).toBe(3);
    expect(m.xs).toEqual([]);
    expect(m.areaPath).toBe("");
    expect(m.nowX).toBeNull();
  });

  it("puts 0 mm/u on the padded baseline and yMax at the top", () => {
    const padded = { width: 240, height: 100, padding: { top: 10, right: 0, bottom: 20, left: 0 } };
    const m = buildGraphModel(series("2026-07-01T10:00:00Z", [0, 3]), new Date(0), padded);
    expect(m.ys[0]).toBe(80);
    expect(m.ys[1]).toBeCloseTo(80 - (3 / 4) * 70, 6);
  });

  it("nowX hits the exact first and last point", () => {
    const pts = series("2026-07-01T10:00:00Z", [0, 0, 0]);
    expect(buildGraphModel(pts, pts[0].time, size).nowX).toBe(0);
    expect(buildGraphModel(pts, pts[2].time, size).nowX).toBe(240);
  });

  it("formats just after midnight as 00:05", () => {
    const m = buildGraphModel(series("2026-07-01T22:00:00Z", Array(3).fill(0)), new Date(0), size);
    expect(m.timeLabels[0].text).toBe("00:00");
  });
});

describe("stepIndex edge cases", () => {
  it("is safe for length 0 and 1", () => {
    expect(stepIndex(0, "End", 0)).toBe(0);
    expect(stepIndex(0, "ArrowRight", 1)).toBe(0);
  });
});
