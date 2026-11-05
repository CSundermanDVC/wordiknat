import { afterEach, describe, expect, it, vi } from "vitest";
import { mountCaption } from "../../web/caption.ts";
import type { ForecastView } from "../../web/lib/api.ts";

// No jsdom: a minimal element stub is enough for the caption's textContent / replaceChildren writes.
class Fake {
  textContent = "";
  children: unknown[] = [];
  classList = { add: vi.fn() };
  replaceChildren(...c: unknown[]) {
    this.children = c;
    this.textContent = c.map((x) => (typeof x === "string" ? x : (x as Fake).textContent)).join("");
  }
}
vi.stubGlobal("document", { createElement: () => new Fake() });
afterEach(() => vi.clearAllMocks());

const T0 = Date.UTC(2026, 6, 1, 12, 0);
const NOW = new Date(T0);
const fc = (issuedMs = T0): ForecastView =>
  ({
    issuedAt: new Date(issuedMs),
    summary: "",
    points: Array.from({ length: 25 }, (_, i) => ({ time: new Date(T0 + i * 300_000), mmPerHour: 0 })),
  }) as unknown as ForecastView;
const loc = (name: string) => ({ name, lat: 52, lon: 5 }) as never;

function setup() {
  const els = Object.fromEntries(
    ["summary", "detail", "issued", "status", "announce"].map((k) => [k, new Fake()]),
  ) as Record<"summary" | "detail" | "issued" | "status" | "announce", Fake>;
  return { els, cap: mountCaption(els as never) };
}

describe("mountCaption", () => {
  it("writes caption, issued line and no status for a fresh forecast", () => {
    const { els, cap } = setup();
    cap.update({ location: loc("Utrecht"), forecast: fc(), error: null }, NOW);
    expect(els.summary.textContent).toContain("Je blijft droog tot ten minste");
    expect(els.summary.children.some((c) => c instanceof Fake)).toBe(true);
    expect(els.issued.textContent).toMatch(/^KNMI-verwachting van \d\d:\d\d · ververst elke 5 minuten$/);
    expect(els.status.textContent).toBe("");
    expect(els.announce.textContent).toMatch(/^Droog\. /);
  });

  it("stale forecast shows verouderd and a Fout line", () => {
    const { els, cap } = setup();
    cap.update({ location: loc("Utrecht"), forecast: fc(), error: "geen verbinding" }, NOW);
    expect(els.issued.textContent).toMatch(/ · verouderd$/);
    expect(els.status.textContent).toBe("Fout: geen verbinding");
  });

  it("no forecast leaves the issued and status lines empty", () => {
    const { els, cap } = setup();
    cap.update({ location: null, forecast: null, error: null }, NOW);
    expect(els.issued.textContent).toBe("");
    expect(els.status.textContent).toBe("");
  });

  it("announces only when label, place or issuedAt change; tick never announces", () => {
    const { els, cap } = setup();
    const base = { location: loc("Utrecht"), forecast: fc(), error: null };
    cap.update(base, NOW);
    els.announce.textContent = "x";
    cap.update(base, new Date(T0 + 60_000));
    cap.tick(new Date(T0 + 120_000));
    expect(els.announce.textContent).toBe("x");
    cap.update({ ...base, location: loc("Ede") }, NOW);
    expect(els.announce.textContent).not.toBe("x");
    els.announce.textContent = "x";
    cap.update({ ...base, location: loc("Ede"), forecast: fc(T0 + 300_000) }, NOW);
    expect(els.announce.textContent).not.toBe("x");
  });

  it("tick does not rewrite an unchanged status line", () => {
    const { els, cap } = setup();
    cap.update({ location: loc("Utrecht"), forecast: fc(), error: "geen verbinding" }, NOW);
    let writes = 0;
    Object.defineProperty(els.status, "textContent", {
      get: () => "Fout: geen verbinding",
      set: () => void writes++,
    });
    cap.tick(new Date(T0 + 60_000));
    expect(writes).toBe(0);
  });

  it("tick before any update is a no-op", () => {
    const { els, cap } = setup();
    cap.tick(NOW);
    expect(els.summary.textContent).toBe("");
  });
});
