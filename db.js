import Dexie from 'https://esm.sh/dexie@3.2.7';

let db;
let dbInitPromise = null;
let usingLocalStorage = false;
let lsToastShown = false;

// Single key holding a full snapshot of all data. This is BOTH:
//  - the localStorage fallback store (when IndexedDB is unavailable), and
//  - a redundant backup mirror of IndexedDB (refreshed after every write).
// It is never deleted, so if IndexedDB fails to open or gets evicted, the
// user's data is still here and can be shown / restored instead of a blank app.
const MIRROR_KEY = 'jsl_mirror';

function buildDexie() {
  const d = new Dexie('JustShoppingListDB');
  d.version(1).stores({
    lists: '++id, name, createdAt, updatedAt',
    items: '++id, listId, name, qty, category, checked, addedFrom',
  });
  d.version(2).stores({
    lists: '++id, name, createdAt, updatedAt',
    items: '++id, listId, name, qty, category, checked, addedFrom, lastCheckedAt',
  });
  d.on('versionchange', () => {
    console.log('Database version changed in another tab. Closing connection to avoid blocking.');
    d.close();
  });
  return d;
}

async function initDB() {
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = (async () => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      console.warn('IndexedDB not supported/available, falling back to localStorage');
      usingLocalStorage = true;
      ensureMirrorFromLegacy();
      return;
    }

    // Retry opening before giving up — a single transient failure on reload
    // must NOT drop the user into an empty fallback store.
    let opened = false;
    for (let attempt = 0; attempt < 3 && !opened; attempt++) {
      try {
        db = buildDexie();
        await db.open();
        opened = true;
      } catch (err) {
        console.error(`Dexie open attempt ${attempt + 1} failed:`, err);
        try { db.close(); } catch { /* ignore */ }
        db = null;
        await new Promise(r => setTimeout(r, 150 * (attempt + 1)));
      }
    }

    if (!opened) {
      // Could not open IndexedDB. Fall back to the mirror, which still holds
      // the last known-good data — do NOT show an empty list.
      console.error('IndexedDB could not be opened after retries; using local backup.');
      usingLocalStorage = true;
      db = null;
      ensureMirrorFromLegacy();
      const mirror = readMirror();
      window.dispatchEvent(new CustomEvent('jsl-toast', {
        detail: {
          msg: (mirror && mirror.lists.length)
            ? 'Database busy — showing your data from local backup.'
            : 'Storage is having trouble — changes may not persist.',
        },
      }));
      return;
    }

    usingLocalStorage = false;

    // Request persistent storage so the browser is less likely to evict data.
    if (navigator.storage && navigator.storage.persist) {
      try {
        const persisted = await navigator.storage.persist();
        console.log(`Persistent storage status: ${persisted}`);
        if (!persisted && !sessionStorage.getItem('jsl_persist_warned')) {
          sessionStorage.setItem('jsl_persist_warned', '1');
          window.dispatchEvent(new CustomEvent('jsl-toast', {
            detail: { msg: 'Tip: install this app (or back up via the menu) to keep your lists safe.' },
          }));
        }
      } catch (e) {
        console.warn('Failed to request storage persistence:', e);
      }
    }

    await migrateLocalStorageToIndexedDB();
    await restoreFromMirrorIfEmpty();
    await refreshMirror();
  })();

  return dbInitPromise;
}

