import { lonLatToPixel, MAP_BBOX, RADAR_GRID, TILE_SIZE, tileAllowed } from "../../src/core/map-grid.ts";

export type ViewKind = "nl" | "local";
/** A fixed map window: (x0, y0) is the Mercator pixel of its upper-left corner at `zoom`. */
export type View = { kind: ViewKind; zoom: number; x0: number; y0: number; width: number; height: number };
export type Grid = { zoom: number; originX: number; originY: number; width: number; height: number };

export const VIEW_ZOOM = { nl: 8, local: 10 } as const;
export const LOCAL_SIZE = 512;

/** MAP_BBOX in whole pixels at `zoom`, rounded outward. */
function boxPx(zoom: number) {
  const nw = lonLatToPixel(MAP_BBOX.west, MAP_BBOX.north, zoom);
  const se = lonLatToPixel(MAP_BBOX.east, MAP_BBOX.south, zoom);
  return { x0: Math.floor(nw.x), y0: Math.floor(nw.y), x1: Math.ceil(se.x), y1: Math.ceil(se.y) };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function viewFor(kind: ViewKind, pin: { lat: number; lon: number } | null): View {
  if (kind === "local" && pin && Number.isFinite(pin.lat) && Number.isFinite(pin.lon)) {
    const zoom = VIEW_ZOOM.local;
    const b = boxPx(zoom);
    const p = lonLatToPixel(pin.lon, pin.lat, zoom);
    const half = LOCAL_SIZE / 2;
    return {
      kind,
      zoom,
      x0: clamp(Math.round(p.x) - half, b.x0, b.x1 - LOCAL_SIZE),
      y0: clamp(Math.round(p.y) - half, b.y0, b.y1 - LOCAL_SIZE),
      width: LOCAL_SIZE,
      height: LOCAL_SIZE,
    };
  }
  const zoom = VIEW_ZOOM.nl;
  const b = boxPx(zoom);
  return { kind: "nl", zoom, x0: b.x0, y0: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 };
}

/** Every allowed tile intersecting the window, with its draw offset in window pixels. */
export function tilesFor(view: View): Array<{ z: number; x: number; y: number; dx: number; dy: number }> {
  const t = (v: number) => Math.floor(v / TILE_SIZE);
  const out = [];
  for (let y = t(view.y0); y <= t(view.y0 + view.height - 1); y++) {
    for (let x = t(view.x0); x <= t(view.x0 + view.width - 1); x++) {
      if (tileAllowed(view.zoom, x, y)) {
        out.push({ z: view.zoom, x, y, dx: x * TILE_SIZE - view.x0, dy: y * TILE_SIZE - view.y0 });
      }
    }
  }
  return out;
}

export function pinPosition(view: View, lat: number, lon: number): { x: number; y: number; visible: boolean } {
  const p = lonLatToPixel(lon, lat, view.zoom);
  const x = p.x - view.x0;
  const y = p.y - view.y0;
  return { x, y, visible: x >= 0 && x <= view.width && y >= 0 && y <= view.height };
}

/** Where the radar grid lands in window pixels; pass the payload's grid to use its origin. */
export function radarRect(view: View, grid: Grid = RADAR_GRID): { dx: number; dy: number; dw: number; dh: number } {
  const s = 2 ** (view.zoom - grid.zoom);
  return { dx: grid.originX * s - view.x0, dy: grid.originY * s - view.y0, dw: grid.width * s, dh: grid.height * s };
}
