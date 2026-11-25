// Full-screen reader: page turns, setlist flow, Draw mode.
import * as R from './render.js';
import * as ink from './ink.js';
import { S, saveSettings, esc } from './store.js';
import * as ui from './ui.js';
import * as db from './db.js';

const $ = s => document.querySelector(s);
const viewer = $('#viewer'), stage = $('#stage');
// Everything on the page sits in #zoomer, which pinch-zoom scales and pans (transform-origin: top left).
const zoomer = document.createElement('div'); zoomer.id = 'zoomer'; stage.append(zoomer);
const Z = { z: 1, tx: 0, ty: 0, key: '' };

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
  zoomer.innerHTML = ''; V.slots = []; Z.key = ''; setZoom(1, 0, 0);
  R.want([], []);
  wake(false);
  if (!fromHistory && history.state?.viewer) history.back();
  V.onClose?.();
  window.dispatchEvent(new Event('viewerclosed'));
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
  slot.half = null; slot.hi = false;
  slot.sid = id; slot.page = page; slot.w = e.cssW; slot.h = e.cssH; slot.key = e.key; slot.crop = e.crop;
  slot.paper.style.width = e.cssW + 'px'; slot.paper.style.height = e.cssH + 'px';
  slot.paper.replaceChildren(e.canvas, slot.ink);
  ink.drawInk(slot.ink, id, page, e.cssW, e.cssH, e.crop);
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
  const zk = `${id}|${V.page}|${V.half}|${g.two}`;   // a new page (or layout) starts unzoomed
  if (zk !== Z.key) { Z.key = zk; if (Z.z !== 1) setZoom(1, 0, 0); }
  if (V.half) { const t = halfOn() && halfTarget(); if (t) return showHalf(gen, g, d, t); V.half = false; }
  const pages = g.two ? [V.page, V.page + 1 <= n ? V.page + 1 : 0] : [V.page];

  stage.classList.toggle('two', g.two);
  while (V.slots.length < pages.length) { const sl = makeSlot(); V.slots.push(sl); zoomer.append(sl.el); }
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
  while (V.slots.length < 1) { const sl = makeSlot(); V.slots.push(sl); zoomer.append(sl.el); }
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
  const id = sid(), W = ec.cssW, H = ec.cssH;
  const sc = score(), page = V.page;
  let split = Math.round(H * (sc.splits?.[page] ?? 0.5));
  sl.sid = null; sl.page = 0; sl.w = 0; sl.key = 'half';   // no drawing on a split page
  sl.half = null;
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
  // The orange line can be dragged; where it sits is remembered for this page of this score.
  const handle = document.createElement('div');
  handle.className = 'hsplit'; handle.style.top = split + 'px';
  handle.innerHTML = '<span>⇕ Drag to move the split</span>';
  const setSplit = y => {
    split = Math.round(Math.max(H * 0.12, Math.min(H * 0.88, y)));
    top.style.height = split + 'px'; bot.style.height = (H - split) + 'px';
    ec.canvas.style.top = inkB.style.top = -split + 'px';
    handle.style.top = split + 'px';
  };
  sl.half = {
    lineY: () => sl.paper.getBoundingClientRect().top + split * Z.z,
    drag: clientY => setSplit((clientY - sl.paper.getBoundingClientRect().top) / Z.z),
    on: v => handle.classList.toggle('drag', v),
    save: () => { (sc.splits ||= {})[page] = Math.round(split / H * 1000) / 1000; db.put('scores', sc); },
  };
  sl.paper.replaceChildren(top, bot, handle);
  if (!S.settings.splitHint) { S.settings.splitHint = true; saveSettings(); ui.toast('Drag the orange line to move where the page splits', 3500); }
  ink.loadMarks(tgt.id).then(() => ink.drawInk(inkT, tgt.id, tgt.p, et.cssW, et.cssH, et.crop));
  ink.drawInk(inkB, id, V.page, W, H, ec.crop);
}

function refreshInk() { for (const sl of V.slots) if (sl.w) ink.drawInk(sl.ink, sl.sid, sl.page, sl.w, sl.h, sl.crop); }

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

