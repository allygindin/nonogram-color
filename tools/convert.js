// Image → puzzle converter (browser tool; open tools/convert.html via the dev server).
import { validateSolution } from '../js/solver.js';
import { rgbToHex, ensureContrast, paletteWarnings, CELL_BG, MIN_CELL_CONTRAST } from '../js/color.js';

const $ = (s) => document.querySelector(s);

// Game-friendly fixed palette (saturated, readable on white), plus light
// entries so white/pale backgrounds have somewhere to go (they become empty).
const FIXED = ['#e63946', '#a4161a', '#ff5d8f', '#ef6a12', '#e3b000', '#40a060', '#2d6a4f', '#2a9d8f',
  '#3a7ca5', '#1d3557', '#7b2cbf', '#8d5524', '#c68642', '#2b2d42', '#7d8597'];
const LIGHT = ['#ffffff', '#ececec', '#f5ecd7'];

const state = { img: null, grid: null, palette: [], w: 0, h: 0, ambiguous: new Set() };

// ---- Color math ----------------------------------------------------------

function hexRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function rgbToLab([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = f(r), G = f(g), B = f(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const t = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  x = t(x); y = t(y); z = t(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
function labToRgb([L, a, b]) {
  let y = (L + 16) / 116, x = a / 500 + y, z = y - b / 200;
  const t = (v) => (v ** 3 > 0.008856 ? v ** 3 : (v - 16 / 116) / 7.787);
  x = t(x) * 0.95047; y = t(y); z = t(z) * 1.08883;
  const g = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  return [g(x * 3.2406 + y * -1.5372 + z * -0.4986), g(x * -0.9689 + y * 1.8758 + z * 0.0415), g(x * 0.0557 + y * -0.204 + z * 1.057)];
}
const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// k-means++ in Lab space. Returns { centers, labels }.
function kmeans(points, k, iters = 30) {
  const rand = rng(42);
  k = Math.min(k, points.length);
  const centers = [points[Math.floor(rand() * points.length)].slice()];
  while (centers.length < k) {
    const dist = points.map((p) => Math.min(...centers.map((c) => d2(p, c))));
    const total = dist.reduce((a, b) => a + b, 0);
    if (total === 0) break;
    let r = rand() * total, i = 0;
    while (r > dist[i]) r -= dist[i++];
    centers.push(points[Math.min(i, points.length - 1)].slice());
  }
  const labels = new Int32Array(points.length);
  for (let it = 0; it < iters; it++) {
    let moved = false;
    points.forEach((p, i) => {
      let best = 0, bd = Infinity;
      centers.forEach((c, j) => { const d = d2(p, c); if (d < bd) { bd = d; best = j; } });
      if (labels[i] !== best) { labels[i] = best; moved = true; }
    });
    const sums = centers.map(() => [0, 0, 0, 0]);
    points.forEach((p, i) => { const s = sums[labels[i]]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; });
    sums.forEach((s, j) => { if (s[3]) centers[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
    if (!moved && it > 0) break;
  }
  return { centers, labels };
}

// ---- Image sampling ------------------------------------------------------

// Averages the image over each grid cell. Returns [{ lab, rgb, alpha }].
function sampleCells(img, w, h) {
  // Puzzles are square: fit the whole image inside a square canvas and
  // center it. The transparent margin reads as white, which usually
  // becomes the empty color.
  const side = Math.max(w, Math.min(640, Math.max(img.naturalWidth, img.naturalHeight)));
  const cw = side, ch = side;
  const fit = side / Math.max(img.naturalWidth, img.naturalHeight);
  const dw = Math.round(img.naturalWidth * fit), dh = Math.round(img.naturalHeight * fit);
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, Math.floor((cw - dw) / 2), Math.floor((ch - dh) / 2), dw, dh);
  const data = ctx.getImageData(0, 0, cw, ch).data;
  const cells = [];
  cells.pixels = { data, cw, ch };
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const x0 = Math.floor((c * cw) / w), x1 = Math.max(x0 + 1, Math.floor(((c + 1) * cw) / w));
      const y0 = Math.floor((r * ch) / h), y1 = Math.max(y0 + 1, Math.floor(((r + 1) * ch) / h));
      let R = 0, G = 0, B = 0, A = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const o = (y * cw + x) * 4, a = data[o + 3] / 255;
        R += data[o] * a; G += data[o + 1] * a; B += data[o + 2] * a; A += a; n++;
      }
      const rgb = A > 0 ? [R / A, G / A, B / A] : [255, 255, 255];
      cells.push({ rgb, lab: rgbToLab(rgb), alpha: A / n, box: [x0, y0, x1, y1] });
    }
  }
  return cells;
}

function edgeIndices(w, h) {
  const out = [];
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (r === 0 || c === 0 || r === h - 1 || c === w - 1) out.push(r * w + c);
  return out;
}

function mostCommon(labels, indices) {
  const count = new Map();
  for (const i of indices) count.set(labels[i], (count.get(labels[i]) || 0) + 1);
  let best = null, bc = -1;
  for (const [l, c] of count) if (c > bc) { bc = c; best = l; }
  return best;
}

// Returns { grid (0..K), palette (hex[]) }.
function quantize(cells, w, h, K, method) {
  const TRANSPARENT = -1;
  const opaque = cells.map((c) => c.alpha >= 0.5);
  const labels = new Int32Array(cells.length).fill(TRANSPARENT);
  let centers;

  if (method === 'fixed') {
    const choices = FIXED.concat(LIGHT).map((hx) => rgbToLab(hexRgb(hx)));
    cells.forEach((c, i) => {
      if (!opaque[i]) return;
      let best = 0, bd = Infinity;
      choices.forEach((p, j) => { const d = d2(c.lab, p); if (d < bd) { bd = d; best = j; } });
      labels[i] = best;
    });
    centers = choices;
  } else if (method === 'kmeans-avg') {
    // Cluster the per-cell average colors (smoother, but blends edges).
    const idx = [];
    cells.forEach((c, i) => opaque[i] && idx.push(i));
    if (idx.length) {
      const km = kmeans(idx.map((i) => cells[i].lab), K + 1);
      idx.forEach((i, j) => { labels[i] = km.labels[j]; });
      centers = km.centers;
    } else centers = [];
  } else {
    // Cluster actual pixels, then give each cell its majority cluster.
    // Keeps edges crisp: anti-aliased blends don't become colors.
    const { data, cw } = cells.pixels;
    const rand = rng(7);
    const sample = [];
    const total = data.length / 4;
    const step = Math.max(1, Math.floor(total / 8000));
    for (let p = 0; p < total; p += step) {
      const o = (p + Math.floor(rand() * step)) * 4;
      if (o < data.length && data[o + 3] >= 128) sample.push(rgbToLab([data[o], data[o + 1], data[o + 2]]));
    }
    centers = sample.length ? kmeans(sample, K + 1).centers : [];
    const cache = new Map();
    const nearest = (o) => {
      const key = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
      let l = cache.get(key);
      if (l === undefined) {
        const lab = rgbToLab([data[o], data[o + 1], data[o + 2]]);
        let bd = Infinity;
        centers.forEach((c, j) => { const d = d2(lab, c); if (d < bd) { bd = d; l = j; } });
        cache.set(key, l);
      }
      return l;
    };
    cells.forEach((cell, i) => {
      const [x0, y0, x1, y1] = cell.box;
      const votes = new Map();
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const o = (y * cw + x) * 4;
        const l = data[o + 3] < 128 ? TRANSPARENT : nearest(o);
        votes.set(l, (votes.get(l) || 0) + 1);
      }
      let best = TRANSPARENT, bv = -1;
      for (const [l, v] of votes) if (v > bv) { bv = v; best = l; }
      labels[i] = best;
    });
  }

  // Most common edge label becomes empty.
  const empty = mostCommon(labels, edgeIndices(w, h));
  const isEmpty = (l) => l === TRANSPARENT || l === empty || (method === 'fixed' && l >= FIXED.length);

  // Keep the K most used remaining labels.
  const use = new Map();
  labels.forEach((l) => { if (!isEmpty(l)) use.set(l, (use.get(l) || 0) + 1); });
  const kept = [...use.entries()].sort((a, b) => b[1] - a[1]).slice(0, K).map(([l]) => l);
  const emptyLab = empty != null && empty >= 0 && centers[empty] ? centers[empty] : rgbToLab([255, 255, 255]);

  const grid = new Int8Array(cells.length);
  cells.forEach((c, i) => {
    const l = labels[i];
    if (isEmpty(l)) { grid[i] = 0; return; }
    const k = kept.indexOf(l);
    if (k >= 0) { grid[i] = k + 1; return; }
    // Dropped color: nearest kept color, or empty if that's closer.
    let best = 0, bd = d2(c.lab, emptyLab);
    kept.forEach((kl, j) => { const d = d2(c.lab, centers[kl]); if (d < bd) { bd = d; best = j + 1; } });
    grid[i] = best;
  });

  const palette = kept.map((l) => (method === 'fixed' ? FIXED[l] : rgbToHex(labToRgb(centers[l]))));
  return { grid, palette };
}

// Replaces isolated single cells whose 4 neighbours agree on another value.
function despeckle(grid, w, h) {
  const out = grid.slice();
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const i = r * w + c, v = grid[i];
    const nb = [];
    if (r > 0) nb.push(grid[i - w]);
    if (r < h - 1) nb.push(grid[i + w]);
    if (c > 0) nb.push(grid[i - 1]);
    if (c < w - 1) nb.push(grid[i + 1]);
    if (nb.length >= 3 && nb.every((x) => x === nb[0]) && nb[0] !== v) out[i] = nb[0];
  }
  return out;
}

// Drops unused palette entries and renumbers by frequency.
function compact(grid, palette) {
  const count = palette.map(() => 0);
  grid.forEach((v) => { if (v > 0) count[v - 1]++; });
  const order = palette.map((_, k) => k).filter((k) => count[k] > 0).sort((a, b) => count[b] - count[a]);
  const map = new Int8Array(palette.length + 1);
  order.forEach((k, j) => { map[k + 1] = j + 1; });
  return { grid: grid.map((v) => (v > 0 ? map[v] : 0)), palette: order.map((k) => palette[k]) };
}

// ---- Validation and auto-fix ---------------------------------------------

function validate() {
  const { grid, w, h, palette } = state;
  const res = validateSolution(grid, w, h, palette.length);
  state.ambiguous = new Set(res.ambiguous.map((a) => a.r * w + a.c));
  return res;
}

// Greedy repair: try changing ambiguous cells (to empty or a neighbour's
// color) and keep the change that removes the most ambiguity.
async function autoFix() {
  const btn = $('#btn-autofix');
  btn.disabled = true;
  const { w, h } = state;
  const K = state.palette.length;
  let res = validate();
  for (let step = 0; step < 80 && !res.ok; step++) {
    const amb = [...state.ambiguous];
    const sample = amb.sort(() => Math.random() - 0.5).slice(0, 24);
    let best = null, bestScore = state.ambiguous.size;
    for (const i of sample) {
      const r = Math.floor(i / w), c = i % w;
      const opts = new Set([0]);
      [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].forEach(([rr, cc]) => {
        if (rr >= 0 && rr < h && cc >= 0 && cc < w) opts.add(state.grid[rr * w + cc]);
      });
      const orig = state.grid[i];
      for (const v of opts) {
        if (v === orig || v > K) continue;
        state.grid[i] = v;
        const t = validateSolution(state.grid, w, h, K);
        const score = t.ok ? -1 : t.ambiguous.length;
        if (score < bestScore) { bestScore = score; best = { i, v }; }
      }
      state.grid[i] = orig;
    }
    if (!best) break;
    state.grid[best.i] = best.v;
    res = validate();
    setStatus(res, `Auto-fix: step ${step + 1}…`);
    draw();
    await new Promise((r) => setTimeout(r, 0));
  }
  finish();
  btn.disabled = false;
}

// ---- UI ------------------------------------------------------------------

function setStatus(res, prefix = '') {
  const el = $('#status');
  if (res.ok) {
    el.className = 'status ok';
    el.textContent = `${prefix} Valid: unique and solvable by logic (${res.passes} passes).`.trim();
  } else {
    el.className = 'status bad';
    el.textContent = `${prefix} Not valid: ${res.ambiguous.length} ambiguous cell(s) (hatched). Edit them or try Auto-fix.`.trim();
  }
}

function draw() {
  const { grid, w, h, palette } = state;
  const cv = $('#preview');
  const cell = Math.max(8, Math.floor(Math.min(560 / w, 560 / h)));
  cv.width = w * cell; cv.height = h * cell;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  for (let i = 0; i < grid.length; i++) {
    const r = Math.floor(i / w), c = i % w;
    if (grid[i] > 0) { ctx.fillStyle = palette[grid[i] - 1]; ctx.fillRect(c * cell, r * cell, cell, cell); }
    if (state.ambiguous.has(i)) {
      ctx.strokeStyle = '#e5383b'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = -cell; k < cell; k += 6) { ctx.moveTo(c * cell + k, r * cell); ctx.lineTo(c * cell + k + cell, r * cell + cell); }
      ctx.save(); ctx.beginPath(); ctx.rect(c * cell, r * cell, cell, cell); ctx.clip();
      ctx.beginPath();
      for (let k = -cell; k < cell; k += 6) { ctx.moveTo(c * cell + k, r * cell); ctx.lineTo(c * cell + k + cell, r * cell + cell); }
      ctx.stroke(); ctx.restore();
    }
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1;
  for (let c = 0; c <= w; c++) { ctx.beginPath(); ctx.moveTo(c * cell + 0.5, 0); ctx.lineTo(c * cell + 0.5, h * cell); ctx.stroke(); }
  for (let r = 0; r <= h; r++) { ctx.beginPath(); ctx.moveTo(0, r * cell + 0.5); ctx.lineTo(w * cell, r * cell + 0.5); ctx.stroke(); }
  state.cellPx = cell;
  $('#palette').innerHTML = palette.map((p, k) => `<span><i style="background:${p}"></i>${k + 1} ${p}</span>`).join('');
  $('#warnings').innerHTML = paletteWarnings(palette).map((m) => `<div class="warn">⚠ ${m}</div>`).join('');
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'puzzle';
}

function levelJson() {
  const name = $('#name').value.trim() || 'Untitled';
  const id = $('#id').value.trim() || `${slug(name)}-01`;
  const rows = [];
  for (let r = 0; r < state.h; r++) rows.push(Array.from(state.grid.slice(r * state.w, (r + 1) * state.w)));
  const head = { id, name, category: $('#category').value.trim() || 'Other', width: state.w, height: state.h, palette: state.palette };
  const lines = JSON.stringify(head, null, 2).split('\n');
  lines.pop();
  lines[lines.length - 1] += ',';
  lines.push('  "solution": [');
  rows.forEach((row, i) => lines.push(`    ${JSON.stringify(row)}${i < rows.length - 1 ? ',' : ''}`));
  lines.push('  ]', '}');
  return { id, text: lines.join('\n') + '\n' };
}

function finish() {
  const res = validate();
  setStatus(res);
  draw();
  const { text } = levelJson();
  $('#out').value = text;
  $('#btn-download').disabled = !res.ok;
  $('#btn-copy').disabled = false;
}

function convert() {
  if (!state.img) return;
  const w = +$('#size').value || 10;
  const h = w;
  const K = Math.max(2, Math.min(6, +$('#k').value | 0));
  const cells = sampleCells(state.img, w, h);
  let { grid, palette } = quantize(cells, w, h, K, $('#method').value);
  if ($('#despeckle').checked) grid = despeckle(grid, w, h);
  if ($('#fix-pale').checked) palette = palette.map((p) => ensureContrast(p, CELL_BG, MIN_CELL_CONTRAST + 0.15));
  ({ grid, palette } = compact(grid, palette));
  Object.assign(state, { grid, palette, w, h });
  $('#btn-autofix').disabled = false;
  finish();
}

$('#file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const img = $('#source');
  img.onload = () => {
    state.img = img;
    img.style.display = 'block';
    if (!$('#name').value) $('#name').value = f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
    $('#btn-convert').disabled = false;
    convert();
  };
  img.src = URL.createObjectURL(f);
});
$('#size').addEventListener('change', () => state.img && convert());
$('#btn-convert').addEventListener('click', convert);
$('#btn-autofix').addEventListener('click', autoFix);
['#name', '#id', '#category'].forEach((s) => $(s).addEventListener('input', () => state.grid && ($('#out').value = levelJson().text)));

// Click a cell to cycle its value (empty → color 1 → … → empty).
$('#preview').addEventListener('click', (e) => {
  if (!state.grid) return;
  const rect = e.target.getBoundingClientRect();
  const sx = e.target.width / rect.width;
  const c = Math.floor(((e.clientX - rect.left) * sx) / state.cellPx);
  const r = Math.floor(((e.clientY - rect.top) * sx) / state.cellPx);
  if (r < 0 || c < 0 || r >= state.h || c >= state.w) return;
  const i = r * state.w + c;
  state.grid[i] = (state.grid[i] + 1) % (state.palette.length + 1);
  finish();
});

$('#btn-download').addEventListener('click', () => {
  const { id, text } = levelJson();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = `${id}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$('#btn-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#out').value); $('#btn-copy').textContent = 'Copied'; }
  catch (_) { $('#out').select(); }
  setTimeout(() => { $('#btn-copy').textContent = 'Copy JSON'; }, 1200);
});

// For automated checks: window.__convertFromUrl(url)
window.__convertFromUrl = (url) => new Promise((resolve) => {
  const img = $('#source');
  img.onload = () => { state.img = img; img.style.display = 'block'; $('#btn-convert').disabled = false; convert(); resolve(validate()); };
  img.src = url;
});
