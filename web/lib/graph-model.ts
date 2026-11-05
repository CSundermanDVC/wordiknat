import { formatTime } from "./format.ts";

export const REFERENCE_LINES = [
  { mm: 0.25, label: "licht" },
  { mm: 1, label: "matig" },
  { mm: 2.5, label: "zwaar" },
] as const;

export const yMax = (values: number[]): number =>
  Math.max(3, Math.ceil(1.025 * Math.max(0, ...values)));

type Size = {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
};

export function buildGraphModel(
  points: { time: Date; mmPerHour: number }[],
  now: Date,
  size: Size,
) {
  const { width, height, padding: p } = size;
  const max = yMax(points.map((pt) => pt.mmPerHour));
  const plotW = width - p.left - p.right;
  const plotH = height - p.top - p.bottom;
  const base = p.top + plotH;
  const toY = (mm: number) => base - (mm / max) * plotH;

  const n = points.length;
  const xs = points.map((_, i) => (n > 1 ? p.left + (i / (n - 1)) * plotW : p.left));
  const ys = points.map((pt) => toY(pt.mmPerHour));

  const linePath = xs.map((x, i) => `${i ? "L" : "M"}${x},${ys[i]}`).join(" ");
  const areaPath = n
    ? `M${xs[0]},${base} ${xs.map((x, i) => `L${x},${ys[i]}`).join(" ")} L${xs[n - 1]},${base} Z`
    : "";

  const timeLabels = points.flatMap((pt, i) => {
    const text = formatTime(pt.time);
    return text.endsWith(":00") || text.endsWith(":30") ? [{ x: xs[i], text }] : [];
  });

  let nowX: number | null = null;
  const t = now.getTime();
  for (let i = 0; i < n - 1; i++) {
    const a = points[i].time.getTime();
    const b = points[i + 1].time.getTime();
    if (t >= a && t <= b) {
      nowX = b === a ? xs[i] : xs[i] + ((t - a) / (b - a)) * (xs[i + 1] - xs[i]);
      break;
    }
  }
  if (n === 1 && t === points[0].time.getTime()) nowX = xs[0];

  return {
    yMax: max,
    lines: REFERENCE_LINES.filter((l) => l.mm <= max).map((l) => ({ ...l, y: toY(l.mm) })),
    areaPath,
    linePath,
    xs,
    ys,
    timeLabels,
    nowX,
  };
}

export function nearestIndex(x: number, xs: number[]): number {
  if (!xs.length) return -1;
  let best = 0;
  for (let i = 1; i < xs.length; i++) {
    if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
  }
  return best;
}

export function stepIndex(
  current: number,
  key: "ArrowLeft" | "ArrowRight" | "Home" | "End",
  length: number,
): number {
  const last = Math.max(0, length - 1);
  const next =
    key === "Home" ? 0 : key === "End" ? last : current + (key === "ArrowRight" ? 1 : -1);
  return Math.min(last, Math.max(0, next));
}
