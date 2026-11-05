import { describe, expect, it } from "vitest";
import { createRefresher } from "../../web/lib/refresh.ts";

const MIN = 60000;

function setup(run: () => Promise<unknown> | unknown) {
  let t = 0;
  let visible = true;
  let id = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const r = createRefresher({
    run,
    now: () => t,
    isVisible: () => visible,
    setTimer: (fn, ms) => {
      timers.set(++id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (h) => void timers.delete(h as number),
  });
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      timers.delete(next[0]);
      t = next[1].at;
      next[1].fn();
    }
    t = end;
  };
  return { r, advance, timers, setVisible: (v: boolean) => (visible = v) };
}

describe("refresher", () => {
  it("runs every 5 minutes while visible", async () => {
    let n = 0;
    const s = setup(() => void n++);
    s.r.start();
    s.advance(4 * MIN);
    expect(n).toBe(0);
    s.advance(MIN);
    expect(n).toBe(1);
    await Promise.resolve();
    await Promise.resolve();
    s.advance(5 * MIN);
    expect(n).toBe(2);
    expect(s.r.lastRun()).toBe(10 * MIN);
  });

  it("hidden at tick time means no run", () => {
    let n = 0;
    const s = setup(() => void n++);
    s.r.start();
    s.setVisible(false);
    s.advance(10 * MIN);
    expect(n).toBe(0);
  });

  it("visible after more than 5 minutes runs at once", async () => {
    let n = 0;
    const s = setup(() => void n++);
    s.r.start();
    s.setVisible(false);
    s.advance(7 * MIN);
    s.setVisible(true);
    s.r.onVisibilityChange();
    expect(n).toBe(1);
    await Promise.resolve();
    await Promise.resolve();
    s.advance(5 * MIN);
    expect(n).toBe(2);
  });

  it("visible after 2 minutes runs after the remaining 3", () => {
    let n = 0;
    const s = setup(() => void n++);
    s.r.start();
    s.setVisible(false);
    s.r.onVisibilityChange();
    s.advance(2 * MIN);
    s.setVisible(true);
    s.r.onVisibilityChange();
    expect(n).toBe(0);
    s.advance(3 * MIN - 1);
    expect(n).toBe(0);
    s.advance(1);
    expect(n).toBe(1);
  });

  it("hiding clears the timer; stop clears the timer", () => {
    const s = setup(() => {});
    s.r.start();
    expect(s.timers.size).toBe(1);
    s.setVisible(false);
    s.r.onVisibilityChange();
    expect(s.timers.size).toBe(0);
    s.setVisible(true);
    s.r.onVisibilityChange();
    expect(s.timers.size).toBe(1);
    s.r.stop();
    expect(s.timers.size).toBe(0);
  });

  it("skips overlapping runs", async () => {
    let n = 0;
    let release!: () => void;
    const s = setup(() => {
      n++;
      return new Promise<void>((res) => (release = res));
    });
    s.r.start();
    s.advance(5 * MIN);
    s.advance(5 * MIN);
    expect(n).toBe(1);
    release();
    await Promise.resolve();
    await Promise.resolve();
    s.advance(5 * MIN);
    expect(n).toBe(2);
  });

  it("a rejecting run keeps scheduling", async () => {
    let n = 0;
    const s = setup(() => {
      n++;
      return Promise.reject(new Error("boom"));
    });
    s.r.start();
    s.advance(5 * MIN);
    await Promise.resolve();
    await Promise.resolve();
    s.advance(5 * MIN);
    expect(n).toBe(2);
  });

  it("a synchronously throwing run keeps scheduling", async () => {
    let n = 0;
    const s = setup(() => {
      n++;
      throw new Error("boom");
    });
    s.r.start();
    s.advance(5 * MIN);
    await Promise.resolve();
    await Promise.resolve();
    s.advance(5 * MIN);
    expect(n).toBe(2);
  });

  it("start while hidden schedules nothing; stop prevents further runs", () => {
    let n = 0;
    const s = setup(() => void n++);
    s.setVisible(false);
    s.r.start();
    expect(s.timers.size).toBe(0);
    s.setVisible(true);
    s.r.start();
    s.r.stop();
    s.advance(20 * MIN);
    expect(n).toBe(0);
  });
});
