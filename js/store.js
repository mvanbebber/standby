// In-memory app state (metadata only; PDFs stay in IndexedDB until opened).
import * as db from './db.js';

export const DEFAULTS = {
  backZone: 'third',   // 'third' | 'half': how much of the left side turns back
  twoUp: true,         // two pages side by side when the iPad is sideways
  halfTurns: false,    // half-page turns (one page on screen); turning this on turns twoUp off and vice versa
  libraryId: null,     // the band library being shown
  pencilDraws: true,   // Apple Pencil writes on the page without entering Draw mode
  night: false,        // inverted pages for dark stages
  trim: true,          // trim white margins so the music fills the screen
  sort: 'title',
  tool: 'pen', color: '#d32f2f', size: 1, stamp: 'fermata',
};

export const S = {
  scores: new Map(),
  libraries: [],
  setlists: [],
  settings: { ...DEFAULTS },
};

export async function load() {
  const [scores, libs, setlists, st] = await Promise.all([
    db.all('scores'), db.all('libraries'), db.all('setlists'), db.get('kv', 'settings'),
  ]);
  if (st) Object.assign(S.settings, st.v);
  // Older data had folders: each folder becomes a library, loose scores go to "My Library".
  if (!libs.length) {
    const folders = await db.all('folders');
    libs.push(...folders.map(f => ({ id: f.id, name: f.name, createdAt: Date.now() })));
    if (!libs.length || scores.some(s => !libs.some(l => l.id === s.folderId))) libs.unshift({ id: uid(), name: 'My Library', createdAt: Date.now() });
    await db.putMany('libraries', libs);
  }
  const fallback = libs.find(l => l.id === S.settings.libraryId) || libs[0];
  const fix = [];
  for (const s of scores) {
    if (!libs.some(l => l.id === s.libraryId)) { s.libraryId = libs.some(l => l.id === s.folderId) ? s.folderId : fallback.id; fix.push(s); }
    delete s.folderId;
    S.scores.set(s.id, s);
  }
  const fixSl = [];
  for (const sl of setlists) if (!libs.some(l => l.id === sl.libraryId)) { sl.libraryId = S.scores.get(sl.items[0])?.libraryId || fallback.id; fixSl.push(sl); }
  if (fix.length) await db.putMany('scores', fix);
  if (fixSl.length) await db.putMany('setlists', fixSl);
  S.libraries = libs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  S.setlists = setlists.sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt));
  if (!libs.some(l => l.id === S.settings.libraryId)) S.settings.libraryId = fallback.id;
}
export const curLib = () => S.libraries.find(l => l.id === S.settings.libraryId) || S.libraries[0];

export function saveSettings() { return db.put('kv', { k: 'settings', v: S.settings }); }
export function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
