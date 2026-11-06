// 24-hour forecast (US-018): one HARMONIE precipitation file per hour, own cache entry, radar untouched.
import { join } from "node:path";
import { getLatestFile } from "./cache.ts";
import { WordiknatError } from "./errors.ts";
import { hourlyValuesAt, latLonToHarmonieCell, readHarmonieFile } from "./harmonie.ts";
import { selectHours } from "./hourly-summary.ts";
import { createKnmiClient, type FetchLike, type KnmiClient } from "./knmi.ts";
import { SOURCE_HOURLY, type HourlyForecast, type Location } from "./types.ts";

const FILES = "https://api.dataplatform.knmi.nl/open-data/v1/datasets/uwcw-ha-det-nl-s1/versions/1.0/files";
// Anchored: only this one ~5 MB file of the 22 per run may ever be selected (docs/knmi-harmonie.md).
const PRECIPITATION = /^uwcw-ha-det-nl-2km_\d{8}T\d{2}_total-precipitation-accumulation-01h-gl\.nc$/;
// 50 newest entries always hold one complete run, even with a half-published newer run on top.
const LISTING = { maxKeys: "50", orderBy: "created", sorting: "desc" };
const MAX_AGE_MS = 60 * 60_000;
const HOUR_MS = 3_600_000;
const HOURS = 24;

/** Lists the HARMONIE dataset and picks the newest run's precipitation file; a 404 means HOURLY_UNAVAILABLE. */
export function createHarmonieClient({ fetch, apiKey }: { fetch: FetchLike; apiKey: string }): KnmiClient {
  const api = createKnmiClient({ fetch, apiKey, files: FILES, notFound: "HOURLY_UNAVAILABLE" });
  return {
    async latestFileName() {
      const names = (await api.listFileNames(LISTING)).filter((n) => PRECIPITATION.test(n));
      if (names.length === 0) throw new WordiknatError("HOURLY_UNAVAILABLE");
      // Within the pattern the name sorts by reference time.
      return names.reduce((a, b) => (b > a ? b : a));
    },
    download: api.download,
  };
}

export async function getHourly(
  location: Location,
  { fetch, apiKey, cacheDir, now }: { fetch: FetchLike; apiKey: string; cacheDir: string; now: Date },
): Promise<HourlyForecast> {
  const bytes = await getLatestFile({
    client: createHarmonieClient({ fetch, apiKey }),
    dir: join(cacheDir, "harmonie"),
    now: now.getTime(),
    fileName: "latest.nc",
    maxAgeMs: MAX_AGE_MS,
  });
  const file = await readHarmonieFile(bytes);
  const values = hourlyValuesAt(file, latLonToHarmonieCell(location.lat, location.lon, file.geometry));
  // Step k is the amount in the hour ending at times[k]; NaN marks "no data" until the selection is checked.
  const points = file.times.map((t, k) => ({ time: new Date(t.getTime() - HOUR_MS), mmPerHour: values[k] ?? Number.NaN }));
  const hours = selectHours(points, now, HOURS);
  if (hours.length < HOURS) throw new WordiknatError("HOURLY_UNAVAILABLE");
  if (hours.some((h) => Number.isNaN(h.mmPerHour))) throw new WordiknatError("NO_DATA");
  return { location, issuedAt: file.issuedAt, hours, source: SOURCE_HOURLY };
}
