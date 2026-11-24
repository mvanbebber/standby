// Library, folders, setlists, import, settings and backup.
import * as db from './db.js';
import * as R from './render.js';
import * as ink from './ink.js';
import { S, load, saveSettings, uid, esc } from './store.js';
import * as ui from './ui.js';
import { openViewer } from './viewer.js';
import { writeZip, readZip } from './zip.js';

const $ = s => document.querySelector(s);
const content = $('#content');
let view = { type: 'all' };
let query = '';
let selecting = false;
const selected = new Set();
const thumbs = new Map();   // id -> object URL

// ---------- helpers ----------
const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const icon = id => `<svg><use href="#${id}"/></svg>`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const folderOf = id => S.folders.find(f => f.id === id);
const setlistOf = id => S.setlists.find(s => s.id === id);
const thumbImg = (id, cls = 'mthumb') => thumbs.get(id) ? `<img class="${cls}" src="${thumbs.get(id)}" alt="">` : `<div class="${cls}"></div>`;
function cleanTitle(name) {
  return name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
}
function matches(s, q) {
  if (!q) return true;
  const hay = (s.title + ' ' + (s.composer || '')).toLowerCase();
  return q.toLowerCase().split(/\s+/).every(w => hay.includes(w));
}
function sorted(list, how = S.settings.sort) {
  if (how === 'added') return list.sort((a, b) => b.addedAt - a.addedAt);
  if (how === 'composer') return list.sort((a, b) => coll.compare(a.composer || '￿', b.composer || '￿') || coll.compare(a.title, b.title));
  return list.sort((a, b) => coll.compare(a.title, b.title));
}

// ---------- sidebar ----------
function renderSide() {
  $('#countAll').textContent = S.scores.size || '';
  document.querySelectorAll('#side .nav[data-view]').forEach(b => b.classList.toggle('on', view.type === b.dataset.view));
  $('#setlistNav').innerHTML = S.setlists.length ? S.setlists.map(s =>
    `<button class="nav${view.type === 'setlist' && view.id === s.id ? ' on' : ''}" data-setlist="${s.id}">${icon('i-setlist')}<span>${esc(s.name)}</span><em>${s.items.length}</em></button>`).join('')
    : '<div class="side-empty">No setlists yet</div>';
  const counts = {};
  for (const s of S.scores.values()) if (s.folderId) counts[s.folderId] = (counts[s.folderId] || 0) + 1;
  $('#folderNav').innerHTML = S.folders.length ? S.folders.map(f =>
    `<button class="nav${view.type === 'folder' && view.id === f.id ? ' on' : ''}" data-folder="${f.id}">${icon('i-folder')}<span>${esc(f.name)}</span><em>${counts[f.id] || ''}</em></button>`).join('')
    : '<div class="side-empty">No folders yet</div>';
}
$('#side').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.view) go({ type: b.dataset.view });
  else if (b.dataset.setlist) go({ type: 'setlist', id: b.dataset.setlist });
  else if (b.dataset.folder) go({ type: 'folder', id: b.dataset.folder });
  else return;
  document.body.classList.remove('side-open');
});
$('#menuBtn').onclick = () => document.body.classList.toggle('side-open');
$('#scrim').onclick = () => document.body.classList.remove('side-open');

function go(v) {
  view = v;
  setSelecting(false);
  query = ''; $('#search').value = '';
  content.scrollTop = 0;
  render();
}
function render() { renderSide(); renderMain(); }

