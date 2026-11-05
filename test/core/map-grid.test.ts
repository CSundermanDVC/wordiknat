import { describe, expect, it } from "vitest";
import {
  allowedTileCount, lonLatToPixel, MAP_BBOX, packClasses, pixelToLonLat, RADAR_GRID, rainClass,
  tileAllowed, tileRange, TILE_ZOOMS, unpackClasses,
} from "../../src/core/map-grid.ts";

describe("web mercator", () => {
  // Pixel values at zoom 8 from the closed form x = (lon+180)/360*256*2^z,
  // y = (1 - ln(tan(phi)+1/cos(phi))/pi)/2*256*2^z, evaluated once in a python scratch script.
  const cases: [string, number, number, number, number][] = [
    ["lower-left", 0, 49.362064, 32768.0, 22405.6779],
    ["upper-left", 0, 55.973602, 32768.0, 20416.0638],
    ["upper-right", 10.856453, 55.388974, 34744.357, 20604.8391],
    ["lower-right", 9.0093, 48.895302, 34408.093, 22535.533],
    ["Utrecht", 5.1214, 52.0907, 33700.3224, 21620.6837],
  ];
  it.each(cases)("%s lands on the independent pixel", (_n, lon, lat, x, y) => {
    const p = lonLatToPixel(lon, lat, 8);
    expect(Math.abs(p.x - x)).toBeLessThan(1);
    expect(Math.abs(p.y - y)).toBeLessThan(1);
  });

  it("round-trips", () => {
    const pts: [number, number][] = [[0, 0], [5.1214, 52.0907], [2.9, 53.9], [7.5, 50.5], [-120.3, -33.2], [179, 80]];
    for (const [lon, lat] of pts) for (const z of [0, 7, 10]) {
      const p = lonLatToPixel(lon, lat, z);
      const b = pixelToLonLat(p.x, p.y, z);
      expect(Math.abs(b.lon - lon)).toBeLessThan(1e-9);
      expect(Math.abs(b.lat - lat)).toBeLessThan(1e-9);
    }
  });
});

