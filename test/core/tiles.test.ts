import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WordiknatError } from "../../src/core/errors.ts";
import { TILE_ZOOMS, tileRange } from "../../src/core/map-grid.ts";
import { getTile, parseTile, tileUrl } from "../../src/core/tiles.ts";

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG = Uint8Array.from([...SIG, 1, 2, 3, 4]);
const R8 = tileRange(8);
const OK = { z: 8, x: R8.x0, y: R8.y0 };
const SENTINEL = "SENTINEL-xyz";

function expectBadArgs(fn: () => unknown, ...inputs: unknown[]) {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(WordiknatError);
  expect((err as WordiknatError).code).toBe("BAD_ARGS");
  expect((err as WordiknatError).message).toBe("Ongeldige kaarttegel.");
  for (const i of inputs) if (typeof i === "string" && i !== "") expect((err as Error).message).not.toContain(i);
}

describe("parseTile", () => {
  it("accepts in-range digit strings and numbers for every allowed zoom", () => {
    for (const z of TILE_ZOOMS) {
      const r = tileRange(z);
      expect(parseTile(String(z), String(r.x0), String(r.y1))).toEqual({ z, x: r.x0, y: r.y1 });
      expect(parseTile(z, r.x1, r.y0)).toEqual({ z, x: r.x1, y: r.y0 });
    }
    expect(parseTile("8", "130", "84")).toEqual({ z: 8, x: 130, y: 84 });
  });

  it.each([
    ["fraction", 1.5],
    ["exponent string", "1e1"],
    ["negative string", "-1"],
    ["empty string", ""],
    ["leading space", " 8"],
    ["leading zero (rejected)", "08"],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["null", null],
    ["undefined", undefined],
    ["array", []],
    ["slash", "8/1"],
    ["traversal", "../8"],
    ["3-digit z", "100"],
    ["sentinel", SENTINEL],
  ])("rejects z = %s", (_, z) => {
    expectBadArgs(() => parseTile(z, OK.x, OK.y), z);
  });

  it.each([
    ["fraction", 130.5],
    ["exponent string", "1e2"],
    ["negative", -1],
    ["7-digit", "1300000"],
    ["leading zero (rejected)", "0130"],
    ["traversal", "../130"],
    ["trailing newline", "130\n"],
    ["sentinel", SENTINEL],
  ])("rejects x = %s and the same as y", (_, v) => {
    expectBadArgs(() => parseTile(OK.z, v, OK.y), v);
    expectBadArgs(() => parseTile(OK.z, OK.x, v), v);
  });

  it("rejects zooms outside TILE_ZOOMS and x, y outside the box", () => {
    for (const z of [0, 7, 11, 20]) expectBadArgs(() => parseTile(z, OK.x, OK.y));
    expectBadArgs(() => parseTile(8, R8.x0 - 1, R8.y0));
    expectBadArgs(() => parseTile(8, R8.x1 + 1, R8.y0));
    expectBadArgs(() => parseTile(8, R8.x0, R8.y0 - 1));
    expectBadArgs(() => parseTile(8, R8.x0, R8.y1 + 1));
  });
});

describe("tileUrl", () => {
  it("builds the exact PDOK URL with a zero-padded zoom", () => {
    expect(tileUrl({ z: 8, x: 130, y: 84 })).toBe(
      "https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/grijs/EPSG:3857/08/130/84.png",
    );
    expect(new URL(tileUrl({ z: 10, x: 526, y: 337 })).host).toBe("service.pdok.nl");
  });
});

type Reply = { status?: number; type?: string; body?: Uint8Array<ArrayBuffer> } | Error;

/** Fake fetch that records calls and answers from a queue (last reply repeats). */
function fakeFetch(...replies: Reply[]) {
  const calls: { url: string; init: unknown }[] = [];
  const fetch = async (url: string, init?: { redirect: "error" }) => {
    calls.push({ url, init });
    const r = replies.length > 1 ? replies.shift()! : replies[0];
    if (r instanceof Error) throw r;
    return new Response(r.body ?? PNG, { status: r.status ?? 200, headers: { "content-type": r.type ?? "image/png" } });
  };
  return { fetch, calls };
}