// ---------- main area ----------
function renderMain() {
  if (view.type === 'setlist') return renderSetlist();
  const head = $('#headActions');
  $('#filters').hidden = false;
  $('#sort').hidden = view.type === 'recent';
  let list = [...S.scores.values()];
  let title = 'All scores', sub = '';
  if (view.type === 'folder') {
    const f = folderOf(view.id); if (!f) return go({ type: 'all' });
    title = f.name; list = list.filter(s => s.folderId === f.id);
  }
  if (view.type === 'recent') { title = 'Recently added'; list = list.sort((a, b) => b.addedAt - a.addedAt).slice(0, 60); }
  else sorted(list);
  sub = plural(list.length, 'score');
  list = list.filter(s => matches(s, query));
  $('#viewTitle').textContent = title;
  $('#viewSub').textContent = sub;
  head.innerHTML = `<button class="btn accent" id="addBtn">${icon('i-plus')}<span>Add PDFs</span></button>` +
    (view.type === 'folder' ? `<button class="icon-btn" id="folderMore" aria-label="Folder options">${icon('i-more')}</button>` : '');
  $('#addBtn').onclick = pickFiles;
  if (view.type === 'folder') $('#folderMore').onclick = () => folderMenu(view.id);

  if (!S.scores.size) {
    content.innerHTML = `<div class="empty"><h2>Add your sheet music</h2>
      <p>Tap <b>Add PDFs</b> and pick files from the Files app, or drag PDFs in. They're ready to play the moment they appear.</p>
      <button class="btn accent big" id="addBig">${icon('i-plus')}Add PDFs</button>
      <p style="margin-top:22px;font-size:14px">Tip: AirDropped PDFs land in Files › Downloads. Pick several at once.</p></div>`;
    $('#addBig').onclick = pickFiles;
    return;
  }
  if (!list.length) {
    content.innerHTML = `<div class="empty"><h2>${query ? 'No matches' : 'Nothing here yet'}</h2><p>${query ? 'Try another word.' :
      'Tap <b>Add PDFs</b> to add music straight into this folder, or use <b>Move to folder</b> on any score.'}</p></div>`;
    return;
  }
  content.innerHTML = `<div class="grid${selecting ? ' selecting' : ''}">${list.map(cardHtml).join('')}</div>`;
}
function cardHtml(s) {
  const t = thumbs.get(s.id);
  return `<div class="card${selected.has(s.id) ? ' sel' : ''}" data-id="${s.id}" role="button" tabindex="0">
    <div class="thumb">${t ? `<img src="${t}" alt="" loading="lazy">` : `<div class="ph">${s.broken ? 'Can’t read PDF' : 'Preparing…'}</div>`}
      ${s.pageCount ? `<span class="pg">${plural(s.pageCount, 'page')}</span>` : ''}
      <span class="chk">${icon('i-check')}</span>
      <button class="more" aria-label="Options">${icon('i-more')}</button></div>
    <div class="t">${esc(s.title)}</div><div class="c">${esc(s.composer || '')}</div></div>`;
}
content.addEventListener('click', e => {
  const card = e.target.closest('.card'); if (!card) return;
  const id = card.dataset.id;
  if (selecting) { toggleSel(id, card); return; }
  if (e.target.closest('.more')) { scoreMenu(id); return; }
  openScore(id);
});
function openScore(id) {
  openViewer({ ids: [id], onClose: () => {} });
}

$('#search').addEventListener('input', e => { query = e.target.value.trim(); renderMain(); });
$('#sort').addEventListener('change', e => { S.settings.sort = e.target.value; saveSettings(); renderMain(); });

// ---------- selection ----------
function setSelecting(on) {
  selecting = on; selected.clear();
  $('#selectBar').hidden = !on;
  $('#selectBtn').innerHTML = on ? 'Done' : `${icon('i-select')}Select`;
  document.querySelector('.grid')?.classList.toggle('selecting', on);
  document.querySelectorAll('.card.sel').forEach(c => c.classList.remove('sel'));
  updateSelCount();
}
function toggleSel(id, card) {
  selected.has(id) ? selected.delete(id) : selected.add(id);
  card.classList.toggle('sel', selected.has(id));
  updateSelCount();
}
function updateSelCount() { $('#selCount').textContent = `${selected.size} selected`; }
$('#selectBtn').onclick = () => setSelecting(!selecting);
$('#selectBar').addEventListener('click', async e => {
  const b = e.target.closest('[data-sel]'); if (!b) return;
  const ids = [...selected];
  if (b.dataset.sel === 'cancel') return setSelecting(false);
  if (!ids.length) return ui.toast('Tap scores to select them first');
  if (b.dataset.sel === 'setlist') { if (await addToSetlist(ids)) setSelecting(false); }
  if (b.dataset.sel === 'folder') { if (await moveToFolder(ids)) setSelecting(false); }
  if (b.dataset.sel === 'delete') { if (await deleteScores(ids)) setSelecting(false); }
});

