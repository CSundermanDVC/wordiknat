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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
export const pdok = (docs: unknown[]) => json({ response: { numFound: docs.length, docs } });

// The 8-byte PNG signature plus a little padding: all the tile proxy checks.
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
export const png = (body: BodyInit = PNG, type = "image/png") => new Response(body, { headers: { "content-type": type } });

export type Override = (url: string) => Response | Error | undefined;

type Init = { headers?: Record<string, string>; redirect?: "error" };

/** Fake fetch for KNMI (listing, download URL, fixture bytes), PDOK and the tile host; `override` wins per URL. */
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
    if (url.startsWith(`${PDOK}/free?`)) {
      return pdok([{ weergavenaam: placeName, centroide_ll: `POINT(${INSIDE.lon} ${INSIDE.lat})` }]);
    }
    if (url.startsWith(`${PDOK}/suggest?`)) return pdok([]);
    if (url.startsWith(TILES)) return png();
    return new Response("nope", { status: 404 });
  };
  return { fetch, calls, inits };
}
