# KNMI HARMONIE `uwcw-ha-det-nl-s1` 1.0: precipitation file

Recorded on 2026-11-06 from real listing calls and one real file, downloaded with
`node --env-file=.env scripts/fetch-sample.ts harmonie <dir>`:
`uwcw-ha-det-nl-2km_20261106T07_total-precipitation-accumulation-01h-gl.nc`, 5 280 611 bytes.
Every value below was read from that file with h5wasm 0.10.3 (HDF5 2.0.0). To dump an already
downloaded file: `node scripts/fetch-sample.ts <file.nc>`.

## API flow

All requests go to `https://api.dataplatform.knmi.nl/open-data/v1` except the download itself.

1. `GET /datasets/uwcw-ha-det-nl-s1/versions/1.0/files?maxKeys=50&orderBy=created&sorting=desc`
   with header `Authorization: <KNMI_API_KEY>` returned `200`. The body has a `files` array
   (`filename`, `size`, `created`, `lastModified`) plus `isTruncated`, `resultCount`,
   `maxResults`, `startAfterFilename` and `nextPageToken`.
2. `GET /datasets/uwcw-ha-det-nl-s1/versions/1.0/files/{filename}/url` with the same header returned
   `200` and a JSON body with `temporaryDownloadUrl`.
3. `GET <temporaryDownloadUrl>` **without** an `Authorization` header returned `200` and the raw
   bytes. The download host is a pre-signed S3 URL on
   `knmi-kdp-datasets-eu-west-1.s3.eu-west-1.amazonaws.com`, not the API host; the key never goes
   there.

## File name and finding the newest precipitation run

Pattern (checked against 600 real names, 27 runs):

```
^uwcw-ha-det-nl-2km_\d{8}T\d{2}_total-precipitation-accumulation-01h-gl\.nc$
```

`<YYYYMMDD>T<HH>` is the reference time (run) in UTC. Each run delivers exactly 22 files, one per
parameter; only this one file is needed. Similar names the pattern must **not** match:
`solid-precipitation-accumulation-01h-gl`, `rainfall-accumulation-01h-gl`,
`total-precipitation-rate-gl`. The other files are up to 58.5 MB (wind gusts), so nothing is ever
downloaded except a name that matches the pattern exactly.

The 22 parameters per run: `air-pressure-msl`, `air-temperature-hagl`, `dew-point-temperature-hagl`,
`effective-type-cloud-area-fraction-atm`, `graupel-accumulation-01h-gl`, `graupel-rate-gl`,
`rainfall-accumulation-01h-gl`, `rainfall-rate-gl`, `relative-humidity-hagl`,
`snowfall-accumulation-01h-gl`, `snowfall-rate-gl`, `solid-precipitation-accumulation-01h-gl`,
`solid-precipitation-rate-gl`, `total-precipitation-accumulation-01h-gl`,
`total-precipitation-rate-gl`, `wet-bulb-globe-temperature-liljegren-hagl`,
`wind-chill-temperature-hagl`, `wind-from-direction-hagl`, `wind-speed-components-hagl`,
`wind-speed-hagl`, `wind-speed-of-gust-01h-hagl`, `wind-speed-of-gust-components-01h-hagl`.

Listing filter options, tested:

- There is no filter on (part of) the name. `begin` and `end` expect an ISO 8601 date with a
  time zone (`begin=<name prefix>` returned `400`: "is not a valid ISO8601 datetime with a timezone").
