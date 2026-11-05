import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getApiKey, loadEnv, redact } from "../../src/core/env.ts";
import { WordiknatError, type ErrorCode } from "../../src/core/errors.ts";

const KEY = "eyJ-secret-test-key-123";
const CODES: ErrorCode[] = [
  "MISSING_KEY", "INVALID_KEY", "RATE_LIMITED", "SOURCE_HTTP", "NETWORK", "BAD_FILE",
  "OUTSIDE_GRID", "NO_DATA", "UNKNOWN_PLACE", "BAD_ARGS", "NO_LOCATION",
];

describe("loadEnv", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wordiknat-env-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    delete process.env.WORDIKNAT_TEST_FROM_FILE;
    delete process.env.WORDIKNAT_TEST_PRESET;
  });

  it("skips silently when there is no .env", () => {
    expect(() => loadEnv(dir)).not.toThrow();
    expect(process.env.WORDIKNAT_TEST_FROM_FILE).toBeUndefined();
  });

  it("loads variables from <cwd>/.env", () => {
    writeFileSync(join(dir, ".env"), "WORDIKNAT_TEST_FROM_FILE=uit-bestand\n");
    loadEnv(dir);
    expect(process.env.WORDIKNAT_TEST_FROM_FILE).toBe("uit-bestand");
  });

  it("keeps variables that are already set in the environment", () => {
    vi.stubEnv("WORDIKNAT_TEST_PRESET", "uit-omgeving");
    writeFileSync(join(dir, ".env"), "WORDIKNAT_TEST_PRESET=uit-bestand\nWORDIKNAT_TEST_FROM_FILE=ja\n");
    loadEnv(dir);
    expect(process.env.WORDIKNAT_TEST_PRESET).toBe("uit-omgeving");
    expect(process.env.WORDIKNAT_TEST_FROM_FILE).toBe("ja");
  });

  it("rethrows errors other than a missing file", () => {
    mkdirSync(join(dir, ".env"));
    expect(() => loadEnv(dir)).toThrow();
  });
});

describe("getApiKey", () => {
  it("returns the key from the given env", () => {
    expect(getApiKey({ KNMI_API_KEY: KEY })).toBe(KEY);
  });

  it.each([undefined, "", "   "])("throws MISSING_KEY for %j", (value) => {
    let thrown: unknown;
    try {
      getApiKey({ KNMI_API_KEY: value });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(WordiknatError);
    expect((thrown as WordiknatError).code).toBe("MISSING_KEY");
    expect((thrown as WordiknatError).exitCode).toBe(2);
  });
});

describe("redact", () => {
  it("replaces every occurrence of the key", () => {
    expect(redact(`a ${KEY} b ${KEY}${KEY}`, KEY)).toBe("a *** b ******");
  });

  it("returns the text unchanged for an empty key", () => {
    expect(redact("niets te verbergen", "")).toBe("niets te verbergen");
  });

  it("treats the key literally, not as a pattern", () => {
    expect(redact("x a.b+c y", "a.b+c")).toBe("x *** y");
    expect(redact("x aXb y", "a.b")).toBe("x aXb y");
  });
});

describe("key never leaks into messages", () => {
  it.each(CODES)("default %s message does not contain the key", (code) => {
    expect(new WordiknatError(code).message).not.toContain(KEY);
  });
});
