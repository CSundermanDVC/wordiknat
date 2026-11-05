// The US-005 JSON report, shared by `wordiknat --json` and the web API so both return the same shape.
import type { Forecast, Summary } from "./types.ts";

/** Field order is part of the contract; Dates stay Dates (JSON.stringify writes ISO strings). */
export function buildReport(forecast: Forecast, summary: Summary) {
  return {
    summary: summary.summary,
    willRain: summary.willRain,
    firstRainAt: summary.firstRainAt,
    dryUntil: summary.dryUntil,
    maxMmPerHour: summary.maxMmPerHour,
    location: forecast.location,
    issuedAt: forecast.issuedAt,
    points: forecast.points,
    source: forecast.source,
  };
}

export type Report = ReturnType<typeof buildReport>;
