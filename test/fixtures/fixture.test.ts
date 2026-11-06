import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import h5wasm from "h5wasm/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const FIXTURE = fileURLToPath(new URL("./radar-sample.h5", import.meta.url));

describe("radar-sample.h5 fixture", () => {
  let file: InstanceType<typeof h5wasm.File>;

  beforeAll(async () => {
    await h5wasm.ready;
    file = new h5wasm.File(FIXTURE, "r");
  });
  afterAll(() => file?.close());

  it("has 25 image groups with a 40x40 uint16 image_data and calibration attributes", () => {
    const images = file.keys().filter((k) => /^image\d+$/.test(k));
    expect(images).toHaveLength(25);
    for (let i = 1; i <= 25; i++) {
      const ds = file.get(`image${i}/image_data`);
      expect(ds).toBeInstanceOf(h5wasm.Dataset);
      expect((ds as InstanceType<typeof h5wasm.Dataset>).shape).toEqual([40, 40]);
      expect((ds as InstanceType<typeof h5wasm.Dataset>).dtype).toBe("<H");
      const cal = file.get(`image${i}/calibration`) as InstanceType<typeof h5wasm.Group>;
      expect(Object.keys(cal.attrs)).toEqual(
        expect.arrayContaining(["calibration_formulas", "calibration_missing_data", "calibration_out_of_image"]),
      );
      expect(Object.keys((file.get(`image${i}`) as InstanceType<typeof h5wasm.Group>).attrs)).toContain("image_datetime_valid");
    }
  });

  it("keeps the geometry attributes named in docs/knmi-format.md, rewritten for the crop", () => {
    const geo = file.get("geographic") as InstanceType<typeof h5wasm.Group>;
    const attr = (name: string) => Array.from(geo.attrs[name].value as ArrayLike<number>);
    expect(attr("geo_number_columns")).toEqual([40]);
    expect(attr("geo_number_rows")).toEqual([40]);
    expect(attr("geo_column_offset")).toEqual([330]);
    expect(attr("geo_row_offset")).toEqual([3705]);
    expect(attr("geo_pixel_size_x")).toEqual([1]);
    expect(attr("geo_pixel_size_y")).toEqual([-1]);
    expect(attr("geo_product_corners")).toHaveLength(8);
    expect(geo.attrs.geo_pixel_def.value).toBe("LU");
    const proj = file.get("geographic/map_projection") as InstanceType<typeof h5wasm.Group>;
    expect(proj.attrs.projection_proj4_params.value).toBe(
      "+proj=stere +lat_0=90 +lon_0=0 +lat_ts=60 +a=6378137 +b=6356752 +x_0=0 +y_0=0 +units=km",
    );
  });

  it("contains at least one cell with precipitation", () => {
    const data = (file.get("image1/image_data") as InstanceType<typeof h5wasm.Dataset>).value as Uint16Array;
    expect(data.some((v) => v > 0 && v < 65534)).toBe(true);
  });

  it("has image groups whose valid times step +5 min from image1 (= overview start), by numeric suffix", () => {
    const parse = (s: string) => {
      const m = /^(\d{2})-([A-Z]{3})-(\d{4});(\d{2}):(\d{2}):(\d{2})\.\d{3}$/.exec(s);
      expect(m).not.toBeNull();
      const mon = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"].indexOf(m![2]);
      return Date.UTC(+m![3], mon, +m![1], +m![4], +m![5], +m![6]);
    };
    const valid = (n: number) =>
      parse((file.get(`image${n}`) as InstanceType<typeof h5wasm.Group>).attrs.image_datetime_valid.value as string);
    const overview = file.get("overview") as InstanceType<typeof h5wasm.Group>;
    expect(Array.from(overview.attrs.number_image_groups.value as ArrayLike<number>)).toEqual([25]);
    expect(valid(1)).toBe(parse(overview.attrs.product_datetime_start.value as string));
    for (let n = 1; n <= 25; n++) expect(valid(n)).toBe(valid(1) + 5 * 60_000 * (n - 1));
  });

  it("has calibration/nodata attribute values as documented, identical in all images", () => {
    for (let i = 1; i <= 25; i++) {
      const cal = file.get(`image${i}/calibration`) as InstanceType<typeof h5wasm.Group>;
      expect(cal.attrs.calibration_formulas.value).toBe("GEO=0.010000*PV+0.000000");
      expect(Array.from(cal.attrs.calibration_missing_data.value as ArrayLike<number>)).toEqual([65534]);
      expect(Array.from(cal.attrs.calibration_out_of_image.value as ArrayLike<number>)).toEqual([65535]);
      const img = file.get(`image${i}`) as InstanceType<typeof h5wasm.Group>;
      expect(img.attrs.image_geo_parameter.value).toBe("PRECIP_[MM]");
    }
  });
});