// ---------- score actions ----------
async function scoreMenu(id) {
  const s = S.scores.get(id);
  const f = folderOf(s.folderId);
  const v = await ui.choose(s.title, [
    { label: 'Open', value: 'open', icon: 'i-play' },
    { label: 'Edit title & composer', value: 'edit', icon: 'i-text' },
    { label: 'Add to setlist', value: 'setlist', icon: 'i-setlist' },
    { label: 'Move to folder', value: 'folder', icon: 'i-folder', sub: f ? f.name : '' },
    { label: 'Delete', value: 'delete', icon: 'i-trash', danger: true },
  ]);
  if (v === 'open') openScore(id);
  if (v === 'edit') editScore(id);
  if (v === 'setlist') addToSetlist([id]);
  if (v === 'folder') moveToFolder([id]);
  if (v === 'delete') deleteScores([id]);
}

function editScore(id) {
  const s = S.scores.get(id);
  const sh = ui.openSheet(`<h2>Edit score</h2><form>
    <label class="fld"><span>Title</span><input type="text" name="title" value="${esc(s.title)}"></label>
    <label class="fld"><span>Composer / artist</span><input type="text" name="composer" value="${esc(s.composer || '')}" placeholder="Optional"></label>
    <p style="font-size:13px">File: ${esc(s.fileName || '')} · ${plural(s.pageCount || 0, 'page')}</p>
    <div class="sheet-actions"><button type="button" class="btn ghost" data-x>Cancel</button><button class="btn accent">Save</button></div></form>`);
  sh.el.querySelector('[data-x]').onclick = () => sh.close();
  sh.el.querySelector('form').onsubmit = e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    s.title = fd.get('title').trim() || s.title;
    s.composer = fd.get('composer').trim();
    db.put('scores', s); sh.close(); render();
  };
}

async function addToSetlist(ids) {
  const opts = S.setlists.map(s => ({ label: s.name, value: s.id, sub: plural(s.items.length, 'song'), icon: 'i-setlist' }));
  opts.push({ label: 'New setlist…', value: '__new', icon: 'i-plus' });
  let id = await ui.choose(ids.length > 1 ? `Add ${ids.length} scores to…` : 'Add to setlist', opts);
  if (!id) return false;
  if (id === '__new') { const sl = await newSetlist(false); if (!sl) return false; id = sl.id; }
  const sl = setlistOf(id);
  const add = ids.filter(x => !sl.items.includes(x));
  sl.items.push(...add);
  await db.put('setlists', sl);
  ui.toast(add.length ? `Added to “${sl.name}”` : `Already in “${sl.name}”`);
  render();
  return true;
}

async function moveToFolder(ids) {
  const cur = ids.length === 1 ? S.scores.get(ids[0]).folderId : undefined;
  const opts = S.folders.map(f => ({ label: f.name, value: f.id, icon: 'i-folder', picked: f.id === cur }));
  opts.push({ label: 'New folder…', value: '__new', icon: 'i-plus' });
  opts.push({ label: 'No folder', value: '__none', icon: 'i-x', picked: cur === null || cur === '' });
  let fid = await ui.choose(ids.length > 1 ? `Move ${ids.length} scores to…` : 'Move to folder', opts);
  if (!fid) return false;
  if (fid === '__new') { const f = await newFolder(false); if (!f) return false; fid = f.id; }
  if (fid === '__none') fid = null;
  const changed = ids.map(i => S.scores.get(i)).filter(Boolean);
  changed.forEach(s => (s.folderId = fid));
  await db.putMany('scores', changed);
  ui.toast(fid ? `Moved to “${folderOf(fid).name}”` : 'Removed from folder');
  render();
  return true;
}

