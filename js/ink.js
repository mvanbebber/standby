// Pencil marks, highlighter, text and stamps. Everything is stored as vectors in page-relative
// coordinates (0..1), so marks stay put at any zoom, orientation or screen size.
import * as db from './db.js';
import { S, saveSettings, esc } from './store.js';

export const COLORS = ['#1f1f1f', '#d32f2f', '#1e63d6', '#1f9a4a', '#8e44c9', '#f08a00'];
const PEN_W = [0.0022, 0.0038, 0.0065];
const HL_W = [0.012, 0.02, 0.032];
const STAMP_S = [0.045, 0.07, 0.1];
const TEXT_S = [0.02, 0.028, 0.04];

// ---------- stamps (drawn in a 100 x 100 box centered on 0,0) ----------
const SERIF = '"Times New Roman", Times, Georgia, serif';
const line = (c, ...pts) => { c.beginPath(); c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.stroke(); };
const dot = (c, x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); };
const txt = (t, style = 'italic bold', size = 72, font = SERIF) => c => {
  c.font = `${style} ${size}px ${font}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(t, 0, 4);
};
export const STAMPS = {
  pp: { name: 'pp', draw: txt('pp') }, p: { name: 'p', draw: txt('p') }, mp: { name: 'mp', draw: txt('mp') },
  mf: { name: 'mf', draw: txt('mf') }, f: { name: 'f', draw: txt('f') }, ff: { name: 'ff', draw: txt('ff') },
  sfz: { name: 'sfz', draw: txt('sfz', 'italic bold', 60) }, fp: { name: 'fp', draw: txt('fp') },
  cresc: { name: 'Crescendo', wide: 1.3, draw: c => { c.lineWidth = 5; line(c, 55, -20, -55, 0, 55, 20); } },
  dim: { name: 'Diminuendo', wide: 1.3, draw: c => { c.lineWidth = 5; line(c, -55, -20, 55, 0, -55, 20); } },
  accent: { name: 'Accent', draw: c => { c.lineWidth = 8; line(c, -35, -22, 35, 0, -35, 22); } },
  marcato: { name: 'Marcato', draw: c => { c.lineWidth = 8; line(c, -24, 26, 0, -28, 24, 26); } },
  staccato: { name: 'Staccato', draw: c => dot(c, 0, 0, 11) },
  tenuto: { name: 'Tenuto', draw: c => { c.lineWidth = 9; line(c, -36, 0, 36, 0); } },
  fermata: { name: 'Fermata', draw: c => { c.lineWidth = 7; c.beginPath(); c.arc(0, 16, 40, Math.PI, 0); c.stroke(); dot(c, 0, 6, 8); } },
  breath: { name: 'Breath', draw: c => { dot(c, 0, -14, 12); c.lineWidth = 7; c.beginPath(); c.moveTo(10, -12); c.quadraticCurveTo(14, 14, -10, 28); c.stroke(); } },
  caesura: { name: 'Caesura', draw: c => { c.lineWidth = 7; line(c, -26, 28, -4, -28); line(c, 6, 28, 28, -28); } },
  upbow: { name: 'Up bow', draw: c => { c.lineWidth = 6; line(c, -22, -30, 0, 30, 22, -30); } },
  downbow: { name: 'Down bow', draw: c => { c.lineWidth = 6; line(c, -28, 30, -28, -26, 28, -26, 28, 30); c.fillRect(-31, -34, 62, 14); } },
  sharp: { name: 'Sharp', draw: txt('♯', '', 86) }, flat: { name: 'Flat', draw: txt('♭', '', 86) }, natural: { name: 'Natural', draw: txt('♮', '', 86) },
  segno: { name: 'Segno', draw: c => {
    c.lineWidth = 7; c.beginPath(); c.moveTo(20, -24); c.bezierCurveTo(10, -42, -26, -36, -20, -12);
    c.bezierCurveTo(-15, 4, 20, -2, 20, 20); c.bezierCurveTo(21, 40, -14, 42, -20, 24); c.stroke();
    c.lineWidth = 5; line(c, -32, 38, 32, -38); dot(c, -30, -4, 7); dot(c, 30, 4, 7);
  } },
  coda: { name: 'Coda', draw: c => { c.lineWidth = 6; c.beginPath(); c.ellipse(0, 0, 22, 30, 0, 0, Math.PI * 2); c.stroke(); c.lineWidth = 5; line(c, 0, -46, 0, 46); line(c, -40, 0, 40, 0); } },
  glasses: { name: 'Watch!', draw: c => {
    c.lineWidth = 6; c.beginPath(); c.arc(-24, 6, 17, 0, Math.PI * 2); c.stroke(); c.beginPath(); c.arc(24, 6, 17, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(-7, 2); c.quadraticCurveTo(0, -6, 7, 2); c.stroke(); line(c, -41, 2, -48, -14); line(c, 41, 2, 48, -14);
  } },
  vs: { name: 'V.S.', draw: txt('V.S.', 'bold', 46) },
  rit: { name: 'rit.', draw: txt('rit.', 'italic', 56) },
  atempo: { name: 'a tempo', wide: 1.6, draw: txt('a tempo', 'italic', 40) },
  cut: { name: 'Cut', draw: c => { c.lineWidth = 6; line(c, -30, -30, 30, 30); line(c, 30, -30, -30, 30); c.beginPath(); c.arc(0, 0, 44, 0, Math.PI * 2); c.stroke(); } },
  arrow: { name: 'Arrow', draw: c => { c.lineWidth = 7; line(c, -44, 0, 40, 0); line(c, 18, -20, 42, 0, 18, 20); } },
  circle: { name: 'Circle', draw: c => { c.lineWidth = 5; c.beginPath(); c.arc(0, 0, 42, 0, Math.PI * 2); c.stroke(); } },
  box: { name: 'Box', wide: 1.2, draw: c => { c.lineWidth = 5; c.strokeRect(-48, -30, 96, 60); } },
  f1: { name: 'Finger 1', draw: txt('1', 'bold', 64, 'system-ui, sans-serif') }, f2: { name: 'Finger 2', draw: txt('2', 'bold', 64, 'system-ui, sans-serif') },
  f3: { name: 'Finger 3', draw: txt('3', 'bold', 64, 'system-ui, sans-serif') }, f4: { name: 'Finger 4', draw: txt('4', 'bold', 64, 'system-ui, sans-serif') },
  f5: { name: 'Finger 5', draw: txt('5', 'bold', 64, 'system-ui, sans-serif') },
};
const GROUPS = [
  ['Dynamics', ['pp', 'p', 'mp', 'mf', 'f', 'ff', 'sfz', 'fp', 'cresc', 'dim']],
  ['Articulation', ['accent', 'marcato', 'staccato', 'tenuto', 'fermata', 'breath', 'caesura', 'upbow', 'downbow']],
  ['Accidentals', ['sharp', 'flat', 'natural']],
  ['Road map & cues', ['segno', 'coda', 'vs', 'rit', 'atempo', 'glasses', 'cut', 'arrow']],
  ['Shapes & fingering', ['circle', 'box', 'f1', 'f2', 'f3', 'f4', 'f5']],
];

export function drawStampIcon(canvas, k, color = '#222') {
  const c = canvas.getContext('2d'), d = devicePixelRatio || 1, sz = canvas.clientWidth || 40;
  canvas.width = canvas.height = Math.round(sz * d);
  c.setTransform(d, 0, 0, d, 0, 0); c.clearRect(0, 0, sz, sz);
  const st = STAMPS[k]; const sc = sz / 100 / (st.wide || 1) * 0.9;
  c.translate(sz / 2, sz / 2); c.scale(sc, sc);
  c.strokeStyle = c.fillStyle = color; c.lineCap = c.lineJoin = 'round';
  st.draw(c);
}

// ---------- marks storage ----------
const marks = new Map();     // sid -> {id, pages:{}}
const saveTimers = new Map();
export async function loadMarks(sid) {
  if (marks.has(sid)) return marks.get(sid);
  const m = (await db.get('marks', sid)) || { id: sid, pages: {} };
  marks.set(sid, m);
  return m;
}
const items = (sid, page) => { const m = marks.get(sid); if (!m) return []; return (m.pages[page] ||= []); };
function save(sid) {
  clearTimeout(saveTimers.get(sid));
  saveTimers.set(sid, setTimeout(() => {
    const m = marks.get(sid);
    for (const k of Object.keys(m.pages)) if (!m.pages[k].length) delete m.pages[k];
    db.put('marks', m);
  }, 300));
}
export function forgetMarks(sid) { marks.delete(sid); }

// ---------- drawing ----------
function strokePath(c, p, W, H) {
  c.beginPath();
  const n = p.length / 2;
  c.moveTo(p[0] * W, p[1] * H);
  if (n === 1) { c.lineTo(p[0] * W + 0.1, p[1] * H); c.stroke(); return; }
  for (let i = 1; i < n - 1; i++) {
    const x = p[2 * i] * W, y = p[2 * i + 1] * H, nx = p[2 * i + 2] * W, ny = p[2 * i + 3] * H;
    c.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
  }
  c.lineTo(p[2 * n - 2] * W, p[2 * n - 1] * H);
  c.stroke();
}
function drawItem(c, it, W, H) {
  c.save();
  c.strokeStyle = c.fillStyle = it.c;
  c.lineCap = c.lineJoin = 'round';
  if (it.t === 'pen' || it.t === 'hl') {
    if (it.t === 'hl') { c.globalAlpha = 0.33; c.lineCap = 'butt'; }
    c.lineWidth = it.w * W;
    strokePath(c, it.p, W, H);
  } else if (it.t === 'st') {
    const st = STAMPS[it.k]; if (st) { c.translate(it.x * W, it.y * H); const s = it.s * W / 100; c.scale(s, s); st.draw(c); }
  } else if (it.t === 'tx' && it.a === 'l') {   // imported note: top-left anchored, several lines
    c.font = `500 ${it.s * W}px -apple-system, system-ui, sans-serif`;
    c.textAlign = 'left'; c.textBaseline = 'top';
    it.v.split('\n').forEach((ln, i) => c.fillText(ln, it.x * W, it.y * H + i * it.s * W * 1.2));
  } else if (it.t === 'tx') {
    c.font = `600 ${it.s * W}px -apple-system, system-ui, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(it.v, it.x * W, it.y * H);
  } else if (it.t === 'img') {   // handwriting imported from forScore (a full-page PNG)
    const bm = bitmap(it);
    if (bm) c.drawImage(bm, 0, 0, W, H);
  }
  c.restore();
}