// Dragging the half-page split line. Handled for the whole screen (not just the thin line), following the
// finger anywhere until it lifts, so it works however iPad Safari routes touches.
let splitDrag = null;
function startSplitDrag(e) {
  const h = V.slots[0]?.half;
  if (!V.half || !h || Math.abs(e.clientY - h.lineY()) > 36) return false;
  splitDrag = { id: e.pointerId, h };
  h.on(true);
  try { stage.setPointerCapture(e.pointerId); } catch {}
  return true;
}
const splitMove = e => { if (splitDrag && e.pointerId === splitDrag.id) { e.preventDefault(); splitDrag.h.drag(e.clientY); } };
const splitEnd = e => {
  if (!splitDrag || e.pointerId !== splitDrag.id) return;
  splitDrag.h.on(false); splitDrag.h.save(); splitDrag = null;
};
window.addEventListener('pointermove', splitMove, { passive: false });
window.addEventListener('pointerup', splitEnd);
window.addEventListener('pointercancel', splitEnd);
// iPad Safari sometimes sends only touch events once a gesture starts; follow those too.
window.addEventListener('touchmove', e => { if (splitDrag) { e.preventDefault(); splitDrag.h.drag(e.touches[0].clientY); } }, { passive: false });
window.addEventListener('touchend', e => { if (splitDrag && !e.touches.length) splitEnd({ pointerId: splitDrag.id }); });

// ---------- zoom ----------
function setZoom(z, tx, ty, animate) {
  Z.z = z; Z.tx = tx; Z.ty = ty;
  zoomer.style.transition = animate ? 'transform .2s ease' : '';
  zoomer.style.transform = z === 1 && !tx && !ty ? '' : `translate(${tx}px, ${ty}px) scale(${z})`;
  viewer.classList.toggle('zoomed', z > 1.001);
}
function clampPan() {
  const W = stage.clientWidth, H = stage.clientHeight;
  Z.tx = Math.min(0, Math.max(W - W * Z.z, Z.tx));
  Z.ty = Math.min(0, Math.max(H - H * Z.z, Z.ty));
}
function resetZoom() { setZoom(1, 0, 0, true); sharpen(); }
// Zoomed in, the page is drawn again at the higher resolution so the music stays crisp.
let sharpT;
function sharpen() {
  clearTimeout(sharpT);
  sharpT = setTimeout(() => {
    if (!V.open || V.half) return;
    const q = Math.min(Z.z, 3);
    if (q <= 1.15) { if (V.slots.some(sl => sl.hi)) show(); return; }
    const g = geom(), d = dpr(), gen = V.gen;
    const slots = V.slots.filter(sl => sl.w);
    const list = slots.map(sl => ({ id: sl.sid, p: sl.page, bw: g.bw, bh: g.bh, dpr: Math.round(d * q * 4) / 4, hi: true }));
    const keep = list.map(r => R.keyOf(r.id, r.p, r.bw, r.bh, r.dpr)).concat(slots.map(sl => sl.key));
    R.want(list, keep).forEach((pr, i) => pr.then(e => {
      if (gen !== V.gen || !V.open || Z.z <= 1.15) return;
      attach(slots[i], e, list[i].id, list[i].p); slots[i].hi = true;
    }).catch(() => {}));
  }, 150);
}
const zoomHint = () => { if (!S.settings.zoomHint) { S.settings.zoomHint = true; saveSettings(); ui.toast('Zoomed in: drag to look around. Tap “Fit page” to go back.', 3500); } };

// ---------- touches ----------
// Two fingers: pinch to zoom, move to scroll (in Draw mode too: one finger or the Pencil draws).
// Zoomed in: one finger drags the page around; a quick tap still turns the page.
const pts = new Map();
let pinch = null, pan = null, swallow = false, gesture = null, zraf = 0;
const local = e => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
function startPinch() {
  ink.cancel(); gesture = null; pan = null;
  if (splitDrag) splitEnd({ pointerId: splitDrag.id });
  const [a, b] = [...pts.values()];
  pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx0: (a.x + b.x) / 2, my0: (a.y + b.y) / 2, z0: Z.z, tx0: Z.tx, ty0: Z.ty };
}
function movePinch() {
  const [a, b] = [...pts.values()];
  const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const z = Math.max(0.8, Math.min(5, pinch.z0 * d / pinch.d0));
  const cx = (pinch.mx0 - pinch.tx0) / pinch.z0, cy = (pinch.my0 - pinch.ty0) / pinch.z0;   // page point under the fingers
  Z.z = z; Z.tx = mx - cx * z; Z.ty = my - cy * z;
  if (!zraf) zraf = requestAnimationFrame(() => { zraf = 0; setZoom(Z.z, Z.tx, Z.ty); });
}
function endPinch() {
  pinch = null;
  cancelAnimationFrame(zraf); zraf = 0;
  if (Z.z < 1.05) return resetZoom();
  clampPan(); setZoom(Z.z, Z.tx, Z.ty, true); sharpen(); zoomHint();
}

