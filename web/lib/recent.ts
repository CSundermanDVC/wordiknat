import type { Location } from "../../src/core/types.ts";

const MAX = 5;

function isLocation(v: unknown): v is Location {
  if (typeof v !== "object" || v === null) return false;
  const { name, lat, lon } = v as Record<string, unknown>;
  return (
    typeof name === "string" &&
    name.length >= 1 &&
    name.length <= 100 &&
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    lat >= 49 &&
    lat <= 55 &&
    typeof lon === "number" &&
    Number.isFinite(lon) &&
    lon >= 0 &&
    lon <= 10
  );
}

const sameSpot = (a: Location, b: Location) =>
  a.lat.toFixed(3) === b.lat.toFixed(3) && a.lon.toFixed(3) === b.lon.toFixed(3);

export function createRecentStore(
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  key = "wordiknat.recent",
) {
  function list(): Location[] {
    try {
      const raw = storage?.getItem(key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(isLocation)
        .slice(0, MAX)
        .map(({ name, lat, lon }) => ({ name, lat, lon }));
    } catch {
      return [];
    }
  }

  function add(loc: Location): Location[] {
    const next = [loc, ...list().filter((l) => !sameSpot(l, loc))].slice(0, MAX);
    try {
      storage?.setItem(key, JSON.stringify(next));
    } catch {
      // storage unavailable or full: keep the in-memory list
    }
    return next;
  }

  return { list, add };
}
