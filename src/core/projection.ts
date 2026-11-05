import { WordiknatError } from "./errors.ts";

// Ellipsoidal polar stereographic (north pole, true scale at latTs, lon_0 = 0), Math only, units km.
// Grid layout (docs/knmi-format.md, pixel_def "LU"): cell (0,0) is the upper-left cell; col grows
// east (+x), row grows south (-y). Projected position of the upper-left corner is
// (originX, originY) = (geo_column_offset, -geo_row_offset); cell (col,row) covers
// x in [originX + col, +1) and y in (originY - row - 1, originY - row].
export type GridGeometry = {
  originX: number;
  originY: number;
  pixelSizeX: number;
  pixelSizeY: number; // negative: y decreases with row
  columns: number;
  rows: number;
  a: number;
  b: number;
  latTs: number;
};

/** Geometry of KNMI radar_forecast 2.0 as recorded in docs/knmi-format.md. */
export const KNMI_RADAR_GEOMETRY: GridGeometry = {
  originX: 0,
  originY: -3650,
  pixelSizeX: 1,
  pixelSizeY: -1,
  columns: 700,
  rows: 765,
  a: 6378137,
  b: 6356752,
  latTs: 60,
};

const RAD = Math.PI / 180;

function consts(g: GridGeometry) {
  const e = Math.sqrt(1 - (g.b * g.b) / (g.a * g.a));
  const t = (phi: number) => {
    const es = e * Math.sin(phi);
    return Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - es) / (1 + es), e / 2);
  };
  const phiTs = g.latTs * RAD;
  const m = Math.cos(phiTs) / Math.sqrt(1 - e * e * Math.sin(phiTs) ** 2);
  return { e, t, k: (g.a * m) / t(phiTs) / 1000 };
}

export function latLonToCell(lat: number, lon: number, geom: GridGeometry): { col: number; row: number } {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) throw new WordiknatError("OUTSIDE_GRID");
  const { t, k } = consts(geom);
  const rho = k * t(lat * RAD);
  const x = rho * Math.sin(lon * RAD);
  const y = -rho * Math.cos(lon * RAD);
  const col = Math.floor((x - geom.originX) / geom.pixelSizeX);
  const row = Math.floor((y - geom.originY) / geom.pixelSizeY);
  if (col < 0 || col >= geom.columns || row < 0 || row >= geom.rows) throw new WordiknatError("OUTSIDE_GRID");
  return { col, row };
}

/** Lat/lon of the centre of a cell. */
export function cellToLatLon(col: number, row: number, geom: GridGeometry): { lat: number; lon: number } {
  const { e, k } = consts(geom);
  const x = geom.originX + (col + 0.5) * geom.pixelSizeX;
  const y = geom.originY + (row + 0.5) * geom.pixelSizeY;
  const rho = Math.hypot(x, y);
  const tt = rho / k;
  let phi = Math.PI / 2 - 2 * Math.atan(tt);
  for (let i = 0; i < 10; i++) {
    const es = e * Math.sin(phi);
    phi = Math.PI / 2 - 2 * Math.atan(tt * Math.pow((1 - es) / (1 + es), e / 2));
  }
  return { lat: phi / RAD, lon: Math.atan2(x, -y) / RAD };
}
