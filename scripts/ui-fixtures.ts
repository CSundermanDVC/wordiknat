// Fixture payloads for the browser pass against the mock-ups: routed /api/forecast, /api/radar, /api/geocode and /tiles.
// Run: node scripts/ui-fixtures.ts <out-dir>. Builds everything locally (no key, no network) and writes only into <out-dir>.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { lonLatToPixel, MAP_BBOX, packClasses, RADAR_GRID, rainClass } from "../src/core/map-grid.ts";
import { buildReport } from "../src/core/report.ts";
import { summarize } from "../src/core/summary.ts";
import { SOURCE, type ForecastPoint, type Location } from "../src/core/types.ts";

/** 14:05 Amsterdam time, the issue time of the mock-ups; the pass installs this as the page clock. */
export const FIXTURE_NOW = new Date("2026-11-04T13:05:00Z");
export const STATES = ["dry", "soon", "now", "drying"] as const;
export type FixtureState = (typeof STATES)[number];

export const PLACE: Location = { name: "Utrecht, Utrecht, Utrecht", lat: 52.09126, lon: 5.10448 };

const STEP_MS = 5 * 60_000;
const zeros = (n: number) => Array<number>(n).fill(0);
// The series of .impeccable/reference/gen.mjs, 14:05 .. 16:05.
const SERIES: Record<FixtureState, number[]> = {
  dry: zeros(25),
  soon: [0, 0, 0.2, 0.7, 1.2, 1.6, 1.9, 1.7, 1.3, 0.9, 0.5, 0.2, ...zeros(13)],
  now: [1.2, 1.6, 2.0, 2.6, 3.1, 2.8, 2.2, 1.9, 1.5, 1.3, 1.1, 0.9, 0.8, 0.7, 0.7, 0.6, 0.5, 0.5, 0.4, 0.4, 0.3, 0.3, 0.3, 0.2, 0.2],
  drying: [1.4, 1.1, 0.8, 0.5, 0.2, ...zeros(20)],
};

const points = (mm: number[], start: Date): ForecastPoint[] =>
  mm.map((v, i) => ({ time: new Date(start.getTime() + i * STEP_MS), mmPerHour: v }));

function forecastJson(pts: ForecastPoint[], now: Date): string {
  const report = buildReport({ location: PLACE, issuedAt: now, points: pts, source: SOURCE }, summarize(pts, now));
  return JSON.stringify(report);
}

/** 25 frames on the real radar grid: a shower cell over the place on every wet step, classes from the step's intensity. */
function radarJson(pts: ForecastPoint[], now: Date): string {
  const { width, height, originX, originY, zoom } = RADAR_GRID;
  const c = lonLatToPixel(PLACE.lon, PLACE.lat, zoom);
  const frames = pts.map((p, i) => {
    const classes = new Uint8Array(width * height);
    const peak = rainClass(p.mmPerHour);
    if (peak > 0) {
      const cx = c.x - originX - 24 + 2 * i; // drifts west to east across the place
      const cy = c.y - originY;
      for (let j = 0; j < height; j++) {
        for (let k = 0; k < width; k++) {
          const d = Math.hypot(k - cx, (j - cy) * 1.4);
          classes[j * width + k] = d < 12 * peak ? peak : d < 60 ? 1 : 0;
        }
      }
    }
    return Buffer.from(packClasses(classes)).toString("base64");
  });
  return JSON.stringify({
    issuedAt: now.toISOString(),
    source: SOURCE,
    zoom,
    bbox: MAP_BBOX,
    originX,
    originY,
    width,
    height,
    times: pts.map((p) => p.time.toISOString()),
    frames,
  });
}

/** A 256 x 256 one-colour PNG (pale land tone) built with zlib; enough for the map's tile layer. */
function tilePng(): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const size = 256;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [0xe9, 0xe6, 0xdc]).flat())]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new Uint8Array(Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())]));
}

/** Every fixture file by name; pure for a given `now`. */
export function buildFixtures(now: Date = FIXTURE_NOW): Record<string, string | Uint8Array> {
  const out: Record<string, string | Uint8Array> = {};
  for (const s of STATES) {
    const pts = points(SERIES[s], now);
    out[`forecast-${s}.json`] = forecastJson(pts, now);
    out[`radar-${s}.json`] = radarJson(pts, now);
  }
  // Issued two hours and five minutes earlier: every step has ended by `now`.
  out["forecast-nodata.json"] = forecastJson(points(SERIES.dry, new Date(now.getTime() - 25 * STEP_MS)), now);
  out["places.json"] = JSON.stringify({ results: [PLACE, { name: "Utrechtseweg, Amersfoort, Utrecht", lat: 52.1532, lon: 5.4018 }] });
  out["tile.png"] = tilePng();
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: node scripts/ui-fixtures.ts <out-dir>");
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(buildFixtures())) writeFileSync(join(dir, name), data);
}