async function deleteScores(ids) {
  const one = ids.length === 1 ? S.scores.get(ids[0]).title : null;
  if (!(await ui.confirmDlg(one ? `Delete “${one}”?` : `Delete ${ids.length} scores?`,
    'This removes the PDF and its marks from this device. It also leaves any setlists it was in.', 'Delete', true))) return false;
  for (const id of ids) {
    S.scores.delete(id);
    R.forgetDoc(id); ink.forgetMarks(id);
    if (thumbs.has(id)) { URL.revokeObjectURL(thumbs.get(id)); thumbs.delete(id); }
    await Promise.all(['scores', 'files', 'thumbs', 'marks'].map(st => db.del(st, id)));
  }
  for (const sl of S.setlists) {
    const n = sl.items.length; sl.items = sl.items.filter(i => S.scores.has(i));
    if (sl.items.length !== n) await db.put('setlists', sl);
  }
  ui.toast(one ? 'Deleted' : `Deleted ${ids.length} scores`);
  render();
  return true;
}

// ---------- folders ----------
async function newFolder(navigate = true) {
  const name = await ui.ask('New folder', '', 'e.g. Big Band, Wedding gigs, Practice', 'Create');
  if (!name) return null;
  const f = { id: uid(), name };
  S.folders.push(f); S.folders.sort((a, b) => coll.compare(a.name, b.name));
  await db.put('folders', f);
  if (navigate) go({ type: 'folder', id: f.id }); else renderSide();
  return f;
}
async function folderMenu(id) {
  const f = folderOf(id);
  const v = await ui.choose(f.name, [
    { label: 'Rename folder', value: 'rename', icon: 'i-text' },
    { label: 'Delete folder (keeps the scores)', value: 'delete', icon: 'i-trash', danger: true },
  ]);
  if (v === 'rename') { const n = await ui.ask('Rename folder', f.name); if (n) { f.name = n; await db.put('folders', f); render(); } }
  if (v === 'delete') {
    if (!(await ui.confirmDlg(`Delete folder “${f.name}”?`, 'The scores inside stay in your library.', 'Delete folder', true))) return;
    const changed = [...S.scores.values()].filter(s => s.folderId === id);
    changed.forEach(s => (s.folderId = null));
    await db.putMany('scores', changed);
    S.folders = S.folders.filter(x => x.id !== id);
    await db.del('folders', id);
    go({ type: 'all' });
  }
}
$('#newFolder').onclick = () => newFolder();

// ---------- setlists ----------
async function newSetlist(navigate = true) {
  const name = await ui.ask('New setlist', '', 'e.g. Friday at The Blue Room', 'Create');
  if (!name) return null;
  const sl = { id: uid(), name, items: [], createdAt: Date.now(), order: Date.now() };
  S.setlists.push(sl);
  await db.put('setlists', sl);
  if (navigate) { go({ type: 'setlist', id: sl.id }); addSongs(sl.id); } else renderSide();
  return sl;
}
$('#newSetlist').onclick = () => newSetlist();

