// localStorage-backed store. Each list is { id, name, items[], createdAt, updatedAt }
// (item shape: see notes.js).
//
// Data is tiny, so every change is written straight away (no debounce): a
// mobile tab can be killed at any moment. See data-loss.md.

import { v1ToNotes, textNoteToItems, CATEGORIES } from './notes.js';

const NOTES_KEY = 'jsl_notes';
// Older formats. Read to migrate, never deleted.
const V1_LISTS_KEY = 'jsl_lists';
const V1_ITEMS_KEY = 'jsl_items';
const V2_BACKUP_KEY = 'jsl_notes_v2_backup';
const CAT_MEMORY_KEY = 'jsl_cat_memory';

function readJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function manualOrder(listId) {
  return readJSON(`jsl_manual_order_${listId}`, null);
}

function writeKey(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error('Storage write failed:', e);
    window.dispatchEvent(new CustomEvent('jsl-toast', {
      detail: { msg: 'Could not save — device storage may be full.' },
    }));
  }
}

const write = (notes) => writeKey(NOTES_KEY, notes);

// v2 notes stored plain text; convert them to items in place.
function upgrade(notes) {
  if (!notes.some(n => !Array.isArray(n.items))) return notes;
  if (localStorage.getItem(V2_BACKUP_KEY) === null) writeKey(V2_BACKUP_KEY, notes);
  const upgraded = notes.map(n => {
    if (Array.isArray(n.items)) return n;
    const { text, checked, ...rest } = n;
    return { ...rest, items: textNoteToItems(text, checked) };
  });
  write(upgraded);
  return upgraded;
}

function load() {
  const raw = localStorage.getItem(NOTES_KEY);
  if (raw === null) {
    const arr = (k) => { const v = readJSON(k, []); return Array.isArray(v) ? v : []; };
    const notes = v1ToNotes({ lists: arr(V1_LISTS_KEY), items: arr(V1_ITEMS_KEY) }, manualOrder);
    write(notes);
    return notes;
  }
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return upgrade(v);
  } catch { /* fall through */ }
  // Unreadable data: keep a copy rather than silently overwriting it.
  try { localStorage.setItem(`${NOTES_KEY}_unreadable_${Date.now()}`, raw); } catch { /* ignore */ }
  return [];
}

const now = () => new Date().toISOString();
const nextId = (notes) => (notes.length ? Math.max(...notes.map(n => n.id)) + 1 : 1);

// Most recently edited first.
export function getNotes() {
  return load().slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export function getNote(id) {
  return load().find(n => n.id === id) || null;
}

export function createNote(name, items = []) {
  const notes = load();
  const note = { id: nextId(notes), name, items, createdAt: now(), updatedAt: now() };
  write([...notes, note]);
  return note;
}

export function saveNote(id, changes) {
  write(load().map(n => (n.id === id ? { ...n, ...changes, updatedAt: now() } : n)));
}

export function deleteNote(id) {
  const notes = load();
  const note = notes.find(n => n.id === id);
  write(notes.filter(n => n.id !== id));
  return note;
}

// Put back a note removed by deleteNote (undo).
export function restoreNote(note) {
  write([...load().filter(n => n.id !== note.id), note]);
}

// Categories the user picked by hand, keyed by item name (see nameKey).
export function getCatMemory() {
  const m = readJSON(CAT_MEMORY_KEY, {});
  return m && typeof m === 'object' ? m : {};
}

export function rememberCat(key, cat) {
  writeKey(CAT_MEMORY_KEY, { ...getCatMemory(), [key]: cat });
}

export function exportAll() {
  return { app: 'JustShoppingList', version: 3, exportedAt: now(), notes: load(), catMemory: getCatMemory() };
}

function cleanItem(i) {
  return {
    id: String(i.id),
    text: String(i.text),
    checked: !!i.checked,
    cat: CATEGORIES.includes(i.cat) ? i.cat : null,
    catKey: typeof i.catKey === 'string' ? i.catKey : null,
    checkedAt: i.checkedAt || null,
  };
}

// Accepts current (v3) backups, v2 notepad backups and v1 item-based backups.
export function parseBackup(data) {
  const meta = (n, i) => ({
    id: i + 1,
    name: String(n.name || 'Shopping'),
    createdAt: n.createdAt || now(),
    updatedAt: n.updatedAt || now(),
  });
  let notes;
  if (data && Array.isArray(data.notes)) {
    notes = data.notes.filter(Boolean).map((n, i) => {
      if (Array.isArray(n.items)) {
        return { ...meta(n, i), items: n.items.filter(x => x && typeof x.text === 'string' && x.id != null).map(cleanItem) };
      }
      if (typeof n.text === 'string') {
        return { ...meta(n, i), items: textNoteToItems(n.text, Array.isArray(n.checked) ? n.checked : []) };
      }
      return null;
    }).filter(Boolean);
  } else if (data && Array.isArray(data.lists) && Array.isArray(data.items)) {
    notes = v1ToNotes(data).map((n, i) => ({ ...n, id: i + 1 }));
  } else {
    throw new Error('Invalid backup format');
  }
  const catMemory = data.catMemory && typeof data.catMemory === 'object' ? data.catMemory : null;
  return { notes, catMemory };
}

export function replaceAll({ notes, catMemory }) {
  write(notes);
  if (catMemory) writeKey(CAT_MEMORY_KEY, catMemory);
}