describe("tiles", () => {
  it("allows the Utrecht tile per zoom, not other zooms", () => {
    for (const z of TILE_ZOOMS) {
      const n = 2 ** z;
      const x = Math.floor((5.1214 + 180) / 360 * n);
      const phi = (52.0907 * Math.PI) / 180;
      const y = Math.floor(((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n);
      expect(tileAllowed(z, x, y)).toBe(true);
    }
    expect(tileAllowed(7, 65, 42)).toBe(false);
    expect(tileAllowed(11, 1053, 673)).toBe(false);
  });

  it("rejects out-of-range and invalid values", () => {
    const [z] = TILE_ZOOMS;
    const r = tileRange(z);
    expect(tileAllowed(z, r.x0 - 1, r.y0)).toBe(false);
    expect(tileAllowed(z, r.x0, r.y0 - 1)).toBe(false);
    expect(tileAllowed(z, r.x1 + 1, r.y0)).toBe(false);
    expect(tileAllowed(z, r.x0, r.y1 + 1)).toBe(false);
    for (const bad of [1.5, -1, NaN, Infinity, -Infinity, 2 ** z]) {
      expect(tileAllowed(z, bad, r.y0)).toBe(false);
      expect(tileAllowed(z, r.x0, bad)).toBe(false);
    }
    expect(tileAllowed(1.5, r.x0, r.y0)).toBe(false);
  });

  it("allows corner tiles and counts 321", () => {
    let sum = 0;
    for (const z of TILE_ZOOMS) {
      const r = tileRange(z);
      for (const [x, y] of [[r.x0, r.y0], [r.x1, r.y0], [r.x0, r.y1], [r.x1, r.y1]]) expect(tileAllowed(z, x, y)).toBe(true);
      sum += (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
    }
    expect(allowedTileCount()).toBe(sum);
    expect(sum).toBe(321);
    expect(sum).toBeLessThanOrEqual(500);
  });

  it("matches the documented ranges", () => {
    expect(tileRange(8)).toEqual({ x0: 130, x1: 133, y0: 82, y1: 86 });
    expect(tileRange(10)).toEqual({ x0: 520, x1: 533, y0: 329, y1: 345 });
  });
});

describe("RADAR_GRID", () => {
  it("covers the bbox with a small cell count", () => {
    const g = RADAR_GRID;
    for (const [lon, lat] of [[MAP_BBOX.west, MAP_BBOX.north], [MAP_BBOX.east, MAP_BBOX.south]] as const) {
      const p = lonLatToPixel(lon, lat, g.zoom);
      expect(p.x).toBeGreaterThanOrEqual(g.originX);
      expect(p.x).toBeLessThanOrEqual(g.originX + g.width);
      expect(p.y).toBeGreaterThanOrEqual(g.originY);
      expect(p.y).toBeLessThanOrEqual(g.originY + g.height);
    }
    expect(g.width * g.height).toBeLessThan(250_000);
  });
});

describe("rainClass", () => {
  it("applies the thresholds", () => {
    const t: [number, number][] = [[0.0999, 0], [0.1, 1], [0.9999, 1], [1, 2], [2.4999, 2], [2.5, 3], [40, 3], [-1, 0], [NaN, 0]];
    for (const [mm, c] of t) expect(rainClass(mm)).toBe(c);
  });
});

describe("class codec", () => {
  it("round-trips", () => {
    for (const n of [0, 1, 3, 4, 5, 1001]) {
      const c = Uint8Array.from({ length: n }, (_, i) => (i * 7 + (i >> 2)) % 4);
      const packed = packClasses(c);
      expect(packed.length).toBe(Math.ceil(n / 4));
      expect(unpackClasses(packed, n)).toEqual(c);
    }
  });
  it("uses the documented bit layout", () => {
    expect([...packClasses(Uint8Array.of(1, 2, 3, 0, 3))]).toEqual([0b00_11_10_01, 0b00_00_00_11]);
  });
  it("throws on wrong length", () => {
    expect(() => unpackClasses(new Uint8Array(2), 5)).not.toThrow();
    expect(() => unpackClasses(new Uint8Array(1), 5)).toThrow(RangeError);
    expect(() => unpackClasses(new Uint8Array(3), 5)).toThrow(RangeError);
  });
});

describe("extra edge cases", () => {
  it("matches the documented zoom 9 range", () => {
    expect(tileRange(9)).toEqual({ x0: 260, x1: 266, y0: 164, y1: 172 });
  });
  it("allows exactly the tiles of tileRange in a 3x3 neighbourhood scan", () => {
    for (const z of TILE_ZOOMS) {
      const r = tileRange(z);
      let n = 0;
      for (let x = r.x0 - 2; x <= r.x1 + 2; x++) for (let y = r.y0 - 2; y <= r.y1 + 2; y++) if (tileAllowed(z, x, y)) n++;
      expect(n).toBe((r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1));
    }
  });
  it("rejects zoom 0, negative and non-finite zooms", () => {
    for (const z of [0, -1, NaN, Infinity, 8.5]) expect(tileAllowed(z, 130, 82)).toBe(false);
  });
  it("RADAR_GRID origin is the floored north-west pixel", () => {
    const nw = lonLatToPixel(MAP_BBOX.west, MAP_BBOX.north, RADAR_GRID.zoom);
    expect(RADAR_GRID.originX).toBe(Math.floor(nw.x));
    expect(RADAR_GRID.originY).toBe(Math.floor(nw.y));
    expect(RADAR_GRID.width).toBeGreaterThan(0);
    expect(RADAR_GRID.height).toBeGreaterThan(0);
  });
  it("rainClass handles infinities", () => {
    expect(rainClass(Infinity)).toBe(3);
    expect(rainClass(-Infinity)).toBe(0);
  });
  it("codec: empty input and unused high bits stay zero", () => {
    expect(packClasses(new Uint8Array(0)).length).toBe(0);
    expect(unpackClasses(new Uint8Array(0), 0).length).toBe(0);
    expect([...packClasses(Uint8Array.of(3))]).toEqual([0b11]);
    expect(() => unpackClasses(new Uint8Array(1), 0)).toThrow(RangeError);
  });
});
