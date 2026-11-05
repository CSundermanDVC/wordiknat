import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("DOD-0.2.1 CI workflow", () => {
  const ci = read(".github/workflows/ci.yml");
  it("runs on pull_request and push to main", () => {
    expect(ci).toMatch(/pull_request:/);
    expect(ci).toMatch(/push:\s*\n\s*branches: \[main\]/);
  });
  it("runs npm ci, typecheck, test and build in order on ubuntu with Node 22", () => {
    expect(ci).toContain("ubuntu-latest");
    expect(ci).toMatch(/node-version: 22\.x/);
    const steps = ["npm ci", "npm run typecheck", "npm test", "npm run build"].map((s) => ci.indexOf(`run: ${s}`));
    expect(steps.every((i) => i >= 0)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
  });
});

describe("DOD-0.2.2 .env.example", () => {
  it("declares both variables without values", () => {
    const lines = read(".env.example").split("\n").filter((l) => l && !l.startsWith("#"));
    expect(lines).toEqual(["KNMI_API_KEY=", "WORDIKNAT_LOCATION="]);
  });
  it("keeps .env untracked and ignored", () => {
    expect(execFileSync("git", ["ls-files", ".env"], { encoding: "utf8" }).trim()).toBe("");
    expect(read(".gitignore")).toMatch(/^\.env$/m);
  });
});

describe("package.json", () => {
  it("pins node engine and has @types/node", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.engines.node).toBe(">=22.18");
    expect(pkg.devDependencies["@types/node"]).toBeDefined();
  });
});
