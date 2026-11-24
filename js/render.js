// PDF rendering built for instant page turns:
//  - one shared PDF.js worker (no worker start-up per score)
//  - open documents are kept (last 4), so going back to a score is immediate
//  - pages render through one priority queue: the page on screen jumps ahead of prefetches,
//    and a prefetch that is in the way gets cancelled and retried later
//  - finished pages stay in a small cache of canvases, so a turn just swaps a canvas in
import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';
import * as db from './db.js';

const BASE = new URL('../vendor/pdfjs/', import.meta.url).href;
pdfjs.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.mjs';

const MAX_DOCS = 4;
const MAX_PAGES = 7;          // rendered pages kept (iOS limits total canvas memory)
const MAX_PIXELS = 6.5e6;     // per page: full sharpness on a 12.9" iPad Pro

let worker;
const opts = data => ({
  data, worker: (worker ||= new pdfjs.PDFWorker()),
  standardFontDataUrl: BASE + 'standard_fonts/', isEvalSupported: false,
});

export async function openBytes(bytes) { return pdfjs.getDocument(opts(bytes)).promise; }

const docs = new Map();
export function getDoc(id) {
  let p = docs.get(id);
  if (p) { docs.delete(id); docs.set(id, p); return p; }
  p = (async () => {
    const f = await db.get('files', id);
    if (!f) throw new Error('PDF missing');
    return openBytes(new Uint8Array(await f.blob.arrayBuffer()));
  })();
  p.catch(() => docs.delete(id));
  docs.set(id, p);
  while (docs.size > MAX_DOCS) {
    const [k, v] = docs.entries().next().value;
    docs.delete(k);
    v.then(d => d.destroy()).catch(() => {});
  }
  return p;
}
export function forgetDoc(id) {
  const p = docs.get(id);
  if (p) { docs.delete(id); p.then(d => d.destroy()).catch(() => {}); }
  for (const [k, e] of cache) if (e.id === id) drop(e);
}

// ---- page cache + queue ----
const cache = new Map();   // key -> entry {key,id,p,bw,bh,dpr,prio,done,canvas,cssW,cssH,promise}
let queue = [];
let running = null;
let pinned = new Set();
let idleWaiters = [];

// Trim white margins: each page is zoomed so its printed area fills the screen (see detectCrop).
let trimOn = true;
export function setTrim(on) { trimOn = !!on; }
export const keyOf = (id, p, bw, bh, dpr) => `${id}|${p}|${bw}|${bh}|${dpr}|${trimOn ? 't' : 'f'}`;
export function peek(key) { const e = cache.get(key); return e && e.done ? e : null; }

function drop(e) {
  cache.delete(e.key);
  queue = queue.filter(q => q !== e);
  if (e.canvas) { e.canvas.width = e.canvas.height = 0; e.canvas = null; }
  if (!e.done) { e.dropped = true; if (e.task) e.task.cancel(); else e.rej(new Error('dropped')); }
}

// Ask for exactly this set of pages (in priority order). Anything else still waiting is dropped.
export function want(list, keep) {
  pinned = new Set(keep);
  const wanted = new Set();
  const out = list.map((r, i) => {
    const key = keyOf(r.id, r.p, r.bw, r.bh, r.dpr);
    wanted.add(key);
    let e = cache.get(key);
    if (e) {
      cache.delete(key); cache.set(key, e);   // most recently used
      if (!e.done) e.prio = i;
      return e.promise;
    }
    e = { key, id: r.id, p: r.p, bw: r.bw, bh: r.bh, dpr: r.dpr, prio: i, done: false, trim: trimOn };
    e.promise = new Promise((res, rej) => { e.res = res; e.rej = rej; });
    e.promise.catch(() => {});
    cache.set(key, e);
    queue.push(e);
    return e.promise;
  });
  for (const e of [...queue]) if (!wanted.has(e.key)) drop(e);
  if (running && !wanted.has(running.key)) { running.dropped = true; running.task?.cancel(); }
  else if (running && running.prio > 0 && queue.some(q => q.prio === 0) && running.task) { running.yielded = true; running.task.cancel(); }
  pump();
  return out;
}

