import Dexie from 'https://esm.sh/dexie@3.2.7';

let db;
let usingLocalStorage = false;
let lsToastShown = false;

function initDB() {
  if (db) return;
  try {
    db = new Dexie('CartlyDB');
    db.version(1).stores({
      lists: '++id, name, createdAt, updatedAt',
      items: '++id, listId, name, qty, category, checked, addedFrom',
    });
  } catch (e) {
    usingLocalStorage = true;
    db = null;
  }
}

// localStorage fallback helpers
function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function lsSet(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

function lsLists() { return lsGet('cartly_lists') || []; }
function lsItems() { return lsGet('cartly_items') || []; }
function lsSaveLists(v) { lsSet('cartly_lists', v); }
function lsSaveItems(v) { lsSet('cartly_items', v); }
function lsNextId(arr) { return arr.length ? Math.max(...arr.map(x => x.id)) + 1 : 1; }

function showLSToast() {
  if (lsToastShown) return;
  lsToastShown = true;
  window.dispatchEvent(new CustomEvent('cartly-toast', { detail: { msg: 'Storage limited in private mode — data may not persist.' } }));
}

export function isUsingLocalStorage() { return usingLocalStorage; }

export async function createList(name) {
  initDB();
  const now = new Date().toISOString();
  if (usingLocalStorage) {
    showLSToast();
    const lists = lsLists();
    const newList = { id: lsNextId(lists), name, createdAt: now, updatedAt: now };
    lsSaveLists([...lists, newList]);
    return newList.id;
  }
  return db.lists.add({ name, createdAt: now, updatedAt: now });
}

export async function getLists() {
  initDB();
  if (usingLocalStorage) return lsLists().slice().reverse();
  return db.lists.toArray().then(arr => arr.reverse());
}

export async function updateListName(id, name) {
  initDB();
  const now = new Date().toISOString();
  if (usingLocalStorage) {
    lsSaveLists(lsLists().map(l => l.id === id ? { ...l, name, updatedAt: now } : l));
    return;
  }
  return db.lists.update(id, { name, updatedAt: now });
}

export async function deleteList(id) {
  initDB();
  if (usingLocalStorage) {
    lsSaveLists(lsLists().filter(l => l.id !== id));
    lsSaveItems(lsItems().filter(i => i.listId !== id));
    return;
  }
  await db.items.where('listId').equals(id).delete();
  await db.lists.delete(id);
}

export async function addItem(listId, { name, qty = 1, category = 'other', addedFrom = 'manual' }) {
  initDB();
  const now = new Date().toISOString();
  if (usingLocalStorage) {
    const items = lsItems();
    const newItem = { id: lsNextId(items), listId, name, qty, category, checked: false, addedFrom };
    lsSaveItems([...items, newItem]);
    lsSaveLists(lsLists().map(l => l.id === listId ? { ...l, updatedAt: now } : l));
    return newItem.id;
  }
  const id = await db.items.add({ listId, name, qty, category, checked: false, addedFrom });
  await db.lists.update(listId, { updatedAt: now });
  return id;
}

export async function getItems(listId) {
  initDB();
  if (usingLocalStorage) return lsItems().filter(i => i.listId === listId);
  return db.items.where('listId').equals(listId).toArray();
}

export async function toggleItem(id) {
  initDB();
  if (usingLocalStorage) {
    lsSaveItems(lsItems().map(i => i.id === id ? { ...i, checked: !i.checked } : i));
    return;
  }
  const item = await db.items.get(id);
  if (item) await db.items.update(id, { checked: !item.checked });
}

export async function deleteItem(id) {
  initDB();
  if (usingLocalStorage) {
    lsSaveItems(lsItems().filter(i => i.id !== id));
    return;
  }
  return db.items.delete(id);
}

export async function updateItem(id, changes) {
  initDB();
  if (usingLocalStorage) {
    lsSaveItems(lsItems().map(i => i.id === id ? { ...i, ...changes } : i));
    return;
  }
  return db.items.update(id, changes);
}

export async function duplicateList(sourceId, newName) {
  initDB();
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
  return newListId;
}

export async function clearChecked(listId) {
  initDB();
  if (usingLocalStorage) {
    lsSaveItems(lsItems().filter(i => !(i.listId === listId && i.checked)));
    return;
  }
  await db.items.where('listId').equals(listId).and(i => i.checked).delete();
}

export async function setAllChecked(listId, checked) {
  initDB();
  if (usingLocalStorage) {
    lsSaveItems(lsItems().map(i => i.listId === listId ? { ...i, checked } : i));
    return;
  }
  const ids = await db.items.where('listId').equals(listId).primaryKeys();
  await Promise.all(ids.map(id => db.items.update(id, { checked })));
}
