export type PlayerOptions = {
  steps: number;
  startIndex: number;
  intervalMs?: number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  onChange: (index: number) => void;
};

/** Playback over `steps` frames. Never starts by itself; stops on the last step. */
export function createPlayer(opts: PlayerOptions) {
  const { steps, intervalMs = 250, setTimer, clearTimer, onChange } = opts;
  const last = Math.max(0, steps - 1);
  const clampIndex = (i: number) => Math.min(Math.max(Math.trunc(i) || 0, 0), last);
  let index = clampIndex(opts.startIndex);
  let playing = false;
  let timer: unknown = null;

  const pause = () => {
    if (playing) clearTimer(timer);
    playing = false;
    timer = null;
  };

  function tick() {
    timer = null;
    index = Math.min(index + 1, last);
    if (index === last) playing = false;
    else timer = setTimer(tick, intervalMs);
    onChange(index);
  }

  return {
    index: () => index,
    playing: () => playing,
    play() {
      if (playing) return;
      if (index === last) {
        index = 0;
        onChange(index);
      }
      playing = true;
      timer = setTimer(tick, intervalMs);
    },
    pause,
    seek(i: number) {
      pause();
      index = clampIndex(i);
      onChange(index);
    },
  };
}
