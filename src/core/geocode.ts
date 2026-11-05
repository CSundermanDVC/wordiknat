// PDOK Locatieserver geocoder (FR-005): Dutch place name -> Location. The only host is api.pdok.nl.
import { WordiknatError } from "./errors.ts";
import type { Location } from "./types.ts";

const BASE = "https://api.pdok.nl/bzk/locatieserver/search/v3_1";
const MAX_QUERY = 100;
const MAX_SUGGESTIONS = 3;

export type GeocodeFetch = (url: string) => Promise<Response>;

const POINT = /^POINT\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)$/;
// Control characters would otherwise end up verbatim in terminal output.
const CONTROL = /[\u0000-\u001f\u007f]/;

function sourceError(detail: string): WordiknatError {
  return new WordiknatError("SOURCE_HTTP", `De PDOK-locatieserver gaf een onverwachte fout (${detail}). Probeer het later opnieuw.`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

async function getDocs(fetch: GeocodeFetch, endpoint: "free" | "suggest", params: Record<string, string>): Promise<unknown[]> {
  const url = `${BASE}/${endpoint}?${new URLSearchParams(params)}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new WordiknatError("NETWORK");
  }
  if (!res.ok) throw sourceError(`HTTP ${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw sourceError("geen geldige JSON");
  }
  const docs = isRecord(body) && isRecord(body.response) ? body.response.docs : undefined;
  if (!Array.isArray(docs)) throw sourceError("onverwacht antwoord");
  return docs;
}

function parseDoc(doc: unknown): Location {
  if (!isRecord(doc) || typeof doc.weergavenaam !== "string" || doc.weergavenaam === "" || typeof doc.centroide_ll !== "string") {
    throw sourceError("onverwacht antwoord");
  }
  const m = POINT.exec(doc.centroide_ll.trim());
  const lon = Number(m?.[1]);
  const lat = Number(m?.[2]);
  if (!m || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw sourceError("ongeldige coördinaten");
  return { name: doc.weergavenaam, lat, lon };
}

/** Best effort: a failing suggest call must not hide the UNKNOWN_PLACE error. */
async function suggestions(fetch: GeocodeFetch, q: string): Promise<string[]> {
  try {
    const docs = await getDocs(fetch, "suggest", { q, fq: "type:woonplaats", rows: String(MAX_SUGGESTIONS), fl: "weergavenaam" });
    const names = docs.map((d) => (isRecord(d) ? d.weergavenaam : undefined));
    return names.filter((n): n is string => typeof n === "string" && n !== "" && !CONTROL.test(n)).slice(0, MAX_SUGGESTIONS);
  } catch {
    return [];
  }
}

/** Trimmed query, validated before it goes into a URL. */
function checkQuery(query: string): string {
  const q = query.trim();
  if (q === "" || q.length > MAX_QUERY || CONTROL.test(q)) {
    throw new WordiknatError("BAD_ARGS", `Ongeldige plaatsnaam. Geef een naam van 1 tot ${MAX_QUERY} tekens, of gebruik --lat en --lon.`);
  }
  return q;
}

function freeDocs(fetch: GeocodeFetch, q: string): Promise<unknown[]> {
  return getDocs(fetch, "free", { q, fq: "type:woonplaats", rows: "5", fl: "weergavenaam,centroide_ll" });
}

/** Up to five woonplaatsen for a picker (US-010); [] when nothing matches. */
export async function searchPlaces(query: string, { fetch }: { fetch: GeocodeFetch }): Promise<Location[]> {
  const docs = await freeDocs(fetch, checkQuery(query));
  // rows=5 is a request, not a guarantee: bound the list ourselves.
  return docs.slice(0, 5).map(parseDoc);
}

export async function geocode(query: string, { fetch }: { fetch: GeocodeFetch }): Promise<Location> {
  const q = checkQuery(query);
  const docs = await freeDocs(fetch, q);
  if (docs.length > 0) return parseDoc(docs[0]);

  const names = await suggestions(fetch, q);
  const hint = names.length > 0 ? `Bedoelde je: ${names.join(", ")}?` : "Controleer de spelling of gebruik --lat en --lon.";
  throw new WordiknatError("UNKNOWN_PLACE", `Plaats "${q}" niet gevonden. ${hint}`);
}
