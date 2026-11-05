// One error type for the whole core; messages are Dutch, say what to do and never contain the key.

export type ErrorCode =
  | "MISSING_KEY"
  | "INVALID_KEY"
  | "RATE_LIMITED"
  | "SOURCE_HTTP"
  | "NETWORK"
  | "BAD_FILE"
  | "OUTSIDE_GRID"
  | "NO_DATA"
  | "UNKNOWN_PLACE"
  | "BAD_ARGS"
  | "NO_LOCATION"
  | "TILE_UNAVAILABLE";

const PORTAL =
  "Vraag gratis een sleutel aan op het KNMI Developer Portal (https://developer.dataplatform.knmi.nl) en zet hem in .env als KNMI_API_KEY=<sleutel>.";

const MESSAGES: Record<ErrorCode, string> = {
  MISSING_KEY: `Geen KNMI-API-sleutel gevonden. ${PORTAL}`,
  INVALID_KEY: `De KNMI-API-sleutel is ongeldig of verlopen. ${PORTAL}`,
  RATE_LIMITED:
    "Het KNMI weigert tijdelijk verzoeken (te veel verzoeken). Probeer het over een paar minuten opnieuw en gebruik je eigen API-sleutel.",
  SOURCE_HTTP: "De KNMI-bron gaf een onverwachte fout. Probeer het later opnieuw.",
  NETWORK: "Geen verbinding met de bron. Controleer je internetverbinding en probeer het opnieuw.",
  BAD_FILE: "Het radarbestand van het KNMI kon niet worden gelezen. Probeer het over een paar minuten opnieuw.",
  OUTSIDE_GRID: "Deze locatie ligt buiten het radarbereik van het KNMI. Kies een locatie in of rond Nederland.",
  NO_DATA: "Er zijn op dit moment geen radargegevens voor deze locatie. Probeer het later opnieuw.",
  UNKNOWN_PLACE: "Plaats niet gevonden. Controleer de spelling of gebruik --lat en --lon.",
  BAD_ARGS: "Ongeldige argumenten. Gebruik: wordiknat <plaats> of wordiknat --lat <n> --lon <n> [--json].",
  NO_LOCATION:
    "Geen locatie opgegeven. Geef een plaats of --lat en --lon mee, of zet WORDIKNAT_LOCATION in .env.",
  TILE_UNAVAILABLE:
    "De kaartondergrond is nu niet beschikbaar. Controleer je internetverbinding en probeer het later opnieuw.",
};

// Exit code 2: the user can fix it. Everything else (source, network, data) is exit code 1.
const USER_ERRORS: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "MISSING_KEY",
  "INVALID_KEY",
  "OUTSIDE_GRID",
  "UNKNOWN_PLACE",
  "BAD_ARGS",
  "NO_LOCATION",
]);

export class WordiknatError extends Error {
  readonly code: ErrorCode;
  readonly exitCode: 1 | 2;

  constructor(code: ErrorCode, message: string = MESSAGES[code]) {
    super(message);
    this.name = "WordiknatError";
    this.code = code;
    this.exitCode = USER_ERRORS.has(code) ? 2 : 1;
  }
}

export function toErrorJson(err: WordiknatError): { error: { code: ErrorCode; message: string } } {
  return { error: { code: err.code, message: err.message } };
}
