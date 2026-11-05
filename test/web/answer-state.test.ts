import { describe, expect, it } from "vitest";
import { summarize } from "../../src/core/summary.ts";
import type { ForecastPoint } from "../../src/core/types.ts";
import { answerState, formatCountdown, heroView } from "../../web/lib/answer-state.ts";
import type { ForecastView } from "../../web/lib/api.ts";
import { formatTime } from "../../web/lib/format.ts";

// 2026-07-01 12:00 UTC = 14:00 Amsterdam (CEST)
const T0 = Date.UTC(2026, 6, 1, 12, 0);
const at = (min: number) => new Date(T0 + min * 60_000);
const series = (mm: number[]): ForecastPoint[] => mm.map((v, i) => ({ time: at(i * 5), mmPerHour: v }));
const zeros = (n: number) => Array<number>(n).fill(0);
const pad = (head: number[]) => [...head, ...zeros(25 - head.length)];
const NOW = at(0);

describe("answerState", () => {
  it("all dry", () => {
    const pts = series(zeros(25));
    const v = answerState(pts, NOW)!;
    expect(v).toMatchObject({
      state: "dry", label: "Droog", before: "Je blijft droog tot ten minste", after: "", minutes: null, intensity: null,
      detail: "Geen regen in de komende twee uur. Laat de jas maar hangen.",
      sentence: "Je blijft droog tot ten minste 16:00",
    });
    expect(v.emphasis).toBe(formatTime(summarize(pts, NOW).dryUntil!));
  });

  it("all wet, range and single class", () => {
    const range = answerState(series(Array(25).fill(0.5).map((x, i) => (i === 3 ? 1.5 : x))), NOW)!;
    expect(range).toMatchObject({
      state: "now", label: "Regen nu", emphasis: "nu", minutes: null, intensity: "matig", sentence: "Het regent nu",
      detail: "Lichte tot matige regen. De komende twee uur blijft het nat.",
    });
    const single = answerState(series(Array(25).fill(1.5)), NOW)!;
    expect(single.detail).toBe("Matige regen. De komende twee uur blijft het nat.");
    expect(answerState(series([3, 0.5, 0.5]), NOW)!.detail).toBe("Lichte tot zware regen. De komende twee uur blijft het nat.");
  });

  it("rain at the last step is soon in 2 uur, staying wet", () => {
    const v = answerState(series([...zeros(24), 0.5]), NOW)!;
    expect(v).toMatchObject({
      state: "soon", label: "Regen op komst", minutes: 120, before: "Over", emphasis: "2 uur", after: "nat",
      detail: "Lichte regen vanaf 16:00, daarna blijft het nat.", sentence: "Over 2 uur nat",
    });
  });

  it("rain ending at the first step after the current one", () => {
    const v = answerState(series(pad([1.5])), NOW)!;
    expect(v).toMatchObject({
      state: "drying", label: "Bijna droog", minutes: 5, emphasis: "5 min", after: "droog",
      detail: "Nog even matige regen, vanaf 14:05 droog.", sentence: "Over 5 min droog",
    });
    const mid = answerState(series(pad([1.5])), at(2))!;
    expect(mid.minutes).toBe(3);
    expect(mid.state).toBe("drying");
    expect(answerState(series(pad([1.5])), new Date(at(4).getTime() + 59_000))!.minutes).toBe(1);
  });

  it("the mock-up soon series at 14:05", () => {
    const mock = [0, 0, 0.2, 0.7, 1.2, 1.6, 1.9, 1.7, 1.3, 0.9, 0.5, 0.2, ...zeros(13)];
    const pts = mock.map((v, i) => ({ time: at(5 + i * 5), mmPerHour: v }));
    const v = answerState(pts, at(5))!;
    expect(v.sentence).toBe("Over 10 min nat");
    expect(v.detail).toBe("Matige bui vanaf 14:15, rond 15:05 weer droog.");
    expect(v.intensity).toBe("matig");
  });

  it("the mock-up drying series", () => {
    const pts = [1.4, 1.1, 0.8, 0.5, 0.2, ...zeros(20)].map((v, i) => ({ time: at(5 + i * 5), mmPerHour: v }));
    const v = answerState(pts, at(5))!;
    expect(v.sentence).toBe("Over 25 min droog");
    expect(v.detail).toBe("Nog even matige regen, vanaf 14:30 droog.");
  });

  it("wet-dry-wet is drying, dry-wet-dry is soon", () => {
    expect(answerState(series(pad([1.5, 0, 1.5])), NOW)!.state).toBe("drying");
    expect(answerState(series(pad([0, 1.5, 0])), NOW)!.state).toBe("soon");
  });

  it("intensity class edges and zware copy in soon and drying", () => {
    expect(answerState(series(pad([0, 2.5, 0])), NOW)!.detail).toBe("Zware bui vanaf 14:05, rond 14:10 weer droog.");
    expect(answerState(series(pad([0, 0.99, 0])), NOW)!.detail).toBe("Lichte bui vanaf 14:05, rond 14:10 weer droog.");
    expect(answerState(series(pad([0, 1, 0])), NOW)!.detail).toBe("Matige bui vanaf 14:05, rond 14:10 weer droog.");
    expect(answerState(series(pad([2.5, 0.5])), NOW)!.detail).toBe("Nog even zware regen, vanaf 14:10 droog.");
    expect(answerState(series(pad([0.5, 2.4, 0])), NOW)!.detail).toBe("Nog even matige regen, vanaf 14:10 droog.".replace("14:10", "14:10"));
  });

  it("threshold edges", () => {
    expect(answerState(series(pad([0.0999])), NOW)!.state).toBe("dry");
    expect(answerState(series(pad([0.1])), NOW)!.state).toBe("drying");
    expect(answerState(series(Array(25).fill(0.1)), NOW)!.detail).toBe("Lichte regen. De komende twee uur blijft het nat.");
  });

  it("ignores ended steps, uses the in-progress step, null after the last", () => {
    const pts = series(pad([1.5, 0, 0]));
    expect(answerState(pts, at(5))!.state).toBe("dry");
    expect(answerState(pts, at(4))!.state).toBe("drying");
    expect(answerState(pts, at(125))).toBeNull();
    expect(answerState(pts, at(119))!.state).toBe("dry");
    expect(answerState([], NOW)).toBeNull();
  });

  it("agrees with summarize", () => {
    const table = [zeros(25), Array(25).fill(1), pad([0.3]), pad([0, 0, 2.6]), [...zeros(24), 0.1], pad([0.0999, 0.1]), pad([3, 0, 3])];
    const mismatches: string[] = [];
    for (const mm of table) {
      for (const now of [at(0), at(7), at(61)]) {
        const pts = series(mm);
        const s = summarize(pts, now);
        const v = answerState(pts, now)!;
        if ((v.state === "dry") !== !s.willRain || v.intensity !== s.intensity) mismatches.push(`${mm.join()}@${now.toISOString()}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe("formatCountdown", () => {
  it.each([[1, "1 min"], [59, "59 min"], [60, "1 uur"], [61, "1 uur 1 min"], [65, "1 uur 5 min"], [120, "2 uur"]])("%i", (m, s) => {
    expect(formatCountdown(m)).toBe(s);
  });
});

describe("heroView", () => {
  const location = { name: "Utrecht", lat: 52, lon: 5 };
  const forecast = (mm: number[]): ForecastView => ({
    ...summarize(series(mm), NOW), location, issuedAt: NOW, points: series(mm), source: "x",
  } as unknown as ForecastView);

  it("empty", () => {
    expect(heroView({ location: null, forecast: null, error: null }, NOW)).toEqual({
      mode: "empty",
      caption: {
        label: "Geen plaats", before: "Waar", emphasis: "fiets", after: "je heen?",
        detail: "Kies een plaats, dan zie je meteen of je nat wordt.", sentence: "Waar fiets je heen?",
      },
    });
  });

  it("loading", () => {
    expect(heroView({ location, forecast: null, error: null }, NOW)).toEqual({
      mode: "loading",
      caption: { label: "Laden", before: "Laden…", emphasis: "", after: "", detail: "", sentence: "Laden…" },
    });
  });

  it("error, with or without a location", () => {
    for (const loc of [null, location]) {
      expect(heroView({ location: loc, forecast: null, error: "Mislukt." }, NOW)).toEqual({
        mode: "error",
        caption: { label: "Fout", before: "Mislukt.", emphasis: "", after: "", detail: "", sentence: "Mislukt." },
      });
    }
  });

  it("nodata", () => {
    expect(heroView({ location, forecast: forecast(zeros(25)), error: null }, at(130))).toEqual({
      mode: "nodata",
      caption: {
        label: "Geen verwachting", before: "Geen verwachting beschikbaar", emphasis: "", after: "", detail: "",
        sentence: "Geen verwachting beschikbaar",
      },
    });
  });

  it("state and stale", () => {
    const f = forecast(zeros(25));
    const ok = heroView({ location, forecast: f, error: null }, NOW);
    expect(ok).toMatchObject({ mode: "state", stale: false, view: { state: "dry", label: "Droog" } });
    expect(heroView({ location, forecast: f, error: "oud" }, NOW)).toMatchObject({ mode: "state", stale: true, view: { state: "dry" } });
  });
});
