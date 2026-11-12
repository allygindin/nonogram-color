// Game state and rules. No DOM code here, so it can be unit-tested in Node.
//
// Cell values: 0 = empty, X (-1) = marked empty by the player, 1..K = color.
// Flags: ERROR (wrong placement in lives mode, locked) and HINT (revealed, locked).

import { lineClue, clueEqual } from './clues.js';

export const X = -1;
export const F_ERROR = 1;
export const F_HINT = 2;
export const MAX_LIVES = 3;
export const MAX_HINTS = 3;
const MAX_UNDO = 300;

export class Game {
  constructor(level, opts = {}) {
    this.level = level;
    this.w = level.width;
    this.h = level.height;
    this.n = this.w * this.h;
    this.cells = new Int8Array(this.n);
    this.flags = new Uint8Array(this.n);
    this.rowSolved = new Uint8Array(this.h);
    this.colSolved = new Uint8Array(this.w);
    // Per clue number: 1 when that block is done (see blocksDone).
    this.rowDone = level.clues.rows.map((cl) => new Uint8Array(cl.length));
    this.colDone = level.clues.cols.map((cl) => new Uint8Array(cl.length));
    this.livesMode = opts.livesMode !== false;
    this.onEvent = opts.onEvent || (() => {});
    this.stroke = null;
    this.reset(true);
    if (opts.saved) this.restore(opts.saved);
    this.refreshAllLines();
  }

  get hintsLeft() {
    return MAX_HINTS - this.hintsUsed;
  }

  emit(type, data) {
    this.onEvent(type, data);
  }

  reset(silent = false) {
    this.cells.fill(0);
    this.flags.fill(0);
    this.lives = MAX_LIVES;
    this.hintsUsed = 0;
    this.undoStack = [];
    this.won = false;
    this.lost = false;
    this.stroke = null;
    this.refreshAllLines();
    if (!silent) this.emit('change');
  }

  serialize() {
    return {
      v: 1,
      cells: Array.from(this.cells),
      flags: Array.from(this.flags),
      lives: this.lives,
      hintsUsed: this.hintsUsed,
    };
  }

  restore(s) {
    if (!s || !Array.isArray(s.cells) || s.cells.length !== this.n) return false;
    const K = this.level.K;
    for (let i = 0; i < this.n; i++) {
      const v = s.cells[i] | 0;
      this.cells[i] = v === X || (v >= 0 && v <= K) ? v : 0;
      this.flags[i] = Array.isArray(s.flags) ? (s.flags[i] | 0) & 3 : 0;
    }
    this.lives = Math.max(1, Math.min(MAX_LIVES, s.lives | 0 || MAX_LIVES));
    this.hintsUsed = Math.max(0, Math.min(MAX_HINTS, s.hintsUsed | 0));
    return true;
  }

  idx(r, c) {
    return r * this.w + c;
  }

  row(r) {
    return Array.from(this.cells.subarray(r * this.w, r * this.w + this.w));
  }

  col(c) {
    const out = new Array(this.h);
    for (let r = 0; r < this.h; r++) out[r] = this.cells[r * this.w + c];
    return out;
  }

  checkRow(r) {
    const have = lineClue(this.row(r));
    const want = this.level.clues.rows[r];
    this.rowSolved[r] = clueEqual(have, want) ? 1 : 0;
    blocksDone(have, want, this.rowDone[r]);
    return this.rowSolved[r] === 1;
  }

  checkCol(c) {
    const have = lineClue(this.col(c));
    const want = this.level.clues.cols[c];
    this.colSolved[c] = clueEqual(have, want) ? 1 : 0;
    blocksDone(have, want, this.colDone[c]);
    return this.colSolved[c] === 1;
  }

  refreshAllLines() {
    for (let r = 0; r < this.h; r++) this.checkRow(r);
    for (let c = 0; c < this.w; c++) this.checkCol(c);
  }

  isComplete() {
    return this.rowSolved.every((v) => v === 1) && this.colSolved.every((v) => v === 1);
  }

  // Is placing value v at cell i correct according to the stored solution?
  // Lives mode only: true once every cell of color k is placed. Wrong
  // placements are rejected in lives mode, so a full count means done.
  colorDone(k) {
    if (!this.livesMode) return false;
    let need = 0;
    let have = 0;
    const sol = this.level.solution;
    for (let i = 0; i < this.n; i++) {
      if (sol[i] === k) need++;
      if (this.cells[i] === k) have++;
    }
    return have >= need;
  }

  isCorrect(i, v) {
    const sol = this.level.solution[i];
    return v === X ? sol === 0 : sol === v;
  }