const bitmaps = new WeakMap();
function bitmap(it) {
  const b = bitmaps.get(it);
  if (b === undefined && it.b instanceof Blob) {
    bitmaps.set(it, null);
    createImageBitmap(it.b).then(bm => { bitmaps.set(it, bm); api?.refresh(); }).catch(() => {});
  }
  return b || null;
}

let live = null;   // {slot, item}
export function drawInk(canvas, sid, page, w, h) {
  const d = Math.min(devicePixelRatio || 1, 3);
  const pw = Math.round(w * d), ph = Math.round(h * d);
  if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
  const c = canvas.getContext('2d');
  c.setTransform(d, 0, 0, d, 0, 0);
  c.clearRect(0, 0, w, h);
  const list = marks.get(sid)?.pages[page] || [];
  const extra = live && live.slot.sid === sid && live.slot.page === page && !list.includes(live.item) ? [live.item] : [];
  const all = list.concat(extra);
  for (const it of all) if (it.t === 'img') drawItem(c, it, w, h);
  for (const it of all) if (it.t === 'hl') drawItem(c, it, w, h);
  for (const it of all) if (it.t !== 'hl' && it.t !== 'img') drawItem(c, it, w, h);
}

// ---------- undo ----------
let undoStack = [], redoStack = [];
function snapshot(sid, page) { undoStack.push({ sid, page, before: items(sid, page).slice() }); if (undoStack.length > 200) undoStack.shift(); redoStack = []; updateBar(); }
function restore(from, to) {
  const e = from.pop(); if (!e) return;
  const m = marks.get(e.sid); if (!m) return;
  to.push({ sid: e.sid, page: e.page, before: (m.pages[e.page] || []).slice() });
  m.pages[e.page] = e.before.slice();
  save(e.sid); api.refresh(); updateBar();
}
export function resetUndo() { undoStack = []; redoStack = []; updateBar(); }