describe("harmonie-sample.nc fixture", () => {
  const NC = fileURLToPath(new URL("./harmonie-sample.nc", import.meta.url));
  const VAR = "total-precipitation-accumulation-01h-gl";
  let file: InstanceType<typeof h5wasm.File>;
  const ds = (name: string) => file.get(name) as InstanceType<typeof h5wasm.Dataset>;

  beforeAll(async () => {
    await h5wasm.ready;
    file = new h5wasm.File(NC, "r");
  });
  afterAll(() => file?.close());

  it("has the precipitation variable as float32 [time, gl, lat, lon] = [60, 1, 8, 8] in mm with a NaN fill value", () => {
    const v = ds(VAR);
    expect(v.shape).toEqual([60, 1, 8, 8]);
    expect(v.dtype).toBe("<f");
    expect(v.attrs.units.value).toBe("mm");
    expect(Number.isNaN((v.attrs._FillValue.value as Float32Array)[0])).toBe(true);
    expect([0, 1, 2, 3].map((i) => v.get_attached_scales(i))).toEqual([["/time"], ["/gl"], ["/latitude"], ["/longitude"]]);
  });

  it("has an hourly time axis starting one hour after the reference time of run 2026-11-06T07", () => {
    const ref = Number(ds("forecast_reference_time").value as bigint);
    const time = Array.from(ds("time").value as BigInt64Array, Number);
    expect(new Date(ref * 1000).toISOString()).toBe("2026-11-06T07:00:00.000Z");
    expect(file.attrs.forecast_run.value).toBe("2026-11-06T07");
    expect(ds("time").attrs.units.value).toBe("seconds since 1970-01-01T00:00:00+00:00");
    expect(time).toEqual(Array.from({ length: 60 }, (_, k) => ref + 3600 * (k + 1)));
  });

  it("has ascending latitude/longitude cropped to the documented window around Utrecht", () => {
    const lat = Array.from(ds("latitude").value as Float64Array);
    const lon = Array.from(ds("longitude").value as Float64Array);
    lat.forEach((x, i) => expect(x).toBeCloseTo(49 + 0.018 * (168 + i), 9));
    lon.forEach((x, i) => expect(x).toBeCloseTo(0.029 * (173 + i), 9));
  });

  it("has exactly one NaN (crop cell (0,0) at step 0) and some rain", () => {
    const data = ds(VAR).value as Float32Array;
    expect(data.reduce<number[]>((acc, x, i) => (Number.isNaN(x) ? [...acc, i] : acc), [])).toEqual([0]);
    expect(data.some((x) => x >= 0.1)).toBe(true);
  });

  it("stays under 100 kB", () => {
    expect(statSync(NC).size).toBeLessThan(100_000);
  });
});

describe("repo hygiene for prompt 0.1", () => {
  const root = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

  it("keeps the fixture under 100 kB", () => {
    expect(statSync(FIXTURE).size).toBeLessThan(100_000);
  });

  it("has h5wasm as the only runtime dependency", () => {
    const pkg = JSON.parse(readFileSync(root("package.json"), "utf8"));
    expect(Object.keys(pkg.dependencies)).toEqual(["h5wasm"]);
  });

  it("ignores tmp/ and .env", () => {
    const lines = readFileSync(root(".gitignore"), "utf8").split("\n").map((l) => l.trim());
    expect(lines).toContain("tmp/");
    expect(lines).toContain(".env");
  });
});
