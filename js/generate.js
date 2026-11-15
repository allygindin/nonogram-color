// Random puzzle generator. No DOM code here, so it runs in Node tests too.
//
// 1. Draw a blobby picture: random noise, smoothed a few times so filled
//    cells clump together, often mirrored so it looks deliberate.
// 2. Split the filled cells into color regions that grow from random seeds,
//    then smooth the colors so regions are chunky rather than speckled.
// 3. Check it with the line solver. If logic alone can't finish it, nudge a
//    few of the cells the solver couldn't pin down (like the image
//    converter's Auto-fix). Give up on hopeless pictures and draw another.
//
// Every puzzle it returns has exactly one solution reachable by line logic,
// the same standard the hand-made levels meet.

import { SIZES, DIFFICULTIES } from './level.js';
import { validateSolution } from './solver.js';
import { paletteWarnings, colorDistance } from './color.js';

// Per difficulty: grid size, color counts to pick from, fill density range,
// and the minimum number of solver passes (a rough "how much thinking").
const SETTINGS = [
  { colors: [2], fill: [0.5, 0.65], minPasses: 2 },
  { colors: [2, 3, 3], fill: [0.45, 0.62], minPasses: 2 },
  { colors: [3, 4], fill: [0.45, 0.6], minPasses: 3 },
  { colors: [4, 4, 5], fill: [0.45, 0.6], minPasses: 3 },
];

// Each color must cover at least this share of the filled cells.
const MIN_COLOR_SHARE = 0.1;

// Bright, saturated colors that read well on white cells and cream clues.
const COLORS = [
  '#e63946', '#f4722b', '#f6a609', '#e9c46a', '#8ac926', '#2a9d55', '#1b998b',
  '#00a6d6', '#3a86ff', '#264c9e', '#6a4c93', '#9d4edd', '#d8348e', '#ff5d8f',
  '#8d5a3b', '#4a4e69', '#2b2d42', '#5e8c31',
];

const NAMES = [
  'Pebble', 'Ember', 'Ripple', 'Marble', 'Comet', 'Lantern', 'Clover', 'Prism',
  'Thistle', 'Coral', 'Meadow', 'Quartz', 'Breeze', 'Juniper', 'Nebula', 'Saffron',
  'Willow', 'Cobalt', 'Maple', 'Glimmer', 'Tundra', 'Sorbet', 'Canyon', 'Fable',
  'Harbor', 'Orchid', 'Basalt', 'Zephyr', 'Mosaic', 'Kettle', 'Pinwheel', 'Lagoon',
];

// Small seeded PRNG (mulberry32) so a puzzle can be reproduced from its seed.
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

function shuffle(rnd, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Generated palettes keep colors much further apart than the validator's
// minimum, so no two colors in a puzzle are easy to mix up.
const PALETTE_MIN_DISTANCE = 180;

function pickPalette(rnd, K) {
  for (let tries = 0; tries < 200; tries++) {
    const pal = [];
    for (const c of shuffle(rnd, COLORS.slice())) {
      if (pal.every((p) => colorDistance(p, c) >= PALETTE_MIN_DISTANCE)) pal.push(c);
      if (pal.length === K) break;
    }
    if (pal.length === K && !paletteWarnings(pal).length) return pal;
  }
  return FALLBACK_PALETTE.slice(0, K);
}

const FALLBACK_PALETTE = ['#e63946', '#3a86ff', '#f6a609', '#2a9d55', '#2b2d42'];

// Mirrors the left half onto the right (mode 1), the top onto the bottom
// (mode 2), or both (mode 3).
function mirror(g, n, mode) {
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      let rr = r, cc = c;
      if (mode & 1 && c >= n / 2) cc = n - 1 - c;
      if (mode & 2 && r >= n / 2) rr = n - 1 - r;
      g[r * n + c] = g[rr * n + cc];
    }
  }
}

// Filled/empty mask: noise, then majority smoothing (cellular automaton).
function drawMask(rnd, n, fill, sym) {
  let g = new Uint8Array(n * n);
  for (let i = 0; i < g.length; i++) g[i] = rnd() < fill ? 1 : 0;
  if (sym) mirror(g, n, sym);
  const rounds = n <= 5 ? 1 : 2 + Math.floor(rnd() * 2);
  for (let k = 0; k < rounds; k++) {
    const next = new Uint8Array(n * n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        let on = 0, all = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr, cc = c + dc;
            all++;
            // Off-grid neighbours count as empty, which pulls shapes inward.
            if (rr >= 0 && rr < n && cc >= 0 && cc < n) on += g[rr * n + cc];
          }
        }
        next[r * n + c] = on * 2 > all ? 1 : on * 2 === all - 1 ? g[r * n + c] : 0;
      }
    }
    g = next;
    if (sym) mirror(g, n, sym);
  }
  return g;
}

