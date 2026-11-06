import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import h5wasm from "h5wasm/node";
import { WordiknatError, type ErrorCode } from "./errors.ts";
import type { GridGeometry } from "./projection.ts";

// Reader for KNMI radar_forecast 2.0 files; layout and rules in docs/knmi-format.md.

export const STEP_COUNT = 25;
const STEP_MS = 5 * 60_000;
// Each image is a 5-minute sum in mm, so the hourly rate is 12x (docs/knmi-format.md).
const PER_HOUR = 3_600_000 / STEP_MS;

export type RadarStep = {
  time: Date;
  /** Raw uint16 pixel values, row-major [rows][columns]. Kept raw: calibrating all cells up front costs ~4x the memory. */
  pixels: Uint16Array;
  /** mm/u = scale * PV + offset. */
  scale: number;
  offset: number;
  /** Pixel values that mean "no data" (missing, out of image). */
  nodata: readonly number[];
};

export type RadarFile = { issuedAt: Date; geometry: GridGeometry; steps: RadarStep[] };

type Group = InstanceType<typeof h5wasm.Group>;
type Dataset = InstanceType<typeof h5wasm.Dataset>;

const bad = (): never => {
  throw new WordiknatError("BAD_FILE");
};

const HDF5_MAGIC = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];

// The superblock sits at offset 0 or a power of two from 512 (user block); checking first keeps
// garbage off the disk and libhdf5 diagnostics off stderr for non-HDF5 input (broken HDF5 still logs).
function isHdf5(bytes: Uint8Array): boolean {
  for (let off = 0; off + 8 <= bytes.length; off = off === 0 ? 512 : off * 2) {
    if (HDF5_MAGIC.every((b, i) => bytes[off + i] === b)) return true;
  }
  return false;
}

function group(file: Group, path: string): Group {
  const g = file.get(path);
  return g instanceof h5wasm.Group ? g : bad();
}

function str(g: Group, name: string): string {
  const v = g.attrs[name]?.value;
  return typeof v === "string" ? v.trim() : bad();
}

