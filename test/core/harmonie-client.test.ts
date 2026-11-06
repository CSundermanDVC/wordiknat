import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WordiknatError } from "../../src/core/errors.ts";
import { getForecast } from "../../src/core/forecast.ts";
import { getHourly } from "../../src/core/harmonie-client.ts";
import { SOURCE_HOURLY } from "../../src/core/types.ts";
import {
  DOWNLOAD,
  fakeFetch,
  HARMONIE_API,
  HARMONIE_DECOYS,
  HARMONIE_DOWNLOAD,
  HARMONIE_FIXTURE,
  HARMONIE_INSIDE,
  HARMONIE_NAME,
  HARMONIE_NOW,
  INSIDE,
  KEY,
  NOW,
  type Override,
} from "../helpers/fake-fetch.ts";

const MIN = 60_000;
const RADAR_SPOT = { name: "Noordzee", ...INSIDE };
const at = (ms: number) => new Date(HARMONIE_NOW.getTime() + ms);
const isListing = (url: string) => url.startsWith(`${HARMONIE_API}?`);
const notFound = () => new Response("nope", { status: 404 });

async function codeOf(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => expect.unreachable("expected a WordiknatError"),
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(WordiknatError);
  expect((err as Error).message).not.toContain(KEY);
  return (err as WordiknatError).code;
}

