// Line solver for color nonograms, used by the level-validation tools.
//
// Each cell holds a bitmask of the values it may still take:
// bit 0 = empty, bit c = palette color c (1..K).
//
// For one line, solveLine() finds every legal placement of the clue's blocks
// that agrees with the current possibilities, and keeps for each cell only the
// values that appear in at least one legal placement. It uses dynamic
// programming (prefix and suffix reachability tables), so it costs
// O(blocks x length) instead of enumerating placements.
//
// Placement rules: blocks appear in clue order; two consecutive blocks of the
// SAME color need at least one empty cell between them; blocks of DIFFERENT
// colors may touch.

import { computeClues } from './clues.js';

export function solveLine(poss, clue) {
  const n = poss.length;
  const m = clue.length;
  const W = n + 1;

  // Prefix counts of "color c allowed" per color used in this clue, so
  // "can block j cover cells [s, s+len)" is an O(1) check.
  const pre = new Map();
  for (const b of clue) {
    if (pre.has(b.color)) continue;
    const p = new Int32Array(n + 1);
    const bit = 1 << b.color;
    for (let i = 0; i < n; i++) p[i + 1] = p[i] + ((poss[i] & bit) ? 1 : 0);
    pre.set(b.color, p);
  }
  const canPlace = (j, s) => {
    const { len, color } = clue[j];
    if (s < 0 || s + len > n) return false;
    const p = pre.get(color);
    return p[s + len] - p[s] === len;
  };
  const canEmpty = (i) => (poss[i] & 1) !== 0;
  const sameAsPrev = (j) => j > 0 && clue[j - 1].color === clue[j].color;
  const sameAsNext = (j) => j + 1 < m && clue[j + 1].color === clue[j].color;

  // Forward tables, indexed [j * W + i], about the prefix of cells [0, i):
  //   F: blocks 0..j-1 fit in [0, i), every other cell there empty.
  //   G: same, and additionally cell i-1 is empty (so the last block ended
  //      strictly before i). Needed before a block of the same color.
  const F = new Uint8Array((m + 1) * W);
  const G = new Uint8Array((m + 1) * W);
  F[0] = 1;
  for (let i = 1; i <= n; i++) {
    G[i] = F[i - 1] && canEmpty(i - 1) ? 1 : 0;
    F[i] = G[i];
  }
  for (let j = 1; j <= m; j++) {
    const b = j - 1;
    const len = clue[b].len;
    const sp = sameAsPrev(b);
    const row = j * W;
    const prow = (j - 1) * W;
    for (let i = 0; i <= n; i++) {
      let e = 0; // block b ends exactly at i
      if (i >= len && canPlace(b, i - len)) e = sp ? G[prow + i - len] : F[prow + i - len];
      const g = i >= 1 && F[row + i - 1] && canEmpty(i - 1) ? 1 : 0;
      G[row + i] = g;
      F[row + i] = e || g ? 1 : 0;
    }
  }
  if (!F[m * W + n]) return null; // no legal placement: contradiction

  // Backward tables, indexed [j * W + i], about the suffix of cells [i, n):
  //   R: blocks j..m-1 fit in [i, n), every other cell there empty.
  //   H: same, and additionally cell i is empty (block j starts after i).
  const R = new Uint8Array((m + 1) * W);
  const H = new Uint8Array((m + 1) * W);
  R[m * W + n] = 1;
  for (let i = n - 1; i >= 0; i--) {
    H[m * W + i] = canEmpty(i) && R[m * W + i + 1] ? 1 : 0;
    R[m * W + i] = H[m * W + i];
  }
  for (let j = m - 1; j >= 0; j--) {
    const len = clue[j].len;
    const sn = sameAsNext(j);
    const row = j * W;
    const nrow = (j + 1) * W;
    for (let i = n; i >= 0; i--) {
      let s = 0; // block j starts exactly at i
      if (i + len <= n && canPlace(j, i)) s = sn ? H[nrow + i + len] : R[nrow + i + len];
      const h = i < n && canEmpty(i) && R[row + i + 1] ? 1 : 0;
      H[row + i] = h;
      R[row + i] = s || h ? 1 : 0;
    }
  }

  // Collect values that appear in at least one full legal placement.
  const out = new Uint8Array(n);
  const diffs = new Map();
  for (const b of clue) if (!diffs.has(b.color)) diffs.set(b.color, new Int32Array(n + 1));

  for (let j = 0; j < m; j++) {
    const { len, color } = clue[j];
    const sp = sameAsPrev(j);
    const sn = sameAsNext(j);
    const d = diffs.get(color);
    for (let s = 0; s + len <= n; s++) {
      if (!canPlace(j, s)) continue;
      const before = sp ? G[j * W + s] : F[j * W + s];
      if (!before) continue;
      const after = sn ? H[(j + 1) * W + s + len] : R[(j + 1) * W + s + len];
      if (!after) continue;
      d[s]++;
      d[s + len]--;
    }
  }
  for (const [color, d] of diffs) {
    const bit = 1 << color;
    let run = 0;
    for (let i = 0; i < n; i++) {
      run += d[i];
      if (run > 0) out[i] |= bit;
    }
  }
  for (let i = 0; i < n; i++) {
    if (!canEmpty(i)) continue;
    for (let j = 0; j <= m; j++) {
      if (F[j * W + i] && R[j * W + i + 1]) {
        out[i] |= 1;
        break;
      }
    }
  }
  for (let i = 0; i < n; i++) if (out[i] === 0) return null;
  return out;
}

