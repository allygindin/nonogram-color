// Level loading helpers shared by the app and the build tools.

import { computeClues } from './clues.js';

export const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Expert'];

// Difficulty from grid size and number of colors.
export function difficultyOf(width, height, colors) {
  const score = Math.max(width, height) + 1.5 * Math.max(0, colors - 2);
  if (score < 8) return 0;
  if (score < 12.5) return 1;
  if (score < 18) return 2;
  return 3;
}

// Checks the raw JSON shape. Returns a list of error strings (empty = OK).
export function checkLevelShape(json) {
  const errs = [];
  if (!json || typeof json !== 'object') return ['not an object'];
  if (typeof json.id !== 'string' || !json.id) errs.push('missing "id"');
  if (typeof json.name !== 'string' || !json.name) errs.push('missing "name"');
  const { width, height, palette, solution } = json;
  if (!Number.isInteger(width) || width < 1) errs.push('bad "width"');
  if (!Number.isInteger(height) || height < 1) errs.push('bad "height"');
  if (!Array.isArray(palette) || palette.length < 1) errs.push('bad "palette"');
  else palette.forEach((p, i) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(p)) errs.push(`palette[${i}] is not a #rrggbb color`);
  });
  if (!Array.isArray(solution)) errs.push('bad "solution"');
  else {
    if (solution.length !== height) errs.push(`solution has ${solution.length} rows, expected ${height}`);
    solution.forEach((row, r) => {
      if (!Array.isArray(row) || row.length !== width) {
        errs.push(`solution row ${r} has ${row && row.length} cells, expected ${width}`);
        return;
      }
      row.forEach((v, c) => {
        if (!Number.isInteger(v) || v < 0 || v > (palette ? palette.length : 0)) {
          errs.push(`solution[${r}][${c}] = ${v} is out of range`);
        }
      });
    });
  }
  return errs;
}

// Turns level JSON into the runtime form: flat solution and computed clues.
export function prepareLevel(json) {
  const { width, height } = json;
  const solution = new Int8Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) solution[r * width + c] = json.solution[r][c];
  }
  const clues = computeClues(solution, width, height);
  const K = json.palette.length;
  return {
    id: json.id,
    name: json.name,
    category: json.category || 'Other',
    width,
    height,
    palette: json.palette.slice(),
    K,
    solution,
    clues,
    difficulty: difficultyOf(width, height, K),
  };
}
