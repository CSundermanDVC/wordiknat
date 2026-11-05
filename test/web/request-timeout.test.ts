import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchForecast, searchPlaces } from "../../web/lib/api.ts";
import { fetchRadar } from "../../web/lib/radar-data.ts";

// A fetch that never answers, but honours the abort signal like the real one.
const stalled = ((_u: string, init?: RequestInit) =>
  new Promise((_res, rej) => {
    const fail = () => rej(new DOMException("timed out", "TimeoutError"));
    if (init?.signal?.aborted) fail();
    else init?.signal?.addEventListener("abort", fail);
  })) as unknown as typeof fetch;

afterEach(() => vi.restoreAllMocks());

describe("request timeout", () => {
  it.each([
    ["fetchForecast", (f: typeof fetch) => fetchForecast({ q: "Utrecht" }, f)],
    ["searchPlaces", (f: typeof fetch) => searchPlaces("Utrecht", f)],
    ["fetchRadar", (f: typeof fetch) => fetchRadar(f)],
  ])("%s rejects with the Dutch network error after 30 s", async (_n, call) => {
    const spy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort());
    const e = await call(stalled).then(() => null, (x: unknown) => x);
    expect(spy).toHaveBeenCalledWith(30_000);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe("NETWORK");
    expect((e as ApiError).message).toContain("Controleer of Wordiknat draait");
  });
});
