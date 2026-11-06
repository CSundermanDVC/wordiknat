// Cut test/fixtures/harmonie-sample.nc from a downloaded HARMONIE precipitation file (see docs/knmi-harmonie.md).
// Run: node scripts/cut-harmonie-fixture.ts <source.nc> [row0] [col0] [size]
// Keeps every dataset and attribute and the axis order [time, gl, latitude, longitude]; crops the
// precipitation variable (all time steps) and latitude/longitude to size x size cells starting at
// (row0, col0), and re-attaches the dimension scales. If the crop holds no NaN, crop cell (0,0) at
// time step 0 becomes NaN so the reader's nodata path is testable.
import h5wasm from "h5wasm/node";
import { strict as assert } from "node:assert";

type H5Group = InstanceType<typeof h5wasm.Group>;
type H5Dataset = InstanceType<typeof h5wasm.Dataset>;
type H5Attrs = H5Group["attrs"];

const OUT = "test/fixtures/harmonie-sample.nc";
const VAR = "total-precipitation-accumulation-01h-gl";
// Rebuilt by make_scale/attach_scale: they hold object references that cannot be copied as values.
const SCALE_ATTRS = new Set(["CLASS", "NAME", "REFERENCE_LIST", "DIMENSION_LIST"]);

// Default window: 8 x 8 cells with Utrecht (52.0907 N, 5.1214 E -> source row 172, col 177) at crop cell (4,4).
const [src, r0 = "168", c0 = "173", n = "8"] = process.argv.slice(2);
if (!src) throw new Error("usage: node scripts/cut-harmonie-fixture.ts <source.nc> [row0] [col0] [size]");
const row0 = Number(r0);
const col0 = Number(c0);
const size = Number(n);

function copyAttrs(from: H5Attrs, to: Pick<H5Group, "create_attribute">): void {
  for (const [name, a] of Object.entries(from)) {
    if (SCALE_ATTRS.has(name)) continue;
    to.create_attribute(name, a.value as Parameters<H5Group["create_attribute"]>[1], a.shape, a.dtype);
  }
}

await h5wasm.ready;
const inp = new h5wasm.File(src, "r");
const v = inp.get(VAR) as H5Dataset;
const [steps, levels, rows, cols] = v.shape ?? [];
assert.equal(v.shape?.length, 4, "unexpected variable rank");
assert(row0 >= 0 && col0 >= 0 && size > 0 && row0 + size <= rows && col0 + size <= cols, "crop window outside grid");

const window: Record<string, { ranges: [number, number][]; shape: number[] }> = {
  [VAR]: { ranges: [[0, steps], [0, levels], [row0, row0 + size], [col0, col0 + size]], shape: [steps, levels, size, size] },
  latitude: { ranges: [[row0, row0 + size]], shape: [size] },
  longitude: { ranges: [[col0, col0 + size]], shape: [size] },
};

const crop = v.slice(window[VAR].ranges) as Float32Array;
const hasNaN = crop.some(Number.isNaN);
const data = hasNaN ? crop : crop.map((x, i) => (i === 0 ? Number.NaN : x));

// libver latest: compact v2 object headers keep the fixture small; track_order keeps the source's dataset order.
const out = new h5wasm.File(OUT, "w", { libver: "latest", track_order: true });
copyAttrs(inp.attrs, out);
const scales: string[] = [];
for (const name of inp.keys()) {
  const child = inp.get(name);
  if (!(child instanceof h5wasm.Dataset)) throw new Error(`unexpected entity ${name}`);
  const w = window[name];
  const ds = out.create_dataset({
    name,
    data: (name === VAR ? data : w ? child.slice(w.ranges) : child.value) as Float32Array,
    shape: w?.shape ?? child.shape,
    dtype: child.dtype,
    ...(name === VAR ? { chunks: w.shape, compression: 9 } : {}),
  });
  copyAttrs(child.attrs, ds);
  if (child.attrs.CLASS?.value === "DIMENSION_SCALE") {
    ds.make_scale(String(child.attrs.NAME.value));
    scales.push(name);
  }
}
for (const name of inp.keys()) {
  const from = inp.get(name) as H5Dataset;
  if (scales.includes(name) || !from.shape?.length) continue;
  from.shape.forEach((_, i) => {
    for (const path of from.get_attached_scales(i)) (out.get(name) as H5Dataset).attach_scale(i, path);
  });
}
out.close();
inp.close();
console.log(
  `wrote ${OUT}: rows ${row0}..${row0 + size - 1}, cols ${col0}..${col0 + size - 1}, ${steps} steps of ${src}` +
    (hasNaN ? "" : "; crop cell (0,0) at step 0 set to NaN"),
);