function evict() {
  const doneEntries = [...cache.values()].filter(e => e.done);
  let extra = doneEntries.length - MAX_PAGES;
  for (const e of doneEntries) {
    if (extra <= 0) break;
    if (pinned.has(e.key)) continue;
    drop(e); extra--;
  }
}

async function pump() {
  if (running) return;
  queue.sort((a, b) => a.prio - b.prio);
  const e = queue.shift();
  if (!e) { idleWaiters.forEach(f => f()); idleWaiters = []; return; }
  running = e;
  let canvas;
  try {
    const doc = await getDoc(e.id);
    if (e.dropped) throw new Error('dropped');
    const page = await doc.getPage(Math.min(e.p, doc.numPages));
    const v1 = page.getViewport({ scale: 1 });
    const crop = e.trim ? viewRect(await cropOf(e.id, e.p, page), v1, e.bw, e.bh) : FULL;
    if (e.dropped) throw new Error('dropped');
    const cw = v1.width * (crop[2] - crop[0]), ch = v1.height * (crop[3] - crop[1]);
    const fit = Math.min(e.bw / cw, e.bh / ch);
    let px = fit * e.dpr;
    if (cw * ch * px * px > MAX_PIXELS) px = Math.sqrt(MAX_PIXELS / (cw * ch));
    const vp = page.getViewport({ scale: px, offsetX: -crop[0] * v1.width * px, offsetY: -crop[1] * v1.height * px });
    canvas = document.createElement('canvas');
    canvas.width = Math.floor(cw * px); canvas.height = Math.floor(ch * px);
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    e.task = page.render({ canvasContext: ctx, viewport: vp });
    await e.task.promise;
    e.task = null;
    e.canvas = canvas; e.cssW = Math.round(cw * fit); e.cssH = Math.round(ch * fit); e.crop = crop;
    e.done = true;
    e.res(e);
  } catch (err) {
    e.task = null;
    if (canvas) canvas.width = canvas.height = 0;
    if (e.yielded && !e.dropped && cache.get(e.key) === e) { e.yielded = false; queue.push(e); }
    else { cache.delete(e.key); e.rej(err); }
  }
  running = null;
  evict();
  pump();
}

export function whenIdle() {
  if (!running && !queue.length) return Promise.resolve();
  return new Promise(r => idleWaiters.push(r));
}

// First-page thumbnail as a JPEG, plus the page count. Opens its own copy of the document
// so it never pushes the scores you are reading out of the cache.
export async function makeThumb(bytes, width = 360) {
  const doc = await openBytes(bytes);
  try {
    const page = await doc.getPage(1);
    const v1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: width / v1.width });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
    c.width = c.height = 0;
    return { blob, pages: doc.numPages };
  } finally { doc.destroy(); }
}