  solutionValue(i) {
    return this.level.solution[i] || X;
  }

  // Re-checks touched lines. Lines that now match their clue get their
  // remaining empty cells auto-filled with X (recorded in `changes`).
  settleLines(rows, cols, changes) {
    for (const r of rows) {
      if (!this.checkRow(r)) continue;
      for (let c = 0; c < this.w; c++) this.autoX(this.idx(r, c), changes);
    }
    for (const c of cols) {
      if (!this.checkCol(c)) continue;
      for (let r = 0; r < this.h; r++) this.autoX(this.idx(r, c), changes);
    }
  }

  autoX(i, changes) {
    if (this.cells[i] !== 0 || this.flags[i]) return;
    this.cells[i] = X;
    changes.push({ i, from: 0, to: X });
  }

  markError(i, st) {
    this.flags[i] = F_ERROR;
    this.cells[i] = this.solutionValue(i);
    this.lives = Math.max(0, this.lives - 1);
    if (st) {
      st.rows.add(Math.floor(i / this.w));
      st.cols.add(i % this.w);
    }
    this.emit('error', { i, lives: this.lives });
    if (this.lives === 0) this.lost = true;
  }

  // ---- Strokes (tap or drag) -------------------------------------------

  // tool: 1..K paints a color, X marks empty.
  // The first cell decides the action: tapping a cell that already has the
  // tool's value clears it, otherwise it gets the tool's value. The stroke
  // then only affects cells in the same state as the first cell.
  beginStroke(r, c, tool) {
    if (this.won || this.lost) return null;
    if (this.stroke) this.endStroke();
    const i = this.idx(r, c);
    const v0 = this.flags[i] ? 0 : this.cells[i];
    // The first cell decides the action: starting on the selected value
    // clears that value; otherwise matching cells get the selected value.
    // An X drag that starts on a locked or colored cell marks empty cells,
    // so you can sweep X's across a line without clearing your colors.
    let match = v0 === tool ? tool : v0;
    let to = v0 === tool ? 0 : tool;
    if (tool === X && (this.flags[i] || v0 > 0)) {
      match = 0;
      to = X;
    }
    const st = {
      r0: r,
      c0: c,
      axis: null,
      match,
      to,
      applied: new Map(), // cell index -> value before the stroke
      stopped: false,
      rows: new Set([r]),
      cols: new Set([c]),
      end: { r, c },
    };
    this.stroke = st;
    this.strokeTo(r, c);
    return st;
  }

  // Extends the current stroke toward (r, c). The stroke is locked to the row
  // or column it first moves along, and always covers the straight segment
  // from its start cell to the projected finger position.
  strokeTo(r, c) {
    const st = this.stroke;
    if (!st) return null;
    if (st.stopped) return st.end;
    r = Math.max(0, Math.min(this.h - 1, r));
    c = Math.max(0, Math.min(this.w - 1, c));
    const dr = r - st.r0;
    const dc = c - st.c0;
    if (dr === 0 && dc === 0) st.axis = null;
    else if (!st.axis) st.axis = Math.abs(dc) >= Math.abs(dr) ? 'row' : 'col';

    const seg = [];
    if (st.axis === 'row') {
      const step = Math.sign(dc);
      for (let k = 0; k <= Math.abs(dc); k++) seg.push(this.idx(st.r0, st.c0 + k * step));
      st.end = { r: st.r0, c: st.c0 + dc };
    } else if (st.axis === 'col') {
      const step = Math.sign(dr);
      for (let k = 0; k <= Math.abs(dr); k++) seg.push(this.idx(st.r0 + k * step, st.c0));
      st.end = { r: st.r0 + dr, c: st.c0 };
    } else {
      seg.push(this.idx(st.r0, st.c0));
      st.end = { r: st.r0, c: st.c0 };
    }

    // Undo cells the finger has retreated from.
    const inSeg = new Set(seg);
    for (const [i, from] of st.applied) {
      if (inSeg.has(i)) continue;
      if (!this.flags[i]) this.cells[i] = from;
      st.applied.delete(i);
    }

    for (const i of seg) {
      if (st.applied.has(i) || this.flags[i] || this.cells[i] !== st.match) continue;
      st.rows.add(Math.floor(i / this.w));
      st.cols.add(i % this.w);
      if (this.livesMode && st.to !== 0 && !this.isCorrect(i, st.to)) {
        this.markError(i, st);
        st.stopped = true;
        st.end = { r: Math.floor(i / this.w), c: i % this.w };
        break;
      }
      st.applied.set(i, this.cells[i]);
      this.cells[i] = st.to;
    }

    // Live clue graying while dragging (auto-X waits for the stroke to end).
    for (const rr of st.rows) this.checkRow(rr);
    for (const cc of st.cols) this.checkCol(cc);
    return st.end;
  }