// Splits filled cells into K regions grown from random seeds.
function colorize(rnd, mask, n, K, sym) {
  const g = new Int8Array(n * n);
  const filled = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) filled.push(i);
  if (!filled.length) return g;
  if (K === 1) {
    for (const i of filled) g[i] = 1;
    return g;
  }
  const frontier = [];
  shuffle(rnd, filled.slice()).slice(0, K).forEach((i, k) => {
    g[i] = k + 1;
    frontier.push(i);
  });
  while (frontier.length) {
    const at = Math.floor(rnd() * frontier.length);
    const i = frontier[at];
    const r = Math.floor(i / n), c = i % n;
    const nbrs = [];
    if (r > 0) nbrs.push(i - n);
    if (r < n - 1) nbrs.push(i + n);
    if (c > 0) nbrs.push(i - 1);
    if (c < n - 1) nbrs.push(i + 1);
    const open = nbrs.filter((j) => mask[j] && !g[j]);
    if (!open.length) {
      frontier.splice(at, 1);
      continue;
    }
    const j = pick(rnd, open);
    g[j] = g[i];
    frontier.push(j);
  }
  // Islands no seed could reach get a random color.
  for (const i of filled) if (!g[i]) g[i] = 1 + Math.floor(rnd() * K);
  // Majority smoothing of colors, keeping the filled mask as is.
  for (let k = 0; k < 2; k++) {
    const next = g.slice();
    for (const i of filled) {
      const r = Math.floor(i / n), c = i % n;
      const count = new Array(K + 1).fill(0);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && rr < n && cc >= 0 && cc < n) count[g[rr * n + cc]]++;
        }
      }
      let best = g[i];
      for (let v = 1; v <= K; v++) if (count[v] > count[best]) best = v;
      next[i] = best;
    }
    g.set(next);
  }
  if (sym) mirror(g, n, sym);
  return g;
}

// Colors actually used, renumbered 1..k, so no palette color goes unused.
function compact(g, palette) {
  const used = [...new Set(g)].filter((v) => v > 0).sort((a, b) => a - b);
  const map = new Map(used.map((v, k) => [v, k + 1]));
  for (let i = 0; i < g.length; i++) if (g[i] > 0) g[i] = map.get(g[i]);
  return used.map((v) => palette[v - 1]);
}

// Greedy repair: change ambiguous cells to empty or a neighbour's color,
// keeping whichever change leaves the fewest ambiguous cells.
function repair(rnd, g, n, K, res, maxSteps) {
  for (let step = 0; step < maxSteps && !res.ok; step++) {
    if (res.status !== 'ambiguous') return res;
    const sample = shuffle(rnd, res.ambiguous.map((a) => a.r * n + a.c)).slice(0, 10);
    let best = null, bestScore = res.ambiguous.length, bestRes = null;
    for (const i of sample) {
      const r = Math.floor(i / n), c = i % n;
      const opts = new Set([0]);
      if (r > 0) opts.add(g[i - n]);
      if (r < n - 1) opts.add(g[i + n]);
      if (c > 0) opts.add(g[i - 1]);
      if (c < n - 1) opts.add(g[i + 1]);
      const orig = g[i];
      for (const v of opts) {
        if (v === orig) continue;
        g[i] = v;
        const t = validateSolution(g, n, n, K);
        const score = t.ok ? -1 : t.ambiguous.length;
        if (score < bestScore) {
          bestScore = score;
          best = { i, v };
          bestRes = t;
        }
      }
      g[i] = orig;
    }
    if (!best) return res;
    g[best.i] = best.v;
    res = bestRes;
  }
  return res;
}

function balanced(g, K) {
  const count = new Array(K + 1).fill(0);
  let on = 0;
  for (const v of g) if (v > 0) { count[v]++; on++; }
  for (let v = 1; v <= K; v++) if (count[v] < on * MIN_COLOR_SHARE) return false;
  return true;
}

function fillRatio(g) {
  let on = 0;
  for (const v of g) if (v > 0) on++;
  return on / g.length;
}

// Builds a random level in the same JSON form as levels/*.json.
// difficulty: 0 Easy, 1 Medium, 2 Hard, 3 Expert.
export function generateLevel(difficulty, seed = (Math.random() * 2 ** 32) >>> 0) {
  const n = SIZES[difficulty];
  const cfg = SETTINGS[difficulty];
  const rnd = makeRng(seed);
  for (let attempt = 0; attempt < 400; attempt++) {
    const K = pick(rnd, cfg.colors);
    const fill = cfg.fill[0] + rnd() * (cfg.fill[1] - cfg.fill[0]);
    const symRoll = rnd();
    const sym = symRoll < 0.55 ? 1 : symRoll < 0.7 ? 3 : symRoll < 0.8 ? 2 : 0;
    const mask = drawMask(rnd, n, fill, sym);
    const ratio = fillRatio(mask);
    if (ratio < 0.38 || ratio > 0.78) continue;
    let g = null;
    for (let k = 0; k < 6 && !g; k++) {
      const t = colorize(rnd, mask, n, K, sym);
      if (balanced(t, K)) g = t;
    }
    if (!g) continue;
    let palette = pickPalette(rnd, K);
    palette = compact(g, palette);
    if (palette.length < Math.min(...cfg.colors)) continue;
    let res = validateSolution(g, n, n, palette.length);
    if (!res.ok) res = repair(rnd, g, n, palette.length, res, n);
    if (!res.ok) continue;
    // Repairs can remove a color completely; renumber if so.
    palette = compact(g, palette);
    if (palette.length < Math.min(...cfg.colors) || !balanced(g, palette.length)) continue;
    const final = validateSolution(g, n, n, palette.length);
    if (!final.ok || final.passes < cfg.minPasses) continue;
    const r2 = fillRatio(g);
    if (r2 < 0.35 || r2 > 0.8) continue;
    const solution = [];
    for (let r = 0; r < n; r++) solution.push(Array.from(g.subarray(r * n, (r + 1) * n)));
    return {
      id: `random-${difficulty}`,
      name: pick(rnd, NAMES),
      category: 'Random',
      width: n,
      height: n,
      palette,
      solution,
      seed,
      difficultyName: DIFFICULTIES[difficulty],
    };
  }
  return null;
}