- `startAfterFilename` cannot be combined with `orderBy` or `sorting` (`400`: "cannot use orderBy,
  nextPageToken, sorting, begin or end when using startAfterFilename"), so "newest first" and
  "after this name" do not go together.

Hence: **`maxKeys=50&orderBy=created&sorting=desc`**, filter on the exact pattern and pick the
highest name (within the pattern the name sorts by reference time). Why 50: a run is published in
about a minute (T07: 09:19:11 to 09:20:08). In the worst case 21 files of a half-published new run
sit at the top; below them the previous run is complete within 21 + 22 = 43 lines. The
precipitation file sits in the middle of its run (T07: line 9 of 22 in the newest-first listing;
the wind files come last).

## Run frequency and availability

- One run every hour (T00 … T23), in the listing 2026-11-05T05 through 2026-11-06T07 without gaps.
- Delay between reference time and `created` of the precipitation file over 27 runs:
  139.8 to 157.4 minutes (2 h 20 to 2 h 37). On 2026-11-06 around 10:20 UTC, T07 was the newest run.
- Size of the precipitation file: 3.2 to 6.1 MB, depending on how much rain falls.

## HDF5 tree

File format: NetCDF4 on HDF5 (magic `89 48 44 46 0d 0a 1a 0a`, `@_NCProperties`
`version=2,netcdf=4.10.0,hdf5=2.1.0`). Datasets in creation order:

```
/
  @conventions   "CF-1.9"
  @title         "Arcus dataset"
  @institution   "KNMI"
  @source        "UWCW"
  @model_version "ha43"
  @references    ""
  @comment       ""
  @time_fmt      "%Y-%m-%dT%H"
  @forecast_run  "2026-11-06T07"
  @_NCProperties "version=2,netcdf=4.10.0,hdf5=2.1.0"
  forecast_reference_time   scalar, int64 "<q", value 1793948400 (2026-11-06T07:00Z)
    @units    "seconds since 1970-01-01T00:00:00+00:00"
    @calendar "proleptic_gregorian"
  latitude_longitude        scalar, int64, value 0 (grid mapping variable)
    @grid_mapping_name "latitude_longitude"
    @proj4_params      "+proj=longlat +a=6371229.0 +e=0 +no_defs"
  total-precipitation-accumulation-01h-gl   [60, 1, 390, 390] float32 "<f"
    @units          "mm"
    @_FillValue     NaN (float32)
    @standard_name  "precipitation_amount"
    @long_name      "Total precipitation (accumulation past 01 hr) at ground level"
    @short_name     "tp_acc1_gl"
    @time_window    "01h"
    @grid_mapping   "latitude_longitude"
    @level_dimension_name "gl"
    @DIMENSION_LIST → /time, /gl, /latitude, /longitude
  time        [60]  int64 "<q", dimension scale
    @units    "seconds since 1970-01-01T00:00:00+00:00"
    @calendar "proleptic_gregorian"
  gl          [1]   int64, dimension scale, value 0 ("Ground level")
  latitude    [390] float64 "<d", dimension scale, @units "degrees_north", @_FillValue NaN
  longitude   [390] float64 "<d", dimension scale, @units "degrees_east",  @_FillValue NaN
```

Every dimension variable also has `@CLASS "DIMENSION_SCALE"`, `@NAME`, `@REFERENCE_LIST`,
`@_Netcdf4Dimid` and `@_Netcdf4Coordinates`. There are no groups; everything sits in the root.

## The precipitation variable

- Name `total-precipitation-accumulation-01h-gl`, dtype float32 little-endian.
- Shape `[60, 1, 390, 390]` = `[time, gl, latitude, longitude]` (dimension names from the
  `@NAME` of the attached scales). Cell index: `k * 152100 + row * 390 + col`.
- Unit `mm`: the amount of precipitation in one hour, so directly mm/h.
- `_FillValue` is NaN. This file contains no NaN at all (9 126 000 values, min 0,
  max 27.89 mm, no negative values). A reader must still treat NaN as "no data".
- Storage: chunks `[1, 1, 75, 75]`, filters fletcher32, shuffle and deflate level 3, time axis
  unlimited (`maxshape[0]` = H5S_UNLIMITED). h5wasm 0.10.3 reads this with its built-in filters:
  the whole variable (36.5 MB as Float32Array) in about 115 ms, one cell across all 60 steps
  with `slice([[0, 60], [0, 1], [row, row + 1], [col, col + 1]])` in about 16 ms.
- Values are continuous, not quantised: the smallest positive value is 4.8·10⁻⁷ mm and
  3 065 630 of the 4 415 519 positive values are below 0.01 mm. "Dry" therefore needs a threshold,
  not `> 0`.

## Grid

Regular lat/lon grid on a sphere (`+proj=longlat +a=6371229.0`), so no projection needed.

| Axis      | Count  | First value   | Step  | Last value     | Direction  |
| --------- | ------ | ------------- | ----- | -------------- | ---------- |
| latitude  | 390    | 49            | 0.018 | 56.002         | ascending  |
| longitude | 390    | 0             | 0.029 | 11.281         | ascending  |

Measured steps: latitude 0.017999999999994 to 0.018000000000001, longitude 0.028999999999999
to 0.029000000000002 (float64 rounding noise). Row 0 is the **southern edge** (49 °N), unlike
the radar, where row 0 is the northern edge. Values are cell centres.

Nearest cell:

```
row = round((lat - 49) / 0.018)     valid if 0 <= row < 390
col = round(lon / 0.029)            valid if 0 <= col < 390
```

Example: Utrecht (5.1214 °E, 52.0907 °N) gives row 172 (52.096), col 177 (5.133).

## Time axis

- `time`: 60 values, int64, seconds since 1970-01-01T00:00Z (UTC), step exactly 3600 s.
- Run T07: `time[0]` = 1793952000 = 2026-11-06T08:00Z, `time[59]` = 2026-11-08T19:00Z.
- **Step 0 has timestamp reference time + 1 h.** The value at `time[k]` is the precipitation in the
  hour that **ends** at `time[k]` (`@long_name` "accumulation past 01 hr", `@time_window "01h"`).
  Step 0 therefore covers the reference hour itself (07:00 to 08:00 UTC) and contains real rain
  (2 005 cells ≥ 0.1 mm), not an empty first accumulation.
- Start of the hour of step k: `time[k] - 3600` = reference time + k hours. The file covers the
  60 hours after the reference time; by the time it is available (≈ reference time + 2.5 h) the
  first two hours have already passed.
- h5wasm returns int64 as `bigint` (scalar) or `BigInt64Array`; convert with `Number()`
  (seconds fit comfortably in a double).

## Reference time of the run (`issuedAt`)

Three sources, equal in this file:

1. scalar dataset `forecast_reference_time` = 1793948400 s = 2026-11-06T07:00Z (int64, with
   `@units` "seconds since 1970-01-01T00:00:00+00:00");
2. root attribute `@forecast_run` = "2026-11-06T07" (format `@time_fmt` "%Y-%m-%dT%H", UTC);
3. the file name, `20261106T07`.

Use `forecast_reference_time` for `issuedAt`: exact, typed and in the same unit as
`time`. Check that `time[0]` = reference time + 3600.

## Constants for the reader

| Constant                   | Value                                      |
| -------------------------- | ------------------------------------------ |
| variable                   | `total-precipitation-accumulation-01h-gl`  |
| shape                      | `[60, 1, 390, 390]`, float32               |
| rows (latitude)            | 390, lat0 = 49, dlat = 0.018 (ascending)   |
| cols (longitude)           | 390, lon0 = 0, dlon = 0.029 (ascending)    |
| steps                      | 60, 3600 s, `time[0]` = reference + 3600   |
| unit                       | mm per hour (hour ending at `time[k]`)     |
| no data                    | NaN (`_FillValue`)                         |

## Differences from expectations

- Name, size (~5 MB), shape, unit, `_FillValue` and the lat/lon range: as expected.
- Run delay 2 h 20 to 2 h 37, slightly wider than "about 2 h 20".
- The listing cannot filter by name; `maxKeys=50` plus the exact pattern is the only way.
- Time is int64, not float: h5wasm returns `bigint`.
- Row 0 is the south; the radar has row 0 in the north.
- This file contains no NaN; the fixture deliberately sets one (see `test/fixtures/README.md`).
- Values are continuous with a lot of noise below 0.01 mm; count only values above a threshold as rain.
