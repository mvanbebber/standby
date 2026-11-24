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

export const keyOf = (id, p, bw, bh, dpr) => `${id}|${p}|${bw}|${bh}|${dpr}`;
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
    e = { key, id: r.id, p: r.p, bw: r.bw, bh: r.bh, dpr: r.dpr, prio: i, done: false };
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
    const fit = Math.min(e.bw / v1.width, e.bh / v1.height);
    let px = fit * e.dpr;
    if (v1.width * v1.height * px * px > MAX_PIXELS) px = Math.sqrt(MAX_PIXELS / (v1.width * v1.height));
    const vp = page.getViewport({ scale: px });
    canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    e.task = page.render({ canvasContext: ctx, viewport: vp });
    await e.task.promise;
    e.task = null;
    e.canvas = canvas; e.cssW = Math.round(v1.width * fit); e.cssH = Math.round(v1.height * fit);
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
