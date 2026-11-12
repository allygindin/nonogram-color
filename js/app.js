// App shell: screens, HUD, saving, level list.
import { prepareLevel, DIFFICULTIES } from './level.js';
import { Game, X, MAX_LIVES } from './game.js';
import { VERSION } from './version.js';
import { BoardView } from './view.js';
import { BoardInput } from './input.js';
import * as store from './storage.js';

const $ = (s) => document.querySelector(s);

const ICONS = {
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.2 3 4.5 6.6 4.5c2.1 0 3.6 1.2 4.4 2.5.8-1.3 2.3-2.5 4.4-2.5 3.6 0 5.7 3.7 4.2 7.2C19.5 16.4 12 21 12 21z"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"/></svg>',
};

const state = {
  levels: [],
  byId: new Map(),
  categories: [],
  completed: new Set(store.get('completed', [])),
  settings: Object.assign({ livesMode: true, hideSolved: false, category: 'All' }, store.get('settings', {})),
  game: null,
  level: null,
  tool: 1,
};

const view = new BoardView($('#board-canvas'));
const input = new BoardInput($('#board-canvas'), view, {
  enabled: () => !!state.game && !state.game.won && !state.game.lost && !document.body.classList.contains('sheet-open'),
  begin: (r, c) => state.game.beginStroke(r, c, state.tool),
  move: (r, c) => state.game.strokeTo(r, c),
  end: () => state.game.endStroke(),
});

// ---- Screens -----------------------------------------------------------

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
  document.body.dataset.screen = name;
}

function openSheet(id) {
  closeSheets();
  $(id).classList.add('open');
  document.body.classList.add('sheet-open');
}

function closeSheets() {
  document.querySelectorAll('.sheet.open').forEach((s) => s.classList.remove('open'));
  document.body.classList.remove('sheet-open');
}

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
}

function saveSettings() {
  store.set('settings', state.settings);
}

// ---- Level list --------------------------------------------------------

function drawThumb(canvas, level) {
  const { width: w, height: h, palette, solution } = level;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = solution[i];
    const hex = v ? palette[v - 1] : '#ffffff';
    const n = parseInt(hex.slice(1), 16);
    img.data[i * 4] = (n >> 16) & 255;
    img.data[i * 4 + 1] = (n >> 8) & 255;
    img.data[i * 4 + 2] = n & 255;
    img.data[i * 4 + 3] = v ? 255 : 0;
  }
  ctx.putImageData(img, 0, 0);
}

function renderTabs() {
  const nav = $('#tabs');
  nav.innerHTML = '';
  for (const cat of ['All', ...state.categories]) {
    const b = document.createElement('button');
    b.className = 'tab' + (state.settings.category === cat ? ' active' : '');
    b.textContent = cat;
    b.addEventListener('click', () => {
      state.settings.category = cat;
      saveSettings();
      renderList();
    });
    nav.appendChild(b);
  }
}