describe("getHourly", () => {
  let cacheDir: string;
  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "wordiknat-harmonie-"));
  });
  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  const hourly = (fetch: ReturnType<typeof fakeFetch>["fetch"], now = HARMONIE_NOW, location = HARMONIE_INSIDE) =>
    getHourly(location, { fetch, apiKey: KEY, cacheDir, now });

  it("returns 24 hours from the fixture, starting at the running hour", async () => {
    const { fetch } = fakeFetch();
    const result = await hourly(fetch);
    expect(result.location).toEqual(HARMONIE_INSIDE);
    expect(result.issuedAt.toISOString()).toBe("2026-11-06T07:00:00.000Z");
    expect(result.source).toBe(SOURCE_HOURLY);
    expect(result.hours).toHaveLength(24);
    expect(result.hours[0].time.toISOString()).toBe("2026-11-06T09:00:00.000Z");
    expect(result.hours[23].time.toISOString()).toBe("2026-11-07T08:00:00.000Z");
    expect(result.hours.every((h) => Number.isFinite(h.mmPerHour) && h.mmPerHour >= 0)).toBe(true);
  });

  it("downloads only the newest exact precipitation file, never a decoy", async () => {
    const { fetch, calls } = fakeFetch();
    await hourly(fetch);
    expect(calls).toEqual([
      `${HARMONIE_API}?maxKeys=50&orderBy=created&sorting=desc`,
      `${HARMONIE_API}/${HARMONIE_NAME}/url`,
      HARMONIE_DOWNLOAD,
    ]);
    for (const decoy of HARMONIE_DECOYS) {
      expect(calls.some((c) => c.includes(encodeURIComponent(decoy)) || c.includes(decoy))).toBe(false);
    }
  });

  it("makes no request at all for a second call within 60 minutes", async () => {
    const { fetch, calls } = fakeFetch();
    await hourly(fetch);
    const before = calls.length;
    const again = await hourly(fetch, at(59 * MIN));
    expect(calls).toHaveLength(before);
    expect(again.hours).toHaveLength(24);
  });

  it("lists again after 60 minutes but does not download the same file twice", async () => {
    const { fetch, calls } = fakeFetch();
    await hourly(fetch);
    await hourly(fetch, at(60 * MIN));
    expect(calls.filter(isListing)).toHaveLength(2);
    expect(calls.filter((c) => c === HARMONIE_DOWNLOAD)).toHaveLength(1);
  });

  it("sends the key only to the API host, never to the download host or in a URL", async () => {
    const { fetch, calls, inits } = fakeFetch();
    await hourly(fetch);
    calls.forEach((url, i) => {
      expect(url).not.toContain(KEY);
      const auth = inits[i]?.headers?.Authorization;
      expect(auth).toBe(url.startsWith("https://api.dataplatform.knmi.nl/") ? KEY : undefined);
    });
    expect(inits[calls.indexOf(HARMONIE_DOWNLOAD)]?.headers).toEqual({});
  });

  it("keeps its cache in <cacheDir>/harmonie and leaves the radar cache untouched", async () => {
    const { fetch } = fakeFetch();
    await getForecast(RADAR_SPOT, { fetch, apiKey: KEY, cacheDir, now: NOW });
    const radarBytes = await readFile(join(cacheDir, "latest.h5"));
    const radarMeta = await readFile(join(cacheDir, "meta.json"), "utf8");
    const radarMtime = (await stat(join(cacheDir, "latest.h5"))).mtimeMs;

    await hourly(fetch);

    expect((await readdir(join(cacheDir, "harmonie"))).sort()).toEqual(["latest.nc", "meta.json"]);
    expect(new Uint8Array(await readFile(join(cacheDir, "harmonie", "latest.nc")))).toEqual(HARMONIE_FIXTURE);
    expect(JSON.parse(await readFile(join(cacheDir, "harmonie", "meta.json"), "utf8")).fileName).toBe(HARMONIE_NAME);
    expect((await readdir(cacheDir)).sort()).toEqual(["harmonie", "latest.h5", "meta.json"]);
    expect(await readFile(join(cacheDir, "latest.h5"))).toEqual(radarBytes);
    expect(await readFile(join(cacheDir, "meta.json"), "utf8")).toBe(radarMeta);
    expect((await stat(join(cacheDir, "latest.h5"))).mtimeMs).toBe(radarMtime);
  });

  it.each<[string, Override]>([
    ["a listing 404", (url) => (isListing(url) ? notFound() : undefined)],
    ["a URL-endpoint 404", (url) => (url.startsWith(`${HARMONIE_API}/`) ? notFound() : undefined)],
    [
      "a listing without a matching name",
      (url) =>
        isListing(url)
          ? Response.json({ files: HARMONIE_DECOYS.filter((n) => n.includes("T08") || n.endsWith(".tmp")).map((filename) => ({ filename })) })
          : undefined,
    ],
  ])("gives HOURLY_UNAVAILABLE on %s while getForecast still answers", async (_label, override) => {
    const { fetch, calls } = fakeFetch(override);
    expect(await codeOf(hourly(fetch))).toBe("HOURLY_UNAVAILABLE");
    expect(calls).not.toContain(HARMONIE_DOWNLOAD);
    const forecast = await getForecast(RADAR_SPOT, { fetch, apiKey: KEY, cacheDir, now: NOW });
    expect(forecast.points).toHaveLength(25);
    expect(calls).toContain(DOWNLOAD);
  });

  it.each([
    [401, "INVALID_KEY"],
    [403, "INVALID_KEY"],
    [429, "RATE_LIMITED"],
  ])("keeps listing status %i as %s", async (status, expected) => {
    const { fetch } = fakeFetch((url) => (isListing(url) ? new Response("", { status }) : undefined));
    expect(await codeOf(hourly(fetch))).toBe(expected);
  });

  it("gives HOURLY_UNAVAILABLE when fewer than 24 hours of the run remain", async () => {
    const { fetch } = fakeFetch();
    // The run ends at 2026-11-08T19:00Z; from 2026-11-07T20:00Z on only 23 hours are left.
    expect(await codeOf(hourly(fetch, new Date("2026-11-07T20:00:00Z")))).toBe("HOURLY_UNAVAILABLE");
    expect((await hourly(fetch, new Date("2026-11-07T19:59:00Z"))).hours).toHaveLength(24);
  });

  it("gives NO_DATA when a selected hour has no data", async () => {
    const { fetch } = fakeFetch();
    // Crop cell (0, 0) is NaN in the hour 07:00-08:00Z; selected only while that hour is running.
    const nanCell = { name: "Hoek", lat: 52.024, lon: 5.017 };
    expect(await codeOf(hourly(fetch, new Date("2026-11-06T07:30:00Z"), nanCell))).toBe("NO_DATA");
    expect((await hourly(fetch, HARMONIE_NOW, nanCell)).hours).toHaveLength(24);
  });

  it.each<[string, unknown]>([
    ["a listing entry without filename", { files: [{ name: "x" }] }],
    ["a listing without files", {}],
  ])("gives SOURCE_HTTP on %s", async (_label, body) => {
    const { fetch, calls } = fakeFetch((url) => (isListing(url) ? Response.json(body) : undefined));
    expect(await codeOf(hourly(fetch))).toBe("SOURCE_HTTP");
    expect(calls).not.toContain(HARMONIE_DOWNLOAD);
  });
});
