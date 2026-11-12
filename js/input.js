// Touch / pointer input for the board.
//
// One finger always paints (never scrolls). Two fingers pinch-zoom and pan.
// A new touch waits a moment (TAP_DELAY) before painting so a second finger
// arriving for a pinch doesn't leave a stray mark; moving to another cell or
// lifting the finger paints immediately.

const TAP_DELAY = 80;
const LOUPE_DELAY = 160;

export class BoardInput {
  constructor(canvas, view, handlers) {
    this.canvas = canvas;
    this.view = view;
    this.h = handlers; // { enabled(), begin(r,c), move(r,c) -> {r,c}, end() }
    this.pointers = new Map();
    this.mode = 'idle'; // idle | pending | paint | gesture | tail | outside
    this.pending = null;
    this.timer = 0;
    this.loupeTimer = 0;

    const opt = { passive: false };
    canvas.addEventListener('pointerdown', (e) => this.down(e), opt);
    canvas.addEventListener('pointermove', (e) => this.move(e), opt);
    canvas.addEventListener('pointerup', (e) => this.up(e), opt);
    canvas.addEventListener('pointercancel', (e) => this.up(e), opt);
    canvas.addEventListener('lostpointercapture', (e) => this.up(e), opt);
    // Block Safari's own gestures (scroll, double-tap zoom, swipe-back,
    // callouts) over the board.
    const block = (e) => e.preventDefault();
    canvas.addEventListener('touchstart', block, opt);
    canvas.addEventListener('touchmove', block, opt);
    canvas.addEventListener('contextmenu', block);
    canvas.addEventListener('wheel', (e) => this.wheel(e), opt);
  }

  pt(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  down(e) {
    e.preventDefault();
    if (!this.h.enabled()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = this.pt(e);
    this.pointers.set(e.pointerId, p);
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }

    if (this.pointers.size === 1) {
      const mm = this.view.minimapHit(p.x, p.y);
      if (mm) {
        this.mode = 'outside';
        this.view.focusCell(mm.r, mm.c);
        return;
      }
      const hit = this.view.hitCell(p.x, p.y);
      if (hit) {
        this.mode = 'pending';
        this.pending = { ...hit, id: e.pointerId, x: p.x, y: p.y };
        this.view.setHighlight(hit);
        this.timer = setTimeout(() => this.commitPending(), TAP_DELAY);
      } else {
        this.mode = 'outside';
      }
    } else if (this.pointers.size === 2) {
      if (this.mode === 'pending') this.cancelPending();
      else if (this.mode === 'paint') this.endPaint();
      this.startGesture();
    }
  }

  commitPending() {
    if (this.mode !== 'pending') return;
    clearTimeout(this.timer);
    const p = this.pending;
    this.mode = 'paint';
    this.paintId = p.id;
    this.h.begin(p.r, p.c);
    const last = this.pointers.get(p.id) || p;
    this.loupeTimer = setTimeout(() => this.showLoupe(), LOUPE_DELAY);
    this.paintTo(last);
  }

  cancelPending() {
    clearTimeout(this.timer);
    this.pending = null;
    this.view.setHighlight(null);
  }

  showLoupe() {
    if (this.mode !== 'paint') return;
    const p = this.pointers.get(this.paintId);
    if (!p) return;
    const cell = this.view.cellAtClamped(p.x, p.y);
    this.view.setLoupe({ x: p.x, y: p.y, ...cell });
  }

  paintTo(p) {
    const cell = this.view.cellAtClamped(p.x, p.y);
    const end = this.h.move(cell.r, cell.c) || cell;
    this.view.setHighlight(end);
    if (this.view.loupe) this.view.setLoupe({ x: p.x, y: p.y, ...cell });
  }

  endPaint() {
    clearTimeout(this.loupeTimer);
    if (this.mode === 'paint') this.h.end();
    this.mode = 'idle';
    this.view.setLoupe(null);
    this.view.setHighlight(null);
  }

  move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    e.preventDefault();
    const p = this.pt(e);
    this.pointers.set(e.pointerId, p);
    if (this.mode === 'pending' && e.pointerId === this.pending.id) {
      const cell = this.view.cellAtClamped(p.x, p.y);
      if (cell.r !== this.pending.r || cell.c !== this.pending.c) this.commitPending();
    } else if (this.mode === 'paint' && e.pointerId === this.paintId) {
      this.paintTo(p);
      if (!this.view.loupe) this.showLoupe();
    } else if (this.mode === 'gesture') {
      this.updateGesture();
    }
  }

  up(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.mode === 'pending' && this.pending && e.pointerId === this.pending.id) {
      this.commitPending();
      this.endPaint();
    } else if (this.mode === 'paint' && e.pointerId === this.paintId) {
      this.endPaint();
    } else if (this.mode === 'gesture' && this.pointers.size < 2) {
      // Remaining finger is ignored until it lifts, so it can't paint.
      this.mode = this.pointers.size ? 'tail' : 'idle';
    }
    if (this.pointers.size === 0) {
      if (this.mode === 'paint') this.endPaint();
      this.mode = 'idle';
      this.view.setHighlight(null);
    }
  }

  // Abort everything (e.g. when the board is hidden mid-touch).
  reset() {
    if (this.mode === 'paint') this.endPaint();
    clearTimeout(this.timer);
    this.pointers.clear();
    this.mode = 'idle';
  }

  startGesture() {
    const [a, b] = [...this.pointers.values()];
    const v = this.view.view;
    this.g = {
      d0: Math.max(10, Math.hypot(b.x - a.x, b.y - a.y)),
      m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      cell0: v.cell,
      ox0: v.ox,
      oy0: v.oy,
    };
    this.mode = 'gesture';
    this.view.setHighlight(null);
    this.view.setLoupe(null);
  }

  updateGesture() {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return;
    const g = this.g;
    const d = Math.max(10, Math.hypot(b.x - a.x, b.y - a.y));
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const L = this.view.L;
    const cell = Math.max(L.minCell, Math.min(L.maxCell, (g.cell0 * d) / g.d0));
    const gx = (g.m0.x - g.ox0) / g.cell0;
    const gy = (g.m0.y - g.oy0) / g.cell0;
    this.view.setView(cell, m.x - gx * cell, m.y - gy * cell);
  }

  // Desktop testing: ctrl/pinch-wheel zooms, plain wheel pans.
  wheel(e) {
    e.preventDefault();
    if (!this.h.enabled()) return;
    const p = this.pt(e);
    if (e.ctrlKey) this.view.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.01));
    else this.view.panBy(-e.deltaX, -e.deltaY);
  }
}