// ---------- margin trimming ----------
// Each page's printed area, as [left, top, right, bottom] fractions of the page, found from a small render.
// A row or column counts as printed only with a real amount of ink on two neighboring lines, so specks and
// scanner dust don't. Saved per score in kv "crop2:<id>", worked out in the background after import.
export const FULL = [0, 0, 1, 1];
const crops = new Map();   // id -> {pages, ready, timer}
function cropsFor(id) {
  let c = crops.get(id);
  if (!c) {
    c = { pages: {} };
    c.ready = db.get('kv', 'crop2:' + id).then(r => { if (r) Object.assign(c.pages, r.v); }).catch(() => {});
    crops.set(id, c);
  }
  return c;
}
function saveCrops(id) {
  const c = crops.get(id);
  clearTimeout(c.timer);
  c.timer = setTimeout(() => db.put('kv', { k: 'crop2:' + id, v: c.pages }), 500);
}
export function forgetCrops(id) { crops.delete(id); db.del('kv', 'crop2:' + id).catch(() => {}); }
async function cropOf(id, n, page) {
  const c = cropsFor(id); await c.ready;
  if (!c.pages[n]) { c.pages[n] = await detectCrop(page); saveCrops(id); }
  return c.pages[n];
}
export async function detectCrop(page) {
  const v1 = page.getViewport({ scale: 1 });
  const W = 640, s = W / v1.width, H = Math.max(1, Math.round(v1.height * s));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  try { await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: s }) }).promise; }
  catch { cv.width = cv.height = 0; return FULL; }
  const d = ctx.getImageData(0, 0, W, H).data;
  cv.width = cv.height = 0;
  const rows = new Uint16Array(H), cols = new Uint16Array(W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11 < 215) { rows[y]++; cols[x]++; }
  }
  const ink = (a, i, min) => a[i] >= min && ((a[i - 1] ?? 0) >= min || (a[i + 1] ?? 0) >= min);
  const first = (a, min) => { for (let i = 0; i < a.length; i++) if (ink(a, i, min)) return i; return -1; };
  const last = (a, min) => { for (let i = a.length - 1; i >= 0; i--) if (ink(a, i, min)) return i; return -1; };
  const rowMin = 4, colMin = 4;   // dust is 1-2 px here; real ink (even small text) reaches 4 on neighboring lines
  const y0 = first(rows, rowMin), y1 = last(rows, rowMin), x0 = first(cols, colMin), x1 = last(cols, colMin);
  if (y0 < 0 || x0 < 0 || x1 - x0 < W * 0.1 || y1 - y0 < H * 0.05) return FULL;   // blank or nearly blank page
  const r = v => Math.round(v * 10000) / 10000;
  return [r(x0 / W), r(y0 / H), r((x1 + 1) / W), r((y1 + 1) / H)];
}

// Which part of the page to show, given the printed area. Width comes first: if the music still fits top to
// bottom at full width, use full width (giving up only breathing room). Never smaller than the untrimmed page.
const PAD = 0.015;
function viewRect(c, v1, bw, bh) {
  if (c === FULL || (c[0] === 0 && c[1] === 0 && c[2] === 1 && c[3] === 1)) return FULL;
  const pw = v1.width, ph = v1.height;
  const x0 = Math.max(0, c[0] - PAD), x1 = Math.min(1, c[2] + PAD);
  const py0 = Math.max(0, c[1] - PAD), py1 = Math.min(1, c[3] + PAD);
  const cw = pw * (x1 - x0), tightH = ph * (c[3] - c[1]), padH = ph * (py1 - py0);
  let fit = bw / cw;
  if (tightH * fit > bh) fit = bh / tightH;                       // music would be cut off: shrink to fit it
  const full = Math.min(bw / pw, bh / ph);
  if (fit <= full * 1.02) return FULL;                            // trimming wouldn't make the music bigger
  // Vertical window: as much breathing room as fits, centered on the music, kept on the page.
  const visH = Math.min(padH, bh / fit) / ph;
  const mid = (c[1] + c[3]) / 2;
  let y0 = Math.max(0, Math.min(1 - visH, mid - visH / 2));
  if (y0 > c[1]) y0 = c[1];
  return [x0, y0, x1, Math.min(1, y0 + visH)];
}
// Work out every page's crop ahead of time, only while nothing else is rendering.
export async function precomputeCrops(id, bytes) {
  const c = cropsFor(id); await c.ready;
  const doc = await openBytes(bytes);
  try {
    let changed = false;
    for (let n = 1; n <= doc.numPages; n++) {
      if (c.pages[n]) continue;
      await whenIdle();
      if (!crops.has(id)) return;
      c.pages[n] = await detectCrop(await doc.getPage(n)); changed = true;
      if (n % 20 === 0) saveCrops(id);
    }
    if (changed) saveCrops(id);
  } finally { doc.destroy(); }
}
export async function hasAllCrops(id, pages) { const c = cropsFor(id); await c.ready; for (let n = 1; n <= pages; n++) if (!c.pages[n]) return false; return true; }
