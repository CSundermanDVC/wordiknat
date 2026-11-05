import { describe, expect, it } from "vitest";
import { ApiError, fetchForecast, searchPlaces } from "../../web/lib/api.ts";

const body = () => ({
  summary: "Droog",
  willRain: false,
  firstRainAt: null,
  dryUntil: null,
  maxMmPerHour: 0,
  location: { name: "Utrecht", lat: 52.09, lon: 5.1 },
  issuedAt: "2026-01-01T10:00:00.000Z",
  points: [{ time: "2026-01-01T10:05:00.000Z", mmPerHour: 0.4 }],
  source: "KNMI radar_forecast 2.0 (CC BY 4.0)",
});
const reply = (b: unknown, status = 200) => async () =>
  new Response(typeof b === "string" ? b : JSON.stringify(b), { status });
const f = (fn: (u: string) => Promise<Response>) => ((u: string) => fn(u)) as unknown as typeof fetch;
const fails = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(ApiError);
  return e as ApiError;
};

describe("fetchForecast", () => {
  it("parses dates and numbers", async () => {
    const r = await fetchForecast({ lat: 52.09, lon: 5.1 }, f(reply(body())));
    expect(r.issuedAt).toBeInstanceOf(Date);
    expect(r.points[0]!.time).toBeInstanceOf(Date);
    expect(r.points[0]!.mmPerHour).toBe(0.4);
    expect(r.firstRainAt).toBeNull();
  });

  it.each([
    ["missing points", (b: any) => delete b.points],
    ["non-numeric mm", (b: any) => (b.points[0].mmPerHour = "1")],
    ["bad date", (b: any) => (b.issuedAt = "nope")],
    ["bad point date", (b: any) => (b.points[0].time = "nope")],
    ["willRain type", (b: any) => (b.willRain = "no")],
    ["too many points", (b: any) => (b.points = Array(26).fill(b.points[0]))],
  ])("rejects %s", async (_n, mutate) => {
    const b = body();
    mutate(b);
    await fails(fetchForecast({ lat: 1, lon: 2 }, f(reply(b))));
  });

  it("maps server error body", async () => {
    const e = await fails(
      fetchForecast({ lat: 1, lon: 2 }, f(reply({ error: { code: "OUTSIDE_GRID", message: "Buiten" } }, 400))),
    );
    expect([e.code, e.message]).toEqual(["OUTSIDE_GRID", "Buiten"]);
  });

  it("uses generic Dutch errors without echoing text", async () => {
    const a = await fails(fetchForecast({ lat: 1, lon: 2 }, f(reply("<secret>boom", 500))));
    expect(a.message).not.toContain("secret");
    const n = await fails(fetchForecast({ lat: 1, lon: 2 }, f(() => Promise.reject(new Error("secret")))));
    expect(n.message).not.toContain("secret");
    expect(n.message).toMatch(/verbinding/);
  });

  it("requests relative, encoded URLs", async () => {
    const urls: string[] = [];
    const spy = f(async (u) => (urls.push(u), new Response(JSON.stringify(body()))));
    await fetchForecast({ lat: 52.09, lon: 5.1 }, spy);
    await fetchForecast({ q: "Den Haag/&" }, spy);
    expect(urls).toEqual(["/api/forecast?lat=52.09&lon=5.1", "/api/forecast?q=Den%20Haag%2F%26"]);
  });
});

describe("searchPlaces", () => {
  it("returns valid places", async () => {
    const r = await searchPlaces("u", f(reply({ results: [{ name: "Utrecht", lat: 52, lon: 5 }] })));
    expect(r).toEqual([{ name: "Utrecht", lat: 52, lon: 5 }]);
  });
  it.each([{ lat: 52, lon: 5 }, { name: "x", lat: null, lon: 5 }, { name: "x", lat: 52, lon: Infinity }])(
    "rejects %j",
    async (bad) => {
      await fails(searchPlaces("u", f(reply({ results: [bad] }))));
    },
  );
});

describe("fetchForecast edge cases", () => {
  it("parses non-null firstRainAt and dryUntil into Dates", async () => {
    const b = { ...body(), willRain: true, firstRainAt: "2026-01-01T10:20:00.000Z", dryUntil: "2026-01-01T10:15:00.000Z" };
    const r = await fetchForecast({ lat: 1, lon: 2 }, f(reply(b)));
    expect(r.firstRainAt).toEqual(new Date("2026-01-01T10:20:00.000Z"));
    expect(r.dryUntil).toBeInstanceOf(Date);
  });

  it.each([
    ["bad firstRainAt", (b: any) => (b.firstRainAt = "nope")],
    ["bad dryUntil", (b: any) => (b.dryUntil = 5)],
    ["missing location", (b: any) => delete b.location],
    ["location without name", (b: any) => (b.location.name = "")],
    ["non-string source", (b: any) => (b.source = 1)],
    ["point not object", (b: any) => (b.points = [null])],
  ])("rejects %s", async (_n, mutate) => {
    const b = body();
    mutate(b);
    await fails(fetchForecast({ lat: 1, lon: 2 }, f(reply(b))));
  });

  it("accepts exactly 25 points", async () => {
    const b = body();
    b.points = Array(25).fill(b.points[0]!);
    expect((await fetchForecast({ lat: 1, lon: 2 }, f(reply(b)))).points).toHaveLength(25);
  });

  it("rejects a non-ok response without error body and malformed error body", async () => {
    await fails(fetchForecast({ lat: 1, lon: 2 }, f(reply(body(), 500))));
    const e = await fails(fetchForecast({ lat: 1, lon: 2 }, f(reply({ error: { code: 1 } }, 400))));
    expect(e.code).toBe("BAD_RESPONSE");
  });
});

describe("searchPlaces edge cases", () => {
  it("rejects missing results and encodes q", async () => {
    await fails(searchPlaces("u", f(reply({}))));
    const urls: string[] = [];
    await searchPlaces("a b&", f(async (u) => (urls.push(u), new Response(JSON.stringify({ results: [] })))));
    expect(urls).toEqual(["/api/geocode?q=a%20b%26"]);
  });
});
