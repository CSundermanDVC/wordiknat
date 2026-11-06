import { classify } from "./summary.ts";
import type { ForecastPoint, Summary } from "./types.ts";

const THRESHOLD = 0.1;
const HOUR_MS = 3_600_000;

const hhmm = new Intl.DateTimeFormat("nl-NL", {
  timeZone: "Europe/Amsterdam",
  hour: "2-digit",
  minute: "2-digit",
});

/** Pure: `time` is the start of the hour. Starts at the first hour that ends after `now`; may return fewer than `count`. */
export function selectHours(points: readonly ForecastPoint[], now: Date, count = 24): ForecastPoint[] {
  const start = points.findIndex((p) => p.time.getTime() + HOUR_MS > now.getTime());
  return start < 0 ? [] : points.slice(start, start + count);
}

/** Same rules as `summarize`, for 1-hour steps over the next 24 hours. */
export function summarizeHourly(hours: readonly ForecastPoint[], _now: Date): Summary {
  if (hours.length === 0) {
    return { summary: "Geen verwachting beschikbaar", willRain: false, firstRainAt: null, dryUntil: null, maxMmPerHour: 0, intensity: null };
  }
  const wet = (p: ForecastPoint) => p.mmPerHour >= THRESHOLD;
  const maxMmPerHour = Math.max(...hours.map((p) => p.mmPerHour));
  const first = hours.find(wet);
  const intensity = first ? classify(maxMmPerHour) : null;
  const suffix = intensity ? ` (${intensity})` : "";

  let summary: string;
  let dryUntil: Date | null = null;
  if (!first) {
    summary = "Droog de komende 24 uur";
    dryUntil = new Date(hours[hours.length - 1]!.time.getTime() + HOUR_MS);
  } else if (first !== hours[0]) {
    summary = `Regen vanaf ${hhmm.format(first.time)}${suffix}`;
    dryUntil = first.time;
  } else {
    const end = hours.find((p) => !wet(p));
    summary = end ? `Regen tot ${hhmm.format(end.time)}${suffix}` : `Regen de komende 24 uur${suffix}`;
  }
  return { summary, willRain: !!first, firstRainAt: first?.time ?? null, dryUntil, maxMmPerHour, intensity };
}
