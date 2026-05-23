import Dexie from 'https://esm.sh/dexie@3.2.7';

let db;
let dbInitPromise = null;
let usingLocalStorage = false;
let lsToastShown = false;

async function initDB() {
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = (async () => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      console.warn('IndexedDB not supported/available, falling back to localStorage');
      usingLocalStorage = true;
      return;
    }

    try {
      db = new Dexie('JustShoppingListDB');
      db.version(1).stores({
        lists: '++id, name, createdAt, updatedAt',
        items: '++id, listId, name, qty, category, checked, addedFrom',
      });
      db.version(2).stores({
        lists: '++id, name, createdAt, updatedAt',
        items: '++id, listId, name, qty, category, checked, addedFrom, lastCheckedAt',
      });

      db.on('versionchange', () => {
        console.log('Database version changed in another tab. Closing connection to avoid blocking.');
        db.close();
      });

      await db.open();
      usingLocalStorage = false;

      // Request persistent storage
      if (navigator.storage && navigator.storage.persist) {
        try {
          const persisted = await navigator.storage.persist();
          console.log(`Persistent storage status: ${persisted}`);
        } catch (e) {
          console.warn('Failed to request storage persistence:', e);
        }
      }

      await migrateLocalStorageToIndexedDB();
    } catch (err) {
      console.error('Dexie open failed, falling back to localStorage:', err);
      usingLocalStorage = true;
      db = null;
    }
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

// localStorage fallback helpers
function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function lsSet(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

function lsLists() { return lsGet('jsl_lists') || []; }
function lsItems() { return lsGet('jsl_items') || []; }
function lsSaveLists(v) { lsSet('jsl_lists', v); }
function lsSaveItems(v) { lsSet('jsl_items', v); }
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
  return db.lists.add({ name, createdAt: now, updatedAt: now });
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
  return db.lists.update(id, { name, updatedAt: now });
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
}

export async function deleteItem(id) {
  await initDB();
  if (usingLocalStorage) {
    lsSaveItems(lsItems().filter(i => i.id !== id));
    return;
  }
  return db.items.delete(id);
}

export async function updateItem(id, changes) {
  await initDB();
  if (usingLocalStorage) {
    lsSaveItems(lsItems().map(i => i.id === id ? { ...i, ...changes } : i));
    return;
  }
  return db.items.update(id, changes);
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
  return newListId;
}

export async function clearChecked(listId) {
  await initDB();
  if (usingLocalStorage) {
    lsSaveItems(lsItems().filter(i => !(i.listId === listId && i.checked)));
    return;
  }
  await db.items.where('listId').equals(listId).and(i => i.checked).delete();
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
}

export async function setAllChecked(listId, checked) {
  await initDB();
  if (usingLocalStorage) {
    lsSaveItems(lsItems().map(i => i.listId === listId ? { ...i, checked } : i));
    return;
  }
  const ids = await db.items.where('listId').equals(listId).primaryKeys();
  await Promise.all(ids.map(id => db.items.update(id, { checked })));
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
  }
}