function renderSetlist() {
  const sl = setlistOf(view.id); if (!sl) return go({ type: 'all' });
  $('#filters').hidden = true;
  $('#viewTitle').textContent = sl.name;
  const pages = sl.items.reduce((a, id) => a + (S.scores.get(id)?.pageCount || 0), 0);
  $('#viewSub').textContent = `${plural(sl.items.length, 'song')} · ${plural(pages, 'page')}`;
  $('#headActions').innerHTML = `<button class="btn accent" id="slStart"${sl.items.length ? '' : ' disabled'}>${icon('i-play')}<span>Start</span></button>
    <button class="btn" id="slAdd">${icon('i-plus')}<span>Add songs</span></button>
    <button class="icon-btn" id="slMore" aria-label="Setlist options">${icon('i-more')}</button>`;
  $('#slStart').onclick = () => playSetlist(sl, 0);
  $('#slAdd').onclick = () => addSongs(sl.id);
  $('#slMore').onclick = () => setlistMenu(sl.id);
  if (!sl.items.length) {
    content.innerHTML = `<div class="empty"><h2>Empty setlist</h2><p>Add songs from your library, or import new PDFs straight into this setlist.</p>
      <button class="btn accent big" id="slAdd2">${icon('i-plus')}Add songs</button>
      <button class="btn big" id="slImport" style="margin-left:8px">${icon('i-down')}Import PDFs</button></div>`;
    $('#slAdd2').onclick = () => addSongs(sl.id);
    $('#slImport').onclick = pickFiles;
    return;
  }
  content.innerHTML = `<div class="slist" id="slist">${sl.items.map((id, i) => {
    const s = S.scores.get(id); if (!s) return '';
    return `<div class="srow" data-i="${i}"><div class="grip" aria-label="Drag to reorder">${icon('i-grip')}</div>
      <span class="num">${i + 1}</span>${thumbImg(id)}
      <button class="info" data-open="${i}"><b>${esc(s.title)}</b><span>${esc([s.composer, s.pageCount ? plural(s.pageCount, 'page') : ''].filter(Boolean).join(' · '))}</span></button>
      <button class="icon-btn rm" data-rm="${i}" aria-label="Remove from setlist">${icon('i-x')}</button></div>`;
  }).join('')}</div>
  <p style="color:var(--muted);font-size:14px;margin-top:16px">Drag ${icon('i-grip').replace('<svg>', '<svg style="width:16px;height:16px;vertical-align:-3px">')} to reorder. Tap a song to start the set from there.</p>`;
}
content.addEventListener('click', async e => {
  if (view.type !== 'setlist') return;
  const sl = setlistOf(view.id);
  const o = e.target.closest('[data-open]');
  if (o) return playSetlist(sl, +o.dataset.open);
  const rm = e.target.closest('[data-rm]');
  if (rm) {
    const i = +rm.dataset.rm, [gone] = sl.items.splice(i, 1);
    await db.put('setlists', sl); render();
    ui.toast(`Removed “${S.scores.get(gone)?.title}”`);
  }
});
function playSetlist(sl, i) {
  openViewer({ ids: sl.items, idx: i, name: sl.name, onClose: () => {} });
}

