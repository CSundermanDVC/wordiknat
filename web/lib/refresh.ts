export type RefresherOptions = {
  intervalMs?: number;
  run: () => Promise<unknown> | unknown;
  now: () => number;
  isVisible: () => boolean;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
};

export function createRefresher(opts: RefresherOptions) {
  const { intervalMs = 300000, run, now, isVisible, setTimer, clearTimer } = opts;
  let timer: unknown = null;
  let hasTimer = false;
  let pending = false;
  let running = false;
  let last: number | null = null;
  let base = 0; // reference for "age": start time or last run

  const clear = () => {
    if (hasTimer) clearTimer(timer);
    hasTimer = false;
    timer = null;
  };

  const schedule = (ms: number) => {
    clear();
    timer = setTimer(tick, ms);
    hasTimer = true;
  };

  function fire() {
    base = now();
    if (pending) return;
    last = base;
    pending = true;
    let result: Promise<unknown>;
    try {
      result = Promise.resolve(run());
    } catch {
      result = Promise.resolve();
    }
    void result.catch(() => {}).finally(() => {
      pending = false;
    });
  }

  function tick() {
    hasTimer = false;
    timer = null;
    if (!running || !isVisible()) return; // resumed by onVisibilityChange
    fire();
    if (running) schedule(intervalMs);
  }

  function onVisibilityChange() {
    clear();
    if (!running || !isVisible()) return;
    const age = now() - base;
    if (age >= intervalMs) {
      fire();
      if (running) schedule(intervalMs);
    } else {
      schedule(intervalMs - age);
    }
  }

  return {
    start() {
      running = true;
      base = now();
      if (isVisible()) schedule(intervalMs);
    },
    stop() {
      running = false;
      clear();
    },
    onVisibilityChange,
    lastRun: () => last,
  };
}
