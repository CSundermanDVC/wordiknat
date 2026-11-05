# KNMI `radar_forecast` 2.0: file format

Recorded from a real file downloaded on 2026-11-04 with `scripts/fetch-sample.ts`:
`RAD_NL25_RAC_FM_202611041100.h5`, 223 889 bytes. Every value below was read from that file
with h5wasm 0.10.3 (HDF5 2.0.0). Regenerate the dump with
`node --env-file=.env scripts/fetch-sample.ts`.

## API flow

All requests go to `https://api.dataplatform.knmi.nl/open-data/v1` except the final download.

1. `GET /datasets/radar_forecast/versions/2.0/files?maxKeys=1&orderBy=created&sorting=desc`
   with header `Authorization: <KNMI_API_KEY>` returned `200`. The body has a `files` array;
   `files[0].filename` is the newest file.
2. `GET /datasets/radar_forecast/versions/2.0/files/{filename}/url` with the same header returned
   `200` and a JSON body with `temporaryDownloadUrl`.
3. `GET <temporaryDownloadUrl>` **without** an `Authorization` header returned `200` and the raw
   HDF5 bytes. The download host is a pre-signed S3 URL on
   `knmi-kdp-datasets-eu-west-1.s3.eu-west-1.amazonaws.com`, not the API host, so the key must
   never be sent there.

## File name and timestamp

`RAD_NL25_RAC_FM_<YYYYMMDDHHmm>.h5`, here `RAD_NL25_RAC_FM_202611041100.h5`. The stamp is the run
(issue) time in UTC: it equals `overview/@product_datetime_start` and the valid time of `image1`.
The file was the newest one at 11:05 UTC (12:05 CET), so the stamp is UTC, not local time.

## HDF5 tree

```
/                                  (no root attributes)
  overview/
    @hdftag_version_number   "3.6"
    @number_image_groups     [25]
    @number_radar_groups     [8]
    @number_satellite_groups [0]
    @number_scan_groups      [0]
    @number_station_groups   [0]
    @product_datetime_start  "04-NOV-2026;11:00:00.000"
    @product_datetime_end    "04-NOV-2026;13:00:00.000"
    @product_group_name      "RAD_NL25_COR_NA"
    @product_missing         "NA"
  geographic/
    @geo_column_offset    [0]          float32
    @geo_row_offset       [3650]       float32
    @geo_number_columns   [700]        int32
    @geo_number_rows      [765]        int32
    @geo_pixel_size_x     [1]          float32
    @geo_pixel_size_y     [-1]         float32
    @geo_dim_pixel        "KM,KM"
    @geo_par_pixel        "X,Y"
    @geo_pixel_def        "LU"
    @geo_product_corners  [0, 49.362064361572266, 0, 55.973602294921875,
                           10.856452941894531, 55.388973236083984,
                           9.009300231933594, 48.895301818847656]   float32
    map_projection/
      @projection_indication   "Y"
      @projection_name         "STEREOGRAPHIC"
      @projection_proj4_params "+proj=stere +lat_0=90 +lon_0=0 +lat_ts=60 +a=6378137 +b=6356752 +x_0=0 +y_0=0 +units=km"
  image1/ … image25/
    @image_bytes_per_pixel  [2]
    @image_datetime_valid   "04-NOV-2026;11:00:00.000"   (image1; +5 min per image)
    @image_geo_parameter    "PRECIP_[MM]"
    @image_product_name     "RAD_NL25_COR_NA"
    @image_size             [1071000]                    (765 * 700 * 2 bytes)
    calibration/
      @calibration_flag         "Y"
      @calibration_formulas     "GEO=0.010000*PV+0.000000"
      @calibration_missing_data [65534]
      @calibration_out_of_image [65535]
    image_data   dataset, shape [765, 700], dtype "<H" (uint16 LE), deflate level 9
      @CLASS          "IMAGE"
      @DISPLAY_ORIGIN "UL"
      @IMAGE_VERSION  "1.2"
    statistics/
      @stat_max_value [0.007710000034421682]   (image1; float32)
      @stat_min_value [0]
  radar1/ … radar8/
    @radar_location    [lon, lat]   float32
    @radar_name        "Den Helder", "Herwijnen", "Jabbeke", "Helchteren",
                       "Essen", "Borkum", "Wideumont", "Neuheilenbach"
    @radar_operational [1]
```

The calibration attributes are identical in all 25 image groups.

## Image datasets

- Count: 25 groups `image1` … `image25`, matching `overview/@number_image_groups = [25]`.
- Shape `[765, 700]` = `[rows, columns]`, dtype uint16 little-endian, one value per 1 km cell.
- Order: by the numeric suffix. `Group.keys()` returns them alphabetically
  (`image1, image10, image11, …, image2, …`), so a reader must sort numerically or by
  `@image_datetime_valid`.
- `image1` is valid at the issue time (+0 min); `imageN` is valid at issue + 5·(N−1) min, up to
  `image25` at +120 min.

