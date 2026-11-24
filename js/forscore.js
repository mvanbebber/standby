// Reading forScore files: Backups/Archives (.4sb), shared setlists (.4ss) and shared scores (.4sc).
//
// Container layout (reverse-engineered by github.com/inet-cologne/forscore-cleanup):
//   "<--4SBV03-->" + 32-character numeric column (last number = metadata size) + file name
//   gzip block: Apple binary plist with all metadata
//   then records: 32-character numeric column (last number = compressed size) + file name
//                 ("{%DOCUMENTS_DIR%}/x.pdf" for files, "x.pdf|2.png" for page drawings) + gzip block
// Metadata keys: "<file>|title", "|composer", "|libraries", "<file>|<page>|textAnnotations",
//   "&SYS;setlists" (ordered names), "&SET;<name>" ([{Title, FilePath}]).
// The other kind of .4ss is plain XML (forScore's developer format): one element per song with
// title/path attributes; we match songs by file name, then title.

const GZ = [0x1f, 0x8b, 0x08];
const findGz = u8 => { for (let i = 0; i < u8.length - 2; i++) if (u8[i] === 31 && u8[i + 1] === 139 && u8[i + 2] === 8) return i; return -1; };
const gunzip = blob => new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).blob();

export async function sniff(file) {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const txt = new TextDecoder('latin1').decode(head);
  if (txt.startsWith('<--')) return 'container';
  if (/^\s*(﻿)?<(\?xml|[A-Za-z])/.test(new TextDecoder().decode(head))) return 'xml';
  return null;
}

