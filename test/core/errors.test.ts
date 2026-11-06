import { describe, expect, it } from "vitest";
import { WordiknatError, toErrorJson, type ErrorCode } from "../../src/core/errors.ts";

const EXIT_CODES: Record<ErrorCode, 1 | 2> = {
  MISSING_KEY: 2,
  INVALID_KEY: 2,
  OUTSIDE_GRID: 2,
  UNKNOWN_PLACE: 2,
  BAD_ARGS: 2,
  NO_LOCATION: 2,
  RATE_LIMITED: 1,
  SOURCE_HTTP: 1,
  NETWORK: 1,
  BAD_FILE: 1,
  NO_DATA: 1,
  TILE_UNAVAILABLE: 1,
  HOURLY_UNAVAILABLE: 1,
  HOURLY_BAD_FILE: 1,
};
const CODES = Object.keys(EXIT_CODES) as ErrorCode[];

describe("WordiknatError", () => {
  it.each(CODES)("%s maps to its fixed exit code", (code) => {
    const err = new WordiknatError(code);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("WordiknatError");
    expect(err.code).toBe(code);
    expect(err.exitCode).toBe(EXIT_CODES[code]);
  });

  it.each(CODES)("%s has a non-empty Dutch default message", (code) => {
    expect(new WordiknatError(code).message).toMatch(/\S{3,}/);
  });

  it("tells the user where to get a key and where to put it", () => {
    for (const code of ["MISSING_KEY", "INVALID_KEY"] as const) {
      const { message } = new WordiknatError(code);
      expect(message).toContain("KNMI Developer Portal");
      expect(message).toContain(".env");
      expect(message).toContain("KNMI_API_KEY");
    }
  });

  it("tells a rate-limited user to wait and use their own key", () => {
    const { message } = new WordiknatError("RATE_LIMITED");
    expect(message).toContain("paar minuten");
    expect(message).toContain("eigen API-sleutel");
  });

  it("accepts a message override without changing code or exit code", () => {
    const err = new WordiknatError("UNKNOWN_PLACE", "Plaats 'Amsterdm' niet gevonden. Bedoel je Amsterdam?");
    expect(err.message).toContain("Amsterdam?");
    expect(err.exitCode).toBe(2);
  });
});

describe("toErrorJson", () => {
  it("produces exactly { error: { code, message } }", () => {
    const err = new WordiknatError("NETWORK");
    expect(toErrorJson(err)).toStrictEqual({ error: { code: "NETWORK", message: err.message } });
    expect(JSON.parse(JSON.stringify(toErrorJson(err)))).toStrictEqual(toErrorJson(err));
  });
});
