import { describe, expect, it } from "vitest";
import { WordiknatError } from "../../src/core/errors.ts";
import { cellToLatLon, KNMI_RADAR_GEOMETRY as G, latLonToCell } from "../../src/core/projection.ts";

// geo_product_corners from docs/knmi-format.md, as [lon, lat] pairs, nudged 1e-3 deg into the grid.
describe("projection", () => {
  it("maps the four documented corners to the corner cells", () => {
    const eps = 0.003;
    expect(latLonToCell(49.362064 + eps, 0 + eps, G)).toEqual({ col: 0, row: 764 }); // lower-left
    expect(latLonToCell(55.973602 - eps, 0 + eps, G)).toEqual({ col: 0, row: 0 }); // upper-left
    expect(latLonToCell(55.388973 - eps, 10.856453 - eps, G)).toEqual({ col: 699, row: 0 }); // upper-right
    expect(latLonToCell(48.895302 + eps, 9.0093 - eps, G)).toEqual({ col: 699, row: 764 }); // lower-right
  });

  it("round-trips interior cells", () => {
    for (const [col, row] of [[0, 0], [350, 400], [123, 654], [699, 764], [10, 700]]) {
      const { lat, lon } = cellToLatLon(col, row, G);
      expect(latLonToCell(lat, lon, G)).toEqual({ col, row });
    }
  });

  it("maps Utrecht inside and throws far outside", () => {
    const c = latLonToCell(52.09, 5.1, G);
    expect(c.col).toBeGreaterThanOrEqual(0);
    expect(c.col).toBeLessThan(700);
    expect(c.row).toBeLessThan(765);
    expect(() => latLonToCell(40, 5, G)).toThrow(WordiknatError);
    expect(() => latLonToCell(40, 5, G)).toThrow(expect.objectContaining({ code: "OUTSIDE_GRID" }));
  });

  it("throws OUTSIDE_GRID on non-finite input", () => {
    expect(() => latLonToCell(NaN, 5, G)).toThrow(expect.objectContaining({ code: "OUTSIDE_GRID" }));
    expect(() => latLonToCell(52, Infinity, G)).toThrow(expect.objectContaining({ code: "OUTSIDE_GRID" }));
  });

  it("matches the documented Utrecht cell (docs/knmi-format.md)", () => {
    expect(latLonToCell(52.0907, 5.1214, G)).toEqual({ col: 365, row: 429 });
  });

  it("throws just outside each grid edge", () => {
    const eps = 0.003;
    const outside = [
      [49.362064 - eps, 0 + eps], // south of lower-left
      [55.973602 + eps, 0 + eps], // north of upper-left
      [55.388973 - eps, 10.856453 + eps], // east of upper-right
      [52, -1], // west of the grid
    ];
    for (const [lat, lon] of outside) {
      expect(() => latLonToCell(lat, lon, G)).toThrow(expect.objectContaining({ code: "OUTSIDE_GRID" }));
    }
  });

  it("throws OUTSIDE_GRID on NaN longitude and |lat| > 90", () => {
    expect(() => latLonToCell(52, NaN, G)).toThrow(expect.objectContaining({ code: "OUTSIDE_GRID" }));
    expect(() => latLonToCell(91, 5, G)).toThrow(expect.objectContaining({ code: "OUTSIDE_GRID" }));
  });

  it("round-trips every 50th cell", () => {
    for (let row = 0; row < 765; row += 50) {
      for (let col = 0; col < 700; col += 50) {
        const { lat, lon } = cellToLatLon(col, row, G);
        expect(latLonToCell(lat, lon, G)).toEqual({ col, row });
      }
    }
  });
});
