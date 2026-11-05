import { describe, expect, it, vi } from "vitest";
import { WordiknatError, type ErrorCode } from "../../src/core/errors.ts";
import { searchPlaces } from "../../src/core/geocode.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const docs = (d: unknown[]) => ({ response: { numFound: d.length, docs: d } });
const UTRECHT = { weergavenaam: "Utrecht, Utrecht", centroide_ll: "POINT(5.10448 52.09126)" };
const UITHOORN = { weergavenaam: "Uithoorn, Uithoorn", centroide_ll: "POINT(4.82 52.24)" };

function fakeFetch(...replies: Array<Response | (() => never)>) {
  return vi.fn(async (_url: string) => {
    const r = replies.shift();
    if (!r) throw new Error("unexpected fetch");
    return typeof r === "function" ? r() : r;
  });
}

async function codeOf(p: Promise<unknown>): Promise<ErrorCode> {
  const err = await p.then(() => undefined, (e: unknown) => e);
  expect(err).toBeInstanceOf(WordiknatError);
  return (err as WordiknatError).code;
}

describe("searchPlaces (US-010)", () => {
  it("returns every doc as a Location in order and queries only PDOK woonplaatsen", async () => {
    const fetch = fakeFetch(json(docs([UTRECHT, UITHOORN])));
    await expect(searchPlaces("  U ", { fetch })).resolves.toEqual([
      { name: "Utrecht, Utrecht", lat: 52.09126, lon: 5.10448 },
      { name: "Uithoorn, Uithoorn", lat: 52.24, lon: 4.82 },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.host).toBe("api.pdok.nl");
    expect(url.origin + url.pathname).toBe("https://api.pdok.nl/bzk/locatieserver/search/v3_1/free");
    expect(url.searchParams.get("q")).toBe("U");
    expect(url.searchParams.get("fq")).toBe("type:woonplaats");
    expect(url.searchParams.get("rows")).toBe("5");
  });

  it("returns [] without a suggest call when there are no docs", async () => {
    const fetch = fakeFetch(json(docs([])));
    await expect(searchPlaces("Nergenshuizen", { fetch })).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns at most five results", async () => {
    const fetch = fakeFetch(json(docs(Array.from({ length: 7 }, () => UTRECHT))));
    await expect(searchPlaces("U", { fetch })).resolves.toHaveLength(5);
  });

  it.each<[string, Response | (() => never), ErrorCode]>([
    ["a malformed doc", json(docs([UTRECHT, { weergavenaam: "X", centroide_ll: "POINT(5.1,52.1)" }])), "SOURCE_HTTP"],
    ["a non-JSON body", new Response("<html>", { status: 200 }), "SOURCE_HTTP"],
    ["HTTP 500", json({}, 500), "SOURCE_HTTP"],
    ["a thrown fetch", () => { throw new TypeError("fetch failed"); }, "NETWORK"],
  ])("gives %s the same code as geocode", async (_label, reply, code) => {
    expect(await codeOf(searchPlaces("Utrecht", { fetch: fakeFetch(reply) }))).toBe(code);
  });

  it.each(["", "   ", "a".repeat(101), "Utrecht\u001b[31m", "Utr\u007f"])("gives BAD_ARGS for %j without fetching", async (q) => {
    const fetch = fakeFetch();
    expect(await codeOf(searchPlaces(q, { fetch }))).toBe("BAD_ARGS");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("searchPlaces boundary", () => {
  it("accepts a query of exactly 100 characters", async () => {
    const fetch = fakeFetch(json(docs([])));
    await expect(searchPlaces("a".repeat(100), { fetch })).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
