// Orchestration (US-001): cache -> HDF5 reader -> projection -> 25 points in mm/u.
import { getLatestFile } from "./cache.ts";
import { WordiknatError } from "./errors.ts";
import { readRadarFile, valuesAt } from "./hdf5.ts";
import { createKnmiClient, type FetchLike } from "./knmi.ts";
import { latLonToCell } from "./projection.ts";
import { SOURCE, type Forecast, type Location } from "./types.ts";

export async function getForecast(
  location: Location,
  { fetch, apiKey, cacheDir, now }: { fetch: FetchLike; apiKey: string; cacheDir: string; now: Date },
): Promise<Forecast> {
  const client = createKnmiClient({ fetch, apiKey });
  const file = await readRadarFile(await getLatestFile({ client, dir: cacheDir, now: now.getTime() }));
  const values = valuesAt(file, latLonToCell(location.lat, location.lon, file.geometry));
  if (values.some((v) => v === null)) throw new WordiknatError("NO_DATA");
  return {
    location,
    issuedAt: file.issuedAt,
    points: file.steps.map((s, i) => ({ time: s.time, mmPerHour: values[i] as number })),
    source: SOURCE,
  };
}