// ---------- container ----------
export async function readContainer(file) {
  const win = new Uint8Array(await file.slice(0, 2048).arrayBuffer());
  const gz = findGz(win);
  if (gz < 0) throw new Error('Not a forScore file');
  const header = new TextDecoder('latin1').decode(win.subarray(0, gz));
  const m = header.match(/^<--([A-Z0-9]+)-->/);
  if (!m) throw new Error('Not a forScore file');
  const nums = header.slice(m[0].length, m[0].length + 32).match(/\d+/g);
  const metaSize = nums ? +nums[nums.length - 1] : 0;
  if (!metaSize) throw new Error('Unreadable forScore header');
  const plistBlob = await gunzip(file.slice(gz, gz + metaSize));
  const meta = parseBplist(new Uint8Array(await plistBlob.arrayBuffer()));

  const records = [];
  let off = gz + metaSize;
  const dec = new TextDecoder();
  while (off < file.size) {
    const w = new Uint8Array(await file.slice(off, off + 4096).arrayBuffer());
    const g = findGz(w);
    if (g < 33) break;
    const n = new TextDecoder('latin1').decode(w.subarray(0, 32)).match(/\d+/g);
    const size = n ? +n[n.length - 1] : 0;
    if (!size) break;
    const name = dec.decode(w.subarray(32, g)).replace(/^\{%DOCUMENTS_DIR%\}\//, '').trim();
    const start = off + g;
    records.push({ name, get: () => gunzip(file.slice(start, start + size)) });
    off = start + size;
  }
  return { kind: m[1], meta: meta && typeof meta === 'object' ? meta : {}, records };
}

// What a container (or plain metadata) tells us about scores, setlists, libraries and marks.
export function describe(meta, records = []) {
  const files = new Map();   // filePath -> {path, title, composer, libraries[], record?, drawings: Map(page->get), texts: [[page, ann]]}
  const ensure = path => {
    if (!files.has(path)) files.set(path, { path, title: '', composer: '', libraries: [], drawings: new Map(), texts: [] });
    return files.get(path);
  };
  for (const [k, v] of Object.entries(meta)) {
    let mm;
    if ((mm = k.match(/^(.*\.pdf)\|title$/i)) && typeof v === 'string') ensure(mm[1]).title = v;
    else if ((mm = k.match(/^(.*\.pdf)\|composer$/i)) && typeof v === 'string') ensure(mm[1]).composer = v;
    else if ((mm = k.match(/^(.*\.pdf)\|libraries$/i))) {
      const list = (Array.isArray(v) ? v : [v]).filter(x => typeof x === 'string').flatMap(x => x.split(',')).map(x => x.trim()).filter(Boolean);
      ensure(mm[1]).libraries = [...new Set(list)];
    } else if ((mm = k.match(/^(.*)\|(\d+)\|textAnnotations$/)) && Array.isArray(v)) {
      for (const a of v) if (a && typeof a.text === 'string' && a.text.trim() && (a.layerVisible ?? 1)) ensure(mm[1]).texts.push([+mm[2], a]);
    }
  }
  for (const r of records) {
    const d = r.name.match(/^(.*)\|(\d+)\.png$/i);
    if (d) { ensure(d[1]).drawings.set(+d[2], r.get); continue; }
    if (/\.pdf$/i.test(r.name)) ensure(r.name).record = r;
  }
  // Setlists, in forScore's order; then any other "&SET;" keys.
  const setlists = [];
  const seen = new Set();
  const addSet = key => {
    const items = meta[key];
    if (seen.has(key) || !Array.isArray(items)) return;
    seen.add(key);
    setlists.push({
      name: key.replace(/^&SET;/, ''),
      items: items.filter(x => x && typeof x === 'object').map(x => ({ path: x.FilePath || x.filePath || x.path || '', title: x.Title || x.title || '' })),
    });
  };
  if (Array.isArray(meta['&SYS;setlists'])) meta['&SYS;setlists'].forEach(k => typeof k === 'string' && addSet(k.startsWith('&SET;') ? k : '&SET;' + k));
  Object.keys(meta).filter(k => k.startsWith('&SET;')).forEach(addSet);
  const libraries = [...new Set([...files.values()].flatMap(f => f.libraries))];
  return { files: [...files.values()], setlists, libraries };
}

// ---------- XML setlist ----------
export async function readXmlSetlist(file) {
  const doc = new DOMParser().parseFromString(await file.text(), 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Not a setlist file');
  const root = doc.documentElement;
  const name = root.getAttribute('title') || root.getAttribute('name') || file.name.replace(/\.[^.]+$/, '');
  const items = [];
  for (const el of root.querySelectorAll('*')) {
    const path = el.getAttribute('path') || el.getAttribute('file') || el.getAttribute('filePath') || '';
    const title = el.getAttribute('title') || el.getAttribute('name') || '';
    if (!path && !title) continue;
    if (el.parentElement !== root && (el.parentElement.getAttribute('path') || el.parentElement.getAttribute('title'))) continue;
    items.push({ path, title });
  }
  return { name, items };
}

// ---------- Apple binary plist ----------
export function parseBplist(u8) {
  if (new TextDecoder().decode(u8.subarray(0, 6)) !== 'bplist') throw new Error('Not a binary plist');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const t = u8.length - 32;
  const offSize = u8[t + 6], refSize = u8[t + 7];
  const numObjects = Number(dv.getBigUint64(t + 8)), top = Number(dv.getBigUint64(t + 16)), tableOff = Number(dv.getBigUint64(t + 24));
  const uint = (pos, size) => { let v = 0; for (let i = 0; i < size; i++) v = v * 256 + u8[pos + i]; return v; };
  const offsets = new Array(numObjects);
  for (let i = 0; i < numObjects; i++) offsets[i] = uint(tableOff + i * offSize, offSize);
  const utf16 = new TextDecoder('utf-16be'), utf8 = new TextDecoder();
  const cache = new Map();
  const len = (pos, info) => {
    if (info !== 0xf) return [info, pos + 1];
    const m = u8[pos + 1], sz = 1 << (m & 0xf);
    return [uint(pos + 2, sz), pos + 2 + sz];
  };
  const obj = ref => {
    if (cache.has(ref)) return cache.get(ref);
    const pos = offsets[ref], marker = u8[pos], type = marker >> 4, info = marker & 0xf;
    let v;
    switch (type) {
      case 0x0: v = info === 8 ? false : info === 9 ? true : null; break;
      case 0x1: { const sz = 1 << info; v = sz === 8 ? Number(dv.getBigInt64(pos + 1)) : uint(pos + 1, sz); break; }
      case 0x2: v = info === 2 ? dv.getFloat32(pos + 1) : dv.getFloat64(pos + 1); break;
      case 0x3: v = new Date((978307200 + dv.getFloat64(pos + 1)) * 1000); break;
      case 0x4: { const [n, p] = len(pos, info); v = u8.slice(p, p + n); break; }
      case 0x5: { const [n, p] = len(pos, info); v = new TextDecoder('latin1').decode(u8.subarray(p, p + n)); break; }
      case 0x6: { const [n, p] = len(pos, info); v = utf16.decode(u8.subarray(p, p + n * 2)); break; }
      case 0x7: { const [n, p] = len(pos, info); v = utf8.decode(u8.subarray(p, p + n)); break; }
      case 0x8: v = { uid: uint(pos + 1, info + 1) }; break;
      case 0xa: case 0xb: case 0xc: {
        const [n, p] = len(pos, info); v = [];
        cache.set(ref, v);
        for (let i = 0; i < n; i++) v.push(obj(uint(p + i * refSize, refSize)));
        break;
      }
      case 0xd: {
        const [n, p] = len(pos, info); v = {};
        cache.set(ref, v);
        for (let i = 0; i < n; i++) v[String(obj(uint(p + i * refSize, refSize)))] = obj(uint(p + (n + i) * refSize, refSize));
        break;
      }
      default: v = null;
    }
    cache.set(ref, v);
    return v;
  };
  return obj(top);
}

// forScore text colors are names ("Red") or occasionally hex.
const NAMED = { black: '#1f1f1f', red: '#d32f2f', blue: '#1e63d6', green: '#1f9a4a', purple: '#8e44c9', orange: '#f08a00', yellow: '#c9a400', gray: '#666666', grey: '#666666', white: '#ffffff', brown: '#7a4a1e', pink: '#d0457a' };
export function color(c) {
  if (typeof c !== 'string') return NAMED.black;
  if (/^#?[0-9a-f]{6}$/i.test(c)) return c.startsWith('#') ? c : '#' + c;
  return NAMED[c.toLowerCase()] || NAMED.black;
}
