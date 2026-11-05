import { describe, expect, it, vi } from "vitest";
import { WordiknatError, type ErrorCode } from "../../src/core/errors.ts";
import { geocode } from "../../src/core/geocode.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const docs = (d: unknown[]) => ({ response: { numFound: d.length, docs: d } });
const UTRECHT = { weergavenaam: "Utrecht, Utrecht", centroide_ll: "POINT(5.10448 52.09126)" };

/** Fake fetch: one response (or thrower) per call, in order; records the URLs. */
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

describe("geocode", () => {
  it("returns the first result as a Location and queries PDOK woonplaatsen", async () => {
    const fetch = fakeFetch(json(docs([UTRECHT, { weergavenaam: "Ander", centroide_ll: "POINT(1 2)" }])));
    await expect(geocode("  Utrecht ", { fetch })).resolves.toEqual({ name: "Utrecht, Utrecht", lat: 52.09126, lon: 5.10448 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://api.pdok.nl/bzk/locatieserver/search/v3_1/free");
    expect(fetch.mock.calls[0][0]).toContain("fq=type%3Awoonplaats");
    expect(url.searchParams.get("q")).toBe("Utrecht");
    expect(url.searchParams.get("fl")).toBe("weergavenaam,centroide_ll");
  });

  it("encodes special characters in the query", async () => {
    const fetch = fakeFetch(json(docs([UTRECHT])));
    await geocode("'s-Hertogenbosch & co", { fetch });
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.searchParams.get("q")).toBe("'s-Hertogenbosch & co");
    expect([...url.searchParams.keys()].sort()).toEqual(["fl", "fq", "q", "rows"]);
  });

  it("gives UNKNOWN_PLACE with up to three suggestions", async () => {
    const fetch = fakeFetch(
      json(docs([])),
      json(docs(["Utrecht", "Uithoorn", "Uden", "Urk"].map((weergavenaam) => ({ weergavenaam })))),
    );
    const err = await geocode("Utreht", { fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WordiknatError);
    expect((err as WordiknatError).code).toBe("UNKNOWN_PLACE");
    expect((err as WordiknatError).exitCode).toBe(2);
    expect((err as WordiknatError).message).toBe('Plaats "Utreht" niet gevonden. Bedoelde je: Utrecht, Uithoorn, Uden?');
    const suggestUrl = new URL(fetch.mock.calls[1][0]);
    expect(suggestUrl.origin + suggestUrl.pathname).toBe("https://api.pdok.nl/bzk/locatieserver/search/v3_1/suggest");
  });

  it.each([
    ["no suggestions", json(docs([]))],
    ["a failing suggest call", json({}, 500)],
    ["a thrown suggest call", () => { throw new TypeError("offline"); }],
  ])("gives UNKNOWN_PLACE with a --lat/--lon hint on %s", async (_label, suggestReply) => {
    const fetch = fakeFetch(json(docs([])), suggestReply);
    const err = (await geocode("Nergenshuizen", { fetch }).catch((e: unknown) => e)) as WordiknatError;
    expect(err.code).toBe("UNKNOWN_PLACE");
    expect(err.message).toContain('"Nergenshuizen"');
    expect(err.message).toContain("--lat en --lon");
  });

  it.each([
    ["malformed centroide_ll", docs([{ ...UTRECHT, centroide_ll: "POINT(5.1,52.1)" }])],
    ["non-numeric point", docs([{ ...UTRECHT, centroide_ll: "POINT(abc def)" }])],
    ["out-of-range point", docs([{ ...UTRECHT, centroide_ll: "POINT(52.1 152.1)" }])],
    ["missing weergavenaam", docs([{ centroide_ll: UTRECHT.centroide_ll }])],
    ["missing centroide_ll", docs([{ weergavenaam: "Utrecht" }])],
    ["numeric centroide_ll", docs([{ ...UTRECHT, centroide_ll: 5.1 }])],
    ["doc is not an object", docs(["Utrecht"])],
    ["docs is not an array", { response: { numFound: 1, docs: "x" } }],
    ["missing response", { numFound: 1 }],
    ["null body", null],
  ])("gives SOURCE_HTTP on %s", async (_label, body) => {
    expect(await codeOf(geocode("Utrecht", { fetch: fakeFetch(json(body)) }))).toBe("SOURCE_HTTP");
  });

  it("gives SOURCE_HTTP on a non-JSON body", async () => {
    const fetch = fakeFetch(new Response("<html>", { status: 200 }));
    expect(await codeOf(geocode("Utrecht", { fetch }))).toBe("SOURCE_HTTP");
  });

  it.each(["", "   ", "a".repeat(101), "Utrecht\u001b[31m"])("gives BAD_ARGS for %j without fetching", async (q) => {
    const fetch = fakeFetch();
    expect(await codeOf(geocode(q, { fetch }))).toBe("BAD_ARGS");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts a 100-character query", async () => {
    const fetch = fakeFetch(json(docs([UTRECHT])));
    await expect(geocode("a".repeat(100), { fetch })).resolves.toMatchObject({ name: "Utrecht, Utrecht" });
  });

  it("maps HTTP 500 to SOURCE_HTTP with the status in the message", async () => {
    const err = (await geocode("Utrecht", { fetch: fakeFetch(json({}, 500)) }).catch((e: unknown) => e)) as WordiknatError;
    expect(err.code).toBe("SOURCE_HTTP");
    expect(err.message).toContain("HTTP 500");
    expect(err.message).toContain("PDOK");
  });

  it("maps a thrown fetch to NETWORK", async () => {
    const fetch = fakeFetch(() => { throw new TypeError("fetch failed"); });
    expect(await codeOf(geocode("Utrecht", { fetch }))).toBe("NETWORK");
  });

  it("drops suggestions with control characters or non-string names", async () => {
    const fetch = fakeFetch(
      json(docs([])),
      json(docs([{ weergavenaam: "Evil\u001b[31m" }, { weergavenaam: 5 }, "x", { weergavenaam: "Utrecht" }])),
    );
    const err = (await geocode("Utr", { fetch }).catch((e: unknown) => e)) as WordiknatError;
    expect(err.message).toBe('Plaats "Utr" niet gevonden. Bedoelde je: Utrecht?');
  });

  it("parses integer and negative coordinates", async () => {
    const fetch = fakeFetch(json(docs([{ weergavenaam: "X", centroide_ll: "POINT(-5 52)" }])));
    await expect(geocode("X", { fetch })).resolves.toEqual({ name: "X", lat: 52, lon: -5 });
  });
});