function renderList() {
  if (!state.categories.includes(state.settings.category)) state.settings.category = 'All';
  renderTabs();
  const grid = $('#level-grid');
  grid.innerHTML = '';
  const cat = state.settings.category;
  const inCat = state.levels.filter((l) => cat === 'All' || l.category === cat);
  const shown = inCat.filter((l) => !(state.settings.hideSolved && state.completed.has(l.id)));
  const solvedCount = state.levels.filter((l) => state.completed.has(l.id)).length;
  $('#progress-count').textContent = `${solvedCount} / ${state.levels.length} solved`;
  $('#hide-solved').checked = state.settings.hideSolved;
  $('#lives-toggle-list').checked = state.settings.livesMode;

  for (const l of shown) {
    const solved = state.completed.has(l.id);
    const inProgress = !solved && store.has(`progress.${l.id}`);
    const tile = document.createElement('button');
    tile.className = 'tile' + (solved ? ' solved' : '');
    tile.setAttribute('aria-label', `${l.name}, ${l.width} by ${l.height}${solved ? ', solved' : ''}`);
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    if (solved) {
      const c = document.createElement('canvas');
      drawThumb(c, l);
      thumb.appendChild(c);
    } else {
      thumb.innerHTML = '<span class="q">?</span>';
    }
    if (inProgress) thumb.insertAdjacentHTML('beforeend', '<span class="badge">In progress</span>');
    const dots = l.palette.map((p) => `<i style="background:${p}"></i>`).join('');
    tile.appendChild(thumb);
    tile.insertAdjacentHTML('beforeend', `
      <div class="tile-name">${escapeHtml(l.name)}</div>
      <div class="tile-meta"><span>${l.width}×${l.height}</span><span class="diff d${l.difficulty}">${DIFFICULTIES[l.difficulty]}</span></div>
      <div class="tile-dots">${dots}</div>`);
    tile.addEventListener('click', () => openPuzzle(l.id));
    grid.appendChild(tile);
  }
  if (!shown.length) {
    grid.innerHTML = `<p class="empty">${inCat.length ? 'Everything here is solved. Nice work!' : 'No puzzles yet.'}</p>`;
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

// ---- Puzzle ------------------------------------------------------------

function openPuzzle(id) {
  const level = state.byId.get(id);
  if (!level) return;
  input.reset();
  closeSheets();
  document.body.classList.remove('revealing');
  state.level = level;
  state.tool = 1;
  state.game = new Game(level, {
    saved: store.get(`progress.${id}`),
    livesMode: state.settings.livesMode,
    onEvent,
  });
  store.set('current', id);
  $('#puzzle-title').textContent = level.name;
  $('#puzzle-sub').textContent = `${level.width}×${level.height} · ${DIFFICULTIES[level.difficulty]}`;
  showScreen('puzzle');
  buildPalette();
  view.setGame(state.game);
  view.tool = state.tool;
  updateHud();
}

function buildPalette() {
  const wrap = $('#palette');
  wrap.innerHTML = '';
  state.level.palette.forEach((hex, k) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.setProperty('--sw', hex);
    b.dataset.tool = String(k + 1);
    b.setAttribute('aria-label', `Color ${k + 1}`);
    b.addEventListener('click', () => setTool(k + 1));
    wrap.appendChild(b);
  });
  const xb = document.createElement('button');
  xb.className = 'swatch xtool';
  xb.dataset.tool = String(X);
  xb.setAttribute('aria-label', 'Mark empty (X)');
  xb.innerHTML = ICONS.x;
  xb.addEventListener('click', () => setTool(X));
  wrap.appendChild(xb);
  setTool(state.tool);
}

function setTool(t) {
  state.tool = t;
  view.tool = t;
  document.querySelectorAll('#palette .swatch').forEach((b) => b.classList.toggle('selected', Number(b.dataset.tool) === t));
}

// In lives mode a color that's been placed everywhere it belongs can't be
// selected. If it was the selected one, move to the next color still needed
// (or the X tool when every color is done).
function updatePalette() {
  const g = state.game;
  const K = state.level.palette.length;
  const done = [];
  for (let k = 1; k <= K; k++) done[k] = g.colorDone(k);
  document.querySelectorAll('#palette .swatch').forEach((b) => {
    const t = Number(b.dataset.tool);
    b.disabled = t > 0 && done[t];
  });
  if (state.tool > 0 && done[state.tool]) {
    let next = X;
    for (let step = 1; step < K; step++) {
      const k = ((state.tool - 1 + step) % K) + 1;
      if (!done[k]) { next = k; break; }
    }
    setTool(next);
  }
}

function updateHud() {
  const g = state.game;
  if (!g) return;
  const lives = $('#lives');
  if (g.livesMode) {
    lives.hidden = false;
    lives.innerHTML = Array.from({ length: MAX_LIVES }, (_, k) => `<span class="life${k < g.lives ? '' : ' lost'}">${ICONS.heart}</span>`).join('');
    lives.setAttribute('aria-label', `${g.lives} lives left`);
  } else {
    lives.hidden = true;
  }
  updatePalette();
  $('#hint-count').textContent = String(g.hintsLeft);
  $('#btn-hint').disabled = g.hintsLeft <= 0 || g.won;
  $('#btn-undo').disabled = !g.undoStack.length || g.won;
  const zb = $('#btn-zoom');
  zb.hidden = !view.canZoom();
  $('#zoom-label').textContent = view.isZoomed() ? 'Fit' : 'Zoom';
  $('#menu-lives').checked = g.livesMode;
}

function save() {
  const g = state.game;
  if (!g || g.won) return;
  store.set(`progress.${state.level.id}`, g.serialize());
}

function onEvent(type, data) {
  const g = state.game;
  if (type === 'change') {
    save();
    updateHud();
    view.requestDraw();
  } else if (type === 'error') {
    view.flashCell(data.i, 'error');
    const lives = $('#lives');
    lives.classList.remove('shake');
    void lives.offsetWidth;
    lives.classList.add('shake');
    toast(data.lives > 0 ? `Not quite. ${data.lives} ${data.lives === 1 ? 'life' : 'lives'} left` : 'Out of lives');
  } else if (type === 'hint') {
    const r = Math.floor(data.i / g.w), c = data.i % g.w;
    view.ensureVisible(r, c);
    view.flashCell(data.i, 'hint');
  } else if (type === 'lost') {
    setTimeout(() => openSheet('#lose-sheet'), 450);
  } else if (type === 'won') {
    onWon();
  }
}

function onWon() {
  const g = state.game;
  const lvl = state.level;
  input.reset();
  state.completed.add(lvl.id);
  store.set('completed', [...state.completed]);
  store.del(`progress.${lvl.id}`);
  store.del('current');
  document.body.classList.add('revealing');
  updateHud();
  view.startReveal(() => {
    $('#win-name').textContent = lvl.name;
    const parts = [`${lvl.width}×${lvl.height}`];
    if (g.livesMode) parts.push(`${g.lives}/${MAX_LIVES} lives left`);
    parts.push(g.hintsUsed ? `${g.hintsUsed} hint${g.hintsUsed > 1 ? 's' : ''}` : 'no hints');
    $('#win-stats').textContent = parts.join(' · ');
    $('#btn-next').hidden = !nextLevelId();
    openSheet('#win-sheet');
  });
}

function nextLevelId() {
  const list = state.levels;
  const at = list.findIndex((l) => l.id === state.level.id);
  for (let k = 1; k <= list.length; k++) {
    const l = list[(at + k) % list.length];
    if (!state.completed.has(l.id)) return l.id;
  }
  return null;
}

function goToList() {
  input.reset();
  closeSheets();
  document.body.classList.remove('revealing');
  showScreen('levels');
  renderList();
}

// ---- Controls ----------------------------------------------------------

$('#btn-undo').addEventListener('click', () => {
  if (state.game && !state.game.undo()) toast('Nothing to undo');
});

$('#btn-hint').addEventListener('click', () => {
  const g = state.game;
  if (!g) return;
  if (g.hintsLeft <= 0) return toast('No hints left');
  if (g.hint() == null) toast('Nothing left to reveal');
});

$('#btn-zoom').addEventListener('click', () => {
  if (view.isZoomed()) view.fit();
  else {
    const h = state.game;
    view.focusCell(h.h / 2 - 0.5, h.w / 2 - 0.5, view.playCell());
  }
  updateHud();
});

$('#btn-menu').addEventListener('click', () => openSheet('#menu-sheet'));
$('#menu-close').addEventListener('click', closeSheets);
$('#menu-levels').addEventListener('click', goToList);
$('#menu-restart').addEventListener('click', () => {
  closeSheets();
  if (state.game && confirm('Restart this puzzle? Your progress on it will be cleared.')) state.game.reset();
});
$('#menu-lives').addEventListener('change', (e) => {
  state.settings.livesMode = e.target.checked;
  saveSettings();
  if (state.game) state.game.livesMode = e.target.checked;
  updateHud();
});

$('#btn-next').addEventListener('click', () => {
  document.body.classList.remove('revealing');
  const id = nextLevelId();
  if (id) openPuzzle(id);
  else goToList();
});
$('#win-levels').addEventListener('click', goToList);

$('#lose-retry').addEventListener('click', () => {
  closeSheets();
  state.game.reset();
});
$('#lose-levels').addEventListener('click', () => {
  state.game.reset();
  goToList();
});

$('#hide-solved').addEventListener('change', (e) => {
  state.settings.hideSolved = e.target.checked;
  saveSettings();
  renderList();
});
$('#lives-toggle-list').addEventListener('change', (e) => {
  state.settings.livesMode = e.target.checked;
  saveSettings();
});

// Close a sheet by tapping its backdrop.
document.querySelectorAll('.sheet').forEach((s) => s.addEventListener('click', (e) => {
  if (e.target === s && s.dataset.dismiss !== 'no') closeSheets();
}));

// Keep zoom label in sync with pinch gestures.
$('#board-canvas').addEventListener('pointerup', () => updateHud());

// Safari page gestures off: pinch-zoom of the page, double-tap zoom.
['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault()));
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    input.reset();
    save();
  } else if (swReg) {
    // iOS resumes a home-screen app without reloading it, so check for a
    // new version every time it comes back to the foreground.
    swReg.update().catch(() => {});
  }
});

