import { describe, expect, it } from "vitest";
import { WordiknatError } from "../../src/core/errors.ts";
import { createKnmiClient, type FetchLike } from "../../src/core/knmi.ts";

const KEY = "SENTINEL-KEY-123";
const API = "https://api.dataplatform.knmi.nl/open-data/v1/datasets/radar_forecast/versions/2.0/files";
const NAME = "RAD_NL25_RAC_FM_202611041100.h5";
const DOWNLOAD = "https://bucket.example/RAD.h5?X-Amz-Signature=abc";

type Call = { url: string; headers: Record<string, string> };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Fake fetch: routes the three KNMI calls; `override` replaces the response for a URL prefix. */
function fakeFetch(override?: (url: string) => Response | Error | undefined) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const o = override?.(url);
    if (o instanceof Error) throw o;
    if (o) return o;
    if (url.startsWith(`${API}?`)) return json({ files: [{ filename: NAME }] });
    if (url === `${API}/${NAME}/url`) return json({ temporaryDownloadUrl: DOWNLOAD });
    if (url === DOWNLOAD) return new Response(new Uint8Array([1, 2, 3]));
    return new Response("nope", { status: 404 });
  };
  return { fetch, calls };
}

async function codeOf(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  const err = await p.then(
    () => expect.unreachable("expected a WordiknatError"),
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(WordiknatError);
  const { code, message } = err as WordiknatError;
  expect(message).not.toContain(KEY);
  expect(message).not.toContain("X-Amz-Signature");
  return { code, message };
}

describe("createKnmiClient", () => {
  it("lists the newest file and downloads it; only API calls carry the key", async () => {
    const { fetch, calls } = fakeFetch();
    const client = createKnmiClient({ fetch, apiKey: KEY });

    expect(await client.latestFileName()).toBe(NAME);
    expect(await client.download(NAME)).toEqual(new Uint8Array([1, 2, 3]));

    expect(calls.map((c) => c.url)).toEqual([
      `${API}?maxKeys=1&orderBy=created&sorting=desc`,
      `${API}/${NAME}/url`,
      DOWNLOAD,
    ]);
    expect(calls[0].headers).toEqual({ Authorization: KEY });
    expect(calls[1].headers).toEqual({ Authorization: KEY });
    expect(calls[2].headers).toEqual({});
  });

  it.each([
    [401, "INVALID_KEY"],
    [403, "INVALID_KEY"],
    [429, "RATE_LIMITED"],
    [500, "SOURCE_HTTP"],
  ])("maps API status %i to %s", async (status, expected) => {
    const { fetch } = fakeFetch(() => new Response(`bad ${KEY}`, { status }));
    const client = createKnmiClient({ fetch, apiKey: KEY });
    const { code, message } = await codeOf(client.latestFileName());
    expect(code).toBe(expected);
    if (expected === "SOURCE_HTTP") expect(message).toContain(String(status));
  });

  it("maps a thrown fetch error to NETWORK without leaking it", async () => {
    const { fetch } = fakeFetch(() => new TypeError(`fetch failed ${KEY} ${DOWNLOAD}`));
    const client = createKnmiClient({ fetch, apiKey: KEY });
    expect((await codeOf(client.latestFileName())).code).toBe("NETWORK");
    expect((await codeOf(client.download(NAME))).code).toBe("NETWORK");
  });

  it("maps download-host errors without blaming the key", async () => {
    const forbidden = fakeFetch((url) => (url === DOWNLOAD ? new Response("", { status: 403 }) : undefined));
    const { code, message } = await codeOf(createKnmiClient({ fetch: forbidden.fetch, apiKey: KEY }).download(NAME));
    expect(code).toBe("SOURCE_HTTP");
    expect(message).toContain("403");

    const limited = fakeFetch((url) => (url === DOWNLOAD ? new Response("", { status: 429 }) : undefined));
    expect((await codeOf(createKnmiClient({ fetch: limited.fetch, apiKey: KEY }).download(NAME))).code).toBe(
      "RATE_LIMITED",
    );
  });

  it.each([
    ["not JSON", new Response("<html>")],
    ["no files key", json({})],
    ["empty files", json({ files: [] })],
    ["filename not a string", json({ files: [{ filename: 42 }] })],
    ["null body", json(null)],
  ])("listing with %s gives SOURCE_HTTP", async (_label, res) => {
    const { fetch } = fakeFetch((url) => (url.startsWith(`${API}?`) ? res : undefined));
    expect((await codeOf(createKnmiClient({ fetch, apiKey: KEY }).latestFileName())).code).toBe("SOURCE_HTTP");
  });

  it.each([
    ["missing temporaryDownloadUrl", json({})],
    ["non-string URL", json({ temporaryDownloadUrl: 1 })],
    ["unparseable URL", json({ temporaryDownloadUrl: "not a url" })],
    ["http URL", json({ temporaryDownloadUrl: "http://bucket.example/x.h5" })],
  ])("url response with %s gives SOURCE_HTTP and never downloads", async (_label, res) => {
    const { fetch, calls } = fakeFetch((url) => (url.endsWith("/url") ? res : undefined));
    expect((await codeOf(createKnmiClient({ fetch, apiKey: KEY }).download(NAME))).code).toBe("SOURCE_HTTP");
    expect(calls).toHaveLength(1);
  });

  it("encodes the file name into the URL path", async () => {
    const { fetch, calls } = fakeFetch(() => json({}));
    await codeOf(createKnmiClient({ fetch, apiKey: KEY }).download("../x?y#z"));
    expect(calls[0].url).toBe(`${API}/..%2Fx%3Fy%23z/url`);
  });
});
