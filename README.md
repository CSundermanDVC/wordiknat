<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/img/hero-donker.png">
    <img src="docs/img/hero-licht.png" alt="Een fietser naast zijn fiets, met een dreigende wolk op komst; eronder het antwoord: Over 10 min nat" width="720">
  </picture>
</p>

<h1 align="center">wordiknat?</h1>

<p align="center">
  Regenverwachting voor de komende twee uur op KNMI-radardata. Het antwoord eerst, lokaal op je eigen computer.
</p>

<p align="center">
  <a href="#snel-starten">Snel starten</a> ·
  <a href="#gebruik">Gebruik</a> ·
  <a href="#json-voor-agents">JSON voor agents</a> ·
  <a href="#agent-skill">Agent-skill</a> ·
  <a href="#english">English</a>
</p>

## Waarom wordiknat?

- Het antwoord staat bovenaan: "Over 10 min nat" of "Je blijft droog", daarna pas de details.
- Geen advertenties, trackers of account. Het draait lokaal.
- Je gebruikt je eigen gratis KNMI-sleutel; de data komt rechtstreeks van het KNMI.
- Mensen en agents krijgen hetzelfde antwoord: als tekst, als webpagina of als JSON.

## Een voorbeeld

`npx wordiknat Utrecht` print het antwoord en een regel per tien minuten:

```text
Regen vanaf 14:15 (matig)
14:05                        0,00 mm/u
14:15  █                     0,20 mm/u
14:25  ███                   1,20 mm/u
14:35  ████                  1,90 mm/u
14:45  ███                   1,30 mm/u
14:55  █                     0,50 mm/u
15:05                        0,00 mm/u
15:15                        0,00 mm/u
15:25                        0,00 mm/u
15:35                        0,00 mm/u
15:45                        0,00 mm/u
15:55                        0,00 mm/u
16:05                        0,00 mm/u
Bron: KNMI (CC BY 4.0)
```

De webpagina laat hetzelfde zien als grafiek en als radarkaart:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/pagina-donker.png">
  <img src="docs/img/pagina-licht.png" alt="De panelen Wanneer en Waar: links de neerslaggrafiek voor de komende twee uur, rechts de radarkaart met een bui boven Utrecht om 14:30" width="720">
</picture>

## Hoe het werkt

```mermaid
flowchart LR
  A["KNMI radar_forecast"] --> B["wordiknat-kern"]
  P["PDOK: plaatsen en kaart"] --> B
  B --> C["CLI"]
  B --> D["Webpagina"]
  B -->|"--json"| E["Agent"]
```

## Snel starten

Je hebt Node >= 22.18 nodig.

```bash
git clone https://github.com/CSundermanDVC/wordiknat
cd wordiknat
npm ci
cp .env.example .env     # zet je KNMI-sleutel achter KNMI_API_KEY=
npx wordiknat Utrecht
```

Voor de webpagina:

```bash
npm run build
npx wordiknat serve      # http://127.0.0.1:5173
```

## Een gratis KNMI-sleutel