// ---- Updates ---------------------------------------------------------
// A new version installs in the background (sw.js calls skipWaiting and
// clients.claim). When it takes over, reload so the new code runs right away.
// Progress is saved after every move, so the puzzle resumes where it was.
let swReg = null;
let reloadPending = false;

function setupUpdates() {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js')
    .then((reg) => { swReg = reg; })
    .catch((e) => console.warn('SW registration failed', e));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // first install, nothing to refresh
    reloadPending = true;
    reloadWhenIdle();
  });
}

function reloadWhenIdle() {
  if (!reloadPending) return;
  // Don't interrupt a drag or the win animation; try again shortly.
  if (input.mode === 'paint' || input.mode === 'gesture' || document.body.classList.contains('revealing')) {
    setTimeout(reloadWhenIdle, 1000);
    return;
  }
  reloadPending = false;
  save();
  location.reload();
}

// ---- Boot ----------------------------------------------------------------

async function loadLevels() {
  const res = await fetch('levels/index.json');
  if (!res.ok) throw new Error(`levels/index.json: ${res.status}`);
  const index = await res.json();
  const loaded = await Promise.all(index.levels.map(async (entry) => {
    try {
      const r = await fetch(entry.file);
      return prepareLevel(await r.json());
    } catch (e) {
      console.warn('Could not load level', entry.id, e);
      return null;
    }
  }));
  state.levels = loaded.filter(Boolean);
  state.byId = new Map(state.levels.map((l) => [l.id, l]));
  state.categories = index.categories || [...new Set(state.levels.map((l) => l.category))];
}

async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.has('reset')) store.clearAll();
  try {
    await loadLevels();
  } catch (e) {
    $('#level-grid').innerHTML = '<p class="empty">Could not load puzzles.</p>';
    console.error(e);
  }
  const want = params.get('play') || store.get('current');
  if (want && state.byId.has(want) && (params.get('play') || !state.completed.has(want))) openPuzzle(want);
  else {
    showScreen('levels');
    renderList();
  }
  document.body.classList.add('ready');

  if ('serviceWorker' in navigator && location.protocol !== 'file:') setupUpdates();
}

// Debug hooks (used by automated UI checks; harmless in production).
window.__game = () => state.game;
window.__view = () => view;

$('#app-version').textContent = `Version ${VERSION.slice(0, 6)}`;
boot();