## Calibration formula

Quoted verbatim from `imageN/calibration/@calibration_formulas`:

```
GEO=0.010000*PV+0.000000
```

`PV` is the raw uint16 pixel value, `GEO` the value in the unit of `@image_geo_parameter`.

## Unit and conversion to mm/u

`@image_geo_parameter = "PRECIP_[MM]"`: the calibrated value is precipitation in mm. The images are
5 minutes apart and the product name `RAC` denotes a radar accumulation, so the value is the amount
over that 5-minute interval and the rate is

```
mm/u = 12 * 0.01 * PV = 0.12 * PV
```

No attribute states the accumulation period explicitly; the ×12 rests on the 5-minute spacing.
The smallest non-zero value (PV = 1) is 0.01 mm per 5 min = 0.12 mm/u.

## Nodata and undetect values

- `calibration_missing_data = 65534`: no data for the cell.
- `calibration_out_of_image = 65535`: cell outside the radar image.
- No separate undetect value: "no precipitation" is PV = 0.

In this file neither 65534 nor 65535 occurs in any of the 25 images: all 535 500 cells are 0 or 1.
Cells outside radar range therefore carry 0, indistinguishable from "dry". A reader must still
treat 65534 and 65535 as nodata in case other runs contain them.

## Projection

- proj4 (verbatim): `+proj=stere +lat_0=90 +lon_0=0 +lat_ts=60 +a=6378137 +b=6356752 +x_0=0 +y_0=0 +units=km`
  (polar stereographic, north pole, true scale at 60°N, ellipsoid a/b in metres, output in km).
- Pixel size: 1 km × 1 km (`geo_pixel_size_x = 1`, `geo_pixel_size_y = -1`; y decreases with row).
- Grid origin: `geo_column_offset = 0`, `geo_row_offset = 3650`. With `geo_pixel_def = "LU"`
  each (col,row) addresses the cell's left-upper corner:

  ```
  x_km = (col + geo_column_offset) * geo_pixel_size_x     →  col
  y_km = (row + geo_row_offset)    * geo_pixel_size_y     →  -(row + 3650)
  col  = floor(x_km / geo_pixel_size_x - geo_column_offset)
  row  = floor(y_km / geo_pixel_size_y - geo_row_offset)
  ```

- Cell (0,0) is the upper-left (north-west) corner of the grid (`DISPLAY_ORIGIN = "UL"`);
  row 0 is the northern edge, column 0 the western edge.
- Corner coordinates from `@geo_product_corners`, as (lon, lat) pairs of the grid's outer edges,
  in the order lower-left, upper-left, upper-right, lower-right. Forward-projecting them with the
  proj string gives exactly the grid edges (checked to 0.005 km):

  | Corner      | lon (°E)           | lat (°N)           | x km | y km  |
  | ----------- | ------------------ | ------------------ | ---- | ----- |
  | lower-left  | 0                  | 49.362064361572266 | 0    | -4415 |
  | upper-left  | 0                  | 55.973602294921875 | 0    | -3650 |
  | upper-right | 10.856452941894531 | 55.388973236083984 | 700  | -3650 |
  | lower-right | 9.009300231933594  | 48.895301818847656 | 700  | -4415 |

- Example: Utrecht (5.1214 °E, 52.0907 °N) projects to x = 365.612, y = -4079.399 km, so
  col 365, row 429.

## Timestamps

- Issue time: file name stamp and `overview/@product_datetime_start = "04-NOV-2026;11:00:00.000"`.
- Per image: `imageN/@image_datetime_valid`, format `DD-MON-YYYY;HH:MM:SS.mmm` with an English
  upper-case month abbreviation. image1 `11:00`, image2 `11:05`, …, image25 `13:00`
  (`overview/@product_datetime_end`).
- Timezone: none in the file; the values are UTC (see "File name and timestamp").

## Differences from expectations

- Image count (25, +0 … +120 min), file size (~224 kB), name pattern and proj string: as expected.
- Unit: the file says only `PRECIP_[MM]`; the 5-minute accumulation and therefore the ×12 factor
  follow from the image spacing, not from an explicit attribute. This run was nearly dry (PV ≤ 1
  everywhere), so the magnitude could not be cross-checked against real rain.
- Resolution: the smallest non-zero rate is 0.12 mm/u, so with a 0.1 mm/u rain threshold every
  non-zero cell counts as rain.
- Nodata: two codes (65534 missing, 65535 out of image), not one, and neither appeared in this
  file; areas outside radar range read as 0.
- Image order: `keys()` is alphabetical, not chronological.
- `statistics/@stat_max_value` is not a reliable calibrated maximum: image1 reports
  0.00771 while its largest cell is PV 1 = 0.01 mm. Do not use the statistics group.
- String attributes differ in stored length (`image1/@image_product_name` is `A16`, the others
  `A15`) with the same text; compare trimmed values.
