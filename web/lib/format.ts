const timeFormat = new Intl.DateTimeFormat("nl-NL", {
  timeZone: "Europe/Amsterdam",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const mmFormat = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 2 });

export const formatTime = (date: Date): string => timeFormat.format(date);

/** Drops repeated comma-separated parts: "De Meern, Utrecht, Utrecht" becomes "De Meern, Utrecht". */
export const formatLocationName = (name: string): string =>
  [...new Set(name.split(",").map((p) => p.trim()).filter(Boolean))].join(", ");

export const staleRadarMessage = (issuedAt: Date): string =>
  `De radar kon niet worden ververst. Je ziet de beelden van ${formatTime(issuedAt)}.`;

export const formatMm = (n: number): string => mmFormat.format(n);

export const scrubLabel = (point: { time: Date; mmPerHour: number }): string =>
  `${formatTime(point.time)} · ${formatMm(point.mmPerHour)} mm/u`;
