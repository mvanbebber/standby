// Full-screen reader: page turns, setlist flow, Draw mode.
import * as R from './render.js';
import * as ink from './ink.js';
import { S, saveSettings, esc } from './store.js';
import * as ui from './ui.js';

const $ = s => document.querySelector(s);
const viewer = $('#viewer'), stage = $('#stage');

const V = { half: false, open: false, ids: [], idx: 0, page: 1, name: '', drawing: false, gen: 0, slots: [], onClose: null };
const sid = () => V.ids[V.idx];
const score = () => S.scores.get(sid());
const dpr = () => Math.min(devicePixelRatio || 1, 3);

function geom() {
  const W = stage.clientWidth, H = stage.clientHeight;
  const two = S.settings.twoUp && !S.settings.halfTurns && W > H && W >= 700;
  return { W, H, two, bw: two ? Math.floor(W / 2) : W, bh: H };
}
const step = () => (geom().two ? 2 : 1);
const lastStart = n => (geom().two ? 1 + 2 * Math.floor((n - 1) / 2) : n);
const halfOn = () => S.settings.halfTurns && !V.drawing && !geom().two;
// What the top half shows during a half-page turn: the next page, or the next song's first page.
function halfTarget() {
  const n = score().pageCount || 1;
  if (V.page < n) return { id: sid(), p: V.page + 1 };
  const nx = V.ids[V.idx + 1];
  return nx ? { id: nx, p: 1 } : null;
}

// ---------- open / close ----------
export function openViewer({ ids, idx = 0, page = 1, name = '', onClose }) {
  V.ids = ids.filter(id => S.scores.has(id));
  if (!V.ids.length) return;
  Object.assign(V, { half: false, open: true, idx: Math.min(idx, V.ids.length - 1), page, name, onClose });
  viewer.hidden = false;
  viewer.classList.toggle('night', !!S.settings.night);
  setDrawing(false);
  ink.resetUndo();
  showBars(true);
  clearTimeout(V.barTimer);
  V.barTimer = setTimeout(() => showBars(false), 2200);
  history.pushState({ viewer: 1 }, '');
  wake(true);
  loadScore();
}
export function closeViewer(fromHistory) {
  if (!V.open) return;
  V.open = false;
  ink.cancel();
  setDrawing(false);
  viewer.hidden = true;
  stage.innerHTML = ''; V.slots = [];
  R.want([], []);
  wake(false);
  if (!fromHistory && history.state?.viewer) history.back();
  V.onClose?.();
}
window.addEventListener('popstate', () => { if (V.open) closeViewer(true); });

