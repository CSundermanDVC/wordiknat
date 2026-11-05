// Spike: download the newest KNMI radar_forecast 2.0 file into tmp/ and print its HDF5 tree.
// Run: node --env-file=.env scripts/fetch-sample.ts            (download + print)
//      node scripts/fetch-sample.ts tmp/<file>.h5               (print an already downloaded file)
// Prints file name, HTTP status codes and structure only; never the key or request headers.
import { mkdir, writeFile } from "node:fs/promises";
import h5wasm from "h5wasm/node";

const BASE = "https://api.dataplatform.knmi.nl/open-data/v1/datasets/radar_forecast/versions/2.0";

async function getJson(url: string, key: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Authorization: key } });
  console.log(`GET ${new URL(url).pathname} -> ${res.status}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

async function download(): Promise<string> {
  const key = process.env.KNMI_API_KEY;
  if (!key) throw new Error("KNMI_API_KEY ontbreekt (draai met node --env-file=.env)");

  const list = await getJson(`${BASE}/files?maxKeys=1&orderBy=created&sorting=desc`, key);
  const files = isRecord(list) ? list.files : undefined;
  const first: unknown = Array.isArray(files) ? files[0] : undefined;
  if (!isRecord(first) || typeof first.filename !== "string") throw new Error("Onverwacht antwoord van /files");
  const filename = first.filename;
  if (!/^[\w.-]+\.h5$/.test(filename)) throw new Error("Onverwachte bestandsnaam");
  console.log(`filename: ${filename}`);

  const urlRes = await getJson(`${BASE}/files/${encodeURIComponent(filename)}/url`, key);
  const dl = isRecord(urlRes) ? urlRes.temporaryDownloadUrl : undefined;
  if (typeof dl !== "string" || !dl.startsWith("https://")) throw new Error("Geen temporaryDownloadUrl");
  console.log(`download host: ${new URL(dl).host}`);

  // No Authorization header here: the pre-signed URL must not receive the key.
  const res = await fetch(dl);
  console.log(`GET <temporaryDownloadUrl> -> ${res.status}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  await mkdir("tmp", { recursive: true });
  const out = `tmp/${filename}`;
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
const path = process.argv[2] ?? (await download());
const f = new h5wasm.File(path, "r");
console.log("/");
printTree(f);
f.close();
