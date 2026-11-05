// Cut test/fixtures/radar-sample.h5 from a downloaded radar_forecast file (see docs/knmi-format.md).
// Run: node scripts/cut-fixture.ts tmp/RAD_NL25_RAC_FM_<stamp>.h5 [row0] [col0] [size]
// Copies every group, dataset and attribute; crops each image_data to size x size cells starting
// at (row0, col0) and rewrites the geographic attributes so crop cell (0,0) keeps its real location.
import h5wasm from "h5wasm/node";
import { strict as assert } from "node:assert";
import { mkdirSync } from "node:fs";

type H5Group = InstanceType<typeof h5wasm.Group>;
type H5Attrs = H5Group["attrs"];

const OUT = "test/fixtures/radar-sample.h5";
const [src, r0 = "55", c0 = "330", n = "40"] = process.argv.slice(2);
if (!src) throw new Error("usage: node scripts/cut-fixture.ts <source.h5> [row0] [col0] [size]");
const row0 = Number(r0);
const col0 = Number(c0);
const size = Number(n);

// Inverse polar stereographic (Snyder 1987, eq. 21-33/7-9) for the file's proj4 string.
const A = 6378137;
const B = 6356752;
const E = Math.sqrt(1 - (B * B) / (A * A));
const RAD = Math.PI / 180;
const tOf = (phi: number) =>
  Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi)), E / 2);
const PHI_C = 60 * RAD;
const MC = Math.cos(PHI_C) / Math.sqrt(1 - E * E * Math.sin(PHI_C) ** 2);
const TC = tOf(PHI_C);

function toLonLat(xKm: number, yKm: number): [number, number] {
  const rho = Math.hypot(xKm, yKm) * 1000;
  const t = (rho * TC) / (A * MC);
  let phi = Math.PI / 2 - 2 * Math.atan(t);
  for (let i = 0; i < 10; i++) {
    const es = E * Math.sin(phi);
    phi = Math.PI / 2 - 2 * Math.atan(t * Math.pow((1 - es) / (1 + es), E / 2));
  }
  return [Math.atan2(xKm, -yKm) / RAD, phi / RAD];
}

const num = (attrs: H5Attrs, name: string) => Number((attrs[name].value as ArrayLike<number>)[0]);

// Corners in the file's order (lower-left, upper-left, upper-right, lower-right) of a grid window.
function corners(colOff: number, rowOff: number, cols: number, rows: number, dx: number, dy: number): number[] {
  const x0 = colOff * dx;
  const y0 = rowOff * dy;
  const x1 = (colOff + cols) * dx;
  const y1 = (rowOff + rows) * dy;
  return [toLonLat(x0, y1), toLonLat(x0, y0), toLonLat(x1, y0), toLonLat(x1, y1)].flat();
}

function copyAttrs(from: H5Attrs, to: Pick<H5Group, "create_attribute">, override: Record<string, unknown> = {}): void {
  for (const [name, a] of Object.entries(from)) {
    const value = name in override ? override[name] : a.value;
    to.create_attribute(name, value as Parameters<H5Group["create_attribute"]>[1], a.shape, a.dtype);
  }
}

await h5wasm.ready;
const inp = new h5wasm.File(src, "r");
const geo = inp.get("geographic") as H5Group;
const cols = num(geo.attrs, "geo_number_columns");
const rows = num(geo.attrs, "geo_number_rows");
assert(row0 >= 0 && col0 >= 0 && size > 0 && row0 + size <= rows && col0 + size <= cols, "crop window outside grid");

const dx = num(geo.attrs, "geo_pixel_size_x");
const dy = num(geo.attrs, "geo_pixel_size_y");
const colOff = num(geo.attrs, "geo_column_offset");
const rowOff = num(geo.attrs, "geo_row_offset");

// Self-check: our inverse projection reproduces the source's own corner attribute.
const srcCorners = Array.from(geo.attrs.geo_product_corners.value as Float32Array);
corners(colOff, rowOff, cols, rows, dx, dy).forEach((v, i) =>
  assert(Math.abs(v - srcCorners[i]) < 1e-4, `corner ${i}: ${v} vs ${srcCorners[i]}`),
);

const geoOverride = {
  geo_number_columns: [size],
  geo_number_rows: [size],
  geo_column_offset: [colOff + col0],
  geo_row_offset: [rowOff + row0],
  geo_product_corners: corners(colOff + col0, rowOff + row0, size, size, dx, dy),
};

mkdirSync("test/fixtures", { recursive: true });
// libver latest: compact v2 object headers keep the 25-image fixture under 100 kB.
const out = new h5wasm.File(OUT, "w", { libver: "latest" });
copyAttrs(inp.attrs, out);
for (const name of inp.keys()) {
  const g = inp.get(name) as H5Group;
  const og = out.create_group(name);
  const override = name === "geographic" ? geoOverride : name.startsWith("image") ? { image_size: [size * size * 2] } : {};
  copyAttrs(g.attrs, og, override);
  for (const childName of g.keys()) {
    const child = g.get(childName);
    if (child instanceof h5wasm.Dataset) {
      const crop = child.slice([
        [row0, row0 + size],
        [col0, col0 + size],
      ]);
      const ds = og.create_dataset({
        name: childName,
        data: crop as Uint16Array,
        shape: [size, size],
        dtype: child.dtype,
        chunks: [size, size],
        compression: 9,
      });
      copyAttrs(child.attrs, ds);
    } else if (child instanceof h5wasm.Group) {
      assert.equal(child.keys().length, 0, `unexpected nesting under ${name}/${childName}`);
      copyAttrs(child.attrs, og.create_group(childName));
    } else {
      throw new Error(`unexpected entity ${name}/${childName}`);
    }
  }
}
out.close();
inp.close();
console.log(`wrote ${OUT}: rows ${row0}..${row0 + size - 1}, cols ${col0}..${col0 + size - 1} of ${src}`);
