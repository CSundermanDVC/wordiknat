import { describe, expect, it } from "vitest";
import { createRecentStore } from "../../web/lib/recent.ts";

const mem = (init?: string) => {
  const m = new Map<string, string>();
  if (init !== undefined) m.set("wordiknat.recent", init);
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};
const loc = (name: string, lat = 52, lon = 5) => ({ name, lat, lon });

describe("recent store", () => {
  it("empty gives []", () => expect(createRecentStore(mem()).list()).toEqual([]));

  it("add then list, newest first", () => {
    const s = createRecentStore(mem());
    s.add(loc("A", 52, 5));
    s.add(loc("B", 51, 4));
    expect(s.list().map((l) => l.name)).toEqual(["B", "A"]);
  });

  it("dedupes by rounded coordinates and moves to front", () => {
    const s = createRecentStore(mem());
    s.add(loc("A", 52.0901, 5));
    s.add(loc("B", 51, 4));
    const out = s.add(loc("A2", 52.0904, 5));
    expect(out.map((l) => l.name)).toEqual(["A2", "B"]);
    expect(s.list()).toEqual(out);
  });

  it("keeps at most 5", () => {
    const s = createRecentStore(mem());
    for (let i = 0; i < 6; i++) s.add(loc(`L${i}`, 50 + i * 0.5, 5));
    const names = s.list().map((l) => l.name);
    expect(names).toEqual(["L5", "L4", "L3", "L2", "L1"]);
  });

  it("throwing getItem gives []", () => {
    const s = createRecentStore({
      getItem: () => {
        throw new Error("x");
      },
      setItem: () => {},
    });
    expect(s.list()).toEqual([]);
  });

  it("throwing setItem still returns list", () => {
    const s = createRecentStore({
      getItem: () => null,
      setItem: () => {
        throw new Error("full");
      },
    });
    expect(s.add(loc("A"))).toEqual([loc("A")]);
  });

  it("null storage works", () => {
    const s = createRecentStore(null);
    expect(s.list()).toEqual([]);
    expect(s.add(loc("A"))).toEqual([loc("A")]);
  });

  it.each(["not json", "42", "{}", "null"])("malformed %s gives []", (raw) => {
    expect(createRecentStore(mem(raw)).list()).toEqual([]);
  });

  it("keeps only valid entries", () => {
    const raw = JSON.stringify([
      loc("ok"),
      loc("x".repeat(101)),
      loc(""),
      { name: "nan", lat: null, lon: 5 },
      { name: "str", lat: "52", lon: 5 },
      loc("north", 56, 5),
      loc("west", 52, -1),
      loc("east", 52, 11),
      loc("south", 48, 5),
      null,
      "x",
      loc("edge", 55, 10),
    ]);
    expect(createRecentStore(mem(raw)).list().map((l) => l.name)).toEqual(["ok", "edge"]);
  });

  it("does not mutate earlier results", () => {
    const s = createRecentStore(mem());
    const first = s.add(loc("A", 52, 5));
    s.add(loc("B", 51, 4));
    expect(first).toEqual([loc("A", 52, 5)]);
  });

  it("invalid JSON, non-array and number give []", () => {
    for (const raw of ["{not json", "42", '{"a":1}', "null", ""])
      expect(createRecentStore(mem(raw)).list()).toEqual([]);
  });

  it("add over corrupt storage starts fresh", () => {
    expect(createRecentStore(mem("garbage")).add(loc("A"))).toEqual([loc("A")]);
  });

  it("dedupes rounding noise and a renamed spot", () => {
    const s = createRecentStore(mem());
    s.add(loc("A", 52.0901, 5));
    s.add(loc("B", 51, 4));
    const out = s.add(loc("A2", 52.0904, 5));
    expect(out.map((l) => l.name)).toEqual(["A2", "B"]);
  });

  it("accepts a 100-character name and rejects NaN coordinates", () => {
    const raw = JSON.stringify([loc("x".repeat(100)), { name: "n", lat: "NaN", lon: 5 }]);
    expect(createRecentStore(mem(raw)).list()).toHaveLength(1);
  });
});
