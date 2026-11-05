import { describe, expect, it } from "vitest";
import { WordiknatError } from "../src/core/errors.ts";
import { parseForecastQuery, parseGeocodeQuery, parsePort } from "../src/validate.ts";

const SENTINEL = "ZZSENTINELZZ";
const qs = (s: string) => new URLSearchParams(s);

function badArgs(fn: () => unknown): WordiknatError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(WordiknatError);
    expect((err as WordiknatError).code).toBe("BAD_ARGS");
    return err as WordiknatError;
  }
  throw new Error("expected BAD_ARGS");
}

describe("parseForecastQuery", () => {
  it("accepts coordinates at the inclusive boundaries", () => {
    expect(parseForecastQuery(qs("lat=49&lon=0"))).toEqual({ lat: 49, lon: 0 });
    expect(parseForecastQuery(qs("lat=55.0&lon=10.0"))).toEqual({ lat: 55, lon: 10 });
    expect(parseForecastQuery(qs("lat=52.1&lon=5.18"))).toEqual({ lat: 52.1, lon: 5.18 });
  });

  it.each([
    ["lat=48.99&lon=5"],
    ["lat=55.01&lon=5"],
    ["lat=52&lon=-0.01"],
    ["lat=52&lon=10.01"],
  ])("rejects just outside the box: %s", (s) => {
    badArgs(() => parseForecastQuery(qs(s)));
  });

  it.each(["NaN", "Infinity", "-Infinity", "1e2", "0x34", "", " ", " 52", "52.1abc", "52.", ".5", "+52", "1".repeat(400)])(
    "rejects malformed lat %j",
    (lat) => {
      badArgs(() => parseForecastQuery(new URLSearchParams({ lat, lon: "5" })));
      badArgs(() => parseForecastQuery(new URLSearchParams({ lat: "52", lon: lat })));
    },
  );

  it.each([
    ["lat without lon", "lat=52"],
    ["lon without lat", "lon=5"],
    ["q together with lat", "q=Utrecht&lat=52"],
    ["q together with lat and lon", "q=Utrecht&lat=52&lon=5"],
    ["no parameters", ""],
    ["duplicate lat", "lat=52&lat=53&lon=5"],
    ["duplicate q", "q=Utrecht&q=Delft"],
    ["unknown parameter", "lat=52&lon=5&x=1"],
  ])("rejects %s", (_name, s) => {
    badArgs(() => parseForecastQuery(qs(s)));
  });

  it("accepts and trims q", () => {
    expect(parseForecastQuery(qs("q=%20De%20Bilt%20"))).toEqual({ q: "De Bilt" });
  });
});

describe("q rule (forecast and geocode)", () => {
  const parsers = [parseForecastQuery, parseGeocodeQuery];

  it("accepts 100 characters after trimming", () => {
    for (const parse of parsers) {
      expect(parse(new URLSearchParams({ q: `  ${"a".repeat(100)}  ` }))).toEqual({ q: "a".repeat(100) });
    }
  });

  it.each(["a".repeat(101), "", "   ", "Ut\nrecht", "Ut\u0000recht", "Ut\u007frecht"])("rejects q %j", (q) => {
    for (const parse of parsers) badArgs(() => parse(new URLSearchParams({ q })));
  });

  it("geocode rejects missing q, duplicates and other parameters", () => {
    badArgs(() => parseGeocodeQuery(qs("")));
    badArgs(() => parseGeocodeQuery(qs("q=a&q=b")));
    badArgs(() => parseGeocodeQuery(qs("q=Utrecht&lat=52")));
    badArgs(() => parseGeocodeQuery(qs("q=Utrecht&x=1")));
  });
});

describe("parsePort", () => {
  it("accepts valid ports", () => {
    expect(parsePort("5173")).toBe(5173);
    expect(parsePort("65535")).toBe(65535);
    expect(parsePort("1")).toBe(1);
  });

  it.each(["0", "65536", "-1", "80.5", "abc", "", " 80", "1e3", "0x50", "9".repeat(400)])("rejects %j", (p) => {
    badArgs(() => parsePort(p));
  });
});

describe("error messages never echo input", () => {
  it.each([
    () => parseForecastQuery(new URLSearchParams({ lat: SENTINEL, lon: "5" })),
    () => parseForecastQuery(new URLSearchParams({ lat: "52", lon: SENTINEL })),
    () => parseForecastQuery(new URLSearchParams({ q: SENTINEL.repeat(20) })),
    () => parseForecastQuery(new URLSearchParams({ q: `${SENTINEL}\n` })),
    () => parseForecastQuery(new URLSearchParams({ [SENTINEL]: "1" })),
    () => parseForecastQuery(new URLSearchParams({ q: SENTINEL, lat: "52" })),
    () => parseGeocodeQuery(new URLSearchParams({ q: "Utrecht", [SENTINEL]: SENTINEL })),
    () => parsePort(SENTINEL),
  ])("case %#", (fn) => {
    const err = badArgs(fn);
    expect(err.message).not.toContain(SENTINEL);
    expect(err.message).toMatch(/\S/);
  });
});

describe("extra edge cases", () => {
  it.each(["52\n", "52\t", "5 2"])("rejects lat with whitespace/control %j", (lat) => {
    badArgs(() => parseForecastQuery(new URLSearchParams({ lat, lon: "5" })));
  });

  it("rejects q with leading/trailing control characters even though trim would strip them", () => {
    for (const q of ["Utrecht\n", "\tUtrecht", "\u0000Utrecht"]) {
      badArgs(() => parseForecastQuery(new URLSearchParams({ q })));
      badArgs(() => parseGeocodeQuery(new URLSearchParams({ q })));
    }
  });

  it("rejects empty q combined with coordinates", () => {
    badArgs(() => parseForecastQuery(qs("q=&lat=52&lon=5")));
  });

  it("counts q length in characters after trim, accepts non-ASCII", () => {
    expect(parseGeocodeQuery(new URLSearchParams({ q: "Ürk" }))).toEqual({ q: "Ürk" });
  });

  it.each(["٣", "05x", "+80"])("parsePort rejects %j", (p) => {
    badArgs(() => parsePort(p));
  });
});
