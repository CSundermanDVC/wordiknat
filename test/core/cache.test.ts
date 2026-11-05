import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cacheDir, getLatestFile } from "../../src/core/cache.ts";
import { WordiknatError } from "../../src/core/errors.ts";
import type { KnmiClient } from "../../src/core/knmi.ts";

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 4, 11, 5);

/** Fake client that counts listings and downloads; `name` can change between calls. */
function fakeClient(initial = "A.h5") {
  const state = { name: initial, listings: 0, downloads: [] as string[] };
  const client: KnmiClient = {
    async latestFileName() {
      state.listings += 1;
      return state.name;
    },
    async download(fileName) {
      state.downloads.push(fileName);
      return new TextEncoder().encode(`bytes of ${fileName}`);
    },
  };
  return { client, state };
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe("cacheDir", () => {
  it("uses XDG_CACHE_HOME on linux when set", () => {
    expect(cacheDir({ XDG_CACHE_HOME: "/x/cache" }, "linux", "/home/u")).toBe("/x/cache/wordiknat");
  });
  it("falls back to ~/.cache on linux", () => {
    expect(cacheDir({}, "linux", "/home/u")).toBe("/home/u/.cache/wordiknat");
    expect(cacheDir({ XDG_CACHE_HOME: "" }, "linux", "/home/u")).toBe("/home/u/.cache/wordiknat");
  });
  it("uses ~/.cache on darwin", () => {
    expect(cacheDir({}, "darwin", "/Users/u")).toBe("/Users/u/.cache/wordiknat");
  });
  it("uses LOCALAPPDATA on win32", () => {
    expect(cacheDir({ LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, "win32", "C:\\Users\\u")).toBe(
      "C:\\Users\\u\\AppData\\Local\\wordiknat",
    );
    expect(cacheDir({}, "win32", "C:\\Users\\u")).toBe("C:\\Users\\u\\AppData\\Local\\wordiknat");
  });
});

describe("getLatestFile", () => {
  let root: string;
  let dir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "wordiknat-cache-"));
    dir = join(root, "wordiknat");
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("two calls 1 minute apart do one listing and one download (DOD-0.6)", async () => {
    const { client, state } = fakeClient();
    expect(text(await getLatestFile({ client, dir, now: T0 }))).toBe("bytes of A.h5");
    expect(text(await getLatestFile({ client, dir, now: T0 + MIN }))).toBe("bytes of A.h5");
    expect(state.listings).toBe(1);
    expect(state.downloads).toEqual(["A.h5"]);
    expect(JSON.parse(await readFile(join(dir, "meta.json"), "utf8"))).toEqual({ fileName: "A.h5", downloadedAt: T0 });
    expect((await readdir(dir)).sort()).toEqual(["latest.h5", "meta.json"]);
  });

  it("after 6 minutes with an unchanged name: lists, no download, refreshes downloadedAt", async () => {
    const { client, state } = fakeClient();
    await getLatestFile({ client, dir, now: T0 });
    expect(text(await getLatestFile({ client, dir, now: T0 + 6 * MIN }))).toBe("bytes of A.h5");
    expect(state.listings).toBe(2);
    expect(state.downloads).toEqual(["A.h5"]);
    expect(JSON.parse(await readFile(join(dir, "meta.json"), "utf8")).downloadedAt).toBe(T0 + 6 * MIN);

    await getLatestFile({ client, dir, now: T0 + 7 * MIN });
    expect(state.listings).toBe(2);
  });

  it("after 6 minutes with a changed name: downloads the new file", async () => {
    const { client, state } = fakeClient();
    await getLatestFile({ client, dir, now: T0 });
    state.name = "B.h5";
    expect(text(await getLatestFile({ client, dir, now: T0 + 6 * MIN }))).toBe("bytes of B.h5");
    expect(state.downloads).toEqual(["A.h5", "B.h5"]);
    expect(text(await readFile(join(dir, "latest.h5")))).toBe("bytes of B.h5");
    expect(JSON.parse(await readFile(join(dir, "meta.json"), "utf8")).fileName).toBe("B.h5");
  });

  it.each([
    ["not JSON", "{oops"],
    ["wrong shape", JSON.stringify({ fileName: 1, downloadedAt: "x" })],
    ["null", "null"],
  ])("treats a corrupt meta.json (%s) as an empty cache", async (_label, meta) => {
    const { client, state } = fakeClient();
    await getLatestFile({ client, dir, now: T0 });
    await writeFile(join(dir, "meta.json"), meta);
    expect(text(await getLatestFile({ client, dir, now: T0 + MIN }))).toBe("bytes of A.h5");
    expect(state.downloads).toEqual(["A.h5", "A.h5"]);
  });

  it("re-downloads when latest.h5 is missing", async () => {
    const { client, state } = fakeClient();
    await getLatestFile({ client, dir, now: T0 });
    await rm(join(dir, "latest.h5"));
    await getLatestFile({ client, dir, now: T0 + MIN });
    expect(state.downloads).toEqual(["A.h5", "A.h5"]);
  });

  it("treats a downloadedAt in the future as stale", async () => {
    const { client, state } = fakeClient();
    await getLatestFile({ client, dir, now: T0 });
    await getLatestFile({ client, dir, now: T0 - MIN });
    expect(state.listings).toBe(2);
    expect(state.downloads).toEqual(["A.h5"]);
  });

  it("rethrows a listing failure even when a cached file exists", async () => {
    const { client } = fakeClient();
    await getLatestFile({ client, dir, now: T0 });
    const failing: KnmiClient = {
      ...client,
      latestFileName: () => Promise.reject(new WordiknatError("NETWORK")),
    };
    await expect(getLatestFile({ client: failing, dir, now: T0 + 6 * MIN })).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("treats exactly 5 minutes as stale and 5 minutes minus 1 ms as fresh", async () => {
    const { client, state } = fakeClient();
    await getLatestFile({ client, dir, now: T0 });
    await getLatestFile({ client, dir, now: T0 + 5 * MIN - 1 });
    expect(state.listings).toBe(1);
    await getLatestFile({ client, dir, now: T0 + 5 * MIN });
    expect(state.listings).toBe(2);
  });

  it("keeps the old cache intact when the download of a new file fails", async () => {
    const { client, state } = fakeClient();
    await getLatestFile({ client, dir, now: T0 });
    state.name = "B.h5";
    const failing: KnmiClient = { ...client, download: () => Promise.reject(new WordiknatError("NETWORK")) };
    await expect(getLatestFile({ client: failing, dir, now: T0 + 6 * MIN })).rejects.toMatchObject({ code: "NETWORK" });
    expect(text(await readFile(join(dir, "latest.h5")))).toBe("bytes of A.h5");
    expect(JSON.parse(await readFile(join(dir, "meta.json"), "utf8"))).toEqual({ fileName: "A.h5", downloadedAt: T0 });
    expect((await readdir(dir)).sort()).toEqual(["latest.h5", "meta.json"]);
  });
});
