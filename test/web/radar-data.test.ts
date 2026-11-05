import { describe, expect, it } from "vitest";
import { MAP_BBOX, packClasses, RADAR_GRID } from "../../src/core/map-grid.ts";
import { ApiError } from "../../web/lib/api.ts";
import { fetchRadar, nowIndex } from "../../web/lib/radar-data.ts";

const T0 = Date.parse("2026-01-01T10:00:00.000Z");
const MIN = 60_000;
const cells = RADAR_GRID.width * RADAR_GRID.height;
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function frame(k: number) {
  const c = new Uint8Array(cells);
  c[0] = k % 4;
  c[cells - 1] = 3;
  return b64(packClasses(c));
}

const payload = () => ({
  issuedAt: new Date(T0).toISOString(),
  source: "KNMI radar_forecast 2.0 (CC BY 4.0)",
  zoom: 7,
  bbox: MAP_BBOX,
  originX: RADAR_GRID.originX,
  originY: RADAR_GRID.originY,
  width: RADAR_GRID.width,
  height: RADAR_GRID.height,
  times: Array.from({ length: 25 }, (_, i) => new Date(T0 + i * 5 * MIN).toISOString()),
  frames: Array.from({ length: 25 }, (_, i) => frame(i)),
});

const reply = (b: unknown, status = 200) => async () =>
  new Response(typeof b === "string" ? b : JSON.stringify(b), { status });
const f = (fn: (u: string) => Promise<Response>) => ((u: string) => fn(u)) as unknown as typeof fetch;
const fails = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(ApiError);
  return e as ApiError;
};

describe("fetchRadar", () => {
  it("accepts a valid payload and unpacks 25 frames", async () => {
    let url = "";
    const r = await fetchRadar(f(async (u) => ((url = u), new Response(JSON.stringify(payload())))));
    expect(url).toBe("/api/radar");
    expect(r.issuedAt.getTime()).toBe(T0);
    expect(r.times).toHaveLength(25);
    expect(r.times[24]!.getTime()).toBe(T0 + 120 * MIN);
    expect(r.frames).toHaveLength(25);
    for (const fr of r.frames) expect(fr.length).toBe(cells);
    expect(r.frames[2]![0]).toBe(2);
    expect(r.frames[2]![cells - 1]).toBe(3);
    expect(r).toMatchObject({ zoom: 7, width: RADAR_GRID.width, height: RADAR_GRID.height, originX: RADAR_GRID.originX });
  });

  const oneByteShort = () => b64(new Uint8Array(Math.ceil(cells / 4) - 3));
  it.each([
    ["not an object", () => [1, 2]],
    ["a number", () => 42],
    ["24 frames", (b: any) => void b.frames.pop()],
    ["26 times", (b: any) => void b.times.push(b.times[0])],
    ["invalid date string", (b: any) => void (b.times[3] = "nope")],
    ["invalid issuedAt", (b: any) => void (b.issuedAt = 5)],
    ["non-base64 frame", (b: any) => void (b.frames[1] = "!".repeat(b.frames[1].length))],
    ["frame of wrong decoded length", (b: any) => void (b.frames[1] = oneByteShort())],
    ["frame with extra padding", (b: any) => void (b.frames[1] = b.frames[1].slice(0, -4) + "AA==")],
    ["width 0", (b: any) => void (b.width = 0)],
    ["width * height above 250000", (b: any) => void ((b.width = 1000), (b.height = 1000))],
    ["width not matching the grid", (b: any) => void (b.width = RADAR_GRID.width - 1)],
    ["zoom 6", (b: any) => void (b.zoom = 6)],
    ["non-integer origin", (b: any) => void (b.originX = 1.5)],
    ["string origin", (b: any) => void (b.originY = "1")],
    ["frames containing a number", (b: any) => void (b.frames[0] = 7)],
    ["frames not an array", (b: any) => void (b.frames = "x")],
  ])("rejects %s with the generic Dutch message", async (_n, mutate) => {
    const b = payload();
    const out = mutate(b) ?? b;
    const e = await fails(fetchRadar(f(reply(out))));
    expect(e.code).toBe("BAD_RESPONSE");
    expect(e.message).toMatch(/^Onverwacht antwoord/);
  });

  it("surfaces the server's Dutch error message", async () => {
    const e = await fails(fetchRadar(f(reply({ error: { code: "UPSTREAM", message: "KNMI is niet bereikbaar." } }, 500))));
    expect(e.code).toBe("UPSTREAM");
    expect(e.message).toBe("KNMI is niet bereikbaar.");
  });

  it("does not surface a non-string error message", async () => {
    const e = await fails(fetchRadar(f(reply({ error: { code: "UPSTREAM", message: { x: 1 } } }, 500))));
    expect(e.message).toMatch(/^Onverwacht antwoord/);
  });

  it("rejects a non-ok status even with a valid body", async () => {
    await fails(fetchRadar(f(reply(payload(), 500))));
  });

  it("rejects a non-JSON body", async () => {
    const e = await fails(fetchRadar(f(reply("<html>", 200))));
    expect(e.code).toBe("BAD_RESPONSE");
  });

  it("gives the Dutch network message when fetch rejects", async () => {
    const e = await fails(fetchRadar(f(async () => Promise.reject(new TypeError("Failed to fetch")))));
    expect(e.code).toBe("NETWORK");
    expect(e.message).toBe("Geen verbinding met de server. Controleer of Wordiknat draait en probeer het opnieuw.");
  });
});

describe("nowIndex", () => {
  const times = Array.from({ length: 25 }, (_, i) => new Date(T0 + i * 5 * MIN));
  it.each([
    ["before the first step", T0 - 10 * MIN, 0],
    ["in the middle of step 3", T0 + 3 * 5 * MIN + 2 * MIN, 3],
    ["exactly at a step boundary", T0 + 4 * 5 * MIN, 4],
    ["after the last step", T0 + 300 * MIN, 24],
  ])("%s", (_n, now, want) => {
    expect(nowIndex(times, new Date(now))).toBe(want);
  });

  it("returns 0 for no times", () => {
    expect(nowIndex([], new Date(T0))).toBe(0);
  });
});