let lock = null;
async function wake(on) {
  try {
    if (on && 'wakeLock' in navigator && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen');
    else if (!on && lock) { await lock.release(); lock = null; }
  } catch {}
}
document.addEventListener('visibilitychange', () => { if (V.open && document.visibilityState === 'visible') wake(true); });

async function loadScore() {
  const id = sid(), s = score();
  ink.loadMarks(id).then(() => { if (sid() === id) refreshInk(); });
  show();
  if (!s.pageCount) {
    try { const d = await R.getDoc(id); s.pageCount = d.numPages; if (sid() === id) show(); } catch { ui.toast('Could not open this PDF'); }
  }
  // Have the next song's marks ready too.
  if (V.ids[V.idx + 1]) ink.loadMarks(V.ids[V.idx + 1]);
}

// ---------- drawing pages ----------
function makeSlot() {
  const el = document.createElement('div'); el.className = 'slot';
  const paper = document.createElement('div'); paper.className = 'paper';
  const inkC = document.createElement('canvas'); inkC.className = 'ink';
  el.append(paper);
  return { el, paper, ink: inkC, sid: null, page: 0, w: 0, h: 0, key: '' };
}

function attach(slot, e, id, page) {
  e.canvas.style.cssText = '';
  slot.sid = id; slot.page = page; slot.w = e.cssW; slot.h = e.cssH; slot.key = e.key;
  slot.paper.style.width = e.cssW + 'px'; slot.paper.style.height = e.cssH + 'px';
  slot.paper.replaceChildren(e.canvas, slot.ink);
  ink.drawInk(slot.ink, id, page, e.cssW, e.cssH);
}
function placeholder(slot, g, id, page) {
  const w = Math.round(Math.min(g.bw, g.bh * 0.773)), h = Math.round(w / 0.773);
  slot.sid = id; slot.page = page; slot.w = 0; slot.key = '';
  slot.paper.style.width = w + 'px'; slot.paper.style.height = h + 'px';
  slot.paper.innerHTML = '<div class="spin"></div>';
  setTimeout(() => { const sp = slot.paper.querySelector('.spin'); if (sp) sp.textContent = 'Loading…'; }, 250);
}

function show() {
  if (!V.open) return;
  const gen = ++V.gen;
  const g = geom(), s = score(), id = sid(), d = dpr();
  const n = s.pageCount || 1;
  V.page = Math.max(1, Math.min(V.page, n));
  if (V.half) { const t = halfOn() && halfTarget(); if (t) return showHalf(gen, g, d, t); V.half = false; }
  const pages = g.two ? [V.page, V.page + 1 <= n ? V.page + 1 : 0] : [V.page];

  stage.classList.toggle('two', g.two);
  while (V.slots.length < pages.length) { const sl = makeSlot(); V.slots.push(sl); stage.append(sl.el); }
  while (V.slots.length > pages.length) V.slots.pop().el.remove();

  const req = [], keep = [];
  const add = (rid, p) => req.push({ id: rid, p, bw: g.bw, bh: g.bh, dpr: d });
  pages.forEach(p => p && add(id, p));
  pages.forEach(p => p && keep.push(R.keyOf(id, p, g.bw, g.bh, d)));
  // Prefetch: the next two pages and the previous turn.
  const st = pages.length;
  for (let i = 1; i <= 2; i++) if (V.page + st - 1 + i <= n) add(id, V.page + st - 1 + i);
  for (let i = 1; i <= st; i++) if (V.page - i >= 1) add(id, V.page - i);
  // Near the end of a song in a setlist, get the next song's first page(s) ready.
  const nextId = V.ids[V.idx + 1];
  if (nextId && V.page + st * 2 > n) { add(nextId, 1); if (st === 2) add(nextId, 2); }
  const prevId = V.ids[V.idx - 1], pn = S.scores.get(prevId)?.pageCount;
  if (prevId && pn && V.page === 1) { const ls = lastStart(pn); add(prevId, ls); if (st === 2 && ls + 1 <= pn) add(prevId, ls + 1); }

  // Anything already rendered goes on screen right now, before asking for the rest.
  pages.forEach((p, i) => {
    const sl = V.slots[i];
    if (!p) { sl.sid = null; sl.page = 0; sl.paper.replaceChildren(); sl.paper.style.width = '0px'; return; }
    const e = R.peek(R.keyOf(id, p, g.bw, g.bh, d));
    if (e) attach(sl, e, id, p); else if (sl.sid !== id || sl.page !== p || !sl.w) placeholder(sl, g, id, p);
  });
  const proms = R.want(req, keep);
  let k = 0;
  pages.forEach((p, i) => {
    if (!p) return;
    const pr = proms[k++];
    const sl = V.slots[i];
    if (sl.key === R.keyOf(id, p, g.bw, g.bh, d)) return;
    pr.then(e => { if (gen === V.gen && V.open) attach(sl, e, id, p); }).catch(() => {});
  });
  updateChrome(pages.filter(Boolean));
}

// Half-page turn: one paper, top half = next page (or next song), bottom half = this page.
function showHalf(gen, g, d, tgt) {
  const id = sid(), n = score().pageCount || 1;
  stage.classList.remove('two');
  while (V.slots.length < 1) { const sl = makeSlot(); V.slots.push(sl); stage.append(sl.el); }
  while (V.slots.length > 1) V.slots.pop().el.remove();
  const sl = V.slots[0];
  const r = (rid, p) => ({ id: rid, p, bw: g.bw, bh: g.bh, dpr: d });
  const req = [r(id, V.page), r(tgt.id, tgt.p)];
  const tn = S.scores.get(tgt.id).pageCount || 1;
  if (tgt.p + 1 <= tn) req.push(r(tgt.id, tgt.p + 1));
  else if (tgt.id === id && V.ids[V.idx + 1]) req.push(r(V.ids[V.idx + 1], 1));
  if (V.page > 1) req.push(r(id, V.page - 1));
  const kc = R.keyOf(id, V.page, g.bw, g.bh, d), kt = R.keyOf(tgt.id, tgt.p, g.bw, g.bh, d);
  const ec = R.peek(kc), et = R.peek(kt);
  if (ec && et) attachHalf(sl, ec, et, tgt);
  const proms = R.want(req, [kc, kt]);
  if (!(ec && et)) {
    placeholder(sl, g, id, V.page);
    Promise.all([proms[0], proms[1]]).then(([a, b]) => { if (gen === V.gen && V.open && V.half) attachHalf(sl, a, b, tgt); }).catch(() => {});
  }
  updateChrome([V.page], tgt);
}
function attachHalf(sl, ec, et, tgt) {
  const id = sid(), W = ec.cssW, H = ec.cssH, split = Math.round(H / 2);
  sl.sid = null; sl.page = 0; sl.w = 0; sl.key = 'half';   // no drawing on a split page
  sl.paper.style.width = W + 'px'; sl.paper.style.height = H + 'px';
  const box = (cls, h) => { const b = document.createElement('div'); b.className = 'hw ' + cls; b.style.height = h + 'px'; return b; };
  const place = (c, w, h, left, top) => { c.style.cssText = `width:${w}px;height:${h}px;left:${left}px;top:${top}px`; return c; };
  const top = box('top', split), bot = box('bot', H - split);
  const tl = Math.round((W - et.cssW) / 2);
  const inkT = document.createElement('canvas'), inkB = document.createElement('canvas');
  top.append(place(et.canvas, et.cssW, et.cssH, tl, 0), place(inkT, et.cssW, et.cssH, tl, 0));
  bot.append(place(ec.canvas, W, H, 0, -split), place(inkB, W, H, 0, -split));
  const tag = document.createElement('span'); tag.className = 'tag';
  tag.textContent = tgt.id === id ? `Page ${tgt.p} ↑` : `Next: ${S.scores.get(tgt.id).title} ↑`;
  top.append(tag);
  sl.paper.replaceChildren(top, bot);
  ink.loadMarks(tgt.id).then(() => ink.drawInk(inkT, tgt.id, tgt.p, et.cssW, et.cssH));
  ink.drawInk(inkB, id, V.page, W, H);
}

function refreshInk() { for (const sl of V.slots) if (sl.w) ink.drawInk(sl.ink, sl.sid, sl.page, sl.w, sl.h); }

function updateChrome(pages, half) {
  const s = score(), n = s.pageCount || 1;
  $('#vTitle').textContent = s.title;
  const bits = [];
  if (s.composer) bits.push(s.composer);
  if (V.ids.length > 1) bits.push(`Song ${V.idx + 1} of ${V.ids.length}${V.name ? ' · ' + V.name : ''}`);
  $('#vSub').textContent = bits.join(' · ');
  $('#vSongs').hidden = V.ids.length < 2;
  $('#vPage').textContent = half ? (half.id === sid() ? `Page ${pages[0]} → ${half.p} of ${n}` : `Page ${pages[0]} of ${n} → next song`)
    : pages.length > 1 ? `Pages ${pages[0]}–${pages[1]} of ${n}` : `Page ${pages[0]} of ${n}`;
  const sl = $('#vSlider'); sl.max = n; sl.value = V.page; sl.disabled = n < 2;
  $('#vNight').classList.toggle('on', !!S.settings.night);
  $('#vTwo').classList.toggle('on', !!S.settings.twoUp);
  $('#vHalf').classList.toggle('on', !!S.settings.halfTurns);
  const atEnd = pages[pages.length - 1] >= n;
  const badge = $('#nextBadge');
  if (atEnd && V.ids.length > 1) {
    const nx = S.scores.get(V.ids[V.idx + 1]);
    badge.textContent = nx ? `Next: ${V.idx + 2}. ${nx.title} ›` : 'End of setlist';
    badge.hidden = false;
  } else badge.hidden = true;
}

// ---------- navigation ----------
export function next() {
  const n = score().pageCount || 1;
  if (halfOn()) {
    // Half-page turns: the first press swaps in the top half of what comes next, the second finishes the turn.
    if (!V.half) {
      if (!halfTarget()) return flash('r');
      V.half = true; show(); showBars(false); return;
    }
    V.half = false;
  }
  if (V.page + step() <= n) { V.page += step(); show(); }
  else if (V.idx < V.ids.length - 1) { V.idx++; V.page = 1; ink.cancel(); loadScore(); }
  else return flash('r');
  if (!V.drawing) showBars(false);
}
export function prev() {
  if (V.half) { V.half = false; show(); return; }
  if (V.page > 1) { V.page = Math.max(1, V.page - step()); show(); }
  else if (V.idx > 0) { V.idx--; V.page = lastStart(score().pageCount || 1); ink.cancel(); loadScore(); }
  else return flash('l');
  if (!V.drawing) showBars(false);
}
function flash(side) {
  const f = $('#edgeFlash'); f.className = side; void f.offsetWidth; f.classList.add('go');
}
function goTo(idx, page = 1) { V.half = false; V.idx = idx; V.page = page; ink.cancel(); loadScore(); }

function showBars(on) {
  clearTimeout(V.barTimer);
  viewer.classList.toggle('bars-off', !on);
}

function setDrawing(on) {
  V.drawing = on;
  if (on && V.half) { V.half = false; show(); }
  viewer.classList.toggle('drawing', on);
  $('#drawBar').hidden = !on;
  $('#drawHint').hidden = !on;
  if (!on) ink.toggleStampPicker(false);
  if (on) { showBars(false); ink.updateBar(); if (S.settings.tool === 'stamp') ink.toggleStampPicker(true); }
}

// ---------- input ----------
function slotAt(e) {
  for (const sl of V.slots) {
    if (!sl.w) continue;
    const r = sl.paper.getBoundingClientRect();
    if (e.clientX >= r.left - 30 && e.clientX <= r.right + 30 && e.clientY >= r.top - 30 && e.clientY <= r.bottom + 30) return sl;
  }
  return null;
}

let gesture = null;
stage.addEventListener('pointerdown', e => {
  if (!V.open) return;
  const pencil = e.pointerType === 'pen' && S.settings.pencilDraws;
  if (V.drawing || pencil) {
    ink.toggleStampPicker(false);
    const sl = slotAt(e);
    if (sl) { ink.down(e, sl, !V.drawing); try { stage.setPointerCapture(e.pointerId); } catch {} return; }
    if (V.drawing) return;
  }
  if (!e.isPrimary) { gesture = null; return; }
  gesture = { x: e.clientX, y: e.clientY, id: e.pointerId, t: performance.now() };
});
stage.addEventListener('pointermove', e => { if (ink.busy()) ink.move(e); });
stage.addEventListener('pointerup', e => {
  if (ink.busy()) { ink.up(e); return; }
  if (!gesture || e.pointerId !== gesture.id) return;
  const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y; gesture = null;
  if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) return dx < 0 ? next() : prev();
  if (Math.hypot(dx, dy) > 14) return;
  const W = stage.clientWidth, H = stage.clientHeight;
  if (e.clientY < H * 0.14) return showBars(viewer.classList.contains('bars-off'));
  const back = S.settings.backZone === 'half' ? 0.5 : 0.33;
  if (e.clientX < W * back) prev(); else next();
});
stage.addEventListener('pointercancel', () => { ink.cancel(); gesture = null; });
stage.addEventListener('contextmenu', e => e.preventDefault());

