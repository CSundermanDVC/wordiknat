import { classify, summarize } from "../../src/core/summary.ts";
import type { ForecastPoint, Intensity, Location } from "../../src/core/types.ts";
import type { ForecastView } from "./api.ts";
import { formatTime } from "./format.ts";

export type AnswerState = "dry" | "soon" | "now" | "drying";

export type Caption = {
  label: string;
  before: string;
  emphasis: string;
  after: string;
  detail: string;
  /** The non-empty parts joined with single spaces. */
  sentence: string;
};

export type AnswerView = Caption & {
  state: AnswerState;
  /** Countdown for soon and drying, else null. */
  minutes: number | null;
  intensity: Intensity | null;
};

export type HeroInput = { location: Location | null; forecast: ForecastView | null; error: string | null };

export type HeroView =
  | { mode: "state"; view: AnswerView; stale: boolean }
  | { mode: "empty" | "loading" | "nodata" | "error"; caption: Caption };

const STEP_MS = 5 * 60_000;
const ADJ: Record<Intensity, string> = { licht: "lichte", matig: "matige", zwaar: "zware" };

const caption = (label: string, before: string, emphasis = "", after = "", detail = ""): Caption => ({
  label,
  before,
  emphasis,
  after,
  detail,
  sentence: [before, emphasis, after].filter(Boolean).join(" "),
});

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function formatCountdown(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} uur` : `${h} uur ${m} min`;
}

const minutesUntil = (target: Date, now: Date) =>
  Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 60_000));

/** The strongest intensity class among the given wet points (callers pass wet points only). */
const peak = (wet: readonly ForecastPoint[]): Intensity => classify(Math.max(...wet.map((p) => p.mmPerHour)));

export function answerState(points: readonly ForecastPoint[], now: Date): AnswerView | null {
  const rest = points.filter((p) => p.time.getTime() + STEP_MS > now.getTime());
  if (rest.length === 0) return null;
  const s = summarize(points, now);
  // summarize owns the threshold: a step is wet when it alone makes willRain true.
  const wet = (p: ForecastPoint) => summarize([p], p.time).willRain;
  const firstWet = rest.findIndex(wet);
  const view = (state: AnswerState, c: Caption, minutes: number | null): AnswerView => ({
    ...c,
    state,
    minutes,
    intensity: s.intensity,
  });

  if (firstWet === -1) {
    return view("dry", caption("Droog", "Je blijft droog tot ten minste", formatTime(rest[rest.length - 1]!.time), "", "Geen regen in de komende twee uur. Laat de jas maar hangen."), null);
  }
  const dryAt = rest.findIndex((p, i) => i > firstWet && !wet(p));
  const dry = dryAt === -1 ? null : rest[dryAt]!;

  if (firstWet > 0) {
    const adj = cap(ADJ[s.intensity!]);
    const start = formatTime(rest[firstWet]!.time);
    const detail = dry
      ? `${adj} bui vanaf ${start}, rond ${formatTime(dry.time)} weer droog.`
      : `${adj} regen vanaf ${start}, daarna blijft het nat.`;
    const minutes = minutesUntil(rest[firstWet]!.time, now);
    return view("soon", caption("Regen op komst", "Over", formatCountdown(minutes), "nat", detail), minutes);
  }
  if (dry) {
    const run = rest.slice(0, dryAt);
    const minutes = minutesUntil(dry.time, now);
    return view("drying", caption("Bijna droog", "Over", formatCountdown(minutes), "droog", `Nog even ${ADJ[peak(run)]} regen, vanaf ${formatTime(dry.time)} droog.`), minutes);
  }
  const wets = rest.filter(wet);
  const lo = classify(Math.min(...wets.map((p) => p.mmPerHour)));
  const hi = peak(wets);
  const head = lo === hi ? `${cap(ADJ[hi])} regen.` : `${cap(ADJ[lo])} tot ${ADJ[hi]} regen.`;
  return view("now", caption("Regen nu", "Het regent", "nu", "", `${head} De komende twee uur blijft het nat.`), null);
}

export function heroView(input: HeroInput, now: Date): HeroView {
  const { location, forecast, error } = input;
  if (forecast) {
    const view = answerState(forecast.points, now);
    return view
      ? { mode: "state", view, stale: error !== null }
      : { mode: "nodata", caption: caption("Geen verwachting", "Geen verwachting beschikbaar") };
  }
  if (error !== null) return { mode: "error", caption: caption("Fout", error) };
  if (location) return { mode: "loading", caption: caption("Laden", "Laden…") };
  return {
    mode: "empty",
    caption: caption("Geen plaats", "Waar", "fiets", "je heen?", "Kies een plaats, dan zie je meteen of je nat wordt."),
  };
}