  endStroke() {
    const st = this.stroke;
    if (!st) return;
    this.stroke = null;
    const changes = [];
    for (const [i, from] of st.applied) {
      if (this.cells[i] !== from) changes.push({ i, from, to: this.cells[i] });
    }
    this.settleLines(st.rows, st.cols, changes);
    this.commit(changes);
  }

  commit(changes) {
    if (changes.length) {
      this.undoStack.push(changes);
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    }
    if (!this.lost && this.isComplete()) this.won = true;
    this.emit('change');
    if (this.lost) this.emit('lost');
    else if (this.won) this.emit('won');
  }

  // ---- Undo / hints ----------------------------------------------------

  undo() {
    if (this.won || this.lost || this.stroke) return false;
    const changes = this.undoStack.pop();
    if (!changes) return false;
    const rows = new Set();
    const cols = new Set();
    for (let k = changes.length - 1; k >= 0; k--) {
      const { i, from } = changes[k];
      if (!this.flags[i]) this.cells[i] = from;
      rows.add(Math.floor(i / this.w));
      cols.add(i % this.w);
    }
    for (const r of rows) this.checkRow(r);
    for (const c of cols) this.checkCol(c);
    this.emit('change');
    return true;
  }

  // Line progress: share of the line's solution cells that are correctly
  // filled. Lines with no colored cells count as finished.
  lineProgress() {
    const { w, h } = this;
    const sol = this.level.solution;
    const rowTot = new Int32Array(h), rowOk = new Int32Array(h);
    const colTot = new Int32Array(w), colOk = new Int32Array(w);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const i = r * w + c;
        if (sol[i] > 0) {
          rowTot[r]++;
          colTot[c]++;
          if (this.cells[i] === sol[i]) {
            rowOk[r]++;
            colOk[c]++;
          }
        }
      }
    }
    const prog = (ok, tot) => (tot ? ok / tot : 1);
    return {
      row: Array.from(rowTot, (t, r) => prog(rowOk[r], t)),
      col: Array.from(colTot, (t, c) => prog(colOk[c], t)),
    };
  }

  // Reveals one correct cell, preferring cells in lines that are nearly solved.
  // Returns the cell index, or null if there is nothing to reveal.
  hint(random = Math.random) {
    if (this.won || this.lost || this.stroke || this.hintsLeft <= 0) return null;
    const sol = this.level.solution;
    const { row, col } = this.lineProgress();
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < this.n; i++) {
      if (this.flags[i]) continue;
      const v = this.cells[i];
      const wrongColor = sol[i] > 0 && v !== sol[i];
      const wrongFill = sol[i] === 0 && v > 0;
      if (!wrongColor && !wrongFill) continue;
      const r = Math.floor(i / this.w);
      const c = i % this.w;
      // Lines already at 100% have nothing left to fill; ignore them.
      const pr = row[r] < 1 ? row[r] : -1;
      const pc = col[c] < 1 ? col[c] : -1;
      let score = Math.max(pr, pc) + random() * 0.01;
      if (wrongFill) score += 0.5; // fixing a mistake is the most useful hint
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) return null;
    this.cells[best] = this.solutionValue(best);
    this.flags[best] = F_HINT;
    this.hintsUsed++;
    const changes = [];
    this.settleLines([Math.floor(best / this.w)], [best % this.w], changes);
    this.emit('hint', { i: best });
    this.commit(changes);
    return best;
  }
}

// Marks which clue numbers are done, reading the colored runs the player has
// drawn in the line. Runs are matched against the clue from the start of the
// line and, separately, from the end; each side stops at the first run that
// doesn't match. So the first and last numbers gray out as soon as their
// block is colored, and a middle number grays out only when every block
// between it and one end is colored too.
export function blocksDone(have, want, out) {
  out.fill(0);
  const n = Math.min(have.length, want.length);
  const same = (a, b) => a.len === b.len && a.color === b.color;
  let a = 0;
  while (a < n && same(have[a], want[a])) out[a++] = 1;
  // A drawn run can only count once, so the end side uses the runs the start
  // side didn't (unless the whole line already matches).
  const m = have.length === want.length && a === n ? n : Math.min(n, have.length - a);
  for (let k = 0; k < m && same(have[have.length - 1 - k], want[want.length - 1 - k]); k++) {
    out[want.length - 1 - k] = 1;
  }
  return out;
}
