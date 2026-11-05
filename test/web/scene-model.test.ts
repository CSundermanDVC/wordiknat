import { describe, expect, it } from "vitest";
import type { ForecastPoint } from "../../src/core/types.ts";
import { answerState, heroView } from "../../web/lib/answer-state.ts";
import type { ForecastView } from "../../web/lib/api.ts";
import { sceneAtStep, sceneFor, sceneKeyOf, type SceneKey } from "../../web/lib/scene-model.ts";

const T0 = Date.UTC(2026, 6, 1, 12, 0);
const at = (min: number) => new Date(T0 + min * 60_000);
const series = (mm: number[]): ForecastPoint[] => mm.map((v, i) => ({ time: at(i * 5), mmPerHour: v }));
const zeros = (n: number) => Array<number>(n).fill(0);
const NOW = at(0);
const loc = { name: "Utrecht", lat: 52.09, lon: 5.12 };
const fc = (mm: number[]) => ({ points: series(mm) }) as unknown as ForecastView;

describe("sceneFor", () => {
  it("dry", () => {
    expect(sceneFor("dry")).toEqual({
      key: "dry", pose: "wave",
      actors: [{ kind: "sun", spot: "high-right", small: false }, { kind: "puffs", spot: "left", count: 2 }],
    });
  });
  it("soon", () => {
    expect(sceneFor("soon")).toEqual({
      key: "soon", pose: "point-up",
      actors: [{ kind: "grump", spot: "high-right", mood: "angry", drops: 0 }, { kind: "puffs", spot: "left-soon", count: 1 }],
    });
  });
  it("now", () => {
    expect(sceneFor("now")).toEqual({
      key: "now", pose: "umbrella", actors: [{ kind: "grump", spot: "over-rider", mood: "angry", drops: 7 }],
    });
  });
  it("drying", () => {
    expect(sceneFor("drying")).toEqual({
      key: "drying", pose: "closed-umbrella",
      actors: [{ kind: "sun", spot: "corner", small: true }, { kind: "grump", spot: "mid", mood: "calm", drops: 3 }],
    });
  });
  it("neutral", () => {
    expect(sceneFor("neutral")).toEqual({
      key: "neutral", pose: "head-scratch", actors: [{ kind: "puffs", spot: "left", count: 2 }],
    });
  });
  it("rain-blue rule: dry and neutral have no drops or umbrella, neutral no sun", () => {
    for (const k of ["dry", "neutral"] as const) {
      const s = sceneFor(k);
      expect(s.pose).not.toBe("umbrella");
      expect(s.actors.some((a) => a.kind === "grump" && a.drops > 0)).toBe(false);
    }
    expect(sceneFor("neutral").actors.some((a) => a.kind === "sun")).toBe(false);
  });
});

describe("sceneKeyOf", () => {
  it("maps every hero mode", () => {
    const wet = fc(Array(25).fill(1));
    expect(sceneKeyOf(heroView({ location: loc, forecast: wet, error: null }, NOW))).toBe("now");
    expect(sceneKeyOf(heroView({ location: loc, forecast: wet, error: "stale" }, NOW))).toBe("now");
    expect(sceneKeyOf(heroView({ location: loc, forecast: fc(zeros(25)), error: null }, NOW))).toBe("dry");
    expect(sceneKeyOf(heroView({ location: null, forecast: null, error: null }, NOW))).toBe("neutral");
    expect(sceneKeyOf(heroView({ location: loc, forecast: null, error: null }, NOW))).toBe("neutral");
    expect(sceneKeyOf(heroView({ location: loc, forecast: null, error: "x" }, NOW))).toBe("neutral");
    expect(sceneKeyOf(heroView({ location: loc, forecast: fc(zeros(25)), error: null }, at(300)))).toBe("neutral");
  });
});

describe("sceneAtStep", () => {
  const pts = series([...zeros(6), 1.5, 1.5, 1.5, ...zeros(16)]);
  it("current and earlier steps equal the caption state", () => {
    const want: SceneKey = answerState(pts, NOW)!.state;
    expect(sceneAtStep(pts, 0, NOW)).toBe(want);
    expect(sceneAtStep(pts, 0, at(10))).toBe(answerState(pts, at(10))!.state);
    expect(sceneAtStep(pts, 1, at(10))).toBe(answerState(pts, at(10))!.state);
  });
  it("a step inside the rain gives now or drying", () => {
    expect(["now", "drying"]).toContain(sceneAtStep(pts, 7, NOW));
    expect(sceneAtStep(pts, 6, NOW)).toBe("drying");
    expect(sceneAtStep(pts, 24, NOW)).toBe("dry");
  });
  it("last step works, out of range is null", () => {
    expect(sceneAtStep(pts, 24, NOW)).not.toBeNull();
    expect(sceneAtStep(pts, -1, NOW)).toBeNull();
    expect(sceneAtStep(pts, 25, NOW)).toBeNull();
  });
  it("null when no steps remain", () => {
    expect(sceneAtStep(pts, 0, at(300))).toBeNull();
  });
});