const isSingle = (x) => x !== 0 && (x & (x - 1)) === 0;
const bitIndex = (x) => 31 - Math.clz32(x);

// Repeats solveLine over every row and column until nothing changes.
// Returns { status: 'solved' | 'ambiguous' | 'contradiction', grid, ambiguous, passes }.
// grid holds the resolved value per cell (or -1 where still ambiguous).
export function solveGrid(width, height, K, rowClues, colClues) {
  const full = (1 << (K + 1)) - 1;
  const poss = new Uint8Array(width * height).fill(full);
  let dirtyRows = new Set();
  let dirtyCols = new Set();
  for (let r = 0; r < height; r++) dirtyRows.add(r);
  for (let c = 0; c < width; c++) dirtyCols.add(c);
  let passes = 0;
  const line = (len) => new Uint8Array(len);

  while (dirtyRows.size || dirtyCols.size) {
    passes++;
    const rows = dirtyRows;
    dirtyRows = new Set();
    for (const r of rows) {
      const cur = line(width);
      for (let c = 0; c < width; c++) cur[c] = poss[r * width + c];
      const res = solveLine(cur, rowClues[r]);
      if (!res) return { status: 'contradiction', line: { kind: 'row', index: r }, passes };
      for (let c = 0; c < width; c++) {
        if (res[c] !== cur[c]) {
          poss[r * width + c] = res[c];
          dirtyCols.add(c);
        }
      }
    }
    const cols = dirtyCols;
    dirtyCols = new Set();
    for (const c of cols) {
      const cur = line(height);
      for (let r = 0; r < height; r++) cur[r] = poss[r * width + c];
      const res = solveLine(cur, colClues[c]);
      if (!res) return { status: 'contradiction', line: { kind: 'col', index: c }, passes };
      for (let r = 0; r < height; r++) {
        if (res[r] !== cur[r]) {
          poss[r * width + c] = res[r];
          dirtyRows.add(r);
        }
      }
    }
  }

  const grid = new Int8Array(width * height);
  const ambiguous = [];
  for (let i = 0; i < poss.length; i++) {
    if (isSingle(poss[i])) grid[i] = bitIndex(poss[i]);
    else {
      grid[i] = -1;
      ambiguous.push({ r: Math.floor(i / width), c: i % width, options: maskValues(poss[i]) });
    }
  }
  return { status: ambiguous.length ? 'ambiguous' : 'solved', grid, poss, ambiguous, passes };
}

export function maskValues(mask) {
  const out = [];
  for (let v = 0; mask >> v; v++) if (mask & (1 << v)) out.push(v);
  return out;
}

// Validates a flat solution grid: it must be reachable by line logic alone,
// which also proves it is the only solution.
export function validateSolution(solution, width, height, K) {
  const clues = computeClues(solution, width, height);
  const res = solveGrid(width, height, K, clues.rows, clues.cols);
  if (res.status === 'solved') {
    for (let i = 0; i < solution.length; i++) {
      if (res.grid[i] !== solution[i]) {
        // Cannot happen if the solver is sound; guard anyway.
        return { ok: false, status: 'mismatch', passes: res.passes, ambiguous: [] };
      }
    }
  }
  return {
    ok: res.status === 'solved',
    status: res.status,
    passes: res.passes,
    ambiguous: res.ambiguous || [],
    grid: res.grid,
  };
}
