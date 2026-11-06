// KNMI Open Data client (FR-001). The key only goes to the API host, never to the download URL.
import { type ErrorCode, WordiknatError } from "./errors.ts";

export const RADAR_FILES = "https://api.dataplatform.knmi.nl/open-data/v1/datasets/radar_forecast/versions/2.0/files";

export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<Response>;

export type KnmiClient = {
  latestFileName(): Promise<string>;
  download(fileName: string): Promise<Uint8Array>;
};

/** The client plus a raw listing call, for datasets that need their own file selection. */
export type KnmiApiClient = KnmiClient & {
  /** File names from one listing page; every entry must have a non-empty string `filename`. */
  listFileNames(query: Record<string, string>): Promise<string[]>;
};

function sourceError(detail: string): WordiknatError {
  return new WordiknatError("SOURCE_HTTP", `De KNMI-bron gaf een onverwachte fout (${detail}). Probeer het later opnieuw.`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function createKnmiClient({
  fetch,
  apiKey,
  files = RADAR_FILES,
  notFound,
}: {
  fetch: FetchLike;
  apiKey: string;
  /** The dataset's files endpoint. */
  files?: string;
  /** Error code for a 404 from the API host (missing dataset or file); default SOURCE_HTTP. */
  notFound?: ErrorCode;
}): KnmiApiClient {
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
    if (withKey && notFound && res.status === 404) throw new WordiknatError(notFound);
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

  async function listFileNames(query: Record<string, string>): Promise<string[]> {
    const body = await getJson(`${files}?${new URLSearchParams(query)}`);
    if (!Array.isArray(body.files)) throw sourceError("onverwacht antwoord");
    return body.files.map((f: unknown) => {
      if (!isRecord(f) || typeof f.filename !== "string" || f.filename === "") throw sourceError("onverwacht antwoord");
      return f.filename;
    });
  }

  return {
    listFileNames,

    async latestFileName() {
      const [first] = await listFileNames({ maxKeys: "1", orderBy: "created", sorting: "desc" });
      if (first === undefined) throw sourceError("onverwacht antwoord");
      return first;
    },

    async download(fileName) {
      const body = await getJson(`${files}/${encodeURIComponent(fileName)}/url`);
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
