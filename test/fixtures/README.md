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