// Drag to reorder: works with finger, Pencil and mouse. Rows slide out of the way as you drag.
content.addEventListener('pointerdown', e => {
  const grip = e.target.closest('.grip'); if (!grip || view.type !== 'setlist') return;
  e.preventDefault();
  const sl = setlistOf(view.id);
  const list = $('#slist'), row = grip.closest('.srow');
  const rows = [...list.children], from = rows.indexOf(row);
  const rects = rows.map(r => r.getBoundingClientRect());
  const gap = rows[1] ? rects[1].top - rects[0].bottom : 8;
  const h = rects[from].height + gap;
  const scroll0 = content.scrollTop, startY = e.clientY;
  let lastY = e.clientY, to = from, raf = 0, alive = true;
  row.classList.add('dragging');
  rows.forEach(r => r !== row && r.classList.add('shift'));
  document.body.classList.add('drag-active');
  try { grip.setPointerCapture(e.pointerId); } catch {}
  const update = () => {
    const dy = lastY - startY + (content.scrollTop - scroll0);
    row.style.transform = `translateY(${dy}px)`;
    const center = rects[from].top + rects[from].height / 2 + dy;
    to = 0;
    rects.forEach((r, i) => { if (i !== from && r.top + r.height / 2 < center) to++; });
    rows.forEach((r, i) => {
      if (r === row) return;
      let off = 0;
      if (from < to && i > from && i <= to) off = -h;
      else if (to < from && i >= to && i < from) off = h;
      r.style.transform = off ? `translateY(${off}px)` : '';
    });
  };
  const tick = () => {   // scroll the list when dragging near the top or bottom edge
    if (!alive) return;
    const cr = content.getBoundingClientRect();
    const v = lastY < cr.top + 70 ? -(cr.top + 70 - lastY) / 4 : lastY > cr.bottom - 70 ? (lastY - cr.bottom + 70) / 4 : 0;
    if (v) { content.scrollTop += v; update(); }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  const move = ev => { if (ev.pointerId !== e.pointerId) return; lastY = ev.clientY; update(); };
  const end = async ev => {
    if (ev.pointerId !== e.pointerId) return;
    alive = false; cancelAnimationFrame(raf);
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', end);
    grip.removeEventListener('pointercancel', end);
    document.body.classList.remove('drag-active');
    if (to !== from) {
      const [it] = sl.items.splice(from, 1);
      sl.items.splice(to, 0, it);
      await db.put('setlists', sl);
    }
    renderSetlist();
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
});

function addSongs(id) {
  const sl = setlistOf(id);
  const sh = ui.openSheet(`<h2>Add songs to “${esc(sl.name)}”</h2>
    <label class="search"><svg><use href="#i-search"/></svg><input type="search" id="pickQ" placeholder="Search your library" autocomplete="off"></label>
    <div class="pick-list" id="pickList"></div>
    <div class="sheet-actions"><button class="btn ghost left" id="pickImport">${icon('i-down')}Import new PDFs</button><button class="btn accent" data-x>Done</button></div>`,
    { wide: true, onClose: () => render() });
  const listEl = sh.el.querySelector('#pickList');
  const draw = () => {
    const q = sh.el.querySelector('#pickQ').value.trim();
    const all = sorted([...S.scores.values()].filter(s => matches(s, q)), 'title');
    listEl.innerHTML = all.length ? all.map(s => {
      const pos = sl.items.indexOf(s.id);
      return `<button class="pick${pos >= 0 ? ' in' : ''}" data-id="${s.id}">${thumbImg(s.id)}
        <span class="info"><b>${esc(s.title)}</b><span>${esc(s.composer || '')}</span></span>
        <span class="state">${pos >= 0 ? `<b style="font-size:14px">${pos + 1}</b>` : icon('i-plus')}</span></button>`;
    }).join('') : `<p style="padding:10px">${S.scores.size ? 'No matches.' : 'Your library is empty. Import some PDFs first.'}</p>`;
  };
  draw();
  sh.el.querySelector('#pickQ').oninput = draw;
  listEl.onclick = e => {
    const b = e.target.closest('[data-id]'); if (!b) return;
    const i = sl.items.indexOf(b.dataset.id);
    if (i >= 0) sl.items.splice(i, 1); else sl.items.push(b.dataset.id);
    db.put('setlists', sl); draw();
  };
  sh.el.querySelector('[data-x]').onclick = () => sh.close();
  sh.el.querySelector('#pickImport').onclick = () => { sh.close(); pickFiles(); };
}

async function setlistMenu(id) {
  const sl = setlistOf(id);
  const v = await ui.choose(sl.name, [
    { label: 'Rename setlist', value: 'rename', icon: 'i-text' },
    { label: 'Duplicate setlist', value: 'dup', icon: 'i-setlist' },
    { label: 'Delete setlist (keeps the scores)', value: 'delete', icon: 'i-trash', danger: true },
  ]);
  if (v === 'rename') { const n = await ui.ask('Rename setlist', sl.name); if (n) { sl.name = n; await db.put('setlists', sl); render(); } }
  if (v === 'dup') {
    const c = { ...sl, id: uid(), name: sl.name + ' copy', items: sl.items.slice(), createdAt: Date.now(), order: Date.now() };
    S.setlists.push(c); await db.put('setlists', c); go({ type: 'setlist', id: c.id });
  }
  if (v === 'delete') {
    if (!(await ui.confirmDlg(`Delete setlist “${sl.name}”?`, 'The songs stay in your library.', 'Delete setlist', true))) return;
    S.setlists = S.setlists.filter(x => x.id !== id);
    await db.del('setlists', id);
    go({ type: 'all' });
  }
}

// ---------- importing ----------
function pickFiles() { const i = $('#fileInput'); i.value = ''; i.click(); }
$('#fileInput').addEventListener('change', e => importFiles([...e.target.files]));

async function importFiles(files) {
  const zips = files.filter(f => /\.zip$/i.test(f.name) || f.type === 'application/zip');
  const pdfs = files.filter(f => !zips.includes(f));
  if (zips.length) await restoreBackup(zips[0]);
  if (!pdfs.length) return;
  ui.toast(`Adding ${plural(pdfs.length, 'PDF')}…`, 10000);
  const folderId = view.type === 'folder' ? view.id : null;
  const sl = view.type === 'setlist' ? setlistOf(view.id) : null;
  const added = [], skipped = [];
  for (const f of pdfs) {
    try {
      const buf = await f.arrayBuffer();
      const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(1024, buf.byteLength)));
      if (!head.includes('%PDF')) { skipped.push(f.name); continue; }
      const dup = [...S.scores.values()].find(s => s.fileName === f.name && s.size === f.size);
      if (dup) { skipped.push(f.name); if (sl && !sl.items.includes(dup.id)) sl.items.push(dup.id); continue; }
      const s = { id: uid(), title: cleanTitle(f.name), composer: '', folderId, pageCount: 0, addedAt: Date.now() + added.length, fileName: f.name, size: f.size };
      await db.put('files', { id: s.id, blob: new Blob([buf], { type: 'application/pdf' }) });
      await db.put('scores', s);
      S.scores.set(s.id, s);
      added.push(s.id);
      if (sl) sl.items.push(s.id);
      queueThumb(s.id);
    } catch (err) { console.error(err); skipped.push(f.name); }
  }
  if (sl) await db.put('setlists', sl);
  navigator.storage?.persist?.().catch(() => {});
  render();
  const where = sl ? ` to “${sl.name}”` : folderId ? ` to “${folderOf(folderId).name}”` : '';
  ui.toast(added.length ? `Added ${plural(added.length, 'score')}${where}${skipped.length ? ` · skipped ${skipped.length} (already here or not a PDF)` : ''}`
    : `Nothing added: ${skipped.length > 1 ? 'those files are' : 'that file is'} already here or not a PDF`, 3500);
}