stage.addEventListener('pointerdown', e => {
  if (!V.open) return;
  if (e.pointerType === 'touch') pts.set(e.pointerId, local(e));
  if (e.pointerType === 'touch' && pts.size === 2) { startPinch(); return; }
  if (pinch || swallow || pts.size > 2) return;
  if (startSplitDrag(e)) { e.preventDefault(); gesture = null; return; }
  const pencil = e.pointerType === 'pen' && S.settings.pencilDraws;
  if (V.drawing || pencil) {
    ink.toggleStampPicker(false);
    const sl = slotAt(e);
    if (sl) { ink.down(e, sl, !V.drawing); try { stage.setPointerCapture(e.pointerId); } catch {} return; }
    if (V.drawing) return;
  }
  if (!e.isPrimary) { gesture = null; return; }
  gesture = { x: e.clientX, y: e.clientY, id: e.pointerId, t: performance.now() };
  pan = Z.z > 1.001 ? { id: e.pointerId, x0: e.clientX, y0: e.clientY, tx0: Z.tx, ty0: Z.ty, moved: false } : null;
});
stage.addEventListener('pointermove', e => {
  if (pts.has(e.pointerId)) pts.set(e.pointerId, local(e));
  if (pinch && pts.size >= 2) { movePinch(); return; }
  if (ink.busy()) { ink.move(e); return; }
  if (pan && e.pointerId === pan.id) {
    const dx = e.clientX - pan.x0, dy = e.clientY - pan.y0;
    if (Math.hypot(dx, dy) > 8) pan.moved = true;
    Z.tx = pan.tx0 + dx; Z.ty = pan.ty0 + dy; clampPan(); setZoom(Z.z, Z.tx, Z.ty);
  }
});
const lift = e => {
  pts.delete(e.pointerId);
  if (pinch) { if (pts.size < 2) { endPinch(); swallow = pts.size > 0; } return true; }
  if (swallow) { if (!pts.size) swallow = false; return true; }
  return false;
};
stage.addEventListener('pointerup', e => {
  if (lift(e)) return;
  if (ink.busy()) { ink.up(e); return; }
  if (splitDrag) return;
  if (!gesture || e.pointerId !== gesture.id) return;
  const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y; gesture = null;
  if (pan) { const moved = pan.moved; pan = null; if (moved) return; }
  else if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) return dx < 0 ? next() : prev();
  if (Math.hypot(dx, dy) > 14) return;
  const W = stage.clientWidth, H = stage.clientHeight, p = local(e);
  if (p.y < H * 0.14) return showBars(viewer.classList.contains('bars-off'));
  const back = S.settings.backZone === 'half' ? 0.5 : 0.33;
  if (p.x < W * back) prev(); else next();
});
stage.addEventListener('pointercancel', e => { lift(e); ink.cancel(); gesture = null; pan = null; });
// Trackpad/mouse on a computer: pinch (or Ctrl + scroll) zooms, scrolling moves a zoomed page.
stage.addEventListener('wheel', e => {
  if (!V.open) return;
  e.preventDefault();
  const p = local(e);
  if (e.ctrlKey) {
    const z = Math.max(1, Math.min(5, Z.z * Math.exp(-e.deltaY / 200)));
    const cx = (p.x - Z.tx) / Z.z, cy = (p.y - Z.ty) / Z.z;
    Z.z = z; Z.tx = p.x - cx * z; Z.ty = p.y - cy * z;
  } else if (Z.z > 1.001) { Z.tx -= e.deltaX; Z.ty -= e.deltaY; }
  else return;
  clampPan(); setZoom(Z.z, Z.tx, Z.ty); sharpen();
}, { passive: false });
// iPad Safari's own page zoom would fight ours.
['gesturestart', 'gesturechange'].forEach(t => document.addEventListener(t, e => { if (V.open) e.preventDefault(); }));
$('#zoomFit').onclick = () => resetZoom();

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

let quickT;
ink.setupBar({
  refresh: refreshInk,
  // After writing with the Pencil outside Draw mode, Undo/Redo show for a few seconds.
  marked(quick) {
    if (!quick || V.drawing) return;
    viewer.classList.add('quickundo');
    clearTimeout(quickT); quickT = setTimeout(() => viewer.classList.remove('quickundo'), 6000);
  },
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