async function migrateLocalStorageToIndexedDB() {
  try {
    const lsListsData = JSON.parse(localStorage.getItem('jsl_lists') || 'null');
    const lsItemsData = JSON.parse(localStorage.getItem('jsl_items') || 'null');

    if (!Array.isArray(lsListsData) || lsListsData.length === 0) {
      return;
    }

    console.log('Migrating localStorage data to IndexedDB...');

    const existingLists = await db.lists.toArray();
    const existingListsByName = new Map(existingLists.map(l => [l.name.toLowerCase().trim(), l]));

    const oldToNewId = {};

    for (const list of lsListsData) {
      let targetListId;
      const cleanName = list.name.toLowerCase().trim();

      if (existingListsByName.has(cleanName)) {
        targetListId = existingListsByName.get(cleanName).id;
      } else {
        targetListId = await db.lists.add({
          name: list.name,
          createdAt: list.createdAt || new Date().toISOString(),
          updatedAt: list.updatedAt || new Date().toISOString()
        });
        existingListsByName.set(cleanName, { id: targetListId, name: list.name });
      }
      oldToNewId[list.id] = targetListId;
    }

    if (Array.isArray(lsItemsData) && lsItemsData.length > 0) {
      const existingItems = await db.items.toArray();
      const existingItemsKeySet = new Set(existingItems.map(i => `${i.listId}|${i.name.toLowerCase().trim()}`));

      const itemsToAdd = [];
      for (const item of lsItemsData) {
        const newListId = oldToNewId[item.listId];
        if (newListId !== undefined) {
          const itemKey = `${newListId}|${item.name.toLowerCase().trim()}`;
          if (!existingItemsKeySet.has(itemKey)) {
            itemsToAdd.push({
              listId: newListId,
              name: item.name,
              qty: item.qty || 1,
              category: item.category || 'other',
              checked: item.checked || false,
              addedFrom: item.addedFrom || 'manual',
              lastCheckedAt: item.lastCheckedAt || null
            });
            existingItemsKeySet.add(itemKey);
          }
        }
      }

      if (itemsToAdd.length > 0) {
        await db.items.bulkAdd(itemsToAdd);
      }
    }

    localStorage.removeItem('jsl_lists');
    localStorage.removeItem('jsl_items');
    console.log('Migration from localStorage to IndexedDB complete.');

    window.dispatchEvent(new CustomEvent('jsl-toast', { detail: { msg: 'Migrated offline storage to browser database.' } }));
  } catch (e) {
    console.error('Failed to migrate localStorage data to IndexedDB:', e);
  }
}

// ─── Backup mirror ──────────────────────────────────────────────────────────

function readMirror() {
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.lists) || !Array.isArray(data.items)) return null;
    return data;
  } catch {
    return null;
  }
}

function writeMirror(lists, items) {
  try {
    localStorage.setItem(MIRROR_KEY, JSON.stringify({
      lists, items, savedAt: new Date().toISOString(),
    }));
  } catch (e) {
    console.warn('Failed to write local backup mirror:', e);
  }
}

// Snapshot the current IndexedDB contents into the mirror. Cheap for the data
// sizes this app deals with, and guarantees the backup is always consistent.
async function refreshMirror() {
  if (usingLocalStorage || !db) return;
  try {
    const [lists, items] = await Promise.all([db.lists.toArray(), db.items.toArray()]);
    writeMirror(lists, items);
  } catch (e) {
    console.warn('Backup mirror refresh failed:', e);
  }
}

// If IndexedDB opened but is empty while the mirror holds data, the DB was
// almost certainly evicted/corrupted (the mirror tracks deletes too, so an
// intentional "delete everything" leaves the mirror empty as well). Restore it.
async function restoreFromMirrorIfEmpty() {
  try {
    const mirror = readMirror();
    if (!mirror || mirror.lists.length === 0) return;
    const existing = await db.lists.count();
    if (existing > 0) return;

    console.warn('IndexedDB empty but local backup found — restoring.');
    await db.transaction('rw', db.lists, db.items, async () => {
      if (mirror.lists.length) await db.lists.bulkAdd(mirror.lists);
      if (mirror.items.length) await db.items.bulkAdd(mirror.items);
    });
    window.dispatchEvent(new CustomEvent('jsl-toast', {
      detail: { msg: 'Recovered your lists from local backup.' },
    }));
  } catch (e) {
    console.error('Failed to restore from local backup:', e);
  }
}

// Convert any legacy localStorage data (old format) into the mirror, so the
// fallback store is populated when we never reach IndexedDB.
function ensureMirrorFromLegacy() {
  if (readMirror()) return;
  try {
    const legacyLists = JSON.parse(localStorage.getItem('jsl_lists') || 'null');
    const legacyItems = JSON.parse(localStorage.getItem('jsl_items') || 'null');
    if (Array.isArray(legacyLists) && legacyLists.length) {
      writeMirror(legacyLists, Array.isArray(legacyItems) ? legacyItems : []);
    } else {
      writeMirror([], []);
    }
  } catch {
    writeMirror([], []);
  }
}