function num(g: Group, name: string): number {
  const v = g.attrs[name]?.value;
  const n = typeof v === "number" ? v : ArrayBuffer.isView(v) && (v as ArrayLike<unknown>).length === 1 ? (v as ArrayLike<unknown>)[0] : undefined;
  return typeof n === "number" && Number.isFinite(n) ? n : bad();
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Parses "04-NOV-2026;11:00:00.000" (UTC). */
function parseTime(s: string): Date {
  const m = /^(\d{2})-([A-Z]{3})-(\d{4});(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(s);
  const mon = m ? MONTHS.indexOf(m[2]) : -1;
  if (!m || mon < 0) return bad();
  return new Date(Date.UTC(+m[3], mon, +m[1], +m[4], +m[5], +m[6], +m[7]));
}

function readGeometry(file: Group): GridGeometry {
  const geo = group(file, "geographic");
  if (str(geo, "geo_pixel_def") !== "LU") bad();
  const proj = Object.fromEntries(
    str(group(file, "geographic/map_projection"), "projection_proj4_params")
      .split(/\s+/)
      .map((t) => t.replace(/^\+/, "").split("=")),
  );
  // projection.ts implements only north-polar stereographic with lon_0 = 0 and km output.
  if (proj.proj !== "stere" || proj.lat_0 !== "90" || proj.lon_0 !== "0" || proj.units !== "km") bad();
  if ((proj.x_0 ?? "0") !== "0" || (proj.y_0 ?? "0") !== "0") bad();
  const a = Number(proj.a);
  const b = Number(proj.b);
  const latTs = Number(proj.lat_ts);
  if (!(a > 0 && b > 0 && b <= a && latTs > 0 && latTs <= 90)) bad();

  const columns = num(geo, "geo_number_columns");
  const rows = num(geo, "geo_number_rows");
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns <= 0 || rows <= 0) bad();
  const pixelSizeX = num(geo, "geo_pixel_size_x");
  const pixelSizeY = num(geo, "geo_pixel_size_y");
  if (pixelSizeX <= 0 || pixelSizeY >= 0) bad();
  return {
    originX: num(geo, "geo_column_offset") * pixelSizeX,
    originY: num(geo, "geo_row_offset") * pixelSizeY,
    pixelSizeX,
    pixelSizeY,
    columns,
    rows,
    a,
    b,
    latTs,
  };
}

function readStep(file: Group, n: number, geometry: GridGeometry): RadarStep {
  const img = group(file, `image${n}`);
  if (str(img, "image_geo_parameter") !== "PRECIP_[MM]") bad();
  const cal = group(file, `image${n}/calibration`);
  const f = /^GEO=([-+]?\d+(?:\.\d+)?)\*PV\+([-+]?\d+(?:\.\d+)?)$/.exec(str(cal, "calibration_formulas")) ?? bad();
  const ds = file.get(`image${n}/image_data`);
  if (!(ds instanceof h5wasm.Dataset)) return bad();
  const shape = (ds as Dataset).shape;
  if (ds.dtype !== "<H" || shape?.length !== 2 || shape[0] !== geometry.rows || shape[1] !== geometry.columns) bad();
  const pixels = ds.value;
  if (!(pixels instanceof Uint16Array) || pixels.length !== geometry.rows * geometry.columns) return bad();
  return {
    time: parseTime(str(img, "image_datetime_valid")),
    pixels,
    scale: Number(f[1]) * PER_HOUR,
    offset: Number(f[2]) * PER_HOUR,
    nodata: [num(cal, "calibration_missing_data"), num(cal, "calibration_out_of_image")],
  };
}

function readOpen(file: Group): RadarFile {
  const overview = group(file, "overview");
  const imageKeys = file.keys().filter((k) => /^image\d+$/.test(k));
  if (num(overview, "number_image_groups") !== STEP_COUNT || imageKeys.length !== STEP_COUNT) bad();
  const issuedAt = parseTime(str(overview, "product_datetime_start"));
  const geometry = readGeometry(file);
  // By numeric suffix: keys() is alphabetical (image1, image10, ...).
  const steps = Array.from({ length: STEP_COUNT }, (_, i) => readStep(file, i + 1, geometry));
  // The x12 conversion and the forecast timeline both rely on image1 = issue time, +5 min each.
  if (steps.some((s, i) => s.time.getTime() !== issuedAt.getTime() + i * STEP_MS)) bad();
  return { issuedAt, geometry, steps };
}

/**
 * Opens HDF5 bytes with h5wasm and hands the open file to `read`; the file is closed and the temp copy
 * removed on every path. Non-HDF5 bytes and any non-WordiknatError failure become WordiknatError(code).
 */
export async function withHdf5File<T>(bytes: Uint8Array, code: ErrorCode, read: (file: Group) => T): Promise<T> {
  if (!(bytes instanceof Uint8Array) || !isHdf5(bytes)) throw new WordiknatError(code);
  await h5wasm.ready;
  // h5wasm/node reads through the host filesystem (NODERAWFS), so the bytes go to a private temp file.
  const dir = mkdtempSync(join(tmpdir(), "wordiknat-"));
  let file: InstanceType<typeof h5wasm.File> | undefined;
  try {
    const path = join(dir, "data.h5");
    writeFileSync(path, bytes, { mode: 0o600 });
    file = new h5wasm.File(path, "r");
    return read(file);
  } catch (err) {
    throw err instanceof WordiknatError ? err : new WordiknatError(code);
  } finally {
    file?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Decodes a KNMI radar_forecast 2.0 HDF5 file. Throws WordiknatError("BAD_FILE") on anything unexpected. */
export function readRadarFile(bytes: Uint8Array): Promise<RadarFile> {
  return withHdf5File(bytes, "BAD_FILE", readOpen);
}

/** The STEP_COUNT rain rates (mm/u) at one cell; null where the file has no data. */
export function valuesAt(file: RadarFile, cell: { col: number; row: number }): (number | null)[] {
  const { col, row } = cell;
  const { columns, rows } = file.geometry;
  if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || col >= columns || row < 0 || row >= rows) {
    throw new WordiknatError("OUTSIDE_GRID");
  }
  return file.steps.map((s) => {
    const pv = s.pixels[row * columns + col];
    return s.nodata.includes(pv) ? null : s.scale * pv + s.offset;
  });
}
