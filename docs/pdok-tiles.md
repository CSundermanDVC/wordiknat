# PDOK BRT Achtergrondkaart: tile limits

Recorded on 2026-11-04 from real requests made with `scripts/probe-pdok-tiles.ts` (platform `fetch`, no key,
tiles saved only under `tmp/pdok/`). Run `node scripts/probe-pdok-tiles.ts` for the corner probes, add `--all` to
fetch every allowed tile (that run fetched all 321 allowed tiles, all `200 image/png`).

## Source and licence

- Capabilities: `https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0?request=GetCapabilities&service=WMTS`
  returned `200`, 22 748 bytes. (The `GetOperation` links inside it point at
  `https://service.pdok.nl/kadaster/brt-achtergrondkaart/wmts/v2_0?`.)
- Service title `BRT Achtergrondkaart WMTS`; five layers: `standaard`, `grijs`, `pastel`, `water`, `labels`.
  Wordiknat uses layer `grijs` (format `image/png`, style `default`).
- Tile matrix set `EPSG:3857` (also offered: `EPSG:28992`, `EPSG:25831`).
- Layer WGS84 bounding box (identical for all five layers): lower corner `-1.657292 48.040502`,
  upper corner `12.431727 56.110590` (lon lat).
- `Fees`: `none`. `AccessConstraints`: `none` (both from the capabilities).
- Licence: **CC BY 4.0** (`https://creativecommons.org/licenses/by/4.0/deed.nl`), named as the `license` link in the
  OGC API landing document `https://api.pdok.nl/kadaster/brt-achtergrondkaart/ogc/v1?f=json` (title `CC BY 4.0`) and
  in the structured data of the PDOK dataset page
  `https://www.pdok.nl/introductie/-/article/basisregistratie-topografie-brt-topnl` (`Attribution CC BY 4.0`).
  The WMTS capabilities themselves name no licence.

## Tile URL scheme

Template from the capabilities (`ResourceURL`, layer `grijs`):

```
https://service.pdok.nl/kadaster/brt-achtergrondkaart/wmts/v2_0/grijs/{TileMatrixSet}/{TileMatrix}/{TileCol}/{TileRow}.png
```

Shorter form (verified by the maintainer):

```
https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/grijs/EPSG:3857/{z}/{x}/{y}.png
```

Both returned `200 image/png`, 33 480 bytes, identical `ETag` (`aca3619dbf52a42c0dc06b0e471dbe9e`) for tile
`10/527/336`, so the short form is an alias of the same service. **Wordiknat uses the short form**: it matches
the shape the proxy needs and is shorter. Risk: the capabilities only advertise the `kadaster/brt-achtergrondkaart`
path, so if the alias ever stops working, switch the single constant to the advertised path.

Orientation (`TileCol` is x, `TileRow` is y, top-left origin):

- Capabilities `EPSG:3857` matrices all have `TopLeftCorner` `-20037508.3428 20037508.3428`, `TileWidth` 256,
  `TileHeight` 256, and `MatrixWidth` = `MatrixHeight` = 2^z. Scale denominators: `08` 2183915.09386,
  `09` 1091957.54693, `10` 545978.773466 (each half of the previous).
- Matrix identifiers are two-digit zero-padded strings (`00` to `19`), not plain integers. The service also
  accepted the unpadded `8` (`200 image/png`); Wordiknat sends the padded form from the capabilities.
- Utrecht Dom (52.0907 N, 5.1214 E) at z10: n = 1024, x = floor((5.1214 + 180) / 360 * 1024) = 526,
  y = floor((1 - ln(tan(lat) + sec(lat)) / pi) / 2 * 1024) = 337. Tile `10/526/337` returned `200 image/png`,
  51 902 bytes, and shows Utrecht, Hilversum and Zeist in the expected places. The swapped tile `10/337/526`
  returned a 854-byte blank tile, so x and y are not interchangeable.

## Zoom levels and bounding box