// ─── localStorage fallback helpers (canonical store = the mirror) ────────────

function lsLists() { return (readMirror() || { lists: [] }).lists || []; }
function lsItems() { return (readMirror() || { items: [] }).items || []; }
function lsSaveLists(v) { const m = readMirror() || { lists: [], items: [] }; writeMirror(v, m.items || []); }
function lsSaveItems(v) { const m = readMirror() || { lists: [], items: [] }; writeMirror(m.lists || [], v); }
function lsNextId(arr) { return arr.length ? Math.max(...arr.map(x => x.id)) + 1 : 1; }

function showLSToast() {
  if (lsToastShown) return;
  lsToastShown = true;
  window.dispatchEvent(new CustomEvent('jsl-toast', { detail: { msg: 'Storage limited in private mode — data may not persist.' } }));
}

export function isUsingLocalStorage() { return usingLocalStorage; }

export async function createList(name) {
  await initDB();
  const now = new Date().toISOString();
  if (usingLocalStorage) {
    showLSToast();
    const lists = lsLists();
    const newList = { id: lsNextId(lists), name, createdAt: now, updatedAt: now };
    lsSaveLists([...lists, newList]);
    return newList.id;
  }
  const id = await db.lists.add({ name, createdAt: now, updatedAt: now });
  await refreshMirror();
  return id;
}

export async function getLists() {
  await initDB();
  if (usingLocalStorage) return lsLists().slice().reverse();
  return db.lists.toArray().then(arr => arr.reverse());
}

export async function updateListName(id, name) {
  await initDB();
  const now = new Date().toISOString();
  if (usingLocalStorage) {
    lsSaveLists(lsLists().map(l => l.id === id ? { ...l, name, updatedAt: now } : l));
    return;
  }
  await db.lists.update(id, { name, updatedAt: now });
  await refreshMirror();
}

export async function deleteList(id) {
  await initDB();
  if (usingLocalStorage) {
    lsSaveLists(lsLists().filter(l => l.id !== id));
    lsSaveItems(lsItems().filter(i => i.listId !== id));
    return;
  }
  await db.items.where('listId').equals(id).delete();
  await db.lists.delete(id);
  await refreshMirror();
}

export async function addItem(listId, { name, qty = 1, category = 'other', addedFrom = 'manual', checked = false, lastCheckedAt = null }) {
  await initDB();
  const now = new Date().toISOString();
  if (usingLocalStorage) {
    const items = lsItems();
    const newItem = { id: lsNextId(items), listId, name, qty, category, checked, addedFrom, lastCheckedAt };
    lsSaveItems([...items, newItem]);
    lsSaveLists(lsLists().map(l => l.id === listId ? { ...l, updatedAt: now } : l));
    return newItem.id;
  }
  const id = await db.items.add({ listId, name, qty, category, checked, addedFrom, lastCheckedAt });
  await db.lists.update(listId, { updatedAt: now });
  await refreshMirror();
  return id;
}

export async function getItems(listId) {
  await initDB();
  if (usingLocalStorage) return lsItems().filter(i => i.listId === listId);
  return db.items.where('listId').equals(listId).toArray();
}

export async function toggleItem(id) {
  await initDB();
  if (usingLocalStorage) {
    lsSaveItems(lsItems().map(i => {
      if (i.id !== id) return i;
      const checked = !i.checked;
      return { ...i, checked, ...(checked ? { lastCheckedAt: new Date().toISOString() } : {}) };
    }));
    return;
  }
  const item = await db.items.get(id);
  if (!item) return;
  const checked = !item.checked;
  await db.items.update(id, { checked, ...(checked ? { lastCheckedAt: new Date().toISOString() } : {}) });
  await refreshMirror();
}

export async function deleteItem(id) {
  await initDB();
  if (usingLocalStorage) {
    lsSaveItems(lsItems().filter(i => i.id !== id));
    return;
  }
  await db.items.delete(id);
  await refreshMirror();
}

export async function updateItem(id, changes) {
  await initDB();
  if (usingLocalStorage) {
    lsSaveItems(lsItems().map(i => i.id === id ? { ...i, ...changes } : i));
    return;
  }
  await db.items.update(id, changes);
  await refreshMirror();
}

