// Spike: download the newest KNMI file of a dataset and print its HDF5 tree.
// Run: node --env-file=.env scripts/fetch-sample.ts                    (radar_forecast 2.0 into tmp/)
//      node --env-file=.env scripts/fetch-sample.ts harmonie <outdir>  (newest HARMONIE precipitation file into <outdir>)
//      node scripts/fetch-sample.ts <file>                             (print an already downloaded file)
// Prints file name, HTTP status codes and structure only; never the key or request headers.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import h5wasm from "h5wasm/node";

const API = "https://api.dataplatform.knmi.nl/open-data/v1/datasets";

type Source = { base: string; maxKeys: number; name: RegExp };
const RADAR: Source = { base: `${API}/radar_forecast/versions/2.0`, maxKeys: 1, name: /^[\w.-]+\.h5$/ };
// 22 files per hourly run: 50 newest entries always hold one complete run, even while the next is being published.
const HARMONIE: Source = {
  base: `${API}/uwcw-ha-det-nl-s1/versions/1.0`,
  maxKeys: 50,
  name: /^uwcw-ha-det-nl-2km_\d{8}T\d{2}_total-precipitation-accumulation-01h-gl\.nc$/,
};

async function getJson(url: string, key: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Authorization: key } });
  console.log(`GET ${new URL(url).pathname} -> ${res.status}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

async function download({ base, maxKeys, name }: Source, outDir: string): Promise<string> {
  const key = process.env.KNMI_API_KEY;
  if (!key) throw new Error("KNMI_API_KEY ontbreekt (draai met node --env-file=.env)");

  const list = await getJson(`${base}/files?maxKeys=${maxKeys}&orderBy=created&sorting=desc`, key);
  const files = isRecord(list) ? list.files : undefined;
  if (!Array.isArray(files)) throw new Error("Onverwacht antwoord van /files");
  // Exact-name filter; the highest name is the newest reference time. Nothing else is ever downloaded.
  const names: string[] = files.flatMap((f: unknown) => (isRecord(f) && typeof f.filename === "string" ? [f.filename] : []));
  const filename = names.filter((n) => name.test(n)).sort().at(-1);
  if (!filename) throw new Error("Geen passend bestand in de lijst");
  console.log(`filename: ${filename}`);

  const urlRes = await getJson(`${base}/files/${encodeURIComponent(filename)}/url`, key);
  const dl = isRecord(urlRes) ? urlRes.temporaryDownloadUrl : undefined;
  if (typeof dl !== "string" || !dl.startsWith("https://")) throw new Error("Geen temporaryDownloadUrl");
  console.log(`download host: ${new URL(dl).host}`);

  // No Authorization header here: the pre-signed URL must not receive the key.
  const res = await fetch(dl);
  console.log(`GET <temporaryDownloadUrl> -> ${res.status}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  await mkdir(outDir, { recursive: true });
  const out = join(outDir, filename);
  await writeFile(out, bytes);
  console.log(`saved ${out} (${bytes.length} bytes)`);
  return out;
}

function fmt(v: unknown): string {
  const s = JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
  return s && s.length > 300 ? `${s.slice(0, 300)}…` : String(s);
}

function printAttrs(obj: { attrs: Record<string, { dtype: unknown; json_value: unknown }> }, indent: string): void {
  for (const [name, a] of Object.entries(obj.attrs)) {
    console.log(`${indent}@${name} (${fmt(a.dtype)}) = ${fmt(a.json_value)}`);
  }
}

function printTree(group: InstanceType<typeof h5wasm.Group>, indent = ""): void {
  printAttrs(group, indent + "  ");
  for (const name of group.keys()) {
    const child = group.get(name);
    if (child instanceof h5wasm.Dataset) {
      console.log(`${indent}  ${name} [dataset shape=${fmt(child.shape)} dtype=${fmt(child.dtype)} filters=${fmt(child.filters)}]`);
      printAttrs(child, indent + "    ");
    } else if (child instanceof h5wasm.Group) {
      console.log(`${indent}  ${name}/`);
      printTree(child, indent + "  ");
    } else {
      console.log(`${indent}  ${name} [${fmt(child)}]`);
    }
  }
}

await h5wasm.ready;
const [arg, outDir] = process.argv.slice(2);
if (arg === "harmonie" && !outDir) throw new Error("usage: node --env-file=.env scripts/fetch-sample.ts harmonie <outdir>");
const path = arg === "harmonie" ? await download(HARMONIE, outDir) : (arg ?? (await download(RADAR, "tmp")));
const f = new h5wasm.File(path, "r");
console.log("/");
printTree(f);
f.close();
