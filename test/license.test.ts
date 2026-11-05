import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("licentie", () => {
  it("LICENSE bevat de MIT-tekst", () => {
    expect(readFileSync("LICENSE", "utf8").startsWith("MIT License")).toBe(true);
  });
  it("package.json is MIT en blijft private", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.license).toBe("MIT");
    expect(pkg.private).toBe(true);
  });
  it("LICENSE heeft de copyrightregel en de volledige tekst", () => {
    const t = readFileSync("LICENSE", "utf8");
    expect(t).toContain("Copyright (c) 2026 wordiknat contributors");
    expect(t).toContain("Permission is hereby granted, free of charge");
    expect(t.trimEnd().endsWith("OTHER DEALINGS IN THE\nSOFTWARE.")).toBe(true);
  });
  it("package.json heeft beschrijving, repository en ongewijzigde dependencies", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.description).toMatch(/regenverwachting/);
    expect(pkg.repository).toEqual({ type: "git", url: "https://github.com/CSundermanDVC/wordiknat" });
    expect(Object.keys(pkg.dependencies)).toEqual(["h5wasm"]);
  });
});
