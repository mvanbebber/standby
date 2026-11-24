// In-memory app state (metadata only; PDFs stay in IndexedDB until opened).
import * as db from './db.js';

export const DEFAULTS = {
  backZone: 'third',   // 'third' | 'half': how much of the left side turns back
  twoUp: true,         // two pages side by side when the iPad is sideways
  pencilDraws: true,   // Apple Pencil writes on the page without entering Draw mode
  night: false,        // inverted pages for dark stages
  sort: 'title',
  tool: 'pen', color: '#d32f2f', size: 1, stamp: 'fermata',
};

export const S = {
  scores: new Map(),
  folders: [],
  setlists: [],
  settings: { ...DEFAULTS },
};

export async function load() {
  const [scores, folders, setlists, st] = await Promise.all([
    db.all('scores'), db.all('folders'), db.all('setlists'), db.get('kv', 'settings'),
  ]);
  for (const s of scores) S.scores.set(s.id, s);
  S.folders = folders.sort((a, b) => a.name.localeCompare(b.name));
  S.setlists = setlists.sort((a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt));
  if (st) Object.assign(S.settings, st.v);
}

export function saveSettings() { return db.put('kv', { k: 'settings', v: S.settings }); }
export function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
