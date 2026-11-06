# Test fixtures

## radar-sample.h5

A 40 x 40-cell crop of a real KNMI `radar_forecast` 2.0 file (CC BY 4.0), with all 25 images and
every group, dataset and attribute of the original.

- Source file: `RAD_NL25_RAC_FM_202611041100.h5` (issued 2026-11-04 11:00 UTC)
- Downloaded: 2026-11-04
- Crop window: rows 55..94, columns 330..369 of the 765 x 700 grid (North Sea, north of the Wadden Islands,
  around 5.0-5.7 °E, 55.0-55.4 °N), chosen because it holds the run's precipitation cells.
- Rewritten attributes: `geographic/@geo_number_rows` and `@geo_number_columns` = 40,
  `@geo_row_offset` = 3705, `@geo_column_offset` = 330, `@geo_product_corners` recomputed for the
  crop's outer edges, and `imageN/@image_size` = 3200. Crop cell (0,0) is source cell (55,330), at
  the same real-world location. `statistics/` attributes are copied unchanged from the full image.
- Content: values are 0 or 1 (0.01 mm per 5 min). The source file has no nodata cells (65534 or
  65535), so the fixture has none either.

Regenerate (needs `KNMI_API_KEY` in `.env`; the newest file will differ from the one above):

```bash
node --env-file=.env scripts/fetch-sample.ts
node scripts/cut-fixture.ts tmp/RAD_NL25_RAC_FM_<stamp>.h5 [row0] [col0] [size]
```

`cut-fixture.ts` defaults to row0 55, col0 330, size 40; pick a window that contains rain (and
nodata, if the run has any).

## harmonie-sample.nc

An 8 x 8-cell crop of a real KNMI HARMONIE `uwcw-ha-det-nl-s1` 1.0 precipitation file
(CC BY 4.0), with all 60 time steps and every dataset and attribute of the original (format:
`docs/knmi-harmonie.md`).

- Source file: `uwcw-ha-det-nl-2km_20261106T07_total-precipitation-accumulation-01h-gl.nc`
  (run 2026-11-06 07:00 UTC, 5 280 611 bytes)
- Downloaded: 2026-11-06
- Crop window: latitude rows 168..175 (52.024..52.150 °N), longitude columns 173..180
  (5.017..5.220 °E) of the 390 x 390 grid. Utrecht (52.0907 °N, 5.1214 °E) is source cell
  (172, 177) = crop cell (4, 4).
- Kept: variable name `total-precipitation-accumulation-01h-gl`, shape `[60, 1, 8, 8]` (axis order
  `[time, gl, latitude, longitude]`), float32, `@units "mm"`, `@_FillValue` NaN, the `time` axis
  (int64, `seconds since 1970-01-01T00:00:00+00:00`, 2026-11-06T08:00Z + 1 h per step),
  `forecast_reference_time`, `latitude_longitude`, `gl`, root `@forecast_run "2026-11-06T07"`,
  and the dimension scales (re-attached, so `get_attached_scales` still names `/time`, `/gl`,
  `/latitude`, `/longitude`). `latitude` and `longitude` are cropped to the window.
- Rewritten value: the source has no NaN, so crop cell (0, 0) (52.024 °N, 5.017 °E) at time step 0
  (the hour ending 2026-11-06T08:00Z) is set to NaN. It is the only NaN in the fixture.
- Storage differs from the source: one chunk `[60, 1, 8, 8]`, deflate 9 only (the source uses
  fletcher32 + shuffle + deflate 3 in `[1, 1, 75, 75]` chunks); attributes come back sorted by name.
- Content: steps 0..33 are dry (all cells 0, apart from the NaN); rain >= 0.1 mm at steps 40
  (21 cells, max 0.36 mm), 50, 51 and 52. At Utrecht: 0.11 mm at step 40 (hour ending
  2026-11-08T00:00Z), small amounts at steps 35, 51 and 52, otherwise 0.

Regenerate (needs `KNMI_API_KEY` in `.env`; the newest run will differ from the one above). Write
the download outside the repo:

```bash
node --env-file=.env scripts/fetch-sample.ts harmonie <download-dir>
node scripts/cut-harmonie-fixture.ts <download-dir>/uwcw-ha-det-nl-2km_<YYYYMMDD>T<HH>_total-precipitation-accumulation-01h-gl.nc [row0] [col0] [size]
```

`cut-harmonie-fixture.ts` defaults to row0 168, col0 173, size 8. From the same source file it
reproduces the same content; the bytes differ per run because HDF5 stores object timestamps.
