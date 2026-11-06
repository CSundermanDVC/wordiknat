// Fake KNMI/PDOK fetch and fixture constants, copied from test/cli.test.ts for the server tests.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cellToLatLon, KNMI_RADAR_GEOMETRY } from "../../src/core/projection.ts";

export const KEY = "SENTINEL-KEY-123";
export const API = "https://api.dataplatform.knmi.nl/open-data/v1/datasets/radar_forecast/versions/2.0/files";
export const NAME = "RAD_NL25_RAC_FM_202611041100.h5";
export const DOWNLOAD = "https://download.example/RAD.h5?X-Amz-Signature=abc";
export const PDOK = "https://api.pdok.nl/bzk/locatieserver/search/v3_1";
export const TILES = "https://service.pdok.nl/";
export const NOW = new Date("2026-11-04T11:01:00Z");
// Fixture crop cell (19,0) is source cell (349,55) of the full grid; it has rain (0.12 mm/u).
export const INSIDE = cellToLatLon(349, 55, KNMI_RADAR_GEOMETRY);
// Utrecht is on the full radar grid but outside the fixture's 40 x 40 crop.
export const OUTSIDE = { lat: 52.09126, lon: 5.10448 };
export const FIELDS = ["dryUntil", "firstRainAt", "issuedAt", "location", "maxMmPerHour", "points", "source", "summary", "willRain"];

const FIXTURE = new Uint8Array(readFileSync(fileURLToPath(new URL("../fixtures/radar-sample.h5", import.meta.url))));

export const HARMONIE_API = "https://api.dataplatform.knmi.nl/open-data/v1/datasets/uwcw-ha-det-nl-s1/versions/1.0/files";
export const HARMONIE_NAME = "uwcw-ha-det-nl-2km_20261106T07_total-precipitation-accumulation-01h-gl.nc";
export const HARMONIE_DOWNLOAD = "https://download.example/HARMONIE.nc?X-Amz-Signature=def";
export const HARMONIE_FIXTURE = new Uint8Array(
  readFileSync(fileURLToPath(new URL("../fixtures/harmonie-sample.nc", import.meta.url))),
);
// Fixture run T07 covers hours 07:00Z..19:00Z two days later; at 09:30Z the run is published and 24+ hours remain.
export const HARMONIE_NOW = new Date("2026-11-06T09:30:00Z");
// Utrecht: crop cell (4, 4) of the fixture.
export const HARMONIE_INSIDE = { name: "Utrecht", lat: 52.0907, lon: 5.1214 };
/** Names in the default listing that must never be requested: other parameters, lookalikes, an older run. */
export const HARMONIE_DECOYS = [
  "uwcw-ha-det-nl-2km_20261106T08_wind-speed-of-gust-01h-hagl.nc",
  `${HARMONIE_NAME}.tmp`,
  "uwcw-ha-det-nl-2km_20261106T07_solid-precipitation-accumulation-01h-gl.nc",
  "uwcw-ha-det-nl-2km_20261106T07_total-precipitation-rate-gl.nc",
  "uwcw-ha-det-nl-2km_20261106T07_rainfall-accumulation-01h-gl.nc",
  // The older run comes first, so picking the first match instead of the newest would fail.
  "uwcw-ha-det-nl-2km_20261106T06_total-precipitation-accumulation-01h-gl.nc",
];
const HARMONIE_LISTING = [...HARMONIE_DECOYS, HARMONIE_NAME];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
export const pdok = (docs: unknown[]) => json({ response: { numFound: docs.length, docs } });

// The 8-byte PNG signature plus a little padding: all the tile proxy checks.
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
export const png = (body: BodyInit = PNG, type = "image/png") => new Response(body, { headers: { "content-type": type } });

export type Override = (url: string) => Response | Error | undefined;

type Init = { headers?: Record<string, string>; redirect?: "error" };

/** Fake fetch for KNMI radar and HARMONIE (listing, download URL, fixture bytes), PDOK and the tile host; `override` wins per URL. */
export function fakeFetch(override?: Override, placeName = "Testdorp, Testgemeente") {
  const calls: string[] = [];
  const inits: Array<Init | undefined> = [];
  const fetch = async (url: string, init?: Init) => {
    calls.push(url);
    inits.push(init);
    const o = override?.(url);
    if (o instanceof Error) throw o;
    if (o) return o;
    if (url.startsWith(`${API}?`)) return json({ files: [{ filename: NAME }] });
    if (url === `${API}/${NAME}/url`) return json({ temporaryDownloadUrl: DOWNLOAD });
    if (url === DOWNLOAD) return new Response(FIXTURE);
    if (url.startsWith(`${HARMONIE_API}?`)) return json({ files: HARMONIE_LISTING.map((filename) => ({ filename })) });
    if (url === `${HARMONIE_API}/${HARMONIE_NAME}/url`) return json({ temporaryDownloadUrl: HARMONIE_DOWNLOAD });
    if (url === HARMONIE_DOWNLOAD) return new Response(HARMONIE_FIXTURE);
    if (url.startsWith(`${PDOK}/free?`)) {
      return pdok([{ weergavenaam: placeName, centroide_ll: `POINT(${INSIDE.lon} ${INSIDE.lat})` }]);
    }
    if (url.startsWith(`${PDOK}/suggest?`)) return pdok([]);
    if (url.startsWith(TILES)) return png();
    return new Response("nope", { status: 404 });
  };
  return { fetch, calls, inits };
}
