// Tiny IndexedDB wrapper. Stores:
//   scores   {id, title, composer, libraryId, pageCount, addedAt, fileName, size}
//   files    {id, blob}           the PDF itself
//   thumbs   {id, blob}           first-page JPEG for the library grid
//   marks    {id, pages:{n:[]}}   annotations, keyed by score id
//   setlists {id, name, libraryId, items:[scoreId], createdAt}
//   libraries {id, name, createdAt}  one per band; scores and setlists belong to one
//   folders  (old, read once to migrate into libraries)
//   kv       {k, v}               settings and other small values
const STORES = ['scores', 'files', 'thumbs', 'marks', 'setlists', 'folders', 'kv', 'libraries'];
let dbp;

function open() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('standby', 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: s === 'kv' ? 'k' : 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const wrap = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = tx => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); });

export async function get(store, id) { const d = await open(); return wrap(d.transaction(store).objectStore(store).get(id)); }
export async function all(store) { const d = await open(); return wrap(d.transaction(store).objectStore(store).getAll()); }
export async function keys(store) { const d = await open(); return wrap(d.transaction(store).objectStore(store).getAllKeys()); }
export async function put(store, val) { const d = await open(); const tx = d.transaction(store, 'readwrite'); tx.objectStore(store).put(val); return done(tx); }
export async function putMany(store, vals) { const d = await open(); const tx = d.transaction(store, 'readwrite'); const s = tx.objectStore(store); for (const v of vals) s.put(v); return done(tx); }
export async function del(store, id) { const d = await open(); const tx = d.transaction(store, 'readwrite'); tx.objectStore(store).delete(id); return done(tx); }
