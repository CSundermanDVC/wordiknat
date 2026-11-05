// WCAG 2.x contrast maths for the colour-token tests.

/** "#rgb" or "#rrggbb" to [r, g, b] in 0..255; null for anything else. */
export function parseHex(value: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const hex = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** Relative luminance of an sRGB colour (WCAG 2.x definition). */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast ratio (1..21) between two hex colours; throws on a value that is not hex. */
export function contrastRatio(a: string, b: string): number {
  const [pa, pb] = [parseHex(a), parseHex(b)];
  if (!pa || !pb) throw new Error(`not a hex colour: ${pa ? b : a}`);
  const [hi, lo] = [relativeLuminance(pa), relativeLuminance(pb)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
