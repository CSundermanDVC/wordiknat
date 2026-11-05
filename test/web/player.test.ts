import { describe, expect, it } from "vitest";
import { createPlayer } from "../../web/lib/player.ts";

function setup(startIndex = 0, steps = 25) {
  let id = 0;
  const timers = new Map<number, { fn: () => void; ms: number }>();
  const changes: number[] = [];
  const p = createPlayer({
    steps,
    startIndex,
    setTimer: (fn, ms) => {
      timers.set(++id, { fn, ms });
      return id;
    },
    clearTimer: (h) => void timers.delete(h as number),
    onChange: (i) => changes.push(i),
  });
  const tick = (n = 1) => {
    for (let k = 0; k < n; k++) {
      const [key, t] = [...timers.entries()][0] ?? [];
      if (key === undefined || !t) return;
      timers.delete(key);
      t.fn();
    }
  };
  return { p, timers, changes, tick };
}

describe("player", () => {
  it("never autoplays: nothing is scheduled at creation", () => {
    const s = setup(3);
    expect(s.timers.size).toBe(0);
    expect(s.p.playing()).toBe(false);
    expect(s.p.index()).toBe(3);
    expect(s.changes).toEqual([]);
  });

  it("play schedules once at 250 ms and ticks advance one step each", () => {
    const s = setup(2);
    s.p.play();
    expect(s.timers.size).toBe(1);
    expect([...s.timers.values()][0]!.ms).toBe(250);
    s.tick(4);
    expect(s.p.index()).toBe(6);
    expect(s.changes).toEqual([3, 4, 5, 6]);
    expect(s.timers.size).toBe(1);
  });

  it("stops by itself on the last step with no timer pending", () => {
    const s = setup(20);
    s.p.play();
    s.tick(10);
    expect(s.p.index()).toBe(24);
    expect(s.p.playing()).toBe(false);
    expect(s.timers.size).toBe(0);
    expect(s.changes.at(-1)).toBe(24);
    expect(s.changes).toEqual([21, 22, 23, 24]);
  });

  it("play on the last step restarts from 0 and continues", () => {
    const s = setup(24);
    s.p.play();
    expect(s.p.index()).toBe(0);
    expect(s.changes).toEqual([0]);
    expect(s.p.playing()).toBe(true);
    s.tick(2);
    expect(s.p.index()).toBe(2);
  });

  it("pause leaves no pending timer", () => {
    const s = setup();
    s.p.play();
    s.tick();
    s.p.pause();
    expect(s.timers.size).toBe(0);
    expect(s.p.playing()).toBe(false);
    expect(s.p.index()).toBe(1);
  });

  it("seek clamps and reports the index", () => {
    const s = setup(5);
    s.p.seek(-5);
    expect(s.p.index()).toBe(0);
    s.p.seek(99);
    expect(s.p.index()).toBe(24);
    s.p.seek(Number.NaN);
    expect(s.p.index()).toBe(0);
    expect(s.changes).toEqual([0, 24, 0]);
  });

  it("seek while playing pauses", () => {
    const s = setup();
    s.p.play();
    s.p.seek(10);
    expect(s.p.playing()).toBe(false);
    expect(s.timers.size).toBe(0);
    expect(s.p.index()).toBe(10);
  });

  it("double play keeps one pending timer", () => {
    const s = setup();
    s.p.play();
    s.p.play();
    expect(s.timers.size).toBe(1);
  });

  it("clamps the start index", () => {
    expect(setup(99).p.index()).toBe(24);
    expect(setup(-1).p.index()).toBe(0);
  });
});
