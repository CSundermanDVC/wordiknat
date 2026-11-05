// Repo-level guards for SR-001, SR-003, SR-004 and NFR-001: they scan the source tree, so later phases keep the properties.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

const FONT = /\.woff2$/;

/** Every text file under `dir` as [repo-relative path, lines]; font binaries are skipped. */
const files = (dir: string) =>
  walk(join(ROOT, dir))
    .filter((f) => !FONT.test(f))
    .map((f) => [relative(ROOT, f).split("\\").join("/"), readFileSync(f, "utf8").split("\n")] as const);

// The font licence ships next to the font and names the SIL and Nunito project URLs; no other web/ file may hold a URL.
const URL_ALLOWED = new Set(["web/public/fonts/OFL.txt"]);

// Comment rule: a line whose first non-blank characters open or continue a comment (//, /*, *, <!--) is prose, not code.
const isComment = (line: string) => /^\s*(\/\/|\/\*|\*|<!--)/.test(line);

const SINK = /innerHTML|outerHTML|insertAdjacentHTML|document\.write|setAttribute\(\s*["']style["']/;
const URL_RE = /https?:\/\/[^\s"'`)<>]*/g;
const SVG_NS = "http://www.w3.org/2000/svg";
const SRC_HOSTS = new Set([
  "api.dataplatform.knmi.nl",
  "api.pdok.nl",
  "service.pdok.nl",
  "developer.dataplatform.knmi.nl", // named in the MISSING_KEY message, never fetched
  "127.0.0.1",
  "localhost",
  "${url}", // cli.ts prints the server's own bind address
]);
const PDOK_TILE_HOST = /service\.pdok\.nl/;
const AUTH = /authorization/i;
const NODE_IMPORT = /(?:\bfrom|\bimport\s*\(?|\brequire\s*\()\s*["']node:/;
const PRIVATE_REF = /\bMISSION\b|\bPRD\b|\bROADMAP\b|DESIGN\.md|CLAUDE\.md|\.plans\b|\.claude\b/;

/** `path:line: text` for every line in `dirs` that matches `bad`. */
function offenders(dirs: string[], bad: (line: string) => boolean): string[] {
  return dirs.flatMap((d) => files(d).flatMap(([path, lines]) => lines.flatMap((l, i) => (bad(l) ? [`${path}:${i + 1}: ${l.trim()}`] : []))));
}

const host = (url: string) => url.replace(/^https?:\/\//, "").split(/[/:?#]/)[0];

describe("guards", () => {
  it("scans a non-empty src/ and web/ (the guards cannot pass vacuously)", () => {
    expect(files("src").length).toBeGreaterThan(0);
    expect(files("web").length).toBeGreaterThan(0);
    expect(files("web").some(([p]) => p.endsWith(".ts"))).toBe(true);
  });

  it("the rules catch what they claim to", () => {
    expect(SINK.test("el.innerHTML = x")).toBe(true);
    expect(SINK.test(`el.setAttribute("style", "x")`)).toBe(true);
    expect(isComment("  // el.innerHTML")).toBe(true);
    expect(isComment("el.innerHTML = '' // x")).toBe(false);
    expect("fetch('https://evil.example/x')".match(URL_RE)?.map(host)).toEqual(["evil.example"]);
    expect(PRIVATE_REF.test("see PRD.md")).toBe(true);
    expect(PDOK_TILE_HOST.test("const u = `https://service.pdok.nl/brt/x.png`")).toBe(true);
    expect(AUTH.test("headers: { Authorization: key }")).toBe(true);
    expect(NODE_IMPORT.test(`import { readFile } from "node:fs";`)).toBe(true);
    expect(NODE_IMPORT.test(`import "node:fs";`)).toBe(true);
    expect(NODE_IMPORT.test(`await import("node:path")`)).toBe(true);
    expect(NODE_IMPORT.test(`import { x } from "./node-utils.ts";`)).toBe(false);
  });

  it("no HTML or inline-style sinks in src/ and web/ (SR-003, SR-004)", () => {
    expect(offenders(["src", "web"], (l) => !isComment(l) && SINK.test(l))).toEqual([]);
  });

  it("web/ contains no URL except the SVG namespace (NFR-001)", () => {
    const hits = offenders(["web"], (l) => (l.match(URL_RE) ?? []).some((u) => u !== SVG_NS));
    expect(hits.filter((h) => !URL_ALLOWED.has(h.slice(0, h.indexOf(":"))))).toEqual([]);
  });

  it("the URL allowance names exactly the shipped font licence, and the font is skipped as binary", () => {
    expect([...URL_ALLOWED]).toEqual(["web/public/fonts/OFL.txt"]);
    const web = files("web").map(([p]) => p);
    expect(web).toContain("web/public/fonts/OFL.txt");
    expect(web.some((p) => p.endsWith(".woff2"))).toBe(false);
    expect(walk(join(ROOT, "web")).some((f) => f.endsWith("web/public/fonts/nunito-wght.woff2"))).toBe(true);
  });

  it("src/ only names the KNMI, PDOK and loopback hosts (NFR-001)", () => {
    expect(offenders(["src"], (l) => (l.match(URL_RE) ?? []).some((u) => !SRC_HOSTS.has(host(u))))).toEqual([]);
  });

  it("only src/core/tiles.ts names the PDOK tile host; web/ never does (SR-005, NFR-001)", () => {
    const named = files("src").filter(([, lines]) => lines.some((l) => PDOK_TILE_HOST.test(l))).map(([p]) => p.split("\\").join("/"));
    expect(named).toEqual(["src/core/tiles.ts"]);
    expect(offenders(["web"], (l) => PDOK_TILE_HOST.test(l))).toEqual([]);
  });

  it("web/ never builds an Authorization header (SR-001)", () => {
    expect(offenders(["web"], (l) => AUTH.test(l))).toEqual([]);
  });

  it("web/ and src/core/map-grid.ts import no node: modules (browser bundle)", () => {
    const grid = "src/core/map-grid.ts";
    const gridHits = readFileSync(join(ROOT, grid), "utf8").split("\n").flatMap((l, i) => (NODE_IMPORT.test(l) ? [`${grid}:${i + 1}`] : []));
    expect([...offenders(["web"], (l) => NODE_IMPORT.test(l)), ...gridHits]).toEqual([]);
  });

  it("h5wasm is the only runtime dependency", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(["h5wasm"]);
  });

  it("shipped files never reference the private planning docs", () => {
    expect(offenders(["src", "web", "bin", "docs"], (l) => PRIVATE_REF.test(l))).toEqual([]);
  });

  it("playback never starts by itself (US-015)", () => {
    const code = (dir: string) => files(dir).filter(([p]) => p.endsWith(".ts"));
    const plays = code("web").flatMap(([path, lines]) => lines.flatMap((l, i) => (!isComment(l) && /\.play\(\)/.test(l) ? [`${path}:${i + 1}`] : [])));
    expect(plays).toHaveLength(1);
    const [path, lines] = code("web").find(([p]) => p.endsWith("web/map.ts"))!;
    expect(plays[0]).toContain(path);
    const at = lines.findIndex((l) => /\.play\(\)/.test(l));
    expect(lines.slice(Math.max(0, at - 4), at).join("\n")).toContain('addEventListener("click"');
    expect(lines.filter((l) => !isComment(l) && /autoplay|setInterval|aria-live/.test(l))).toEqual([]);
  });

  it("the caption and scene never poll, and no script sets aria-live (the countdown is not a live region)", () => {
    const code = files("web").filter(([p]) => p.endsWith(".ts"));
    const paths = code.map(([p]) => p);
    for (const p of ["web/caption.ts", "web/scene.ts"]) expect(paths).toContain(p);
    const hits = code.flatMap(([path, lines]) =>
      lines.flatMap((l, i) =>
        !isComment(l) && (/aria-live/.test(l) || (/^web\/(caption|scene)\.ts$/.test(path) && /setInterval/.test(l)))
          ? [`${path}:${i + 1}: ${l.trim()}`]
          : [],
      ),
    );
    expect(hits).toEqual([]);
  });

  it("the time slider is labelled and has a value text (DOD-2.8.4)", () => {
    const src = readFileSync("web/map.ts", "utf8");
    expect(src).toContain('"aria-label": "Tijdstap"');
    expect(src).toContain("aria-valuetext");
  });
});

describe("no leftover of the old product name (US-016, DOD-3.1)", () => {
  const OLD = /* built from pieces so this file never contains the old name */ new RegExp("droo" + "gte", "i");
  const SKIP = new Set([".git", "node_modules", "dist", "tmp", ".plans", ".remember", ".env", "ROADMAP.md", ".DS_Store"]);
  const BINARY = /\.(h5|png|ico|woff2)$/;

  /** Every non-skipped file and directory under the repo root. */
  function scan(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const path = join(dir, e.name);
      if (dir === ROOT && SKIP.has(e.name)) return [];
      return e.isDirectory() ? [path, ...scan(path)] : [path];
    });
  }
  const all = scan(ROOT).map((p) => relative(ROOT, p));

  it("finds no old name in any path or file line", () => {
    const hits = all.flatMap((p) => {
      const abs = join(ROOT, p);
      const nameHit = OLD.test(p) ? [`${p}: (path)`] : [];
      if (BINARY.test(p) || statSync(abs).isDirectory()) return nameHit;
      return [...nameHit, ...readFileSync(abs, "utf8").split("\n").flatMap((l, i) => (OLD.test(l) ? [`${p}:${i + 1}: ${l.trim()}`] : []))];
    });
    expect(hits).toEqual([]);
  });

  it("the rule catches what it claims to", () => {
    for (const s of ["droo" + "gte", "Droo" + "gte", "DROO" + "GTE"]) expect(OLD.test(`X${s}`)).toBe(true);
    expect(OLD.test("wordiknat")).toBe(false);
  });

  it("is not vacuous and the bin maps wordiknat", () => {
    for (const p of ["src/cli.ts", "package.json", "bin/wordiknat.js"]) expect(all).toContain(p);
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.bin.wordiknat).toBe("bin/wordiknat.js");
  });
});