export async function duplicateList(sourceId, newName) {
  await initDB();
  const now = new Date().toISOString();
  const sourceItems = await getItems(sourceId);
  const unchecked = sourceItems.filter(i => !i.checked);
  if (usingLocalStorage) {
    const lists = lsLists();
    const newList = { id: lsNextId(lists), name: newName, createdAt: now, updatedAt: now };
    lsSaveLists([...lists, newList]);
    const items = lsItems();
    const newItems = unchecked.map((item, idx) => ({
      id: lsNextId(items) + idx, listId: newList.id,
      name: item.name, qty: item.qty, category: item.category,
      checked: false, addedFrom: item.addedFrom,
    }));
    lsSaveItems([...items, ...newItems]);
    return newList.id;
  }
  const newListId = await db.lists.add({ name: newName, createdAt: now, updatedAt: now });
  await db.items.bulkAdd(unchecked.map(item => ({
    listId: newListId, name: item.name, qty: item.qty,
    category: item.category, checked: false, addedFrom: item.addedFrom,
  })));
  await refreshMirror();
  return newListId;
}

export async function clearChecked(listId) {
  await initDB();
  if (usingLocalStorage) {
    lsSaveItems(lsItems().filter(i => !(i.listId === listId && i.checked)));
    return;
  }
  await db.items.where('listId').equals(listId).and(i => i.checked).delete();
  await refreshMirror();
}

export async function syncItems(listId, items) {
  await initDB();
  if (usingLocalStorage) {
    const otherItems = lsItems().filter(i => i.listId !== listId);
    lsSaveItems([...otherItems, ...items]);
    return;
  }
  await db.transaction('rw', db.items, async () => {
    await db.items.where('listId').equals(listId).delete();
    await db.items.bulkAdd(items);
  });
  await refreshMirror();
}

export async function setAllChecked(listId, checked) {
  await initDB();
  if (usingLocalStorage) {
    lsSaveItems(lsItems().map(i => i.listId === listId ? { ...i, checked } : i));
    return;
  }
  const ids = await db.items.where('listId').equals(listId).primaryKeys();
  await Promise.all(ids.map(id => db.items.update(id, { checked })));
  await refreshMirror();
}

export async function exportDB() {
  await initDB();
  let lists, items;
  if (usingLocalStorage) {
    lists = lsLists();
    items = lsItems();
  } else {
    lists = await db.lists.toArray();
    items = await db.items.toArray();
  }
  return { version: 1, exportedAt: new Date().toISOString(), lists, items };
}

export async function importDB(data) {
  await initDB();
  if (!data || !Array.isArray(data.lists) || !Array.isArray(data.items)) {
    throw new Error('Invalid backup format');
  }
  const oldToNew = {};
  if (usingLocalStorage) {
    lsSaveLists([]);
    lsSaveItems([]);
    for (const list of data.lists) {
      const newId = await createList(list.name);
      oldToNew[list.id] = newId;
    }
    for (const item of data.items) {
      const newListId = oldToNew[item.listId];
      if (newListId !== undefined) {
        await addItem(newListId, {
          name: item.name, qty: item.qty || 1, category: item.category || 'other',
          addedFrom: item.addedFrom || 'manual', checked: item.checked || false,
          lastCheckedAt: item.lastCheckedAt || null,
        });
      }
    }
  } else {
    await db.items.clear();
    await db.lists.clear();
    for (const list of data.lists) {
      const newId = await db.lists.add({
        name: list.name,
        createdAt: list.createdAt || new Date().toISOString(),
        updatedAt: list.updatedAt || new Date().toISOString(),
      });
      oldToNew[list.id] = newId;
    }
    for (const item of data.items) {
      const newListId = oldToNew[item.listId];
      if (newListId !== undefined) {
        await db.items.add({
          listId: newListId, name: item.name, qty: item.qty || 1,
          category: item.category || 'other', checked: item.checked || false,
          addedFrom: item.addedFrom || 'manual', lastCheckedAt: item.lastCheckedAt || null,
        });
      }
    }
    await refreshMirror();
  }
}
