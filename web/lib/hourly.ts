// Pure model of the "Komende 24 uur" panel; the DOM glue only copies these values into elements.
import { classify } from "../../src/core/summary.ts";
import type { Intensity } from "../../src/core/types.ts";
import type { HourlyView } from "./api.ts";
import { formatMm, formatTime } from "./format.ts";
import { yMax } from "./graph-model.ts";

const WET = 0.1;
const REFS = [
  { name: "matig", mm: 1 },
  { name: "zwaar", mm: 2.5 },
] as const;

const dateKey = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Amsterdam",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export type HourBar = {
  /** null for a dry hour (< 0.1 mm): no bar, only the dash. */
  cls: Intensity | null;
  /** Bar height as a share of the plot, 0 for a dry hour. */
  heightPct: number;
  /** "21:00", or "morgen 02:00" on a later Amsterdam date than now; readout, value text and table row. */
  time: string;
  amount: string;
  valueText: string;
};

export function buildHourlyModel(view: HourlyView, now: Date) {
  const max = yMax(view.hours.map((h) => h.mmPerHour));
  const today = dateKey.format(now);
  const hours: HourBar[] = view.hours.map((h) => {
    const wet = h.mmPerHour >= WET;
    const clock = formatTime(h.time);
    const time = dateKey.format(h.time) > today ? `morgen ${clock}` : clock;
    // A dry hour (< 0,1 mm) must never round up to read "0,1 mm".
    const amount = `${formatMm(wet ? h.mmPerHour : Math.min(h.mmPerHour, 0.09))} mm`;
    return {
      cls: wet ? classify(h.mmPerHour) : null,
      heightPct: wet ? (h.mmPerHour / max) * 100 : 0,
      time,
      amount,
      valueText: `${time}, ${amount}`,
    };
  });
  // Every 3 hours from the current one; `every6` marks the ones kept under 600 px.
  const ticks = view.hours.flatMap((h, index) =>
    index % 3 === 0 ? [{ index, text: formatTime(h.time), every6: index % 6 === 0 }] : [],
  );
  return {
    summary: view.summary,
    yMax: max,
    refs: REFS.map((r) => ({ label: `${r.name} ${formatMm(r.mm)}`, pct: (r.mm / max) * 100 })),
    hours,
    ticks,
  };
}

export type HourlyModel = ReturnType<typeof buildHourlyModel>;

/** Clamps `next` into the hours; a non-number keeps `current`, and an unchanged index comes back as is. */
export function selectHour(current: number, next: number, length: number): number {
  if (!Number.isFinite(next)) return current;
  return Math.min(Math.max(0, length - 1), Math.max(0, Math.round(next)));
}
