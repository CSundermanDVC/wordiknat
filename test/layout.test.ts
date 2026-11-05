import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("Vite layout (DOD-1.4.2, DOD-1.4.4)", () => {
  it("root index.html and src/main.ts are gone", () => {
    expect(existsSync(new URL("../index.html", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../src/main.ts", import.meta.url))).toBe(false);
  });

  it("package.json has serve and dev scripts and only h5wasm as dependency", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.dev).toBe("vite");
    expect(pkg.scripts.serve).toContain("wordiknat.js serve");
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(["h5wasm"]);
  });

  it("favicon.svg is self-contained: only the SVG namespace, no scripts", () => {
    const svg = read("web/public/favicon.svg");
    expect(svg).toMatch(/^<svg\b/);
    expect(svg.replace("http://www.w3.org/2000/svg", "")).not.toMatch(/https?:\/\/|<script|\son\w+=|data:/i);
  });

  it("web/index.html is Dutch with no inline script or style", () => {
    const html = read("web/index.html");
    expect(html).toContain('lang="nl"');
    expect(html.match(/<main[\s>]/g)).toHaveLength(1);
    expect(html).toContain("Bron: KNMI (CC BY 4.0)");
    // Same text as the footer line in docs/pdok-tiles.md (Attribution).
    expect(html).toContain("Kaart: BRT Achtergrondkaart, Kadaster/PDOK");
    expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/i);
    expect(html).not.toMatch(/<style|style=|\son\w+=/i);
  });
});

