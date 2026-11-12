// Converts the ASCII art in tools/levels-src.mjs into levels/<id>.json.
//   node tools/build-levels.mjs          write all levels
//   node tools/build-levels.mjs cat-01   write one level
// Run `node tools/validate.mjs` afterwards to validate and index them.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sources from './levels-src.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const only = process.argv.slice(2);

export function levelJson(src) {
  const keys = Object.keys(src.colors);
  const rows = src.art.split('\n').map((l) => l.trim()).filter(Boolean);
  const width = rows[0].length;
  const solution = rows.map((row, r) => {
    if (row.length !== width) throw new Error(`${src.id}: row ${r} is ${row.length} wide, expected ${width}`);
    return [...row].map((ch) => {
      if (ch === '.') return 0;
      const k = keys.indexOf(ch);
      if (k < 0) throw new Error(`${src.id}: unknown color letter "${ch}" in row ${r}`);
      return k + 1;
    });
  });
  return {
    id: src.id,
    name: src.name,
    category: src.category,
    width,
    height: rows.length,
    palette: keys.map((k) => src.colors[k]),
    solution,
  };
}

// JSON with one solution row per line, so files stay readable in diffs.
export function stringifyLevel(lvl) {
  const head = { ...lvl };
  delete head.solution;
  const lines = JSON.stringify(head, null, 2).split('\n');
  lines.pop(); // closing brace
  lines[lines.length - 1] += ',';
  lines.push('  "solution": [');
  lvl.solution.forEach((row, i) => {
    lines.push(`    ${JSON.stringify(row)}${i < lvl.solution.length - 1 ? ',' : ''}`);
  });
  lines.push('  ]', '}');
  return lines.join('\n') + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  let count = 0;
  for (const src of sources) {
    if (only.length && !only.includes(src.id)) continue;
    const lvl = levelJson(src);
    fs.writeFileSync(path.join(root, 'levels', `${lvl.id}.json`), stringifyLevel(lvl));
    count++;
  }
  console.log(`Wrote ${count} level file(s) to levels/`);
}