// ---------- pointer handling ----------
let api;           // provided by the viewer: refresh(), inkCanvasFor(slot), askText()
let active = null; // {slot, id, tool, moved}
const R = n => Math.round(n * 10000) / 10000;

function pos(e, slot) {
  const r = slot.paper.getBoundingClientRect();
  return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
}
function redraw(slot) { drawInk(slot.ink, slot.sid, slot.page, slot.w, slot.h); }

function hits(it, x, y, slot) {
  const W = slot.w, H = slot.h, px = x * W, py = y * H;
  if (it.t === 'pen' || it.t === 'hl') {
    const tol = Math.max(it.w * W / 2, 10);
    const p = it.p;
    for (let i = 0; i < p.length; i += 2) {
      const ax = p[i] * W, ay = p[i + 1] * H;
      const bx = (p[i + 2] ?? p[i]) * W, by = (p[i + 3] ?? p[i + 1]) * H;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
      const qx = ax + t * dx - px, qy = ay + t * dy - py;
      if (qx * qx + qy * qy <= tol * tol) return true;
    }
    return false;
  }
  if (it.t === 'img') return false;   // imported handwriting: remove with Clear page
  if (it.t === 'tx' && it.a === 'l') {
    const lines = it.v.split('\n'), fs = it.s * W;
    const wMax = Math.max(...lines.map(l => l.length)) * fs * 0.55;
    return px >= it.x * W - 6 && px <= it.x * W + wMax + 6 && py >= it.y * H - 6 && py <= it.y * H + lines.length * fs * 1.2 + 6;
  }
  const r = it.s * W * (it.t === 'tx' ? 1 : 0.55);
  const rx = it.t === 'tx' ? Math.max(r, it.v.length * it.s * W * 0.3) : r * (STAMPS[it.k]?.wide || 1);
  return Math.abs(px - it.x * W) <= rx + 6 && Math.abs(py - it.y * H) <= r + 6;
}
function erase(slot, x, y) {
  const list = items(slot.sid, slot.page);
  const keep = list.filter(it => !hits(it, x, y, slot));
  if (keep.length !== list.length) { marks.get(slot.sid).pages[slot.page] = keep; redraw(slot); return true; }
  return false;
}

