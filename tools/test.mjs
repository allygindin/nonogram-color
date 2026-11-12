// Unit tests: node tools/test.mjs
import { lineClue, computeClues, clueEqual } from '../js/clues.js';
import { solveLine, solveGrid, validateSolution } from '../js/solver.js';
import { prepareLevel } from '../js/level.js';
import { Game, X, F_ERROR, F_HINT } from '../js/game.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n  ${e.stack || e}`);
  }
}
function eq(a, b, msg = '') {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg} expected ${sb}, got ${sa}`);
}
function ok(v, msg = 'expected truthy') {
  if (!v) throw new Error(msg);
}

// Deterministic PRNG so failures are reproducible.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- clues ----------------------------------------------------------------

test('lineClue basic runs', () => {
  eq(lineClue([1, 1, 1, 0, 2, 1, 1]), [{ len: 3, color: 1 }, { len: 1, color: 2 }, { len: 2, color: 1 }]);
});
test('lineClue empty line and X marks', () => {
  eq(lineClue([0, 0, 0]), []);
  eq(lineClue([-1, 2, -1, 2]), [{ len: 1, color: 2 }, { len: 1, color: 2 }]);
});
test('different colors touching are separate blocks', () => {
  eq(lineClue([1, 2, 2, 1]), [{ len: 1, color: 1 }, { len: 2, color: 2 }, { len: 1, color: 1 }]);
});
test('computeClues rows and columns', () => {
  const g = [1, 2, 0, 1];
  const c = computeClues(g, 2, 2);
  eq(c.rows, [[{ len: 1, color: 1 }, { len: 1, color: 2 }], [{ len: 1, color: 1 }]]);
  eq(c.cols, [[{ len: 1, color: 1 }], [{ len: 1, color: 2 }, { len: 1, color: 1 }]]);
});

// ---- line solver vs brute force ------------------------------------------

function bruteLine(poss, clue, K) {
  const n = poss.length;
  const out = new Uint8Array(n);
  const cur = new Array(n).fill(0);
  let any = false;
  const rec = (i) => {
    if (i === n) {
      if (clueEqual(lineClue(cur), clue)) {
        any = true;
        for (let k = 0; k < n; k++) out[k] |= 1 << cur[k];
      }
      return;
    }
    for (let v = 0; v <= K; v++) {
      if (!(poss[i] & (1 << v))) continue;
      cur[i] = v;
      rec(i + 1);
    }
  };
  rec(0);
  return any ? out : null;
}

test('solveLine matches brute force on random lines', () => {
  const rand = rng(12345);
  for (let t = 0; t < 4000; t++) {
    const K = 1 + Math.floor(rand() * 3);
    const n = 1 + Math.floor(rand() * 8);
    const full = (1 << (K + 1)) - 1;
    // Clue from a random line, so it is usually (not always) satisfiable.
    const line = Array.from({ length: n }, () => (rand() < 0.4 ? 0 : 1 + Math.floor(rand() * K)));
    let clue = lineClue(line);
    if (rand() < 0.15) clue = clue.concat([{ len: 1 + Math.floor(rand() * 2), color: 1 }]);
    const poss = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      let m = full;
      if (rand() < 0.35) m &= ~(1 << Math.floor(rand() * (K + 1)));
      if (rand() < 0.15) m &= ~(1 << Math.floor(rand() * (K + 1)));
      poss[i] = m || full;
    }
    const a = solveLine(poss, clue);
    const b = bruteLine(poss, clue, K);
    const sa = a ? Array.from(a) : null;
    const sb = b ? Array.from(b) : null;
    if (JSON.stringify(sa) !== JSON.stringify(sb)) {
      throw new Error(`mismatch K=${K} poss=${Array.from(poss)} clue=${JSON.stringify(clue)}\n  dp=${sa}\n  brute=${sb}`);
    }
  }
});

test('same-color blocks need a gap, different colors do not', () => {
  // Line of 3, clue [1 red, 2 blue] -> fully determined: R B B
  const full = 0b111;
  const a = solveLine(new Uint8Array([full, full, full]), [{ len: 1, color: 1 }, { len: 2, color: 2 }]);
  eq(Array.from(a), [2, 4, 4]);
  // Line of 3, clue [1 red, 2 red] cannot fit (needs 4 cells).
  eq(solveLine(new Uint8Array([full, full, full]), [{ len: 1, color: 1 }, { len: 2, color: 1 }]), null);
});

// ---- grid solver ---------------------------------------------------------

test('solveGrid solves a uniquely solvable puzzle', () => {
  const sol = [
    0, 1, 0, 1, 0,
    1, 2, 1, 1, 1,
    1, 1, 1, 1, 1,
    0, 1, 1, 1, 0,
    0, 0, 1, 0, 0,
  ];
  const v = validateSolution(Int8Array.from(sol), 5, 5, 2);
  ok(v.ok, `status ${v.status}`);
});

test('solveGrid reports ambiguity (classic 2x2 diagonal)', () => {
  const sol = Int8Array.from([1, 0, 0, 1]);
  const v = validateSolution(sol, 2, 2, 1);
  eq(v.ok, false);
  eq(v.status, 'ambiguous');
  eq(v.ambiguous.length, 4);
});

test('color resolves what black-and-white cannot', () => {
  // Same diagonal shape, but two different colors -> unique.
  const sol = Int8Array.from([1, 0, 0, 2]);
  ok(validateSolution(sol, 2, 2, 2).ok);
});

// ---- game rules ----------------------------------------------------------

function mkLevel() {
  return prepareLevel({
    id: 't', name: 'T', width: 3, height: 3,
    palette: ['#e63946', '#457b9d'],
    solution: [
      [1, 1, 0],
      [0, 2, 0],
      [0, 2, 2],
    ],
  });
}

test('tap fills, tap again with same color clears', () => {
  const g = new Game(mkLevel(), { livesMode: false });
  g.beginStroke(0, 0, 1); g.endStroke();
  eq(g.cells[0], 1);
  g.beginStroke(0, 0, 1); g.endStroke();
  eq(g.cells[0], 0);
});

test('drag locks to the first axis', () => {
  const g = new Game(mkLevel(), { livesMode: false });
  g.beginStroke(0, 0, 1);
  g.strokeTo(0, 1);
  g.strokeTo(1, 2); // drifts down a row: stays on row 0
  g.endStroke();
  eq(Array.from(g.cells).slice(0, 3), [1, 1, 1]);
  eq([g.cells[5], g.cells[8]], [0, 2 - 2], 'row 1/2 not painted');
});

test('retreating a drag restores cells', () => {
  const g = new Game(mkLevel(), { livesMode: false });
  g.beginStroke(0, 0, 1);
  g.strokeTo(0, 2);
  g.strokeTo(0, 1);
  g.endStroke();
  eq(Array.from(g.cells).slice(0, 2), [1, 1]);
  ok(g.cells[2] !== 1, 'retreated cell not painted');
});

test('dragging X marks every empty cell along the line', () => {
  const g = new Game(mkLevel(), { livesMode: true });
  g.beginStroke(2, 0, X);
  g.strokeTo(0, 0);
  g.endStroke();
  eq([g.cells[0], g.cells[3], g.cells[6]], [1, X, X], 'stops before the colored cell in lives mode');
  const h = new Game(mkLevel(), { livesMode: false });
  h.beginStroke(1, 0, X);
  h.strokeTo(1, 2);
  h.endStroke();
  eq(Array.from(h.cells).slice(3, 6), [X, X, X]);
  eq(h.undoStack.length, 1, 'one undo step');
});

test('X drag starting on a colored cell marks empties and keeps the color', () => {
  const g = new Game(mkLevel(), { livesMode: false });
  g.beginStroke(1, 1, 2); g.endStroke();
  g.beginStroke(1, 1, X);
  g.strokeTo(1, 0);
  g.endStroke();
  eq([g.cells[3], g.cells[4]], [X, 2]);
});

test('solved line greys and auto-fills X; undo reverts all of it', () => {
  const g = new Game(mkLevel(), { livesMode: false });
  g.beginStroke(0, 0, 1);
  g.strokeTo(0, 1);
  g.endStroke();
  eq(g.rowSolved[0], 1);
  eq(g.cells[2], X);
  g.undo();
  eq(Array.from(g.cells).slice(0, 3), [0, 0, 0]);
  eq(g.rowSolved[0], 0);
});

test('win compares clues, not cells', () => {
  // Ambiguous 2x2 diagonal: the anti-diagonal also satisfies the clues.
  const lvl = prepareLevel({ id: 'd', name: 'D', width: 2, height: 2, palette: ['#000000'], solution: [[1, 0], [0, 1]] });
  let won = false;
  const g = new Game(lvl, { livesMode: false, onEvent: (t) => { if (t === 'won') won = true; } });
  g.beginStroke(0, 1, 1); g.endStroke();
  g.beginStroke(1, 0, 1); g.endStroke();
  ok(won, 'alternate solution should win');
});

test('lives mode: wrong placement costs a life, locks the cell, stops the drag', () => {
  const g = new Game(mkLevel(), { livesMode: true });
  g.beginStroke(1, 0, 1); // solution is empty here
  g.strokeTo(1, 2);
  g.endStroke();
  eq(g.lives, 2);
  eq(g.flags[3], F_ERROR);
  eq(g.cells[3], X);
  eq(g.cells[4], 0, 'drag stopped at the error');
});

test('losing all lives sets lost; reset restores', () => {
  let lost = false;
  const g = new Game(mkLevel(), { livesMode: true, onEvent: (t) => { if (t === 'lost') lost = true; } });
  for (const [r, c] of [[1, 0], [1, 2], [2, 0]]) { g.beginStroke(r, c, 1); g.endStroke(); }
  ok(lost && g.lost);
  g.reset();
  eq(g.lives, 3);
  eq(Array.from(g.flags).every((f) => f === 0), true);
});

test('hint prefers nearly-solved lines and locks the cell', () => {
  const g = new Game(mkLevel(), { livesMode: false });
  g.beginStroke(2, 1, 2); g.endStroke(); // row 2: 1 of 2 filled
  const i = g.hint(() => 0);
  eq(i, 8, 'should finish row 2 / col 2');
  eq(g.flags[8], F_HINT);
  eq(g.hintsLeft, 2);
});

test('serialize / restore round trip', () => {
  const g = new Game(mkLevel(), { livesMode: false });
  g.beginStroke(0, 0, 1); g.endStroke();
  const s = JSON.parse(JSON.stringify(g.serialize()));
  const g2 = new Game(mkLevel(), { livesMode: false, saved: s });
  eq(Array.from(g2.cells), Array.from(g.cells));
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
