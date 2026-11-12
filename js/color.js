// Small color helpers (contrast checks for palettes and clue text).

export function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToHex([r, g, b]) {
  const h = (x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function channel(c) {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// WCAG contrast ratio, 1..21.
export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Rough perceptual distance (weighted RGB, "redmean"). ~0..765.
export function colorDistance(a, b) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const rm = (r1 + r2) / 2;
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

// Darkens a color until it has at least `min` contrast against `bg`.
export function ensureContrast(hex, bg, min) {
  let [r, g, b] = hexToRgb(hex);
  let out = hex;
  for (let k = 0; k < 40 && contrast(out, bg) < min; k++) {
    r *= 0.93; g *= 0.93; b *= 0.93;
    out = rgbToHex([r, g, b]);
  }
  return out;
}

// Palette checks used by the validator and the image converter.
// The empty-cell background is white; clue text sits on a cream panel.
export const CELL_BG = '#ffffff';
export const CLUE_BG = '#f3ede2';
export const MIN_CELL_CONTRAST = 1.6; // filled vs empty cell
export const MIN_COLOR_DISTANCE = 90; // between two palette colors

export function paletteWarnings(palette) {
  const warn = [];
  palette.forEach((p, i) => {
    const cr = contrast(p, CELL_BG);
    if (cr < MIN_CELL_CONTRAST) warn.push(`color ${i + 1} (${p}) is too pale against empty cells (contrast ${cr.toFixed(2)})`);
  });
  for (let i = 0; i < palette.length; i++) {
    for (let j = i + 1; j < palette.length; j++) {
      const d = colorDistance(palette[i], palette[j]);
      if (d < MIN_COLOR_DISTANCE) warn.push(`colors ${i + 1} and ${j + 1} (${palette[i]}, ${palette[j]}) are hard to tell apart`);
    }
  }
  return warn;
}
