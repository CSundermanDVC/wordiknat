---
name: wordiknat
description: Gebruik dit voor vragen over regen in Nederland in de komende twee uur ("gaat het regenen in Utrecht?") of, met --24u, de komende 24 uur ("wordt het vannacht nat?"). Niet voor het weekend of buiten Nederland.
---

# wordiknat: regen in de komende twee uur

wordiknat geeft een regenverwachting voor de komende twee uur op KNMI-radardata. Het draait lokaal via de CLI.

## Wanneer gebruiken

- De gebruiker vraagt of het gaat regenen, wanneer het begint of stopt, of wanneer het droog is, voor een plek in Nederland.
- Gaat de vraag over later vandaag, vannacht of morgenochtend (binnen 24 uur)? Gebruik dan `--24u`. Voor de komende twee uur blijft de gewone vraag (zonder `--24u`) de beste: die is nauwkeuriger (radar).
- Niet gebruiken voor het weekend of verder dan 24 uur, en niet voor plekken buiten Nederland. Zeg dan eerlijk dat dit buiten bereik valt.

## Aanroepen

```bash
npx wordiknat <plaats> --json          # vanuit de repo-checkout
wordiknat <plaats> --json              # als het gelinkt of geïnstalleerd is
wordiknat --lat <n> --lon <n> --json   # met coördinaten
wordiknat <plaats> --24u --json        # komende 24 uur, per uur
```

- Zonder plaats of coördinaten gebruikt wordiknat `WORDIKNAT_LOCATION` (een plaatsnaam of `lat,lon`) uit de omgeving.
- Gebruik alleen een plaats die de gebruiker noemt of `WORDIKNAT_LOCATION`. Verzin geen plaats.
- De uitvoer is één JSON-object op stdout.

## Het resultaat

Zonder `--24u` heeft het object negen sleutels, in deze volgorde:

| Sleutel | Type | Betekenis |
| --- | --- | --- |
| `summary` | string | Eén Nederlandse zin met het antwoord |
| `willRain` | boolean | `true` als er regen is (>= 0,1 mm/u) |
| `firstRainAt` | string of `null` | Eerste regenmoment; `null` als het droog blijft |
| `dryUntil` | string of `null` | Tot wanneer het droog is; `null` als het al regent of als er geen verwachting is; blijft het droog, dan is dit het laatste punt (droog tot ten minste dat tijdstip) |
| `maxMmPerHour` | number | Hoogste intensiteit in mm/u |
| `location` | object | `{ "name", "lat", "lon" }` |
| `issuedAt` | string | Uitgiftetijd van de verwachting |
| `points` | array | 25 punten `{ "time", "mmPerHour" }`, elke 5 minuten |
| `source` | string | Bron en licentie (KNMI, CC BY 4.0) |

Alle tijden zijn ISO 8601 in UTC. Reken ze om naar Europe/Amsterdam (CET of CEST) voordat je ze noemt.

## De 24-uursverwachting

Met `--24u` komt er één JSON-object met tien sleutels, in deze volgorde (HARMONIE-model van het KNMI, per uur):

| Sleutel | Type | Betekenis |
| --- | --- | --- |
| `summary` | string | Eén Nederlandse zin met het antwoord |
| `willRain` | boolean | `true` als er in de komende 24 uur regen is |
| `firstRainAt` | string of `null` | Eerste regenuur; `null` als het droog blijft |
| `dryUntil` | string of `null` | Tot wanneer het droog is; `null` als het al regent of er geen verwachting is |
| `maxMmPerHour` | number | Hoogste intensiteit in mm/u |
| `intensity` | string of `null` | `licht`, `matig` of `zwaar`; `null` als het droog blijft |
| `location` | object | `{ "name", "lat", "lon" }` |
| `issuedAt` | string | Referentietijd van de modelrun |
| `hours` | array | Per uur `{ "time", "mmPerHour" }`; `time` is het begin van dat uur |
| `source` | string | Bron en licentie (KNMI HARMONIE, CC BY 4.0) |

Tijden zijn ISO 8601 in UTC; lees het antwoord zoals hierboven.

## Antwoorden

- Baseer het antwoord op `summary`, `firstRainAt` en `dryUntil`. Het blijft alleen droog als `willRain` `false` is en `dryUntil` niet `null`; zijn `firstRainAt` en `dryUntil` allebei `null`, zeg dan dat er nu geen verwachting is.
- Noem `maxMmPerHour` alleen als de gebruiker naar de intensiteit vraagt.
- Noem de plek met `location.name`, niet met wat de gebruiker typte.
- Noem de bron: KNMI.
- Verzin nooit een verwachting als het commando faalt.

## Versheid

`issuedAt` is het moment waarop het KNMI de verwachting uitgaf. Resultaten worden ongeveer 5 minuten gecachet, dus een tweede aanroep binnen die tijd geeft hetzelfde antwoord. Is `issuedAt` opvallend oud, zeg dat erbij.

## Fouten

Bij een fout staat `{"error":{"code","message"}}` op stdout en is de exitcode 1 of 2. Geef `error.message` in eigen woorden door.

| Code | Exit | Wat je de gebruiker zegt |
| --- | --- | --- |
| `MISSING_KEY` | 2 | Er is geen KNMI-sleutel ingesteld. Verwijs naar het kopje "Een gratis KNMI-sleutel" in de README. |
| `INVALID_KEY` | 2 | De sleutel is ongeldig of verlopen. Verwijs naar hetzelfde kopje in de README. |
| `OUTSIDE_GRID` | 2 | De plek ligt buiten het radarbereik; vraag om een plek in of rond Nederland. |
| `UNKNOWN_PLACE` | 2 | Plaats niet gevonden; probeer een specifiekere naam (bijvoorbeeld met gemeente) of vraag de gebruiker, of gebruik `--lat` en `--lon`. |
| `BAD_ARGS` | 2 | Ongeldige argumenten; controleer je aanroep en probeer opnieuw. |
| `NO_LOCATION` | 2 | Er is geen locatie; vraag de gebruiker om een plaats. |
| `RATE_LIMITED` | 1 | Het KNMI weigert tijdelijk verzoeken; probeer het over een paar minuten opnieuw. |
| `SOURCE_HTTP` | 1 | De KNMI-bron gaf een fout; probeer het later opnieuw. |
| `NETWORK` | 1 | Geen verbinding; controleer het internet en probeer opnieuw. |
| `BAD_FILE` | 1 | Het radarbestand was onleesbaar; probeer het over een paar minuten opnieuw. |
| `NO_DATA` | 1 | Er zijn nu geen radargegevens voor deze plek; probeer het later opnieuw. |
| `TILE_UNAVAILABLE` | 1 | De kaartondergrond is niet beschikbaar (alleen de webpagina); de verwachting zelf blijft bruikbaar. |
| `HOURLY_UNAVAILABLE` | 1 | De 24-uursverwachting is nu niet beschikbaar; de verwachting voor twee uur werkt nog, probeer het later opnieuw. |
| `HOURLY_BAD_FILE` | 1 | Het modelbestand voor de 24-uursverwachting was onleesbaar; probeer het later opnieuw. |

## Sleutel en veiligheid

- Lees, print of verstuur het bestand `.env` en de KNMI-sleutel nooit. Toon ze niet in de chat of in commando's.
- Vraag de gebruiker nooit om de sleutel in de chat te plakken. Laat de gebruiker hem zelf in `.env` of de omgeving zetten.
