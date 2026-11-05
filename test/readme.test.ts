import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WordiknatError, type ErrorCode } from "../src/core/errors";

const readme = readFileSync("README.md", "utf8");
const KEYS = ["summary", "willRain", "firstRainAt", "dryUntil", "maxMmPerHour", "location", "issuedAt", "points", "source"];
const CODES: ErrorCode[] = [
  "MISSING_KEY", "INVALID_KEY", "RATE_LIMITED", "SOURCE_HTTP", "NETWORK", "BAD_FILE",
  "OUTSIDE_GRID", "NO_DATA", "UNKNOWN_PLACE", "BAD_ARGS", "NO_LOCATION", "TILE_UNAVAILABLE",
];

describe("README", () => {
  it("noemt de negen JSON-sleutels in volgorde in de tabel", () => {
    const rows = [...readme.matchAll(/^\| `(\w+)` \| (?:string|boolean|number|object|array)/gm)].map((m) => m[1]);
    expect(rows).toEqual(KEYS);
  });
  it("noemt elke foutcode met de juiste exitcode", () => {
    for (const code of CODES) {
      const exit = new WordiknatError(code).exitCode;
      expect(readme, code).toMatch(new RegExp(`^\\| \`${code}\` \\| ${exit} \\|`, "m"));
    }
  });
  it("heeft een AGENTS.md-fragment en linkt agent/SKILL.md", () => {
    expect(readme).toContain("(agent/SKILL.md)");
    expect(readme).toMatch(/`{4}markdown\n## [\s\S]*wordiknat <plaats> --json[\s\S]*`{4}/);
  });
  it("heeft een Engelse sectie van hooguit 12 regels", () => {
    const section = readme.split(/^## English\n/m)[1];
    expect(section).toBeDefined();
    expect(section.trim().split("\n").length).toBeLessThanOrEqual(12);
  });
  it("noemt geen interne planbestanden", () => {
    expect(readme).not.toMatch(/MISSION|PRD|ROADMAP|DESIGN\.md|CLAUDE\.md|\.plans|\.claude/);
  });
  it("Snel starten gebruikt bestaande scripts en .env.example", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts.build).toBeDefined();
    expect(readFileSync(".env.example", "utf8")).toContain("KNMI_API_KEY=");
    expect(readme).toContain("cp .env.example .env");
  });
  it("bevat geen echte sleutel", () => {
    expect(readme).not.toMatch(/KNMI_API_KEY=[A-Za-z0-9._-]{20,}/);
    expect(readme).not.toMatch(/eyJ[A-Za-z0-9]{20,}/);
  });
});
