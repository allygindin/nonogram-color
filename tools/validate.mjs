// Level validation + build step.
//
//   node tools/validate.mjs           validate every levels/*.json; if all pass,
//                                     write levels/index.json and refresh the
//                                     service worker's file list and version
//   node tools/validate.mjs --check   validate only, write nothing
//   node tools/validate.mjs cat-01    validate (and report on) selected levels
//
// Every shipped puzzle must have exactly one solution reachable by line logic
// alone. The line solver proves both: if repeated line solving fixes every
// cell, the solution is unique and needs no guessing.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { checkLevelShape, prepareLevel, DIFFICULTIES } from '../js/level.js';
import { validateSolution } from '../js/solver.js';
import { paletteWarnings } from '../js/color.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const levelsDir = path.join(root, 'levels');
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const only = args.filter((a) => !a.startsWith('--'));

const CATEGORY_ORDER = ['Symbols', 'Animals', 'Nature', 'Food', 'Objects'];
const LETTERS = '.ABCDEF';

function asciiMap(lvl, ambiguous) {
  const amb = new Set(ambiguous.map((a) => a.r * lvl.width + a.c));
  const lines = [];
  for (let r = 0; r < lvl.height; r++) {
    let s = '';
    for (let c = 0; c < lvl.width; c++) {
      const i = r * lvl.width + c;
      s += amb.has(i) ? '?' : LETTERS[lvl.solution[i]];
    }
    lines.push('      ' + s);
  }
  return lines.join('\n');
}

const files = fs.readdirSync(levelsDir).filter((f) => f.endsWith('.json') && f !== 'index.json').sort();
const results = [];
const ids = new Map();
let failures = 0;

for (const file of files) {
  const id = file.replace(/\.json$/, '');
  if (only.length && !only.includes(id)) continue;
  const errors = [];
  const warnings = [];
  let json;
  try {
    json = JSON.parse(fs.readFileSync(path.join(levelsDir, file), 'utf8'));
  } catch (e) {
    errors.push(`invalid JSON: ${e.message}`);
  }
  let lvl = null;
  let report = null;
  if (json) {
    errors.push(...checkLevelShape(json));
    if (json.id && json.id !== id) errors.push(`id "${json.id}" does not match file name "${id}"`);
    if (ids.has(json.id)) errors.push(`duplicate id, also in ${ids.get(json.id)}`);
    ids.set(json.id, file);
    if (!errors.length) {
      if (json.palette.length < 2 || json.palette.length > 6) warnings.push(`palette has ${json.palette.length} colors (spec: 2-6)`);
      warnings.push(...paletteWarnings(json.palette));
      lvl = prepareLevel(json);
      const used = new Set(lvl.solution);
      for (let k = 1; k <= lvl.K; k++) if (!used.has(k)) warnings.push(`color ${k} (${lvl.palette[k - 1]}) is never used`);
      if (!used.size || (used.size === 1 && used.has(0))) errors.push('solution is empty');
      if (!errors.length) {
        report = validateSolution(lvl.solution, lvl.width, lvl.height, lvl.K);
        if (!report.ok) {
          const n = report.ambiguous.length;
          errors.push(report.status === 'ambiguous'
            ? `not solvable by line logic: ${n} ambiguous cell(s): ` +
              report.ambiguous.slice(0, 12).map((a) => `(r${a.r},c${a.c})`).join(' ') + (n > 12 ? ' ...' : '')
            : `solver status: ${report.status}`);
        }
      }
    }
  }
  if (errors.length) failures++;
  results.push({ file, id, json, lvl, report, errors, warnings });

  const tag = errors.length ? 'FAIL' : 'ok  ';
  const info = lvl ? `${lvl.width}x${lvl.height}, ${lvl.K} colors, ${DIFFICULTIES[lvl.difficulty]}` : '';
  const passes = report && report.ok ? `, ${report.passes} passes` : '';
  console.log(`${tag} ${id.padEnd(18)} ${info}${passes}`);
  for (const e of errors) console.log(`     error: ${e}`);
  for (const w of warnings) console.log(`     warn:  ${w}`);
  if (report && !report.ok && report.ambiguous.length) {
    console.log('     ambiguous cells marked "?":');
    console.log(asciiMap(lvl, report.ambiguous));
  }
}

console.log(`\n${results.length - failures}/${results.length} levels valid.`);
if (failures) process.exit(1);
if (checkOnly || only.length) process.exit(0);

// ---- Write levels/index.json ---------------------------------------------
const catRank = (c) => {
  const i = CATEGORY_ORDER.indexOf(c);
  return i < 0 ? CATEGORY_ORDER.length : i;
};
const entries = results.map(({ file, lvl, json }) => ({
  id: lvl.id,
  file: `levels/${file}`,
  name: lvl.name,
  category: lvl.category,
  width: lvl.width,
  height: lvl.height,
  colors: lvl.K,
  difficulty: lvl.difficulty,
  order: Number.isFinite(json.order) ? json.order : 0,
}));
entries.sort((a, b) =>
  a.difficulty - b.difficulty ||
  a.width * a.height - b.width * b.height ||
  a.colors - b.colors ||
  a.order - b.order ||
  a.name.localeCompare(b.name));
const categories = [...new Set(entries.map((e) => e.category))].sort((a, b) => catRank(a) - catRank(b) || a.localeCompare(b));
const index = { version: 1, categories, levels: entries.map(({ order, ...e }) => e) };
fs.writeFileSync(path.join(levelsDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`Wrote levels/index.json (${entries.length} levels).`);

// ---- Refresh the service worker's precache list ------------------------
function walk(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((d) => {
    const rel = `${dir}/${d.name}`;
    return d.isDirectory() ? walk(rel) : [rel];
  });
}
const assets = [
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  ...walk('js').filter((f) => f.endsWith('.js')),
  ...walk('icons').filter((f) => f.endsWith('.png')),
  'levels/index.json',
  ...entries.map((e) => e.file),
].filter((f) => fs.existsSync(path.join(root, f)));
const hash = crypto.createHash('sha256');
for (const f of assets) hash.update(f).update(fs.readFileSync(path.join(root, f)));
const version = hash.digest('hex').slice(0, 12);

const swPath = path.join(root, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
const list = ['./', ...assets].map((f) => `  '${f === './' ? f : './' + f}',`).join('\n');
sw = sw
  .replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`)
  .replace(/\/\/ <assets>[\s\S]*\/\/ <\/assets>/, `// <assets>\n${list}\n  // </assets>`);
fs.writeFileSync(swPath, sw);
console.log(`Updated sw.js: ${assets.length + 1} files, version ${version}.`);
