import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WordiknatError, type ErrorCode } from "../src/core/errors";

const skill = readFileSync("agent/SKILL.md", "utf8");
const KEYS = ["summary", "willRain", "firstRainAt", "dryUntil", "maxMmPerHour", "location", "issuedAt", "points", "source"];
const CODES: ErrorCode[] = [
  "MISSING_KEY", "INVALID_KEY", "RATE_LIMITED", "SOURCE_HTTP", "NETWORK", "BAD_FILE",
  "OUTSIDE_GRID", "NO_DATA", "UNKNOWN_PLACE", "BAD_ARGS", "NO_LOCATION", "TILE_UNAVAILABLE",
];

describe("agent/SKILL.md", () => {
  it("begint met frontmatter met name en description", () => {
    const fm = skill.match(/^---\n([\s\S]*?)\n---\n/);
    expect(fm).not.toBeNull();
    expect(fm![1]).toMatch(/^name: wordiknat$/m);
    expect(fm![1]).toMatch(/^description: \S/m);
  });
  it("noemt wordiknat --json en de negen sleutels in volgorde", () => {
    expect(skill).toContain("wordiknat <plaats> --json");
    const rows = [...skill.matchAll(/^\| `(\w+)` \| (?:string|boolean|number|object|array)/gm)].map((m) => m[1]);
    expect(rows).toEqual(KEYS);
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
