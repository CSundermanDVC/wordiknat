// KNMI Open Data client (FR-001). The key only goes to the API host, never to the download URL.
import { WordiknatError } from "./errors.ts";

const FILES = "https://api.dataplatform.knmi.nl/open-data/v1/datasets/radar_forecast/versions/2.0/files";

export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<Response>;

export type KnmiClient = {
  latestFileName(): Promise<string>;
  download(fileName: string): Promise<Uint8Array>;
};

function sourceError(detail: string): WordiknatError {
  return new WordiknatError("SOURCE_HTTP", `De KNMI-bron gaf een onverwachte fout (${detail}). Probeer het later opnieuw.`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function createKnmiClient({ fetch, apiKey }: { fetch: FetchLike; apiKey: string }): KnmiClient {
  /** `withKey` marks API calls: only those carry the key, and only there does 401/403 mean a bad key. */
  async function get(url: string, withKey: boolean): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(url, { headers: withKey ? { Authorization: apiKey } : {} });
    } catch {
      throw new WordiknatError("NETWORK");
    }
    if (res.ok) return res;
    if (withKey && (res.status === 401 || res.status === 403)) throw new WordiknatError("INVALID_KEY");
    if (res.status === 429) throw new WordiknatError("RATE_LIMITED");
    throw sourceError(`HTTP ${res.status}`);
  }

  async function getJson(url: string): Promise<Record<string, unknown>> {
    const res = await get(url, true);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw sourceError("geen geldige JSON");
    }
    if (!isRecord(body)) throw sourceError("onverwacht antwoord");
    return body;
  }

  return {
    async latestFileName() {
      const body = await getJson(`${FILES}?maxKeys=1&orderBy=created&sorting=desc`);
      const first = Array.isArray(body.files) ? body.files[0] : undefined;
      if (!isRecord(first) || typeof first.filename !== "string" || first.filename === "") {
        throw sourceError("onverwacht antwoord");
      }
      return first.filename;
    },

    async download(fileName) {
      const body = await getJson(`${FILES}/${encodeURIComponent(fileName)}/url`);
      const target = body.temporaryDownloadUrl;
      if (typeof target !== "string" || !URL.canParse(target) || new URL(target).protocol !== "https:") {
        throw sourceError("onverwacht antwoord");
      }
      const res = await get(target, false);
      try {
        return new Uint8Array(await res.arrayBuffer());
      } catch {
        throw new WordiknatError("NETWORK");
      }
    },
  };
}