describe("page shell (DOD-4.4.4)", () => {
  const html = read("web/index.html");
  /** The opening tag of the element with this id. */
  const tag = (id: string) => html.match(new RegExp(`<[a-z][a-z0-9]*\\b[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? "";
  /** The markup from the element with this id up to its first closing `</name>`. */
  const block = (id: string, name: string) => html.slice(html.indexOf(`id="${id}"`), html.indexOf(`</${name}>`, html.indexOf(`id="${id}"`)));

  it("has the top bar with the wordmark and the place pill controlling the picker", () => {
    expect(html).toMatch(/<header class="top">\s*<a class="mark" href="\/">wordiknat<span>\?<\/span><\/a>/);
    expect(tag("place-pill")).toContain('aria-controls="picker"');
    expect(tag("place-pill")).toContain('type="button"');
    expect(tag("place-pill")).toMatch(/aria-expanded="(true|false)"/);
    expect(tag("place-name")).not.toBe("");
  });

  it("has the street with the stage and the caption elements, in order, inside <main>", () => {
    const main = html.slice(html.indexOf("<main>"), html.indexOf("</main>"));
    const ids = ["stage", "summary", "detail", "issued", "announce", "picker", "graph", "map"];
    const at = ids.map((id) => main.indexOf(`id="${id}"`));
    expect(at.every((i) => i >= 0), ids.join()).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(main).toContain('<section class="street" aria-label="Het antwoord">');
  });

  it("uses one visually hidden status element as the live region; the answer itself is not live", () => {
    expect(tag("announce")).toContain('role="status"');
    expect(tag("announce")).toContain("visually-hidden");
    expect(tag("summary")).not.toMatch(/aria-live|role=/);
    expect(html.match(/aria-live/g)).toBeNull();
  });

  it("labels the picker and both panels by their headings", () => {
    expect(tag("picker")).toContain('aria-labelledby="picker-heading"');
    expect(tag("picker-heading")).toMatch(/^<h2/);
    expect(block("picker", "section")).toContain('id="location"');
    for (const [id, heading, title] of [
      ["graph", "graph-heading", "Wanneer"],
      ["map", "map-heading", "Waar"],
    ] as const) {
      const at = html.indexOf(`id="${id}"`);
      const article = html.lastIndexOf("<article", at);
      expect(html.slice(article, at)).toContain(`aria-labelledby="${heading}"`);
      expect(html.slice(article, at)).toContain(`<h2 id="${heading}">${title}</h2>`);
      expect(html.indexOf("</article>", article)).toBeGreaterThan(at);
    }
  });
});

describe("styles (DOD-2.7, DOD-4.4.4)", () => {
  const css = read("web/style.css");
  /** [start, end] of the body of every `@media <query>` block, braces balanced. */
  const ranges = (query: string) =>
    [...css.matchAll(new RegExp(`@media \\(${query}\\)\\s*\\{`, "g"))].map((m) => {
      let depth = 1;
      let i = m.index! + m[0].length;
      for (; depth > 0; i++) depth += css[i] === "{" ? 1 : css[i] === "}" ? -1 : 0;
      return [m.index! + m[0].length, i - 1] as const;
    });
  const darkBlocks = ranges("prefers-color-scheme: dark").map(([a, b]) => css.slice(a, b));

  it("animates only inside prefers-reduced-motion: no-preference", () => {
    const gate = ranges("prefers-reduced-motion: no-preference");
    const decls = [...css.matchAll(/(?<![\w-])(animation|transition)(-[a-z-]+)?\s*:\s*([^;}]+)/g)];
    expect(decls.length, "the motion rules exist").toBeGreaterThan(0);
    const loose = decls.filter((m) => m[3]!.trim() !== "none" && !gate.some(([a, b]) => m.index! > a && m.index! < b));
    expect(loose.map((m) => m[0])).toEqual([]);
    expect(css).not.toContain("prefers-reduced-motion: reduce");
  });

  it("self-hosts Nunito", () => {
    expect(css).toMatch(/@font-face\s*\{[^}]*src:\s*url\("\/fonts\/nunito-wght\.woff2"\)\s*format\("woff2"\)/);
    expect(css).toMatch(/@font-face\s*\{[^}]*font-display:\s*swap/);
  });

  it("defines the three rain tokens as hex on :root and drops the old names", () => {
    const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
    for (const t of ["--rain-1", "--rain-2", "--rain-3"]) expect(root, t).toMatch(new RegExp(`${t}:\\s*#[0-9a-fA-F]{6};`));
    expect(css).not.toMatch(/--(bg|surface|fg|line|warn|ink-soft|rain-licht|rain-matig|rain-zwaar)\b/);
  });

  it("dark blocks redefine only custom properties, apart from the tile filter", () => {
    expect(darkBlocks.length).toBeGreaterThanOrEqual(2);
    const rules = darkBlocks.flatMap((b) => [...b.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1]!.trim(), m[2]!] as const));
    for (const [selector, body] of rules) {
      const decls = body.split(";").map((d) => d.replace(/\/\*[\s\S]*?\*\//g, "").trim()).filter(Boolean);
      if (selector === ":root") expect(decls.filter((d) => !/^--[\w-]+:|^color-scheme:/.test(d)), selector).toEqual([]);
      else {
        expect(selector).toBe(".map-tiles");
        expect(decls.every((d) => d.startsWith("filter:"))).toBe(true);
      }
    }
  });

  it("filters the tiles once in light and once in a dark block, never the rain, pin or chip (Ongefilterde regen)", () => {
    const TILE = /\.map-tiles\s*\{[^}]*filter:/g;
    const inDark = darkBlocks.flatMap((b) => b.match(TILE) ?? []);
    expect(css.match(TILE)).toHaveLength(2);
    expect(inDark).toHaveLength(1);
    expect(css).toMatch(/\.map-tiles\s*\{[^}]*filter:\s*sepia\(0\.35\) saturate\(0\.8\) brightness\(1\.04\)/);
    expect(darkBlocks.join("")).toMatch(/\.map-tiles\s*\{[^}]*filter:\s*invert\(0\.9\) hue-rotate\(185deg\)/);
    for (const layer of ["map-rain", "map-pin", "place-chip"]) expect(css, layer).not.toMatch(new RegExp(`\\.${layer}[^{]*\\{[^}]*filter:`));
  });

  it("keeps the rain layer, pin and chip above the filtered tiles (position: relative on every layer)", () => {
    expect(css.match(/\.map-figure > \*\s*\{[^}]*position:\s*relative;/)).not.toBeNull();
    expect(css).not.toMatch(/\.(map-rain|map-pin|place-chip)\s*\{[^}]*position:\s*(static|absolute)/);
  });

  it("styles the Waar figure, slider, legend and the 360 px player wrap (DOD-4.7)", () => {
    expect(css).toMatch(/\.map-figure\s*\{[^}]*var\(--map-ground\)[^}]*3px solid var\(--ink\)[^}]*border-radius:\s*12px/);
    expect(css).toMatch(/\.map-slider\s*\{[^}]*accent-color:\s*var\(--ink-line\)/);
    expect(css).toMatch(/\.map-time\s*\{[^}]*font-weight:\s*900[^}]*tabular-nums/);
    for (const n of ["licht", "matig", "zwaar"]) expect(css).toMatch(new RegExp(`\\.swatch-${n}\\s*\\{[^}]*var\\(--rain-[123]\\)`));
    expect(css).toMatch(/@media \(max-width: 360px\)\s*\{[^@]*\.map-slider\s*\{[^}]*flex-basis:\s*100%/);
  });

  it("wires the shared step both ways in main.ts (DOD-4.7.3)", () => {
    const main = read("web/main.ts");
    expect(main).toMatch(/onStep\(/);
    expect(main).toMatch(/graph\.show\(/);
    expect(main).toMatch(/sceneAtStep\(/);
    expect(main).toMatch(/map\.setStep\(/);
    expect(main).toMatch(/i === selected\) return/);
  });

  it("the place chip uses textContent and CSSOM positions only (security note)", () => {
    const map = read("web/map.ts");
    expect(map).toMatch(/chip\.textContent\s*=/);
    expect(map).toMatch(/chip\.style\.setProperty\("left"/);
    expect(map).not.toMatch(/chip\.(innerHTML|setAttribute)/);
  });

  it("stacks the panels in one column up to 900 px", () => {
    expect(css).toMatch(/\.panels\s*\{[^}]*grid-template-columns:\s*minmax\(0, 5fr\) minmax\(0, 7fr\)/);
    expect(css).toMatch(/@media \(max-width: 900px\)\s*\{\s*\.panels\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
  });
});

describe("product name (DOD-3.2.1)", () => {
  it("web/index.html title is Wordiknat", () => {
    expect(read("web/index.html")).toMatch(/<title>Wordiknat<\/title>/);
  });
});

describe("graph css (DOD-4.6)", () => {
  const css = read("web/style.css");
  it("graph svg strokes do not scale with the stretch", () => {
    expect(css).toMatch(/\.graph-plot path,\s*\.graph-plot line\s*\{[^}]*vector-effect:\s*non-scaling-stroke/);
  });
  it("graph line reads --graph-line", () => {
    expect(css).toMatch(/\.graph-line\s*\{[^}]*stroke:\s*var\(--graph-line\)/);
  });
});

describe("graph glue (DOD-4.6.1, DOD-4.6.4)", () => {
  const graphSrc = read("web/graph.ts");
  it("draws no SVG text and no style attribute", () => {
    expect(graphSrc).not.toMatch(/<text|"text"/);
    expect(graphSrc).not.toMatch(/setAttribute\(\s*"style"|\bstyle=/);
  });
  it("keeps slider semantics, mouse-only pointerleave reset and pointer capture", () => {
    for (const s of ['role: "slider"', "aria-valuenow", "aria-valuetext", "setPointerCapture", 'e.pointerType === "mouse" && !target.hasPointerCapture']) {
      expect(graphSrc).toContain(s);
    }
  });
  it("main wires a graph scrub to the scene via sceneAtStep", () => {
    expect(read("web/main.ts")).toMatch(/mountGraph\(graphEl,\s*\{[^}]*sceneAtStep/s);
  });
});