- Allowed zoom set: **8, 9, 10**.
- Allowed box (WGS84): **west 2.9, east 7.5, south 50.5, north 53.9** (inside the layer's own box).
- Rule: a tile is allowed when it intersects the box, so the x range is
  `floor((lon + 180) / 360 * 2^z)` for west and east, and the y range uses the formula above for north (min y) and
  south (max y), both inclusive.

| z | x range | y range | tiles |
|---|---------|---------|-------|
| 8 | 130..133 | 82..86 | 4 x 5 = 20 |
| 9 | 260..266 | 164..172 | 7 x 9 = 63 |
| 10 | 520..533 | 329..345 | 14 x 17 = 238 |

Total: **321 tiles**.

Corner probes (all `200 image/png`, PNG signature present):

| tile | bytes |
|------|-------|
| 08/130/82 | 4210 |
| 08/133/82 | 6487 |
| 08/130/86 | 5728 |
| 08/133/86 | 334 |
| 09/260/164 | 2638 |
| 09/266/164 | 1180 |
| 09/260/172 | 3971 |
| 09/266/172 | 334 |
| 10/520/329 | 2652 |
| 10/533/329 | 1996 |
| 10/520/345 | 334 |
| 10/533/345 | 334 |

Outside the layer's own box: z10 at lon 14 (`10/551/338`) and at lat 57 (`10/526/313`) both returned
`200 image/png`, 854 bytes (a blank tile), not an error. The service does not enforce the layer box, so the proxy's
own box check is what keeps requests inside Wordiknat's limits.

## Response behaviour

Headers of `GET .../10/526/337.png` (and the other tiles probed):

- Status `200`, `Content-Type: image/png`, `Content-Length` equal to the body size.
- `Cache-Control: public, max-age=3600, no-transform`
- `ETag: aca3619dbf52a42c0dc06b0e471dbe9e` (tile `10/527/336`), `Last-Modified: Fri, 04 Sep 2026 12:40:12 GMT`
- `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: Content-Type`,
  `Access-Control-Allow-Method: GET,OPTIONS`
- `Accept-Ranges: bytes`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security` set.
- Every `200` body started with the PNG signature `89 50 4E 47 0D 0A 1A 0A`.
- No redirects: with `redirect: "manual"` every tile request answered directly with `200` (or `400`).

Out-of-range tile (`10/1024/0`, x beyond the matrix): status `400`, `Content-Type: text/xml`, 487 bytes, an
OGC `ExceptionReport` with `exceptionCode="TileOutOfRange"`. The proxy must treat any non-`200` or non-`image/png`
response as unavailable. Zoom 11 and zoom 20 (not in Wordiknat's set) also answered `200 image/png`
for `11/526/337` and `20/1/1`, so zoom limits are likewise enforced only by the proxy.

## Attribution

No source read for this document gives a verbatim attribution sentence: the capabilities have no attribution
element, the OGC API landing document has only the licence link `CC BY 4.0`, and the PDOK dataset page exposes
only the licence name `Attribution CC BY 4.0` in its structured data. CC BY 4.0 itself requires crediting the
creator, which for this dataset is Kadaster (the abstract states the map is derived from TOP10NL of the Basisregistratie
Topografie, BRT, and the service is run by PDOK).

Footer line Wordiknat shows (Dutch, written by Wordiknat, not quoted from a source):

```
Kaart: BRT Achtergrondkaart, Kadaster/PDOK
```

Open point: if the maintainer finds an official attribution string on a Kadaster or PDOK page, replace the line
above with that text verbatim.

## Size estimate

Measured over all 321 allowed tiles (`--all` run):

| z | tiles | total bytes | max bytes | blank 334-byte tiles |
|---|-------|-------------|-----------|----------------------|
| 8 | 20 | 296 534 | 52 576 | 2 |
| 9 | 63 | 725 686 | 42 594 | 10 |
| 10 | 238 | 2 609 381 | 54 242 | 64 |

Overall: minimum 334, **median 2 739**, **maximum 54 242** bytes, total 3 631 601 bytes (about 3.5 MiB) for a full
cache of the allowed set. A 334-byte tile is an empty (sea) tile; 854 bytes is the blank tile returned outside the
data area.