export function down(e, slot, quick) {
  if (active) return;
  let tool = S.settings.tool;
  if (quick && !(tool === 'pen' || tool === 'hl')) tool = 'pen';
  const [x, y] = pos(e, slot);
  const sz = S.settings.size, color = S.settings.color;
  active = { slot, id: e.pointerId, tool, erased: false };
  if (tool === 'pen' || tool === 'hl') {
    const item = { t: tool, c: color, w: (tool === 'pen' ? PEN_W : HL_W)[sz], p: [R(x), R(y)] };
    live = { slot, item }; active.item = item;
    redraw(slot);
  } else if (tool === 'eraser') {
    active.before = items(slot.sid, slot.page).slice();
    active.erased = erase(slot, x, y);
  } else if (tool === 'stamp') {
    const item = { t: 'st', k: S.settings.stamp, c: color, s: STAMP_S[sz], x: R(x), y: R(y) };
    live = { slot, item }; active.item = item;
    redraw(slot);
  } else if (tool === 'text') {
    active.x = x; active.y = y;
  }
}
export function move(e) {
  if (!active || e.pointerId !== active.id) return;
  const { slot, tool } = active;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  if (tool === 'pen' || tool === 'hl') {
    const p = active.item.p;
    for (const ev of evs.length ? evs : [e]) {
      const [x, y] = pos(ev, slot);
      const lx = p[p.length - 2], ly = p[p.length - 1];
      if (Math.abs(x - lx) * slot.w + Math.abs(y - ly) * slot.h < 1.2) continue;
      p.push(R(x), R(y));
    }
    schedule(slot);
  } else if (tool === 'eraser') {
    for (const ev of evs.length ? evs : [e]) { const [x, y] = pos(ev, slot); if (erase(slot, x, y)) active.erased = true; }
  } else if (tool === 'stamp') {
    const [x, y] = pos(e, slot); active.item.x = R(x); active.item.y = R(y); schedule(slot);
  }
}
let raf = 0;
function schedule(slot) { if (!raf) raf = requestAnimationFrame(() => { raf = 0; redraw(slot); }); }

