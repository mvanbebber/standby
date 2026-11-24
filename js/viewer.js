// Full-screen reader: page turns, setlist flow, Draw mode.
import * as R from './render.js';
import * as ink from './ink.js';
import { S, saveSettings, esc } from './store.js';
import * as ui from './ui.js';

const $ = s => document.querySelector(s);
const viewer = $('#viewer'), stage = $('#stage');

const V = { open: false, ids: [], idx: 0, page: 1, name: '', drawing: false, gen: 0, slots: [], onClose: null };
const sid = () => V.ids[V.idx];
const score = () => S.scores.get(sid());
const dpr = () => Math.min(devicePixelRatio || 1, 3);

function geom() {
  const W = stage.clientWidth, H = stage.clientHeight;
  const two = S.settings.twoUp && W > H && W >= 700;
  return { W, H, two, bw: two ? Math.floor(W / 2) : W, bh: H };
}
const step = () => (geom().two ? 2 : 1);
const lastStart = n => (geom().two ? 1 + 2 * Math.floor((n - 1) / 2) : n);

// ---------- open / close ----------
export function openViewer({ ids, idx = 0, page = 1, name = '', onClose }) {
  V.ids = ids.filter(id => S.scores.has(id));
  if (!V.ids.length) return;
  Object.assign(V, { open: true, idx: Math.min(idx, V.ids.length - 1), page, name, onClose });
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

function refreshInk() { for (const sl of V.slots) if (sl.w) ink.drawInk(sl.ink, sl.sid, sl.page, sl.w, sl.h); }

function updateChrome(pages) {
  const s = score(), n = s.pageCount || 1;
  $('#vTitle').textContent = s.title;
  const bits = [];
  if (s.composer) bits.push(s.composer);
  if (V.ids.length > 1) bits.push(`Song ${V.idx + 1} of ${V.ids.length}${V.name ? ' · ' + V.name : ''}`);
  $('#vSub').textContent = bits.join(' · ');
  $('#vSongs').hidden = V.ids.length < 2;
  $('#vPage').textContent = pages.length > 1 ? `Pages ${pages[0]}–${pages[1]} of ${n}` : `Page ${pages[0]} of ${n}`;
  const sl = $('#vSlider'); sl.max = n; sl.value = V.page; sl.disabled = n < 2;
  $('#vNight').classList.toggle('on', !!S.settings.night);
  $('#vTwo').classList.toggle('on', !!S.settings.twoUp);
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
  if (V.page + step() <= n) { V.page += step(); show(); }
  else if (V.idx < V.ids.length - 1) { V.idx++; V.page = 1; ink.cancel(); loadScore(); }
  else return flash('r');
  if (!V.drawing) showBars(false);
}
export function prev() {
  if (V.page > 1) { V.page = Math.max(1, V.page - step()); show(); }
  else if (V.idx > 0) { V.idx--; V.page = lastStart(score().pageCount || 1); ink.cancel(); loadScore(); }
  else return flash('l');
  if (!V.drawing) showBars(false);
}
function flash(side) {
  const f = $('#edgeFlash'); f.className = side; void f.offsetWidth; f.classList.add('go');
}
function goTo(idx, page = 1) { V.idx = idx; V.page = page; ink.cancel(); loadScore(); }

function showBars(on) {
  clearTimeout(V.barTimer);
  viewer.classList.toggle('bars-off', !on);
}

function setDrawing(on) {
  V.drawing = on;
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
    if (sl) { ink.down(e, sl, !V.drawing); try { stage.setPointerCapture(e.pointerId); } catch {} }
    return;
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
$('#vTwo').onclick = () => {
  S.settings.twoUp = !S.settings.twoUp; saveSettings();
  if (S.settings.twoUp && stage.clientWidth <= stage.clientHeight) ui.toast('Two pages show when the iPad is sideways');
  show();
};
const slider = $('#vSlider');
slider.oninput = () => { $('#vPage').textContent = `Page ${slider.value} of ${slider.max}`; };
slider.onchange = () => { V.page = +slider.value; show(); };
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
