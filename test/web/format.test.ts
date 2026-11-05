import { describe, expect, it } from "vitest";
import { formatLocationName, formatMm, formatTime, scrubLabel, staleRadarMessage } from "../../web/lib/format.ts";

describe("format", () => {
  it("formats mm with a Dutch comma", () => {
    expect(formatMm(1.2)).toBe("1,2");
    expect(formatMm(0)).toBe("0");
    expect(formatMm(0.25)).toBe("0,25");
    expect(formatMm(2.499)).toBe("2,5");
  });

  it("formats time in Amsterdam for summer and winter", () => {
    expect(formatTime(new Date("2026-07-01T11:05:00Z"))).toBe("13:05");
    expect(formatTime(new Date("2026-01-15T11:05:00Z"))).toBe("12:05");
  });

  it("builds the scrub label", () => {
    expect(scrubLabel({ time: new Date("2026-07-01T11:05:00Z"), mmPerHour: 1.2 })).toBe(
      "13:05 · 1,2 mm/u",
    );
  });
});

describe("format edge cases", () => {
  it("uses 24-hour clock around midnight", () => {
    expect(formatTime(new Date("2026-07-01T22:05:00Z"))).toBe("00:05");
  });
  it("rounds to two decimals", () => {
    expect(formatMm(0.126)).toBe("0,13");
    expect(formatMm(12)).toBe("12");
  });
});

describe("formatLocationName", () => {
  it.each([
    ["Utrecht, Utrecht, Utrecht", "Utrecht"],
    ["De Meern, Utrecht, Utrecht", "De Meern, Utrecht"],
    ["Hoogland, Amersfoort, Utrecht", "Hoogland, Amersfoort, Utrecht"],
    ["  Utrecht ,   Utrecht  ", "Utrecht"],
    ["Utrecht,, ,Utrecht", "Utrecht"],
    ["", ""],
  ])("%j -> %j", (a, b) => expect(formatLocationName(a)).toBe(b));
});

describe("staleRadarMessage", () => {
  it("names the shown run in Amsterdam time", () => {
    expect(staleRadarMessage(new Date("2026-07-01T11:05:00Z"))).toBe(
      "De radar kon niet worden ververst. Je ziet de beelden van 13:05.",
    );
  });

  it("uses CET in winter", () => {
    expect(staleRadarMessage(new Date("2026-01-15T11:05:00Z"))).toMatch(/12:05\.$/);
  });
});
