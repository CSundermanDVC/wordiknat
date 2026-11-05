// Next active option for ArrowDown/ArrowUp; -1 means none. Wraps around.
export function nextActiveIndex(current: number, key: string, length: number): number {
  if (length <= 0) return -1;
  if (key === "ArrowDown") return current < 0 ? 0 : (current + 1) % length;
  if (key === "ArrowUp") return current <= 0 ? length - 1 : current - 1;
  return current;
}
