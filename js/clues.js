// Clue generation. Shared by the game and the Node build tools.
//
// A line is an array of cell values: 0 = empty, 1..K = palette color.
// Negative values (the player's X marks) count as empty.
// A clue is an ordered list of blocks: [{ len, color }, ...].
// Every run of consecutive cells with the same color becomes one block.

export function lineClue(line) {
  const blocks = [];
  const n = line.length;
  let i = 0;
  while (i < n) {
    const v = line[i];
    if (v > 0) {
      let j = i + 1;
      while (j < n && line[j] === v) j++;
      blocks.push({ len: j - i, color: v });
      i = j;
    } else {
      i++;
    }
  }
  return blocks;
}

export function rowOf(grid, width, r) {
  const out = new Array(width);
  for (let c = 0; c < width; c++) out[c] = grid[r * width + c];
  return out;
}

export function colOf(grid, width, height, c) {
  const out = new Array(height);
  for (let r = 0; r < height; r++) out[r] = grid[r * width + c];
  return out;
}

// grid is a flat array (row-major). Returns { rows: [clue...], cols: [clue...] }.
export function computeClues(grid, width, height) {
  const rows = [];
  const cols = [];
  for (let r = 0; r < height; r++) rows.push(lineClue(rowOf(grid, width, r)));
  for (let c = 0; c < width; c++) cols.push(lineClue(colOf(grid, width, height, c)));
  return { rows, cols };
}

export function clueEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].len !== b[i].len || a[i].color !== b[i].color) return false;
  }
  return true;
}