// Drag files in (iPad Split View from Files, or a computer).
let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('#dropHint').hidden = false; });
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropHint').hidden = true; } });
window.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; $('#dropHint').hidden = true;
  importFiles([...e.dataTransfer.files]);
});

// ---------- thumbnails (made in the background, never in the way of page turns) ----------
const thumbQ = [];
let thumbing = false;
function queueThumb(id) { thumbQ.push(id); if (!thumbing) runThumbs(); }
async function runThumbs() {
  thumbing = true;
  while (thumbQ.length) {
    const id = thumbQ.shift();
    const s = S.scores.get(id); if (!s) continue;
    await R.whenIdle();
    try {
      const f = await db.get('files', id);
      const { blob, pages } = await R.makeThumb(new Uint8Array(await f.blob.arrayBuffer()));
      await db.put('thumbs', { id, blob });
      thumbs.set(id, URL.createObjectURL(blob));
      if (s.pageCount !== pages) { s.pageCount = pages; await db.put('scores', s); }
    } catch (err) { console.warn('thumb failed', id, err); s.broken = true; }
    const card = content.querySelector(`.card[data-id="${id}"]`);
    if (card) card.outerHTML = cardHtml(s);
    else if (view.type === 'setlist') renderSetlist();
  }
  thumbing = false;
}

// ---------- settings & backup ----------
async function openSettings() {
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  const mb = est?.usage ? (est.usage / 1048576).toFixed(0) + ' MB' : '';
  const sw = (k, label, help) => `<div class="setting"><div class="txt">${label}${help ? `<small>${help}</small>` : ''}</div>
    <button class="switch${S.settings[k] ? ' on' : ''}" data-k="${k}" role="switch" aria-checked="${!!S.settings[k]}"></button></div>`;
  const sh = ui.openSheet(`<h2>Settings</h2>
    <div class="setting"><div class="txt">Tap to go back<small>How much of the left side turns back a page. The rest turns forward.</small></div>
      <div class="seg" id="backZone"><button data-v="third">Left third</button><button data-v="half">Left half</button></div></div>
    ${sw('twoUp', 'Two pages side by side', 'When the iPad is sideways.')}
    ${sw('pencilDraws', 'Apple Pencil writes right away', 'No need to tap Draw first. Fingers still turn pages.')}
    ${sw('night', 'Night pages', 'White pages turn dark for dim stages.')}
    <div class="sheet-section">Foot pedals &amp; keyboards</div>
    <p style="margin-top:6px;font-size:14px">Page-turn pedals work out of the box: → ↓ Page Down and Space go forward, ← ↑ Page Up go back.</p>
    <div class="sheet-section">Your library</div>
    <p style="margin-top:6px;font-size:14px">${plural(S.scores.size, 'score')}${mb ? ` · ${mb} on this device` : ''} · ${persisted ? 'protected from automatic cleanup' : 'not yet marked as permanent storage'}.
    Everything works offline. Keep a backup in Files or iCloud Drive in case you lose or replace the iPad.</p>
    <div class="sheet-actions" style="justify-content:flex-start;margin-top:6px">
      <button class="btn" id="doBackup">${icon('i-up')}Back up library</button>
      <button class="btn" id="doRestore">${icon('i-down')}Restore a backup</button></div>
    <div class="sheet-actions"><button class="btn accent" data-x>Done</button></div>`);
  const seg = sh.el.querySelector('#backZone');
  const paintSeg = () => seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === S.settings.backZone));
  paintSeg();
  seg.onclick = e => { const b = e.target.closest('button'); if (!b) return; S.settings.backZone = b.dataset.v; saveSettings(); paintSeg(); };
  sh.el.querySelectorAll('.switch').forEach(b => b.onclick = () => {
    S.settings[b.dataset.k] = !S.settings[b.dataset.k]; saveSettings();
    b.classList.toggle('on', S.settings[b.dataset.k]); b.setAttribute('aria-checked', S.settings[b.dataset.k]);
  });
  sh.el.querySelector('#doBackup').onclick = makeBackup;
  sh.el.querySelector('#doRestore').onclick = () => { sh.close(); pickFiles(); };
  sh.el.querySelector('[data-x]').onclick = () => sh.close();
}
$('#settingsBtn').onclick = () => { document.body.classList.remove('side-open'); openSettings(); };

