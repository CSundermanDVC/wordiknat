// Keeps the public files free of private references and README and the skill in step with the code (US-012, US-013).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildReport } from "../src/core/report.ts";
import type { Forecast, Summary } from "../src/core/types.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

const PRIVATE_REF = /\bMISSION\b|\bPRD\b|\bROADMAP\b|DESIGN\.md|PRODUCT\.md|CLAUDE\.md|\.plans\b|\.claude\b/i;
// Binary fonts and the third-party font licence (it contains the word PERMISSION) are not ours to scan.
const SKIP = /\.(woff2|png)$|(^|\/)OFL\.txt$/;
const PUBLIC = ["README.md", "LICENSE", "agent", "docs", "scripts", "src", "web"];

const publicFiles = PUBLIC.flatMap((p) => {
  const abs = join(ROOT, p);
  return p.includes(".") || p === "LICENSE" ? [abs] : walk(abs);
}).map((f) => relative(ROOT, f).split("\\").join("/"));

const readme = read("README.md");
const skill = read("agent/SKILL.md");

const forecast = {
  location: { lat: 52, lon: 5, name: "x" },
  issuedAt: new Date(0),
  points: [],
  source: "KNMI",
} as unknown as Forecast;
const summary: Summary = { summary: "", willRain: false, firstRainAt: null, dryUntil: null, maxMmPerHour: 0, intensity: null };

describe("public files", () => {
  it("regex flags a private reference", () => {
    expect(PRIVATE_REF.test("see the roadmap for .plans/ and CLAUDE.md")).toBe(true);
  });

  it("names no private files or folders", () => {
    const offenders = publicFiles
      .filter((f) => !SKIP.test(f))
      .flatMap((f) =>
        read(f)
          .split("\n")
          .flatMap((line, i) => (PRIVATE_REF.test(line) ? [`${f}:${i + 1}`] : [])),
      );
    expect(publicFiles).toEqual(expect.arrayContaining(["README.md", "LICENSE", "agent/SKILL.md"]));
    expect(offenders).toEqual([]);
  });

  it("documents every JSON key in README and SKILL.md", () => {
    const keys = Object.keys(buildReport(forecast, summary));
    expect(keys.length).toBeGreaterThan(5);
    const missing = keys.flatMap((k) => [readme, skill].flatMap((t, i) => (t.includes(`\`${k}\``) ? [] : [`${k} in ${i ? "SKILL.md" : "README.md"}`])));
    expect(missing).toEqual([]);
  });

  it("documents every error code in README and SKILL.md", () => {
    const union = /export type ErrorCode =([^;]*);/.exec(read("src/core/errors.ts"))?.[1] ?? "";
    const codes = [...union.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThanOrEqual(10);
    const missing = codes.flatMap((c) => [readme, skill].flatMap((t, i) => (t.includes(c) ? [] : [`${c} in ${i ? "SKILL.md" : "README.md"}`])));
    expect(missing).toEqual([]);
  });

  it("SKILL.md has frontmatter name and description", () => {
    const fm = /^---\n([\s\S]*?)\n---/.exec(skill)?.[1] ?? "";
    expect(fm).toMatch(/^name: wordiknat$/m);
    expect(fm).toMatch(/^description: \S/m);
  });

  it("README has the install, key and English parts", () => {
    for (const s of ["npm ci", "npx wordiknat", ".env.example", "KNMI_API_KEY"]) expect(readme).toContain(s);
    expect(readme).toMatch(/^## English/m);
  });

  it("README images exist in the repo and none is external", () => {
    const paths = [...readme.matchAll(/(?:src|srcset)="([^"]+)"|!\[[^\]]*\]\(([^)\s]+)/g)].flatMap((m) =>
      m[1] !== undefined ? m[1].split(",").map((e) => e.trim().split(/\s+/)[0]) : [m[2]],
    );
    expect(paths.length).toBeGreaterThanOrEqual(4);
    expect(paths.filter((p) => /^(?:[a-z]+:)?\/\//i.test(p))).toEqual([]);
    expect(paths.filter((p) => !existsSync(join(ROOT, p)))).toEqual([]);
  });

  it("docs/img holds 3 to 5 PNGs, each at most 300 KB", () => {
    const files = readdirSync(join(ROOT, "docs/img"));
    expect(files.filter((f) => !f.endsWith(".png"))).toEqual([]);
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files.length).toBeLessThanOrEqual(5);
    expect(files.filter((f) => statSync(join(ROOT, "docs/img", f)).size > 300 * 1024)).toEqual([]);
  });
});
