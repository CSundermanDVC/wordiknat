// Radar layer (US-015): the cached KNMI file resampled onto the fixed Web Mercator grid as 2-bit rain classes.
import { getLatestFile } from "./cache.ts";
import { WordiknatError } from "./errors.ts";
import { readRadarFile, type RadarFile } from "./hdf5.ts";
import { createKnmiClient, type FetchLike } from "./knmi.ts";
import { MAP_BBOX, packClasses, pixelToLonLat, RADAR_GRID, rainClass } from "./map-grid.ts";
import { latLonToCell, type GridGeometry } from "./projection.ts";
import { SOURCE } from "./types.ts";

export type RadarPayload = {
  issuedAt: string;
  source: typeof SOURCE;
  zoom: number;
  bbox: typeof MAP_BBOX;
  originX: number;
  originY: number;
  width: number;
  height: number;
  times: string[];
  frames: string[];
};

const cellMaps = new Map<string, Int32Array>();

/** Flat KNMI index (row * columns + col) per target cell, or -1 outside the KNMI grid. */
export function radarCellMap(geometry: GridGeometry): Int32Array {
  const key = JSON.stringify(geometry);
  const hit = cellMaps.get(key);
  if (hit) return hit;
  const { originX, originY, width, height, zoom } = RADAR_GRID;
  const map = new Int32Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const { lon, lat } = pixelToLonLat(originX + i + 0.5, originY + j + 0.5, zoom);
      try {
        const { col, row } = latLonToCell(lat, lon, geometry);
        map[j * width + i] = row * geometry.columns + col;
      } catch (e) {
        if (!(e instanceof WordiknatError) || e.code !== "OUTSIDE_GRID") throw e;
        map[j * width + i] = -1;
      }
    }
  }
  if (cellMaps.size >= 2) cellMaps.delete(cellMaps.keys().next().value as string);
  cellMaps.set(key, map);
  return map;
}

export function buildRadar(file: RadarFile): RadarPayload {
  const map = radarCellMap(file.geometry);
  const frames = file.steps.map((s) => {
    const classes = new Uint8Array(map.length);
    map.forEach((idx, n) => {
      if (idx < 0) return;
      const pv = s.pixels[idx];
      if (!s.nodata.includes(pv)) classes[n] = rainClass(s.scale * pv + s.offset);
    });
    return Buffer.from(packClasses(classes)).toString("base64");
  });
  const { originX, originY, width, height, zoom } = RADAR_GRID;
  return {
    issuedAt: file.issuedAt.toISOString(),
    source: SOURCE,
    zoom,
    bbox: MAP_BBOX,
    originX,
    originY,
    width,
    height,
    times: file.steps.map((s) => s.time.toISOString()),
    frames,
  };
}

// shortcut: the file is parsed again per request; share parsing with /api/forecast if it shows up in profiles.
export async function getRadar({
  fetch,
  apiKey,
  cacheDir,
  now,
}: {
  fetch: FetchLike;
  apiKey: string;
  cacheDir: string;
  now: Date;
}): Promise<RadarPayload> {
  const client = createKnmiClient({ fetch, apiKey });
  return buildRadar(await readRadarFile(await getLatestFile({ client, dir: cacheDir, now: now.getTime() })));
}