async function makeBackup() {
  if (!S.scores.size) return ui.toast('Nothing to back up yet');
  ui.toast('Preparing backup…', 20000);
  const [marks, files] = [await db.all('marks'), []];
  for (const id of S.scores.keys()) { const f = await db.get('files', id); if (f) files.push({ name: `pdf/${id}.pdf`, data: f.blob }); }
  const lib = { app: 'StandBy', version: 1, exportedAt: new Date().toISOString(),
    scores: [...S.scores.values()].map(({ broken, ...s }) => s), folders: S.folders, setlists: S.setlists, marks, settings: S.settings };
  const zip = await writeZip([{ name: 'library.json', data: JSON.stringify(lib) }, ...files]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(zip);
  a.download = `StandBy backup ${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  ui.toast('Backup saved (' + (zip.size / 1048576).toFixed(1) + ' MB)', 3000);
}

async function restoreBackup(file) {
  try {
    const z = await readZip(file);
    if (!z.has('library.json')) return ui.toast('That zip is not a StandBy backup');
    const lib = JSON.parse(await (await z.get('library.json')()).text());
    let added = 0;
    for (const s of lib.scores || []) {
      if (S.scores.has(s.id)) continue;
      const get = z.get(`pdf/${s.id}.pdf`); if (!get) continue;
      const blob = new Blob([await (await get()).arrayBuffer()], { type: 'application/pdf' });
      await db.put('files', { id: s.id, blob });
      await db.put('scores', s);
      S.scores.set(s.id, s); added++;
      queueThumb(s.id);
    }
    for (const f of lib.folders || []) if (!folderOf(f.id)) { S.folders.push(f); await db.put('folders', f); }
    for (const sl of lib.setlists || []) {
      const mine = setlistOf(sl.id);
      if (!mine) { S.setlists.push(sl); await db.put('setlists', sl); }
    }
    for (const m of lib.marks || []) if (!(await db.get('marks', m.id))) await db.put('marks', m);
    S.folders.sort((a, b) => coll.compare(a.name, b.name));
    render();
    ui.toast(`Restored ${plural(added, 'score')}`, 3000);
  } catch (err) { console.error(err); ui.toast('Could not read that backup'); }
}

// ---------- start ----------
(async function start() {
  await load();
  $('#sort').value = S.settings.sort;
  const have = new Set(await db.keys('thumbs'));
  await Promise.all([...have].map(async id => {
    const t = await db.get('thumbs', id); if (t && S.scores.has(id)) thumbs.set(id, URL.createObjectURL(t.blob));
  }));
  render();
  for (const id of S.scores.keys()) if (!have.has(id)) queueThumb(id);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
