import { describe, expect, it } from "vitest";
import { nextActiveIndex } from "../../web/lib/listbox.ts";

describe("nextActiveIndex", () => {
  it("moves down and wraps", () => {
    expect(nextActiveIndex(-1, "ArrowDown", 3)).toBe(0);
    expect(nextActiveIndex(2, "ArrowDown", 3)).toBe(0);
  });
  it("moves up and wraps", () => {
    expect(nextActiveIndex(-1, "ArrowUp", 3)).toBe(2);
    expect(nextActiveIndex(0, "ArrowUp", 3)).toBe(2);
    expect(nextActiveIndex(2, "ArrowUp", 3)).toBe(1);
  });
  it("handles empty lists and other keys", () => {
    expect(nextActiveIndex(0, "ArrowDown", 0)).toBe(-1);
    expect(nextActiveIndex(1, "a", 3)).toBe(1);
  });
});
