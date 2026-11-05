// Builds the real web bundle with Vite and serves it through the real server (DOD-1.8, SR-001, SR-004, NFR-001).
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { tileRange } from "../src/core/map-grid.ts";
import { tileUrl } from "../src/core/tiles.ts";
import { startServer } from "../src/server.ts";
import { fakeFetch, KEY, NOW, PNG } from "./helpers/fake-fetch.ts";

const CSP = "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const SVG_NS = "http://www.w3.org/2000/svg";
const URL_RE = /https?:\/\/[^\s"'`)<>]*/g;
const R8 = tileRange(8);
const TILE = { z: 8, x: R8.x0, y: R8.y0 };

let tmp: string;
let outDir: string;
let built: Array<[path: string, text: string]>;
let server: http.Server;
let base: string;
let fake: ReturnType<typeof fakeFetch>;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "wordiknat-int-"));
  outDir = join(tmp, "web");
  // The key sits in the build environment too, so a leak through define/import.meta.env would show up.
  vi.stubEnv("KNMI_API_KEY", KEY);
  try {
    await build({
      configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
      logLevel: "silent",
      build: { outDir, emptyOutDir: true },
    });
  } finally {
    vi.unstubAllEnvs();
  }
  // The font is binary; every text check below runs on the other files.
  const names = (await readdir(outDir, { recursive: true, withFileTypes: true })).filter((e) => e.isFile() && !e.name.endsWith(".woff2"));
  built = await Promise.all(names.map(async (e) => [join(e.parentPath, e.name), await readFile(join(e.parentPath, e.name), "utf8")] as [string, string]));
  fake = fakeFetch();
  server = await startServer({
    port: 0,
    fetch: fake.fetch,
    env: { KNMI_API_KEY: KEY },
    now: () => NOW,
    cacheDir: join(tmp, "cache"),
    staticDir: outDir,
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  await rm(tmp, { recursive: true, force: true });
});

describe("built bundle served by the server", () => {
  it("the build produced html, js and css (the checks below are not vacuous)", () => {
    const exts = built.map(([p]) => p.slice(p.lastIndexOf(".")));
    expect(exts).toEqual(expect.arrayContaining([".html", ".js", ".css"]));
    expect(built.every(([, text]) => text.length > 0)).toBe(true);
  });

  it("/ is html with external scripts only and no style attributes (SR-004)", async () => {
    const res = await fetch(`${base}/`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(CSP);
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attrs, body] of scripts) {
      expect(attrs).toMatch(/\ssrc=/);
      expect(body.trim()).toBe("");
    }
    expect(html).not.toMatch(/\sstyle\s*=/i);
  });

  it("serves /favicon.svg as svg with the CSP", async () => {
    const res = await fetch(`${base}/favicon.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(res.headers.get("content-security-policy")).toBe(CSP);
  });

  it("every /assets/ file the page references is served with the CSP", async () => {
    const html = await (await fetch(`${base}/`)).text();
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    expect(assets.some((a) => a.endsWith(".js"))).toBe(true);
    expect(assets.some((a) => a.endsWith(".css"))).toBe(true);
    for (const path of assets) {
      const res = await fetch(`${base}${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-security-policy"), path).toBe(CSP);
      await res.arrayBuffer();
    }
  });

  it("no built file contains the key, its name or a foreign URL (SR-001, NFR-001)", () => {
    // Only the shipped font licence may name URLs (the SIL and Nunito project pages); it is never fetched.
    const licence = join(outDir, "fonts", "OFL.txt");
    expect(built.map(([p]) => p)).toContain(licence);
    for (const [path, text] of built) {
      expect(text, path).not.toContain(KEY);
      expect(text, path).not.toContain("KNMI_API_KEY");
      if (path !== licence) expect((text.match(URL_RE) ?? []).filter((u) => u !== SVG_NS), path).toEqual([]);
    }
  });

  it("serves the self-hosted font as font/woff2 with the CSP", async () => {
    const res = await fetch(`${base}/fonts/nunito-wght.woff2`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("font/woff2");
    expect(res.headers.get("content-security-policy")).toBe(CSP);
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });

  it("the built index.html only references root-relative /assets/ files and the home link, inline-free (SR-004, NFR-001)", () => {
    const [, html] = built.find(([p]) => p.endsWith("index.html"))!;
    const refs = [...html.matchAll(/\s(?:src|href)="([^"]*)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    // "/" is the wordmark's link home.
    for (const ref of refs) expect(ref).toMatch(/^(\/assets\/[\w.-]+|\/favicon\.svg|\/)$/);
    expect(html).not.toMatch(/<script\b(?![^>]*\ssrc=)[^>]*>/i);
    expect(html).not.toMatch(/\sstyle\s*=/i);
  });

  it("the built JS calls the relative /tiles/ and /api/radar paths, never PDOK directly (SR-005)", () => {
    const js = built.filter(([p]) => p.endsWith(".js")).map(([, text]) => text);
    expect(js.length).toBeGreaterThan(0);
    const all = js.join("\n");
    expect(all).toContain("/tiles/");
    expect(all).toContain("/api/radar");
    expect(all).not.toContain("service.pdok.nl");
  });

  it("serves a tile through the proxy with the CSP and no key sent to PDOK (SR-001, SR-004, SR-005)", async () => {
    const res = await fetch(`${base}/tiles/8/${TILE.x}/${TILE.y}.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-security-policy")).toBe(CSP);
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([...PNG]);
    const at = fake.calls.indexOf(tileUrl(TILE));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(fake.inits[at]?.headers?.Authorization).toBeUndefined();
    expect(JSON.stringify(fake.inits[at] ?? {})).not.toContain(KEY);
  });

  it("serves 25 radar frames with the CSP and without the key, its name or a foreign URL (SR-001, SR-004, NFR-001)", async () => {
    const res = await fetch(`${base}/api/radar`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(CSP);
    const text = await res.text();
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("KNMI_API_KEY");
    expect(text.match(URL_RE) ?? []).toEqual([]);
    expect(JSON.parse(text).frames).toHaveLength(25);
  });

  it("the API answers from the same server", async () => {
    // The fixture crop covers 55.0-55.4 °N only, so Utrecht (52.09, 5.1) would be OUTSIDE_GRID here.
    const res = await fetch(`${base}/api/forecast?lat=55&lon=5.33`);
    expect(res.status).toBe(200);
    expect((await res.json()).points).toHaveLength(25);
  });
});
