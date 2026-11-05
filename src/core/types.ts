// Shared contracts for the core, CLI and (later) web server.

export const SOURCE = "KNMI radar_forecast 2.0 (CC BY 4.0)";

export type Location = { name: string; lat: number; lon: number };

export type ForecastPoint = { time: Date; mmPerHour: number };

export type Forecast = {
  location: Location;
  issuedAt: Date;
  points: ForecastPoint[];
  source: typeof SOURCE;
};

export type Intensity = "licht" | "matig" | "zwaar";

export type Summary = {
  summary: string;
  willRain: boolean;
  firstRainAt: Date | null;
  dryUntil: Date | null;
  maxMmPerHour: number;
  /** Strongest intensity in the remaining points; null when it stays dry. */
  intensity: Intensity | null;
};
