import { classify } from "./summary.ts";

export const TILE_SIZE = 256;
export const RADAR_ZOOM = 7;
// Values from docs/pdok-tiles.md.
export const MAP_BBOX = { west: 2.9, south: 50.5, east: 7.5, north: 53.9 } as const;
export const TILE_ZOOMS: readonly number[] = [8, 9, 10];

const world = (zoom: number) => TILE_SIZE * 2 ** zoom;

export function lonLatToPixel(lon: number, lat: number, zoom: number): { x: number; y: number } {
  const phi = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * world(zoom),
    y: ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * world(zoom),
  };
}

export function pixelToLonLat(x: number, y: number, zoom: number): { lon: number; lat: number } {
  const w = world(zoom);
  return {
    lon: (x / w) * 360 - 180,
    lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / w))) * 180) / Math.PI,
  };
}

export function tileRange(z: number): { x0: number; x1: number; y0: number; y1: number } {
  const nw = lonLatToPixel(MAP_BBOX.west, MAP_BBOX.north, z);
  const se = lonLatToPixel(MAP_BBOX.east, MAP_BBOX.south, z);
  const t = (v: number) => Math.floor(v / TILE_SIZE);
  return { x0: t(nw.x), x1: t(se.x), y0: t(nw.y), y1: t(se.y) };
}

export function tileAllowed(z: number, x: number, y: number): boolean {
  if (!TILE_ZOOMS.includes(z) || !Number.isInteger(x) || !Number.isInteger(y)) return false;
  const r = tileRange(z);
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

export const allowedTileCount = (): number =>
  TILE_ZOOMS.reduce((n, z) => {
    const r = tileRange(z);
    return n + (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
  }, 0);

const nw = lonLatToPixel(MAP_BBOX.west, MAP_BBOX.north, RADAR_ZOOM);
const se = lonLatToPixel(MAP_BBOX.east, MAP_BBOX.south, RADAR_ZOOM);
const originX = Math.floor(nw.x);
const originY = Math.floor(nw.y);
export const RADAR_GRID = {
  zoom: RADAR_ZOOM,
  originX,
  originY,
  width: Math.ceil(se.x) - originX,
  height: Math.ceil(se.y) - originY,
} as const;

export type RainClass = 0 | 1 | 2 | 3;

const RAIN_THRESHOLD = 0.1; // same as THRESHOLD in summary.ts

export function rainClass(mmPerHour: number): RainClass {
  if (!(mmPerHour >= RAIN_THRESHOLD)) return 0;
  const k = classify(mmPerHour);
  return k === "zwaar" ? 3 : k === "matig" ? 2 : 1;
}

export function packClasses(classes: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(classes.length / 4));
  classes.forEach((c, i) => {
    out[i >> 2] |= (c & 3) << ((i % 4) * 2);
  });
  return out;
}

export function unpackClasses(bytes: Uint8Array, count: number): Uint8Array {
  if (bytes.length !== Math.ceil(count / 4)) throw new RangeError("class bytes do not match cell count");
  return Uint8Array.from({ length: count }, (_, i) => (bytes[i >> 2] >> ((i % 4) * 2)) & 3);
}