export function up(e) {
  if (!active || e.pointerId !== active.id) return;
  const { slot, tool } = active;
  const a = active; active = null;
  if (tool === 'pen' || tool === 'hl' || tool === 'stamp') {
    live = null;
    snapshot(slot.sid, slot.page);
    items(slot.sid, slot.page).push(a.item);
    save(slot.sid); redraw(slot);
  } else if (tool === 'eraser') {
    if (a.erased) { undoStack.push({ sid: slot.sid, page: slot.page, before: a.before }); redoStack = []; updateBar(); save(slot.sid); }
  } else if (tool === 'text') {
    api.askText().then(v => {
      if (!v) return;
      snapshot(slot.sid, slot.page);
      items(slot.sid, slot.page).push({ t: 'tx', v, c: S.settings.color, s: TEXT_S[S.settings.size], x: R(a.x), y: R(a.y) });
      save(slot.sid); redraw(slot);
    });
  }
}
export function cancel() { if (active) { live = null; const s = active.slot; active = null; redraw(s); } }
export const busy = () => !!active;

// ---------- toolbar ----------
const $ = s => document.querySelector(s);
function updateBar() {
  const bar = $('#drawBar'); if (!bar) return;
  bar.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === S.settings.tool));
  bar.querySelectorAll('[data-size]').forEach(b => b.classList.toggle('on', +b.dataset.size === S.settings.size));
  bar.querySelectorAll('#colors button').forEach(b => b.classList.toggle('on', b.dataset.c === S.settings.color));
  $('#undoBtn').disabled = !undoStack.length;
  $('#redoBtn').disabled = !redoStack.length;
  drawStampIcon($('#stampIcon'), S.settings.stamp, S.settings.tool === 'stamp' ? '#f5a524' : '#c9ced6');
  const hint = { pen: 'Pen: write on the music', hl: 'Highlighter: drag over the music', eraser: 'Eraser: rub over a mark to remove it',
    text: 'Text: tap where the words go', stamp: `Stamp: tap the music to place “${STAMPS[S.settings.stamp].name}” (drag to adjust)` }[S.settings.tool];
  $('#drawHint').textContent = hint;
}
export function setupBar(viewerApi) {
  api = viewerApi;
  $('#colors').innerHTML = COLORS.map(c => `<button data-c="${c}" aria-label="Color"><i style="--c:${c}"></i></button>`).join('');
  $('#drawBar').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tool) {
      if (b.dataset.tool === 'stamp' && S.settings.tool === 'stamp') { toggleStampPicker(); return; }
      S.settings.tool = b.dataset.tool;
      if (b.dataset.tool === 'stamp') toggleStampPicker(true); else toggleStampPicker(false);
    } else if (b.dataset.size) S.settings.size = +b.dataset.size;
    else if (b.dataset.c) S.settings.color = b.dataset.c;
    else if (b.id === 'undoBtn') return restore(undoStack, redoStack);
    else if (b.id === 'redoBtn') return restore(redoStack, undoStack);
    else if (b.id === 'clearBtn') return api.clearPages();
    else return;
    saveSettings(); updateBar();
  });
  const pk = $('#stampPicker');
  pk.innerHTML = GROUPS.map(([g, ks]) => `<h3>${esc(g)}</h3><div class="row">${ks.map(k =>
    `<button data-st="${k}"><canvas></canvas><span>${esc(STAMPS[k].name)}</span></button>`).join('')}</div>`).join('');
  pk.addEventListener('click', e => {
    const b = e.target.closest('[data-st]'); if (!b) return;
    S.settings.stamp = b.dataset.st; S.settings.tool = 'stamp'; saveSettings();
    toggleStampPicker(false); updateBar();
  });
  updateBar();
}
export function toggleStampPicker(force) {
  const pk = $('#stampPicker');
  const show = force ?? pk.hidden;
  pk.hidden = !show;
  if (show) pk.querySelectorAll('[data-st]').forEach(b => { b.classList.toggle('on', b.dataset.st === S.settings.stamp); drawStampIcon(b.querySelector('canvas'), b.dataset.st); });
}
export function clearPage(sid, page) {
  if (!items(sid, page).length) return false;
  snapshot(sid, page); marks.get(sid).pages[page] = []; save(sid); return true;
}
export function hasMarks(sid, page) { return !!marks.get(sid)?.pages[page]?.length; }
export { updateBar };
