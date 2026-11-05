export type Rgb = [r: number, g: number, b: number];
export type Palette = [licht: Rgb, matig: Rgb, zwaar: Rgb];

export const RAIN_ALPHA = 0.65;
// Fallback when a --rain-* token does not parse; the middle value is the light theme's --rain.
export const DEFAULT_PALETTE: Palette = [
  [138, 180, 240],
  [47, 111, 222],
  [26, 63, 143],
];

export function parseHex(s: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** RGBA pixels for one frame of rain classes: 0 (and anything above 3) transparent, 1 to 3 in the palette. */
export function paintRadar(
  classes: Uint8Array,
  palette: Palette,
  alpha: number,
  out: Uint8ClampedArray = new Uint8ClampedArray(classes.length * 4),
): Uint8ClampedArray {
  if (out.length !== classes.length * 4) throw new RangeError("output buffer does not match class count");
  const a = Math.round(Math.min(Math.max(alpha, 0), 1) * 255);
  for (let i = 0; i < classes.length; i++) {
    const c = classes[i]!;
    const rgb = c >= 1 && c <= 3 ? palette[c - 1]! : null;
    const o = i * 4;
    out[o] = rgb ? rgb[0] : 0;
    out[o + 1] = rgb ? rgb[1] : 0;
    out[o + 2] = rgb ? rgb[2] : 0;
    out[o + 3] = rgb ? a : 0;
  }
  return out;
}
