// WCAG AA over the colour tokens in web/style.css, light and evening (US-017).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, parseHex, relativeLuminance } from "../helpers/contrast.ts";

const css = readFileSync(new URL("../../web/style.css", import.meta.url), "utf8");

/** Custom-property declarations of the first `:root { ... }` at or after `from`. */
function rootTokens(from: number): Map<string, string> {
  const open = css.indexOf(":root {", from);
  const body = css.slice(open, css.indexOf("}", open));
  return new Map([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

const light = rootTokens(0);
const dark = new Map([...light, ...rootTokens(css.indexOf("@media (prefers-color-scheme: dark)"))]);

/** Follows var(--x) references until a literal value. */
function resolve(tokens: Map<string, string>, name: string, seen: string[] = []): string {
  const value = tokens.get(name);
  if (value === undefined || seen.includes(name)) throw new Error(`unresolved token ${name}`);
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  return ref ? resolve(tokens, ref[1]!, [...seen, name]) : value;
}

const TEXT = 4.5;
const GRAPHIC = 3;
const PAIRS: Array<[fg: string, bg: string, min: number]> = [
  ...["--text", "--muted"].flatMap((fg) => ["--sky", "--ground", "--panel"].map((bg): [string, string, number] => [fg, bg, TEXT])),
  ["--answer-fg", "--answer-bg", TEXT],
  ["--answer-em", "--answer-bg", TEXT],
  ["--ink", "--paper", TEXT],
  ["--placeholder", "--paper", TEXT],
  ["--cream", "--ink", TEXT],
  ["--ring", "--sky", GRAPHIC],
  ["--ring", "--panel", GRAPHIC],
  ["--ink-line", "--panel", GRAPHIC],
  ["--graph-line", "--panel", GRAPHIC],
];

describe("contrast helper", () => {
  it("parses hex and rejects anything else", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("#1C2A4A")).toEqual([28, 42, 74]);
    expect(parseHex("var(--ink)")).toBeNull();
    expect(parseHex("#12345")).toBeNull();
  });

  it("matches the known WCAG pairs", () => {
    expect(relativeLuminance([255, 255, 255])).toBeCloseTo(1, 6);
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 6);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 6);
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    expect(() => contrastRatio("red", "#fff")).toThrow();
  });
});

describe("token contrast (US-017)", () => {
  it("reads a dark block that overrides the light tokens", () => {
    expect(light.size).toBeGreaterThan(20);
    expect(resolve(dark, "--sky")).not.toBe(resolve(light, "--sky"));
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ] as const)("every pair meets AA in %s", (_theme, tokens) => {
    const failures = PAIRS.flatMap(([fg, bg, min]) => {
      const ratio = contrastRatio(resolve(tokens, fg), resolve(tokens, bg));
      return ratio >= min ? [] : [`${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`];
    });
    expect(failures).toEqual([]);
  });
});
