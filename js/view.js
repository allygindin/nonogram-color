// Canvas renderer for the puzzle board: grid, pinned clues, zoom/pan view,
// finger magnifier, overview map, and the win reveal.

import { X, F_ERROR, F_HINT } from './game.js';
import { contrast, CLUE_BG, CELL_BG } from './color.js';

const FONT_FAMILY = '"Avenir Next Condensed", "Arial Narrow", "Roboto Condensed", system-ui, sans-serif';
const font = (px) => `700 ${px}px ${FONT_FAMILY}`;

const COLORS = {
  page: '#f8f4ec',
  clueBg: CLUE_BG,
  cell: CELL_BG,
  thin: '#d8d0c2',
  major: '#7a7266',
  border: '#3b3832',
  x: '#9a9184',
  solvedClue: '#c3baab',
  zero: '#9a9184',
  highlight: 'rgba(58, 134, 255, 0.14)',
  highlightClue: 'rgba(58, 134, 255, 0.18)',
  error: '#e5383b',
};

const MARGIN = 8;
const MIN_PLAY_CELL = 30;

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class BoardView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = null;
    this.size = { W: 0, H: 0 };
    this.dpr = 1;
    this.view = { cell: 20, ox: 0, oy: 0 };
    this.highlight = null; // { r, c }
    this.loupe = null; // { x, y, r, c }
    this.flashes = []; // { i, start, kind }
    this.reveal = null;
    this.confetti = [];
    this.tool = 1;
    this.pending = false;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement);
  }

  setGame(game) {
    this.game = game;
    this.reveal = null;
    this.confetti = [];
    this.flashes = [];
    this.highlight = null;
    this.loupe = null;
    this.prepPalette();
    this.resize(true);
  }

  prepPalette() {
    const pal = this.game.level.palette;
    // Light colors get a dark outline on clue numbers so they stay readable.
    this.outline = pal.map((p) => contrast(p, COLORS.clueBg) < 2.4);
    this.inkOnColor = pal.map((p) => (contrast(p, '#ffffff') < 2.2 ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.9)'));
  }

  resize(refit = false) {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const W = Math.max(1, Math.round(rect.width));
    const H = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const changed = W !== this.size.W || H !== this.size.H || dpr !== this.dpr;
    if (!changed && !refit) return;
    this.size = { W, H };
    this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;
    if (this.game) {
      const wasZoomed = this.isZoomed();
      const prev = { ...this.view };
      this.computeLayout();
      if (refit || !wasZoomed) this.fit();
      else this.setView(prev.cell, prev.ox, prev.oy);
    }
    this.requestDraw();
  }

  // ---- Layout ------------------------------------------------------------

  measureRow(clue, px) {
    const ctx = this.ctx;
    ctx.font = font(px);
    if (!clue.length) return ctx.measureText('0').width;
    const gap = px * 0.42;
    let w = 0;
    for (const b of clue) w += ctx.measureText(String(b.len)).width;
    return w + gap * (clue.length - 1);
  }

  computeLayout() {
    const { W, H } = this.size;
    const { width: cols, height: rows, clues } = this.game.level;
    let px = 14;
    let L;
    for (let pass = 0; pass < 3; pass++) {
      const rowW = clues.rows.map((cl) => this.measureRow(cl, px));
      const pad = px * 0.9;
      const lineH = px * 1.16;
      const colBlocks = clues.cols.map((cl) => Math.max(1, cl.length));
      const rowClueW = Math.min(Math.max(...rowW) + pad, W * 0.42);
      const colClueH = Math.min(Math.max(...colBlocks) * lineH + pad * 0.7, H * 0.36);
      let fitCell = Math.min((W - 2 * MARGIN - rowClueW) / cols, (H - 2 * MARGIN - colClueH) / rows);
      fitCell = Math.max(4, Math.min(fitCell, 64));
      L = { px, pad, lineH, rowW, colBlocks, rowClueW, colClueH, fitCell };
      px = clamp(Math.max(fitCell, 28) * 0.5, 11, 16);
      if (Math.abs(px - L.px) < 0.25) break;
    }
    const left = Math.max(MARGIN, (W - (L.rowClueW + cols * L.fitCell)) / 2);
    // Sit a little below center: closer to the thumb for one-handed play.
    const top = Math.max(MARGIN, (H - (L.colClueH + rows * L.fitCell)) * 0.62);
    L.left = left;
    L.top = top;
    L.vp = {
      x: left + L.rowClueW,
      y: top + L.colClueH,
      w: W - MARGIN - (left + L.rowClueW),
      h: H - MARGIN - (top + L.colClueH),
    };
    L.minCell = L.fitCell;
    L.maxCell = Math.max(L.fitCell, 52);
    // Per-line shrink factors for clues with many blocks.
    L.rowScale = L.rowW.map((w) => Math.min(1, (L.rowClueW - L.pad * 0.8) / Math.max(1, w)));
    L.colScale = L.colBlocks.map((k) => Math.min(1, (L.colClueH - L.pad * 0.5) / (k * L.lineH)));
    this.L = L;
  }

  fit() {
    const L = this.L;
    this.view = { cell: L.fitCell, ox: L.vp.x, oy: L.vp.y };
    this.clampView();
    this.requestDraw();
  }

  isZoomed() {
    return !!this.L && this.view.cell > this.L.fitCell * 1.02;
  }

  gridSize() {
    const { width, height } = this.game.level;
    return { gw: width * this.view.cell, gh: height * this.view.cell };
  }

  // Large puzzles can be zoomed; ≤10x10 already fit.
  canZoom() {
    return this.L && this.L.maxCell > this.L.fitCell * 1.05;
  }

  // Default zoom for large puzzles: comfortable cell size for play.
  playCell() {
    return clamp(Math.max(MIN_PLAY_CELL, 36), this.L.fitCell, this.L.maxCell);
  }

  setView(cell, ox, oy) {
    this.view = { cell: clamp(cell, this.L.minCell, this.L.maxCell), ox, oy };
    this.clampView();
    this.requestDraw();
  }

  // Zoom by factor around a screen point.
  zoomAt(x, y, factor) {
    const v = this.view;
    const cell = clamp(v.cell * factor, this.L.minCell, this.L.maxCell);
    const gx = (x - v.ox) / v.cell;
    const gy = (y - v.oy) / v.cell;
    this.setView(cell, x - gx * cell, y - gy * cell);
  }

  panBy(dx, dy) {
    this.setView(this.view.cell, this.view.ox + dx, this.view.oy + dy);
  }

  clampView() {
    const { vp } = this.L;
    const { gw, gh } = this.gridSize();
    const v = this.view;
    v.ox = gw <= vp.w ? vp.x : clamp(v.ox, vp.x + vp.w - gw, vp.x);
    v.oy = gh <= vp.h ? vp.y : clamp(v.oy, vp.y + vp.h - gh, vp.y);
  }

  // Zooms to a comfortable size centered on a cell (used by hints / zoom button).
  focusCell(r, c, cell = this.view.cell) {
    const { vp } = this.L;
    cell = clamp(cell, this.L.minCell, this.L.maxCell);
    this.setView(cell, vp.x + vp.w / 2 - (c + 0.5) * cell, vp.y + vp.h / 2 - (r + 0.5) * cell);
  }

  ensureVisible(r, c) {
    const v = this.view;
    const { vp } = this.L;
    const x = v.ox + (c + 0.5) * v.cell;
    const y = v.oy + (r + 0.5) * v.cell;
    if (x < vp.x || x > vp.x + vp.w || y < vp.y || y > vp.y + vp.h) this.focusCell(r, c);
  }

  // ---- Hit testing ---------------------------------------------------------

  inGridViewport(x, y) {
    const { vp } = this.L;
    const { gw, gh } = this.gridSize();
    const v = this.view;
    const x0 = Math.max(vp.x, v.ox), y0 = Math.max(vp.y, v.oy);
    const x1 = Math.min(vp.x + vp.w, v.ox + gw), y1 = Math.min(vp.y + vp.h, v.oy + gh);
    return x >= x0 && x < x1 && y >= y0 && y < y1;
  }

  // Cell under a point, or null if the point is not over the visible grid.
  hitCell(x, y) {
    if (!this.game || !this.inGridViewport(x, y)) return null;
    return this.cellAtClamped(x, y);
  }

  cellAtClamped(x, y) {
    const v = this.view;
    const { width, height } = this.game.level;
    return {
      r: clamp(Math.floor((y - v.oy) / v.cell), 0, height - 1),
      c: clamp(Math.floor((x - v.ox) / v.cell), 0, width - 1),
    };
  }

  // Point inside the overview map → grid coordinates (for tap-to-jump).
  minimapHit(x, y) {
    const m = this.minimapRect;
    if (!m || x < m.x || y < m.y || x > m.x + m.w || y > m.y + m.h) return null;
    return { r: (y - m.y) / m.s, c: (x - m.x) / m.s };
  }

  // ---- Effects -------------------------------------------------------------

  setHighlight(h) {
    this.highlight = h;
    this.requestDraw();
  }

  setLoupe(l) {
    this.loupe = l;
    this.requestDraw();
  }

  flashCell(i, kind) {
    this.flashes.push({ i, kind, start: performance.now() });
    this.requestDraw();
  }

  // Win reveal: fade grid lines, X's and clues, then move the picture to the
  // center at full size and throw confetti.
  startReveal(onDone) {
    const { W, H } = this.size;
    const { width, height } = this.game.level;
    // Leave room at the bottom for the win sheet.
    const avail = H - 130;
    const cell = Math.min((W - 40) / width, (avail - 30) / height, 48);
    this.reveal = {
      start: performance.now(),
      from: { ...this.view },
      to: { cell, ox: (W - width * cell) / 2, oy: Math.max(10, (avail - height * cell) / 2) },
      done: false,
      confettiFired: false,
    };
    // Timer-driven (not frame-driven) so the win sheet always appears.
    setTimeout(() => onDone && onDone(), 1500);
    this.highlight = null;
    this.loupe = null;
    this.requestDraw();
  }

  fireConfetti() {
    const { W, H } = this.size;
    const colors = this.game.level.palette.concat(['#ffd166', '#06d6a0', '#118ab2']);
    for (let k = 0; k < 140; k++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
      const sp = 5 + Math.random() * 9;
      this.confetti.push({
        x: W / 2 + (Math.random() - 0.5) * 60,
        y: H * 0.62,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.4,
        size: 5 + Math.random() * 6,
        color: colors[k % colors.length],
        life: 1,
      });
    }
  }

  // ---- Drawing -------------------------------------------------------------

  requestDraw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  snap(v) {
    return Math.round(v * this.dpr) / this.dpr;
  }

  draw() {
    if (!this.game) return;
    const ctx = this.ctx;
    const { W, H } = this.size;
    const now = performance.now();
    let animating = false;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COLORS.page;
    ctx.fillRect(0, 0, W, H);

    let fade = 1; // 1 = normal; 0 = lines/clues fully faded (win)
    let view = this.view;
    if (this.reveal) {
      const t = (now - this.reveal.start) / 1500;
      fade = 1 - clamp(t / 0.35, 0, 1);
      const m = easeInOut(clamp((t - 0.25) / 0.6, 0, 1));
      const a = this.reveal.from, b = this.reveal.to;
      view = { cell: a.cell + (b.cell - a.cell) * m, ox: a.ox + (b.ox - a.ox) * m, oy: a.oy + (b.oy - a.oy) * m };
      if (t >= 0.7 && !this.reveal.confettiFired) {
        this.reveal.confettiFired = true;
        this.fireConfetti();
      }
      if (t < 1) animating = true;
    }

    const { vp } = this.L;
    if (this.reveal) {
      this.drawCells(ctx, view, null, fade);
      if (fade > 0) {
        ctx.globalAlpha = fade;
        this.drawClues(ctx, view);
        ctx.globalAlpha = 1;
      }
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.rect(vp.x, vp.y, vp.w, vp.h);
      ctx.clip();
      this.drawCells(ctx, view, this.highlight, 1);
      animating = this.drawFlashes(ctx, view, now) || animating;
      ctx.restore();
      this.drawClues(ctx, view);
      this.drawMinimap(ctx);
      if (this.loupe) this.drawLoupe(ctx);
    }

    if (this.confetti.length) {
      animating = true;
      this.drawConfetti(ctx);
    }
    if (animating) this.requestDraw();
  }

  visibleRange(view, w, h, x0, y0, x1, y1) {
    return {
      c0: clamp(Math.floor((x0 - view.ox) / view.cell), 0, w - 1),
      c1: clamp(Math.ceil((x1 - view.ox) / view.cell), 0, w),
      r0: clamp(Math.floor((y0 - view.oy) / view.cell), 0, h - 1),
      r1: clamp(Math.ceil((y1 - view.oy) / view.cell), 0, h),
    };
  }

  // Draws cells + grid lines for the given view. `fade` < 1 during the win
  // reveal fades empty cells, X marks and grid lines away.
  drawCells(ctx, view, hl, fade, bounds) {
    const g = this.game;
    const { width: w, height: h, palette } = g.level;
    const { W, H } = this.size;
    const b = bounds || { x0: 0, y0: 0, x1: W, y1: H };
    const { r0, r1, c0, c1 } = this.visibleRange(view, w, h, b.x0, b.y0, b.x1, b.y1);
    const cell = view.cell;
    const xs = [];
    const ys = [];
    for (let c = c0; c <= c1; c++) xs[c] = this.snap(view.ox + c * cell);
    for (let r = r0; r <= r1; r++) ys[r] = this.snap(view.oy + r * cell);

    // Empty background.
    if (fade > 0) {
      ctx.globalAlpha = fade;
      ctx.fillStyle = COLORS.cell;
      ctx.fillRect(xs[c0], ys[r0], xs[c1] - xs[c0], ys[r1] - ys[r0]);
      ctx.globalAlpha = 1;
    }

    // Row / column highlight while touching (under the fills, so colors stay true).
    if (hl && fade === 1) {
      ctx.fillStyle = COLORS.highlight;
      if (hl.r >= r0 && hl.r < r1) ctx.fillRect(xs[c0], ys[hl.r], xs[c1] - xs[c0], ys[hl.r + 1] - ys[hl.r]);
      if (hl.c >= c0 && hl.c < c1) ctx.fillRect(xs[hl.c], ys[r0], xs[hl.c + 1] - xs[hl.c], ys[r1] - ys[r0]);
    }

    // Filled cells.
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        const v = g.cells[r * w + c];
        if (v > 0) {
          ctx.fillStyle = palette[v - 1];
          ctx.fillRect(xs[c], ys[r], xs[c + 1] - xs[c], ys[r + 1] - ys[r]);
        }
      }
    }

    // Marks: X, errors, hints.
    if (fade > 0) {
      ctx.globalAlpha = fade;
      ctx.lineCap = 'round';
      const inset = cell * 0.28;
      for (let r = r0; r < r1; r++) {
        for (let c = c0; c < c1; c++) {
          const i = r * w + c;
          const v = g.cells[i];
          const f = g.flags[i];
          const x = xs[c], y = ys[r], s = xs[c + 1] - x;
          if (v === X) {
            ctx.strokeStyle = f & F_ERROR ? COLORS.error : COLORS.x;
            ctx.lineWidth = Math.max(1.2, cell * (f & F_ERROR ? 0.1 : 0.07));
            ctx.beginPath();
            ctx.moveTo(x + inset, y + inset);
            ctx.lineTo(x + s - inset, y + s - inset);
            ctx.moveTo(x + s - inset, y + inset);
            ctx.lineTo(x + inset, y + s - inset);
            ctx.stroke();
          } else if (v > 0 && f & F_ERROR) {
            // Wrong guess: shown with the correct color and a red corner.
            ctx.fillStyle = COLORS.error;
            ctx.beginPath();
            ctx.moveTo(x + s, y);
            ctx.lineTo(x + s, y + s * 0.42);
            ctx.lineTo(x + s - s * 0.42, y);
            ctx.closePath();
            ctx.fill();
          }
          if (f & F_HINT) {
            ctx.fillStyle = v > 0 ? this.inkOnColor[v - 1] : '#3a86ff';
            const d = Math.max(2, cell * 0.09);
            ctx.beginPath();
            ctx.arc(x + s / 2, y + s / 2, d, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    // Grid lines.
    if (fade > 0) {
      ctx.globalAlpha = fade;
      const thin = Math.max(1 / this.dpr, cell > 14 ? 1 : 0.5);
      ctx.fillStyle = COLORS.thin;
      for (let c = c0; c <= c1; c++) if (c % 5) ctx.fillRect(xs[c] - thin / 2, ys[r0], thin, ys[r1] - ys[r0]);
      for (let r = r0; r <= r1; r++) if (r % 5) ctx.fillRect(xs[c0], ys[r] - thin / 2, xs[c1] - xs[c0], thin);
      ctx.fillStyle = COLORS.major;
      const maj = Math.max(1.5, thin * 1.6);
      for (let c = c0; c <= c1; c++) if (c % 5 === 0 && c !== 0 && c !== w) ctx.fillRect(xs[c] - maj / 2, ys[r0], maj, ys[r1] - ys[r0]);
      for (let r = r0; r <= r1; r++) if (r % 5 === 0 && r !== 0 && r !== h) ctx.fillRect(xs[c0], ys[r] - maj / 2, xs[c1] - xs[c0], maj);
      // Outer border.
      ctx.strokeStyle = COLORS.border;
      ctx.lineWidth = 2;
      ctx.strokeRect(this.snap(view.ox), this.snap(view.oy), this.snap(w * cell), this.snap(h * cell));
      ctx.globalAlpha = 1;
    }
  }

  drawFlashes(ctx, view, now) {
    if (!this.flashes.length) return false;
    const w = this.game.level.width;
    this.flashes = this.flashes.filter((f) => now - f.start < 700);
    for (const f of this.flashes) {
      const t = (now - f.start) / 700;
      const r = Math.floor(f.i / w), c = f.i % w;
      const x = view.ox + c * view.cell, y = view.oy + r * view.cell;
      const grow = (1 - t) * view.cell * 0.25;
      ctx.strokeStyle = f.kind === 'error' ? COLORS.error : '#3a86ff';
      ctx.globalAlpha = 1 - t;
      ctx.lineWidth = 3;
      ctx.strokeRect(x - grow, y - grow, view.cell + grow * 2, view.cell + grow * 2);
      ctx.globalAlpha = 1;
    }
    return this.flashes.length > 0;
  }

  clueColor(color, solved) {
    return solved ? COLORS.solvedClue : this.game.level.palette[color - 1];
  }

  drawNumber(ctx, text, x, y, color, solved, px) {
    if (!solved && this.outline[color - 1]) {
      ctx.lineWidth = Math.max(2, px * 0.16);
      ctx.strokeStyle = 'rgba(40, 36, 30, 0.75)';
      ctx.lineJoin = 'round';
      ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = this.clueColor(color, solved);
    ctx.fillText(text, x, y);
  }

  drawClues(ctx, view) {
    const g = this.game;
    const L = this.L;
    const { width: w, height: h, clues } = g.level;
    const { vp } = L;
    const cell = view.cell;
    const hl = this.reveal ? null : this.highlight;
    const colTop = L.top;
    const rowLeft = L.left;

    // ---- Column clues (pinned to the top) ----
    ctx.save();
    ctx.beginPath();
    const cx0 = this.reveal ? 0 : vp.x;
    const cw = this.reveal ? this.size.W : vp.w;
    ctx.rect(cx0, colTop, cw, L.colClueH);
    ctx.clip();
    const cr = this.visibleRange(view, w, h, vp.x, 0, vp.x + vp.w, 1);
    const x0 = Math.max(view.ox + cr.c0 * cell, cx0);
    const x1 = Math.min(view.ox + cr.c1 * cell, cx0 + cw);
    ctx.fillStyle = COLORS.clueBg;
    ctx.fillRect(x0, colTop, x1 - x0, L.colClueH);
    if (hl) {
      ctx.fillStyle = COLORS.highlightClue;
      ctx.fillRect(view.ox + hl.c * cell, colTop, cell, L.colClueH);
    }
    ctx.fillStyle = COLORS.thin;
    for (let c = cr.c0; c <= cr.c1; c++) {
      const x = this.snap(view.ox + c * cell);
      ctx.fillStyle = c % 5 === 0 ? 'rgba(122,114,102,0.45)' : 'rgba(216,208,194,0.8)';
      ctx.fillRect(x - 0.5, colTop, 1, L.colClueH);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const bottom = vp.y - L.pad * 0.35;
    for (let c = cr.c0; c < cr.c1; c++) {
      const clue = clues.cols[c];
      const solved = g.colSolved[c] === 1;
      const k = Math.max(1, clue.length);
      const lh = L.lineH * L.colScale[c];
      const px = Math.min(L.px * L.colScale[c], cell * 0.66);
      ctx.font = font(px);
      const x = view.ox + (c + 0.5) * cell;
      if (!clue.length) {
        ctx.fillStyle = solved ? COLORS.solvedClue : COLORS.zero;
        ctx.fillText('0', x, bottom - lh / 2);
        continue;
      }
      for (let j = 0; j < k; j++) {
        const y = bottom - (k - j - 0.5) * lh;
        this.drawNumber(ctx, String(clue[j].len), x, y, clue[j].color, solved || g.colDone[c][j] === 1, px);
      }
    }
    ctx.restore();

    // ---- Row clues (pinned to the left) ----
    ctx.save();
    ctx.beginPath();
    const ry0 = this.reveal ? 0 : vp.y;
    const rh = this.reveal ? this.size.H : vp.h;
    ctx.rect(rowLeft, ry0, L.rowClueW, rh);
    ctx.clip();
    const rr = this.visibleRange(view, w, h, 0, vp.y, 1, vp.y + vp.h);
    const y0 = Math.max(view.oy + rr.r0 * cell, ry0);
    const y1 = Math.min(view.oy + rr.r1 * cell, ry0 + rh);
    ctx.fillStyle = COLORS.clueBg;
    ctx.fillRect(rowLeft, y0, L.rowClueW, y1 - y0);
    if (hl) {
      ctx.fillStyle = COLORS.highlightClue;
      ctx.fillRect(rowLeft, view.oy + hl.r * cell, L.rowClueW, cell);
    }
    for (let r = rr.r0; r <= rr.r1; r++) {
      const y = this.snap(view.oy + r * cell);
      ctx.fillStyle = r % 5 === 0 ? 'rgba(122,114,102,0.45)' : 'rgba(216,208,194,0.8)';
      ctx.fillRect(rowLeft, y - 0.5, L.rowClueW, 1);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const right = vp.x - L.pad * 0.4;
    for (let r = rr.r0; r < rr.r1; r++) {
      const clue = clues.rows[r];
      const solved = g.rowSolved[r] === 1;
      const px = Math.min(L.px * L.rowScale[r], cell * 0.72);
      ctx.font = font(px);
      const y = view.oy + (r + 0.5) * cell;
      if (!clue.length) {
        ctx.fillStyle = solved ? COLORS.solvedClue : COLORS.zero;
        ctx.fillText('0', right, y);
        continue;
      }
      const gap = px * 0.42;
      let x = right;
      for (let j = clue.length - 1; j >= 0; j--) {
        const t = String(clue[j].len);
        this.drawNumber(ctx, t, x, y, clue[j].color, solved || g.rowDone[r][j] === 1, px);
        x -= ctx.measureText(t).width + gap;
      }
    }
    ctx.restore();
  }

  // Overview map in the top-left corner (between the clue panels) when the
  // grid is larger than the viewport.
  drawMinimap(ctx) {
    this.minimapRect = null;
    const { gw, gh } = this.gridSize();
    const L = this.L;
    if (gw <= L.vp.w + 1 && gh <= L.vp.h + 1) return;
    const g = this.game;
    const { width: w, height: h, palette } = g.level;
    let boxW = L.rowClueW - 8, boxH = L.colClueH - 8, bx = L.left + 4, by = L.top + 4;
    if (boxW < 40 || boxH < 40) {
      // Corner too small: float it over the grid's bottom-right instead.
      boxW = boxH = 72;
      bx = L.vp.x + L.vp.w - boxW - 6;
      by = L.vp.y + L.vp.h - boxH - 6;
    }
    const s = Math.min(boxW / w, boxH / h);
    const mw = w * s, mh = h * s;
    const mx = bx + (boxW - mw) / 2, my = by + (boxH - mh) / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillRect(mx - 2, my - 2, mw + 4, mh + 4);
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const v = g.cells[r * w + c];
        if (v > 0) {
          ctx.fillStyle = palette[v - 1];
          ctx.fillRect(mx + c * s, my + r * s, Math.ceil(s), Math.ceil(s));
        }
      }
    }
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(mx - 1.5, my - 1.5, mw + 3, mh + 3);
    const v = this.view;
    const vx = (L.vp.x - v.ox) / v.cell, vy = (L.vp.y - v.oy) / v.cell;
    const vw = Math.min(w, L.vp.w / v.cell), vh = Math.min(h, L.vp.h / v.cell);
    ctx.strokeStyle = '#3a86ff';
    ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(58,134,255,0.12)';
    ctx.fillRect(mx + Math.max(0, vx) * s, my + Math.max(0, vy) * s, vw * s, vh * s);
    ctx.strokeRect(mx + Math.max(0, vx) * s, my + Math.max(0, vy) * s, vw * s, vh * s);
    this.minimapRect = { x: mx, y: my, w: mw, h: mh, s };
  }

  // Enlarged view of the cells under the finger, drawn above it.
  drawLoupe(ctx) {
    const { x, y, r, c } = this.loupe;
    const { W } = this.size;
    const R = 50;
    let cx = x, cy = y - 96;
    if (cy - R < 4) {
      cy = Math.max(R + 4, y - 30);
      cx = x < W / 2 ? x + 100 : x - 100;
    }
    cx = clamp(cx, R + 4, W - R - 4);
    const v = this.view;
    const lc = Math.max(v.cell * 1.7, (2 * R) / 3.4);
    const gx = (x - v.ox) / v.cell, gy = (y - v.oy) / v.cell;
    const lv = { cell: lc, ox: cx - gx * lc, oy: cy - gy * lc };

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.page;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    this.drawCells(ctx, lv, this.highlight, 1, { x0: cx - R, y0: cy - R, x1: cx + R, y1: cy + R });
    // Outline the active cell in the current tool's color.
    const tc = this.tool > 0 ? this.game.level.palette[this.tool - 1] : COLORS.border;
    ctx.strokeStyle = tc;
    ctx.lineWidth = 3;
    ctx.strokeRect(lv.ox + c * lc + 1.5, lv.oy + r * lc + 1.5, lc - 3, lc - 3);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  drawConfetti(ctx) {
    const { H } = this.size;
    for (const p of this.confetti) {
      p.vy += 0.28;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life -= 0.006;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    this.confetti = this.confetti.filter((p) => p.life > 0 && p.y < H + 40);
  }
}
