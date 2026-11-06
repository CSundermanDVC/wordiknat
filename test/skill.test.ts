import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildHourlyReport } from "../src/core/report";
import { WordiknatError, type ErrorCode } from "../src/core/errors";

const skill = readFileSync("agent/SKILL.md", "utf8");
const KEYS = ["summary", "willRain", "firstRainAt", "dryUntil", "maxMmPerHour", "location", "issuedAt", "points", "source"];
const HOURLY_KEYS = ["summary", "willRain", "firstRainAt", "dryUntil", "maxMmPerHour", "intensity", "location", "issuedAt", "hours", "source"];
const CODES: ErrorCode[] = [
  "MISSING_KEY", "INVALID_KEY", "RATE_LIMITED", "SOURCE_HTTP", "NETWORK", "BAD_FILE",
  "OUTSIDE_GRID", "NO_DATA", "UNKNOWN_PLACE", "BAD_ARGS", "NO_LOCATION", "TILE_UNAVAILABLE",
  "HOURLY_UNAVAILABLE", "HOURLY_BAD_FILE",
];

/** The text from a heading up to the next `##` or `###` heading. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n${heading}\n`);
  expect(start, heading).toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + 1 + heading.length);
  const end = rest.search(/\n#{2,3} /);
  return end < 0 ? rest : rest.slice(0, end);
}
const keyRows = (s: string) => [...s.matchAll(/^\| `(\w+)` \| (?:string|boolean|number|object|array)/gm)].map((m) => m[1]);

describe("agent/SKILL.md", () => {
  it("begint met frontmatter met name en description", () => {
    const fm = skill.match(/^---\n([\s\S]*?)\n---\n/);
    expect(fm).not.toBeNull();
    expect(fm![1]).toMatch(/^name: wordiknat$/m);
    expect(fm![1]).toMatch(/^description: \S/m);
  });
  it("noemt wordiknat --json en de negen sleutels in volgorde", () => {
    expect(skill).toContain("wordiknat <plaats> --json");
    const rows = keyRows(section(skill, "## Het resultaat"));
    expect(rows).toEqual(KEYS);
  });
  it("noemt de sleutels van het 24-uursobject in volgorde", () => {
    const date = new Date();
    const summary = { summary: "", willRain: false, firstRainAt: null, dryUntil: null, maxMmPerHour: 0, intensity: null };
    const real = Object.keys(buildHourlyReport({ location: { name: "", lat: 0, lon: 0 }, issuedAt: date, hours: [], source: "x" } as never, summary));
    expect(HOURLY_KEYS).toEqual(real);
    expect(keyRows(section(skill, "## De 24-uursverwachting"))).toEqual(HOURLY_KEYS);
    expect(skill).toContain("--24u --json");
  });
  it("noemt elke foutcode met de juiste exitcode", () => {
    for (const code of CODES) {
      const exit = new WordiknatError(code).exitCode;
      expect(skill, code).toMatch(new RegExp(`^\\| \`${code}\` \\| ${exit} \\|`, "m"));
    }
  });
  it("noemt geen interne bestanden", () => {
    expect(skill).not.toMatch(/MISSION|PRD|ROADMAP|DESIGN\.md|CLAUDE\.md|\.plans|\.claude/);
  });
});