async function listFiles(dir: string): Promise<string[]> {
  return (await readdir(dir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
}

describe("getTile", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "wordiknat-tiles-"));
  });
  afterEach(async () => {
    expect((await listFiles(dir)).every((f) => f.startsWith(join(dir, "tiles") + "/"))).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  const path = (t = OK) => join(dir, "tiles", String(t.z), String(t.x), `${t.y}.png`);

  it("fetches once with redirect: error and no headers, then serves from disk", async () => {
    const { fetch, calls } = fakeFetch({});
    expect(await getTile(OK, { fetch, dir })).toEqual(PNG);
    expect(calls).toEqual([{ url: tileUrl(OK), init: { redirect: "error" } }]);
    expect(new Uint8Array(await readFile(path()))).toEqual(PNG);

    expect(await getTile({ ...OK }, { fetch, dir })).toEqual(PNG);
    expect(calls).toHaveLength(1);
  });

  it("shares one upstream call between concurrent requests", async () => {
    const { fetch, calls } = fakeFetch({});
    const [a, b] = await Promise.all([getTile(OK, { fetch, dir }), getTile(OK, { fetch, dir })]);
    expect(a).toEqual(PNG);
    expect(b).toEqual(PNG);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["../8", OK.x, OK.y],
    [8, "../../etc", OK.y],
    [11, 526, 337],
    [8, R8.x1 + 1, OK.y],
  ])("rejects invalid tile %s/%s/%s before any fetch or file access", async (z, x, y) => {
    const { fetch, calls } = fakeFetch({});
    await expect(getTile({ z, x, y }, { fetch, dir })).rejects.toMatchObject({ code: "BAD_ARGS" });
    expect(calls).toHaveLength(0);
    expect(await readdir(dir)).toEqual([]);
  });

  it.each<[string, Reply]>([
    ["status 404", { status: 404 }],
    ["status 500", { status: 500 }],
    ["text/html", { type: "text/html" }],
    ["image/jpeg", { type: "image/jpeg" }],
    ["no PNG signature", { body: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]) }],
    ["600 000-byte body", { body: Uint8Array.from({ length: 600_000 }, (_, i) => (i < 8 ? SIG[i] : 0)) }],
    ["fetch throws", new TypeError("fetch failed")],
  ])("%s gives TILE_UNAVAILABLE, caches nothing, and a later good reply succeeds", async (_, bad) => {
    const { fetch, calls } = fakeFetch(bad, {});
    await expect(getTile(OK, { fetch, dir })).rejects.toMatchObject({ code: "TILE_UNAVAILABLE", exitCode: 1 });
    expect(await listFiles(dir)).toEqual([]);
    expect(await getTile(OK, { fetch, dir })).toEqual(PNG);
    expect(calls).toHaveLength(2);
  });

  it("accepts a body of exactly 524 288 bytes", async () => {
    const body = Uint8Array.from({ length: 524_288 }, (_, i) => (i < 8 ? SIG[i] : 0));
    const { fetch } = fakeFetch({ body });
    expect((await getTile(OK, { fetch, dir })).length).toBe(524_288);
  });

  it("refetches a corrupt cached file", async () => {
    await mkdir(join(dir, "tiles", "8", String(OK.x)), { recursive: true });
    await writeFile(path(), "not a png");
    const { fetch, calls } = fakeFetch({});
    expect(await getTile(OK, { fetch, dir })).toEqual(PNG);
    expect(calls).toHaveLength(1);
    expect(new Uint8Array(await readFile(path()))).toEqual(PNG);
  });

  it("shares a failed upstream call between concurrent requests, then recovers", async () => {
    const { fetch, calls } = fakeFetch({ status: 500 }, {});
    const r = await Promise.allSettled([getTile(OK, { fetch, dir }), getTile(OK, { fetch, dir })]);
    expect(r.map((x) => x.status)).toEqual(["rejected", "rejected"]);
    expect(calls).toHaveLength(1);
    expect(await getTile(OK, { fetch, dir })).toEqual(PNG);
  });

  it("uses the static Dutch TILE_UNAVAILABLE message", async () => {
    const { fetch } = fakeFetch({ status: 404 });
    await expect(getTile(OK, { fetch, dir })).rejects.toThrow("De kaartondergrond is nu niet beschikbaar.");
  });
});

describe("tiles.ts source (DOD-2.4.3)", () => {
  it("does not touch env.ts or the KNMI key", () => {
    const src = readFileSync(new URL("../../src/core/tiles.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/env\.ts|KNMI_API_KEY|process\.env/);
  });
});
