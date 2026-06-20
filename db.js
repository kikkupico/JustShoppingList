// Simple localStorage-backed store.
//
// Shopping-list data is tiny (a few hundred items at most), so localStorage is
// the right tool: synchronous, no async "open" step that can fail, no external
// dependency. Functions are async only to keep the call sites unchanged.

const LISTS_KEY = 'jsl_lists';
const ITEMS_KEY = 'jsl_items';

function read(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function write(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) {
    console.error('Storage write failed:', e);
    window.dispatchEvent(new CustomEvent('jsl-toast', {
      detail: { msg: 'Could not save — device storage may be full.' },
    }));
  }
}

const getListsRaw = () => read(LISTS_KEY);
const getItemsRaw = () => read(ITEMS_KEY);
const saveLists = (v) => write(LISTS_KEY, v);
const saveItems = (v) => write(ITEMS_KEY, v);
const nextId = (arr) => (arr.length ? Math.max(...arr.map(x => x.id)) + 1 : 1);
const now = () => new Date().toISOString();

export async function createList(name) {
  const lists = getListsRaw();
  const id = nextId(lists);
  saveLists([...lists, { id, name, createdAt: now(), updatedAt: now() }]);
  return id;
}

export async function getLists() {
  // Newest first.
  return getListsRaw().slice().reverse();
}

export async function updateListName(id, name) {
  saveLists(getListsRaw().map(l => l.id === id ? { ...l, name, updatedAt: now() } : l));
}

export async function deleteList(id) {
  saveLists(getListsRaw().filter(l => l.id !== id));
  saveItems(getItemsRaw().filter(i => i.listId !== id));
}

export async function addItem(listId, { name, qty = 1, category = 'other', addedFrom = 'manual', checked = false, lastCheckedAt = null }) {
  const items = getItemsRaw();
  const id = nextId(items);
  saveItems([...items, { id, listId, name, qty, category, checked, addedFrom, lastCheckedAt }]);
  saveLists(getListsRaw().map(l => l.id === listId ? { ...l, updatedAt: now() } : l));
  return id;
}

export async function getItems(listId) {
  return getItemsRaw().filter(i => i.listId === listId);
}

export async function toggleItem(id) {
  saveItems(getItemsRaw().map(i => {
    if (i.id !== id) return i;
    const checked = !i.checked;
    return { ...i, checked, ...(checked ? { lastCheckedAt: now() } : {}) };
  }));
}

export async function deleteItem(id) {
  saveItems(getItemsRaw().filter(i => i.id !== id));
}

export async function updateItem(id, changes) {
  saveItems(getItemsRaw().map(i => i.id === id ? { ...i, ...changes } : i));
}

export async function clearChecked(listId) {
  saveItems(getItemsRaw().filter(i => !(i.listId === listId && i.checked)));
}

export async function syncItems(listId, items) {
  const others = getItemsRaw().filter(i => i.listId !== listId);
  saveItems([...others, ...items]);
}

export async function setAllChecked(listId, checked) {
  saveItems(getItemsRaw().map(i => i.listId === listId ? { ...i, checked } : i));
}

export async function exportDB() {
  return { version: 1, exportedAt: now(), lists: getListsRaw(), items: getItemsRaw() };
}

export async function importDB(data) {
  if (!data || !Array.isArray(data.lists) || !Array.isArray(data.items)) {
    throw new Error('Invalid backup format');
  }
  const oldToNew = {};
  const lists = [];
  let listId = 1;
  for (const list of data.lists) {
    const id = listId++;
    oldToNew[list.id] = id;
    lists.push({
      id,
      name: list.name,
      createdAt: list.createdAt || now(),
      updatedAt: list.updatedAt || now(),
    });
  }
  const items = [];
  let itemId = 1;
  for (const item of data.items) {
    const newListId = oldToNew[item.listId];
    if (newListId === undefined) continue;
    items.push({
      id: itemId++,
      listId: newListId,
      name: item.name,
      qty: item.qty || 1,
      category: item.category || 'other',
      checked: item.checked || false,
      addedFrom: item.addedFrom || 'manual',
      lastCheckedAt: item.lastCheckedAt || null,
    });
  }
  saveLists(lists);
  saveItems(items);
}
