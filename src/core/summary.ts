import type { ForecastPoint, Intensity, Summary } from "./types.ts";

const THRESHOLD = 0.1;
const STEP_MS = 5 * 60_000;

const hhmm = new Intl.DateTimeFormat("nl-NL", {
  timeZone: "Europe/Amsterdam",
  hour: "2-digit",
  minute: "2-digit",
});

export const classify = (mm: number): Intensity => (mm >= 2.5 ? "zwaar" : mm >= 1 ? "matig" : "licht");

/** Pure: `now` is a parameter. Points whose 5-minute step ended at or before `now` are ignored. */
export function summarize(points: readonly ForecastPoint[], now: Date): Summary {
  const rest = points.filter((p) => p.time.getTime() + STEP_MS > now.getTime());
  if (rest.length === 0) {
    return { summary: "Geen verwachting beschikbaar", willRain: false, firstRainAt: null, dryUntil: null, maxMmPerHour: 0, intensity: null };
  }
  const wet = (p: ForecastPoint) => p.mmPerHour >= THRESHOLD;
  const maxMmPerHour = Math.max(...rest.map((p) => p.mmPerHour));
  const first = rest.find(wet);
  const last = rest[rest.length - 1]!;
  const intensity = first ? classify(maxMmPerHour) : null;
  const suffix = intensity ? ` (${intensity})` : "";

  let summary: string;
  let dryUntil: Date | null = null;
  if (!first) {
    summary = `Droog tot ten minste ${hhmm.format(last.time)}`;
    dryUntil = last.time;
  } else if (first !== rest[0]) {
    summary = `Regen vanaf ${hhmm.format(first.time)}${suffix}`;
    dryUntil = first.time;
  } else {
    const dry = rest.find((p) => !wet(p));
    summary = dry
      ? `Regen tot ${hhmm.format(dry.time)}${suffix}`
      : `Regen de komende twee uur${suffix}`;
  }
  return { summary, willRain: !!first, firstRainAt: first?.time ?? null, dryUntil, maxMmPerHour, intensity };
}
