// Spike: probe the public PDOK BRT Achtergrondkaart tiles (no key) and print a table.
// Run: node scripts/probe-pdok-tiles.ts [--all: fetch every allowed tile]     Tiles are written into tmp/pdok/ only.
import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/grijs/EPSG:3857";
const BOX = { west: 2.9, east: 7.5, south: 50.5, north: 53.9 };
const ZOOMS = [8, 9, 10];

const tileX = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
const tileY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

const sizes: number[] = [];
async function probe(label: string, z: number, x: number, y: number, matrix = String(z).padStart(2, "0")) {
  const res = await fetch(`${BASE}/${matrix}/${x}/${y}.png`, { redirect: "manual" });
  const buf = Buffer.from(await res.arrayBuffer());
  const png = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (res.status === 200 && png) {
    sizes.push(buf.length);
    await mkdir("tmp/pdok", { recursive: true });
    await writeFile(`tmp/pdok/${z}-${x}-${y}.png`, buf);
  }
  console.log([label, `${matrix}/${x}/${y}`, res.status, res.headers.get("content-type"), buf.length, png ? "png" : "no-png"].join(" | "));
}

let total = 0;
for (const z of ZOOMS) {
  const x0 = tileX(BOX.west, z), x1 = tileX(BOX.east, z), y0 = tileY(BOX.north, z), y1 = tileY(BOX.south, z);
  const count = (x1 - x0 + 1) * (y1 - y0 + 1);
  total += count;
  const all = Array.from({ length: count }, (_, i) => [x0 + (i % (x1 - x0 + 1)), y0 + Math.floor(i / (x1 - x0 + 1))]);
  if (process.argv.includes("--all")) for (let i = 0; i < all.length; i += 8) await Promise.all(all.slice(i, i + 8).map(([x, y]) => probe(`z${z} all`, z, x, y)));
  console.log(`z${z}: x ${x0}..${x1}, y ${y0}..${y1}, ${count} tiles`);
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) await probe(`z${z} corner`, z, x, y);
}
console.log(`total ${total} tiles`);

// Utrecht Dom (52.0907 N, 5.1214 E) at zoom 10: orientation check.
const ux = tileX(5.1214, 10), uy = tileY(52.0907, 10);
console.log(`Utrecht Dom z10: x=${ux}, y=${uy}`);
await probe("utrecht", 10, ux, uy);
await probe("swapped", 10, uy, ux);

// Outside the layer's own box (lon -1.657292..12.431727, lat 48.040502..56.110590) and outside the grid.
await probe("outside layer box (lon 14)", 10, tileX(14, 10), tileY(52, 10));
await probe("outside layer box (lat 57)", 10, ux, tileY(57, 10));
await probe("outside grid", 10, 1024, 0);
await probe("unpadded matrix id", 8, tileX(5, 8), tileY(52, 8), "8");

sizes.sort((a, b) => a - b);
console.log(`ok tiles ${sizes.length}, min ${sizes[0]}, median ${sizes[Math.floor(sizes.length / 2)]}, max ${sizes[sizes.length - 1]}`);
