import { describe, expect, it } from "vitest";
import { lonLatToPixel, MAP_BBOX, RADAR_GRID, TILE_SIZE, tileAllowed } from "../../src/core/map-grid.ts";
import { LOCAL_SIZE, pinPosition, radarRect, tilesFor, viewFor, type View } from "../../web/lib/map-view.ts";

const UTRECHT = { lat: 52.0907, lon: 5.1214 };
const EDGE = { lat: 53.5, lon: 7.2 };
const PARIS = { lat: 48.8566, lon: 2.3522 };

function boxPx(zoom: number) {
  const nw = lonLatToPixel(MAP_BBOX.west, MAP_BBOX.north, zoom);
  const se = lonLatToPixel(MAP_BBOX.east, MAP_BBOX.south, zoom);
  return { nw, se };
}

const inWindow = (v: View, p: { x: number; y: number }) =>
  p.x >= v.x0 && p.x <= v.x0 + v.width && p.y >= v.y0 && p.y <= v.y0 + v.height;

function insideBox(v: View) {
  const { nw, se } = boxPx(v.zoom);
  expect(v.x0).toBeGreaterThanOrEqual(Math.floor(nw.x));
  expect(v.y0).toBeGreaterThanOrEqual(Math.floor(nw.y));
  expect(v.x0 + v.width).toBeLessThanOrEqual(Math.ceil(se.x));
  expect(v.y0 + v.height).toBeLessThanOrEqual(Math.ceil(se.y));
}

describe("viewFor", () => {
  it("nl covers MAP_BBOX at zoom 8 and ignores the pin", () => {
    const v = viewFor("nl", null);
    expect(viewFor("nl", UTRECHT)).toEqual(v);
    expect(v).toMatchObject({ kind: "nl", zoom: 8 });
    const { nw, se } = boxPx(8);
    for (const p of [nw, se, { x: nw.x, y: se.y }, { x: se.x, y: nw.y }]) expect(inWindow(v, p)).toBe(true);
    expect(Number.isInteger(v.x0) && Number.isInteger(v.y0) && Number.isInteger(v.width) && Number.isInteger(v.height)).toBe(true);
  });

  it("local without a pin equals the nl view", () => {
    expect(viewFor("local", null)).toEqual(viewFor("nl", null));
  });

  it("local centres a 512 x 512 window on the pin", () => {
    const v = viewFor("local", UTRECHT);
    expect(v).toMatchObject({ kind: "local", zoom: 10, width: LOCAL_SIZE, height: LOCAL_SIZE });
    const p = lonLatToPixel(UTRECHT.lon, UTRECHT.lat, 10);
    expect(Math.abs(v.x0 + 256 - p.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(v.y0 + 256 - p.y)).toBeLessThanOrEqual(1);
    const pin = pinPosition(v, UTRECHT.lat, UTRECHT.lon);
    expect(Math.abs(pin.x - 256)).toBeLessThanOrEqual(1);
    expect(Math.abs(pin.y - 256)).toBeLessThanOrEqual(1);
    expect(pin.visible).toBe(true);
  });

  it("a pin near the box edge shifts the window but stays visible", () => {
    const v = viewFor("local", EDGE);
    insideBox(v);
    const pin = pinPosition(v, EDGE.lat, EDGE.lon);
    expect(pin.visible).toBe(true);
    expect(Math.abs(pin.x - 256) > 1 || Math.abs(pin.y - 256) > 1).toBe(true);
  });

  it("a pin outside the box clamps the window and is not visible", () => {
    const v = viewFor("local", PARIS);
    expect(v.width).toBe(LOCAL_SIZE);
    insideBox(v);
    expect(pinPosition(v, PARIS.lat, PARIS.lon).visible).toBe(false);
  });

  it("a non-finite pin falls back to the nl view", () => {
    expect(viewFor("local", { lat: Number.NaN, lon: 5 })).toEqual(viewFor("nl", null));
  });
});

describe("tilesFor", () => {
  for (const v of [viewFor("nl", null), viewFor("local", UTRECHT), viewFor("local", EDGE), viewFor("local", PARIS)]) {
    it(`covers the ${v.kind} window at x0=${v.x0} with allowed, unique tiles`, () => {
      const tiles = tilesFor(v);
      expect(tiles.length).toBeGreaterThan(0);
      expect(new Set(tiles.map((t) => `${t.z}/${t.x}/${t.y}`)).size).toBe(tiles.length);
      for (const t of tiles) {
        expect(t.z).toBe(v.zoom);
        expect(tileAllowed(t.z, t.x, t.y)).toBe(true);
        expect(t.dx).toBe(t.x * TILE_SIZE - v.x0);
        expect(t.dy).toBe(t.y * TILE_SIZE - v.y0);
      }
      const corners = [
        [0, 0],
        [v.width - 1, 0],
        [0, v.height - 1],
        [v.width - 1, v.height - 1],
      ];
      for (const [cx, cy] of corners) {
        const hit = tiles.some((t) => cx >= t.dx && cx < t.dx + TILE_SIZE && cy >= t.dy && cy < t.dy + TILE_SIZE);
        expect(hit).toBe(true);
      }
      if (v.kind === "local") expect(tiles.length).toBeLessThanOrEqual(9);
    });
  }
});

describe("radarRect", () => {
  it("scales the zoom-7 grid by 2 for the nl view", () => {
    const v = viewFor("nl", null);
    const r = radarRect(v);
    expect(r.dw).toBe(2 * RADAR_GRID.width);
    expect(r.dh).toBe(2 * RADAR_GRID.height);
    expect(r.dx).toBe(RADAR_GRID.originX * 2 - v.x0);
  });

  it("scales by 8 for the local view and places the grid origin", () => {
    const v = viewFor("local", UTRECHT);
    const r = radarRect(v);
    expect(r.dw).toBe(8 * RADAR_GRID.width);
    expect(r.dh).toBe(8 * RADAR_GRID.height);
    expect(r.dx).toBe(RADAR_GRID.originX * 8 - v.x0);
    expect(r.dy).toBe(RADAR_GRID.originY * 8 - v.y0);
    // the origin is the box's north-west pixel at zoom 7, floored: within one zoom-7 cell (8 px) at zoom 10
    const { nw } = boxPx(10);
    expect(nw.x - v.x0 - r.dx).toBeGreaterThanOrEqual(0);
    expect(nw.x - v.x0 - r.dx).toBeLessThan(8);
    expect(nw.y - v.y0 - r.dy).toBeGreaterThanOrEqual(0);
    expect(nw.y - v.y0 - r.dy).toBeLessThan(8);
  });

  it("uses the payload's grid when given", () => {
    const v = viewFor("nl", null);
    const r = radarRect(v, { ...RADAR_GRID, originX: RADAR_GRID.originX + 1 });
    expect(r.dx).toBe((RADAR_GRID.originX + 1) * 2 - v.x0);
  });
});
