import { describe, expect, it } from "vitest";
import { DEFAULT_PALETTE, paintRadar, parseHex, RAIN_ALPHA, type Palette } from "../../web/lib/radar-paint.ts";

const P: Palette = [
  [10, 20, 30],
  [40, 50, 60],
  [70, 80, 90],
];

describe("paintRadar", () => {
  it("paints class 0 transparent and classes 1 to 3 in the palette", () => {
    const a = Math.round(RAIN_ALPHA * 255);
    const out = paintRadar(Uint8Array.from([0, 1, 2, 3]), P, RAIN_ALPHA);
    expect(out).toHaveLength(16);
    expect([...out]).toEqual([0, 0, 0, 0, 10, 20, 30, a, 40, 50, 60, a, 70, 80, 90, a]);
  });

  it("clamps alpha to 0..1", () => {
    expect(paintRadar(Uint8Array.from([1]), P, 2)[3]).toBe(255);
    expect(paintRadar(Uint8Array.from([1]), P, -1)[3]).toBe(0);
  });

  it("treats a class above 3 as dry", () => {
    expect([...paintRadar(Uint8Array.from([7]), P, 1)]).toEqual([0, 0, 0, 0]);
  });

  it("fills and returns a provided buffer, overwriting old pixels", () => {
    const buf = new Uint8ClampedArray(8).fill(99);
    const out = paintRadar(Uint8Array.from([0, 3]), P, 1, buf);
    expect(out).toBe(buf);
    expect([...buf]).toEqual([0, 0, 0, 0, 70, 80, 90, 255]);
  });

  it("rejects a buffer of the wrong size", () => {
    expect(() => paintRadar(Uint8Array.from([1, 1]), P, 1, new Uint8ClampedArray(4))).toThrow(RangeError);
  });
});

describe("parseHex", () => {
  it("parses #rrggbb and #rgb", () => {
    expect(parseHex("#2f6fde")).toEqual([47, 111, 222]);
    expect(parseHex("  #FFF ")).toEqual([255, 255, 255]);
  });

  it.each(["red", "#12", "", "#gggggg", "2f6fde", "#2f6fde00"])("rejects %j", (s) => {
    expect(parseHex(s)).toBeNull();
  });

  it("default palette is three ordered blues", () => {
    expect(DEFAULT_PALETTE).toHaveLength(3);
    for (const [r, g, b] of DEFAULT_PALETTE) expect(b).toBeGreaterThan(Math.max(r, g));
    expect(DEFAULT_PALETTE[1]).toEqual(parseHex("#2f6fde"));
  });
});
