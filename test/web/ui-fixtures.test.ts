import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFixtures, FIXTURE_NOW, HOURLY_STATES, STATES } from "../../scripts/ui-fixtures.ts";
import { answerState, heroView } from "../../web/lib/answer-state.ts";
import { ApiError, fetchForecast, fetchHourly, searchPlaces } from "../../web/lib/api.ts";
import { fetchRadar } from "../../web/lib/radar-data.ts";
import { sceneKeyOf } from "../../web/lib/scene-model.ts";

const files = buildFixtures();
const text = (name: string) => {
  const f = files[name];
  if (typeof f !== "string") throw new Error(`no text fixture ${name}`);
  return f;
};
// Each payload goes through the page's own boundary parser, so a fixture the page would reject fails here.
const serve = (body: string) => (async () => new Response(body, { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
const forecast = (name: string) => fetchForecast({ lat: 52, lon: 5 }, serve(text(`forecast-${name}.json`)));

describe("ui fixtures (prompt 4.8)", () => {
  it.each(STATES)("forecast-%s.json maps to state and scene %s at the fixed now", async (state) => {
    const f = await forecast(state);
    expect(f.points).toHaveLength(25);
    expect(answerState(f.points, FIXTURE_NOW)?.state).toBe(state);
    expect(sceneKeyOf(heroView({ location: f.location, forecast: f, error: null }, FIXTURE_NOW))).toBe(state);
  });

  it("matches the mock-up captions (10 min nat, 25 min droog)", async () => {
    expect(answerState((await forecast("soon")).points, FIXTURE_NOW)?.emphasis).toBe("10 min");
    expect(answerState((await forecast("drying")).points, FIXTURE_NOW)?.emphasis).toBe("25 min");
  });

  it("forecast-nodata.json has no remaining steps: nodata mode, neutral scene", async () => {
    const f = await forecast("nodata");
    expect(answerState(f.points, FIXTURE_NOW)).toBeNull();
    const view = heroView({ location: f.location, forecast: f, error: null }, FIXTURE_NOW);
    expect(view.mode).toBe("nodata");
    expect(sceneKeyOf(view)).toBe("neutral");
  });

  it.each(STATES)("radar-%s.json is accepted by the page; rain only in wet states, on the forecast's times", async (state) => {
    const r = await fetchRadar(serve(text(`radar-${state}.json`)));
    const f = await forecast(state);
    expect(r.times.map((t) => t.getTime())).toEqual(f.points.map((p) => p.time.getTime()));
    const wet = r.frames.map((fr) => fr.some((c) => c > 0));
    expect(wet).toEqual(f.points.map((p) => p.mmPerHour >= 0.1));
  });

  const SENTENCE = { dry: "Droog de komende 24 uur", later: "Regen vanaf 21:00 (zwaar)", now: "Regen tot 17:00 (matig)" } as const;
  it.each(HOURLY_STATES)("hourly-%s.json passes the page's guard with the expected sentence", async (state) => {
    const h = await fetchHourly({ lat: 52, lon: 5 }, serve(text(`hourly-${state}.json`)));
    expect(h.hours).toHaveLength(24);
    expect(h.summary).toBe(SENTENCE[state]);
    expect(h.hours[0]!.time.getTime()).toBeLessThanOrEqual(FIXTURE_NOW.getTime());
  });

  it("hourly-unavailable.json is the HOURLY_UNAVAILABLE error body, with the two-hour fallback hint", async () => {
    const body = JSON.parse(text("hourly-unavailable.json"));
    expect(body.error.code).toBe("HOURLY_UNAVAILABLE");
    const res = (async () => new Response(JSON.stringify(body), { status: 502 })) as unknown as typeof fetch;
    const err = await fetchHourly({ lat: 52, lon: 5 }, res).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toContain("komende twee uur werkt nog wel");
  });

  it("places.json is a valid geocode answer and the tile is a PNG", async () => {
    const places = await searchPlaces("Utr", serve(text("places.json")));
    expect(places.length).toBeGreaterThan(0);
    const tile = files["tile.png"];
    expect(tile).toBeInstanceOf(Uint8Array);
    expect([...(tile as Uint8Array).slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it("is pure: the same now gives the same files", () => {
    expect(buildFixtures()).toEqual(files);
  });

  it("the CLI writes every fixture into the given directory and nothing else", () => {
    const dir = mkdtempSync(join(tmpdir(), "ui-fixtures-"));
    try {
      execFileSync("node", ["scripts/ui-fixtures.ts", join(dir, "out")], { env: { PATH: process.env.PATH ?? "" } });
      expect(readdirSync(join(dir, "out")).sort()).toEqual(Object.keys(files).sort());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the CLI refuses to run without an output directory", () => {
    expect(() => execFileSync("node", ["scripts/ui-fixtures.ts"], { stdio: "pipe" })).toThrow();
  });
});