document.addEventListener('keydown', e => {
  if (!V.open || ui.sheetOpen() || e.target.matches?.('input, textarea')) return;
  const k = e.key;
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) { e.preventDefault(); next(); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(k)) { e.preventDefault(); prev(); }
  else if (k === 'Escape') { if (V.drawing) setDrawing(false); else closeViewer(); }
  else if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'z') { e.preventDefault(); document.querySelector(e.shiftKey ? '#redoBtn' : '#undoBtn').click(); }
});

let resizeT;
window.addEventListener('resize', () => { if (!V.open) return; clearTimeout(resizeT); resizeT = setTimeout(show, 80); });

$('#vClose').onclick = () => closeViewer();
$('#vDraw').onclick = () => setDrawing(true);
$('#drawDone').onclick = () => setDrawing(false);
$('#dPrev').onclick = () => prev();
$('#dNext').onclick = () => next();
$('#vNight').onclick = () => { S.settings.night = !S.settings.night; viewer.classList.toggle('night', S.settings.night); saveSettings(); updateChrome(V.slots.filter(s => s.page).map(s => s.page)); };
$('#vHalf').onclick = () => {
  S.settings.halfTurns = !S.settings.halfTurns;
  if (S.settings.halfTurns) S.settings.twoUp = false;
  saveSettings(); V.half = false;
  ui.toast(S.settings.halfTurns ? 'Half-page turns on: the top half changes first, then the rest' : 'Half-page turns off');
  show();
};
$('#vTwo').onclick = () => {
  S.settings.twoUp = !S.settings.twoUp;
  if (S.settings.twoUp) S.settings.halfTurns = false;
  V.half = false; saveSettings();
  if (S.settings.twoUp && stage.clientWidth <= stage.clientHeight) ui.toast('Two pages show when the iPad is sideways');
  show();
};
const slider = $('#vSlider');
slider.oninput = () => { $('#vPage').textContent = `Page ${slider.value} of ${slider.max}`; };
slider.onchange = () => { V.half = false; V.page = +slider.value; show(); };
$('#vSongs').onclick = async () => {
  const opts = V.ids.map((id, i) => ({ label: `${i + 1}. ${S.scores.get(id).title}`, value: i, picked: i === V.idx, sub: i === V.idx ? 'Now' : '' }));
  const i = await ui.choose(V.name || 'Songs', opts);
  if (i !== null) { goTo(i); showBars(false); }
};

ink.setupBar({
  refresh: refreshInk,
  askText: () => ui.ask('Add text', '', 'e.g. Repeat 2x, Solo, Watch drummer', 'Add'),
  async clearPages() {
    const vis = V.slots.filter(sl => sl.w && ink.hasMarks(sl.sid, sl.page));
    if (!vis.length) return ui.toast('No marks on this page');
    if (!(await ui.confirmDlg(vis.length > 1 ? 'Clear marks on both pages?' : 'Clear marks on this page?', 'You can undo this.', 'Clear', true))) return;
    vis.forEach(sl => ink.clearPage(sl.sid, sl.page));
    refreshInk(); ink.updateBar();
  },
});

export const isOpen = () => V.open;