1. Vraag een sleutel aan op het [KNMI Developer Portal](https://developer.dataplatform.knmi.nl) voor de Open Data API (dataset `radar_forecast`).
2. Zet hem in `.env` als `KNMI_API_KEY=<sleutel>`, of in je omgeving.

`.env` staat in `.gitignore`: de sleutel wordt nooit gecommit en wordiknat print hem nergens.

## Gebruik

```text
wordiknat [<plaats>] [--lat <n> --lon <n>] [--json] [--help]
wordiknat serve [--port <n>] [--host <adres>]
```

| Optie | Betekenis |
| --- | --- |
| `<plaats>` | Plaatsnaam, opgezocht via de PDOK-locatieserver |
| `--lat <n> --lon <n>` | Coördinaten in plaats van een plaats (samen op te geven) |
| `--json` | Uitvoer als JSON, zie hieronder |
| `--help` | Toon het gebruik |
| `serve --port <n>` | Poort van de webpagina (standaard 5173) |
| `serve --host <adres>` | Adres om op te luisteren (standaard 127.0.0.1) |

Omgevingsvariabelen (ook uit `.env`):

- `WORDIKNAT_LOCATION`: standaardlocatie zonder argument, een plaatsnaam of `lat,lon`.
- `WORDIKNAT_DEBUG=1`: toon op stderr per verzoek de host en de status.

Let op: met `--host` een ander adres dan 127.0.0.1 kiezen maakt de pagina bereikbaar vanaf het netwerk, zonder authenticatie. Doe dat alleen op een vertrouwd netwerk.

Exitcodes: `0` gelukt, `1` bron-, netwerk- of datafout, `2` iets wat je zelf kunt oplossen (zie de tabel met foutcodes).

## JSON voor agents

`wordiknat <plaats> --json` schrijft één JSON-object met deze sleutels, in deze volgorde:

| Sleutel | Type | Betekenis |
| --- | --- | --- |
| `summary` | string | Eén Nederlandse zin, bijvoorbeeld "Regen vanaf 14:35 (licht)" |
| `willRain` | boolean | `true` als er in de resterende punten regen is (>= 0,1 mm/u) |
| `firstRainAt` | string of null | Tijdstip (ISO 8601) van het eerste regenpunt; `null` als het droog blijft |
| `dryUntil` | string of null | Tot wanneer het droog is (ISO 8601); `null` als het nu al regent |
| `maxMmPerHour` | number | Hoogste intensiteit in mm/u |
| `location` | object | `{ "name", "lat", "lon" }` |
| `issuedAt` | string | Uitgiftetijd van de verwachting (ISO 8601) |
| `points` | array | `{ "time", "mmPerHour" }` per 5 minuten |
| `source` | string | `KNMI radar_forecast 2.0 (CC BY 4.0)` |

```json
{
  "summary": "Regen vanaf 14:35 (licht)",
  "willRain": true,
  "firstRainAt": "2026-06-01T12:35:00.000Z",
  "dryUntil": "2026-06-01T12:35:00.000Z",
  "maxMmPerHour": 0.8,
  "location": { "name": "Utrecht", "lat": 52.09, "lon": 5.12 },
  "issuedAt": "2026-06-01T12:20:00.000Z",
  "points": [
    { "time": "2026-06-01T12:25:00.000Z", "mmPerHour": 0 },
    { "time": "2026-06-01T12:30:00.000Z", "mmPerHour": 0 },
    { "time": "2026-06-01T12:35:00.000Z", "mmPerHour": 0.8 }
  ],
  "source": "KNMI radar_forecast 2.0 (CC BY 4.0)"
}
```

`points` is hier ingekort; in het echt zijn het 25 punten van 5 minuten.

`firstRainAt` is `null` als het de komende twee uur droog blijft. `dryUntil` is het tijdstip waarop het droog blijft tot (het eerste regenpunt, of het laatste punt als het droog blijft) en is `null` als het al regent of er geen verwachting is.

Bij een fout staat er `{"error":{"code","message"}}` op stdout en eindigt het proces met exitcode 1 of 2:

<details>
<summary>Foutcodes</summary>

| Code | Exit | Wanneer |
| --- | --- | --- |
| `MISSING_KEY` | 2 | Geen KNMI-API-sleutel gevonden |
| `INVALID_KEY` | 2 | Sleutel ongeldig of verlopen |
| `OUTSIDE_GRID` | 2 | Locatie buiten het radarbereik |
| `UNKNOWN_PLACE` | 2 | Plaats niet gevonden |
| `BAD_ARGS` | 2 | Ongeldige argumenten |
| `NO_LOCATION` | 2 | Geen locatie opgegeven |
| `RATE_LIMITED` | 1 | KNMI weigert tijdelijk verzoeken |
| `SOURCE_HTTP` | 1 | Onverwachte fout van de KNMI-bron |
| `NETWORK` | 1 | Geen verbinding met de bron |
| `BAD_FILE` | 1 | Radarbestand niet te lezen |
| `NO_DATA` | 1 | Geen radargegevens voor deze locatie |
| `TILE_UNAVAILABLE` | 1 | Kaartondergrond niet beschikbaar |

</details>

## Agent-skill

Kopieer [`agent/SKILL.md`](agent/SKILL.md) naar de skills-map van je agent. Of zet dit fragment in de `AGENTS.md` van je project:

````markdown
## Regen
Vraagt de gebruiker of het gaat regenen of wanneer het droog is, draai `wordiknat <plaats> --json`.
Lees `summary` voor het antwoord in één zin en `willRain` voor ja of nee.
`firstRainAt` is het eerste regenmoment, `null` als het droog blijft.
`maxMmPerHour` geeft de intensiteit; de verwachting dekt twee uur.
Bij exitcode 1 of 2 staat in `error.message` wat er mis is; verzin dan geen verwachting.
Gebruik alleen een plaats die de gebruiker noemt of `WORDIKNAT_LOCATION`.
````

## Gegevensbronnen

- Neerslagverwachting: KNMI `radar_forecast` 2.0, licentie CC BY 4.0.
- Plaatsnamen: PDOK locatieserver. Kaart: BRT Achtergrondkaart, Kadaster/PDOK.

Dit zijn de enige externe verzoeken die wordiknat doet.

## Bijdragen

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Houd `h5wasm` de enige runtime-dependency, schrijf de tekst in de interface in het Nederlands en maak kleine, gerichte pull requests.

## Licentie

MIT, zie [LICENSE](LICENSE).

## English

Wordiknat shows a rain forecast for the next two hours from KNMI radar data. It runs locally.
```bash
git clone https://github.com/CSundermanDVC/wordiknat && cd wordiknat && npm ci   # Node >= 22.18
cp .env.example .env                  # add your free KNMI key as KNMI_API_KEY
npx wordiknat Utrecht                 # text answer
npx wordiknat Utrecht --json          # JSON for agents (nine keys, see "JSON voor agents")
npm run build && npx wordiknat serve  # web page on http://127.0.0.1:5173
```
Get a free key at https://developer.dataplatform.knmi.nl. It lives only in `.env` or the environment, and is never printed.
