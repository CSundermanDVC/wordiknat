import h5wasm from "h5wasm/node";
import { WordiknatError } from "./errors.ts";
import { withHdf5File } from "./hdf5.ts";

// Reader for the KNMI HARMONIE uwcw-ha-det-nl-s1 1.0 precipitation file (NetCDF4 on HDF5);
// layout and rules in docs/knmi-harmonie.md.

/** Regular lat/lon grid of cell centres; row 0 is the south edge, col 0 the west edge. */
export type HarmonieGeometry = { rows: number; cols: number; lat0: number; lon0: number; dLat: number; dLon: number };

/** The full 390 x 390 model grid as documented. */
export const HARMONIE_GRID: HarmonieGeometry = { rows: 390, cols: 390, lat0: 49, lon0: 0, dLat: 0.018, dLon: 0.029 };

export type HarmonieFile = {
  /** Run reference time. */
  issuedAt: Date;
  geometry: HarmonieGeometry;
  /** End of each hour; steps[k] is the amount (mm) in the hour ending at times[k]. */
  times: Date[];
  /** Row-major [rows][cols] mm per step; NaN means no data. */
  steps: Float32Array[];
};

const VARIABLE = "total-precipitation-accumulation-01h-gl";
const SECONDS = "seconds since 1970-01-01T00:00:00+00:00";
const MIN_STEPS = 24;
const HOUR_S = 3600;
// Measured axis noise is ~1e-14 degrees; anything beyond this fraction of a step is not a regular grid.
const AXIS_TOLERANCE = 1e-6;

type Group = InstanceType<typeof h5wasm.Group>;
type Dataset = InstanceType<typeof h5wasm.Dataset>;

const bad = (): never => {
  throw new WordiknatError("HOURLY_BAD_FILE");
};

function dataset(file: Group, name: string): Dataset {
  const ds = file.get(name);
  return ds instanceof h5wasm.Dataset ? ds : bad();
}

function unitsOf(ds: Dataset): unknown {
  return ds.attrs.units?.value;
}

/** Any numeric value or typed array (int64 comes back as bigint) as finite numbers. */
function numbers(ds: Dataset): number[] {
  const v = ds.value;
  const list = typeof v === "bigint" || typeof v === "number" ? [v] : ArrayBuffer.isView(v) && !(v instanceof DataView) ? Array.from(v as ArrayLike<number | bigint>) : bad();
  const out = list.map(Number);
  return out.every(Number.isFinite) ? out : bad();
}

/** First value and step of a strictly ascending, evenly spaced axis. */
function regularAxis(values: number[]): { first: number; step: number } {
  if (values.length < 2) bad();
  const step = (values[values.length - 1] - values[0]) / (values.length - 1);
  if (!(step > 0) || values.some((x, i) => i > 0 && Math.abs(x - values[i - 1] - step) > step * AXIS_TOLERANCE)) bad();
  return { first: values[0], step };
}

function fillValue(ds: Dataset): number {
  const v = ds.attrs._FillValue?.value;
  if (v === undefined) return Number.NaN;
  const n = typeof v === "number" ? v : ArrayBuffer.isView(v) && (v as ArrayLike<unknown>).length === 1 ? (v as ArrayLike<unknown>)[0] : undefined;
  return typeof n === "number" ? n : bad();
}

function readOpen(file: Group): HarmonieFile {
  const ref = dataset(file, "forecast_reference_time");
  const time = dataset(file, "time");
  if (unitsOf(ref) !== SECONDS || unitsOf(time) !== SECONDS) bad();
  const refS = numbers(ref);
  if (refS.length !== 1) bad();
  const issuedS = refS[0];
  const timesS = numbers(time);
  // Hourly steps, the first one ending one hour after the reference time (docs/knmi-harmonie.md).
  if (timesS.length < MIN_STEPS || timesS.some((t, i) => t !== issuedS + (i + 1) * HOUR_S)) bad();

  const latitude = numbers(dataset(file, "latitude"));
  const longitude = numbers(dataset(file, "longitude"));
  const lat = regularAxis(latitude);
  const lon = regularAxis(longitude);
  const rows = latitude.length;
  const cols = longitude.length;

  const v = dataset(file, VARIABLE);
  const shape = v.shape ?? bad();
  const expected = [timesS.length, 1, rows, cols];
  if (v.dtype !== "<f" || unitsOf(v) !== "mm" || shape.length !== 4 || shape.some((n, i) => n !== expected[i])) bad();
  const raw = v.value;
  const cells = rows * cols;
  if (!(raw instanceof Float32Array) || raw.length !== timesS.length * cells) return bad();
  const fill = fillValue(v);
  // A numeric fill value becomes NaN so lookups have one "no data" marker; NaN fill needs no copy.
  const data = Number.isNaN(fill) ? raw : raw.map((x) => (x === fill ? Number.NaN : x));

  return {
    issuedAt: new Date(issuedS * 1000),
    geometry: { rows, cols, lat0: lat.first, lon0: lon.first, dLat: lat.step, dLon: lon.step },
    times: timesS.map((t) => new Date(t * 1000)),
    steps: timesS.map((_, k) => data.subarray(k * cells, (k + 1) * cells)),
  };
}

/** Decodes a HARMONIE precipitation file. Throws WordiknatError("HOURLY_BAD_FILE") on anything unexpected. */
export function readHarmonieFile(bytes: Uint8Array): Promise<HarmonieFile> {
  return withHdf5File(bytes, "HOURLY_BAD_FILE", readOpen);
}

/** Nearest cell centre; more than half a cell outside the grid throws OUTSIDE_GRID. */
export function latLonToHarmonieCell(lat: number, lon: number, g: HarmonieGeometry): { row: number; col: number } {
  const r = (lat - g.lat0) / g.dLat;
  const c = (lon - g.lon0) / g.dLon;
  // Negated range checks so NaN also lands here.
  if (!(r >= -0.5 && r <= g.rows - 0.5 && c >= -0.5 && c <= g.cols - 0.5)) throw new WordiknatError("OUTSIDE_GRID");
  // Clamp: exactly half a cell outside rounds past the edge (or to -0).
  return { row: Math.min(g.rows - 1, Math.max(0, Math.round(r))), col: Math.min(g.cols - 1, Math.max(0, Math.round(c))) };
}

/** The amount (mm) per step at one cell; null where the file has no data. */
export function hourlyValuesAt(file: HarmonieFile, cell: { row: number; col: number }): (number | null)[] {
  const { row, col } = cell;
  const { rows, cols } = file.geometry;
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= rows || col < 0 || col >= cols) {
    throw new WordiknatError("OUTSIDE_GRID");
  }
  return file.steps.map((s) => {
    const v = s[row * cols + col];
    return Number.isNaN(v) ? null : v;
  });
}
