// localStorage-backed store. Each list is a note: { id, name, text, checked[] }.
//
// Data is tiny, so every change is written straight away (no debounce): a
// mobile tab can be killed at any moment, and losing typed text is the worst
// outcome for this app. See data-loss.md.

import { v1ToNotes } from './notes.js';

const NOTES_KEY = 'jsl_notes';
// Old item-based keys. Read once to migrate, never deleted.
const V1_LISTS_KEY = 'jsl_lists';
const V1_ITEMS_KEY = 'jsl_items';

function readArray(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function manualOrder(listId) {
  try {
    return JSON.parse(localStorage.getItem(`jsl_manual_order_${listId}`) || 'null');
  } catch {
    return null;
  }
}

function write(notes) {
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
  } catch (e) {
    console.error('Storage write failed:', e);
    window.dispatchEvent(new CustomEvent('jsl-toast', {
      detail: { msg: 'Could not save — device storage may be full.' },
    }));
  }
}

function load() {
  const raw = localStorage.getItem(NOTES_KEY);
  if (raw === null) {
    // First run on the notepad version: convert old lists, keep the originals.
    const notes = v1ToNotes(
      { lists: readArray(V1_LISTS_KEY), items: readArray(V1_ITEMS_KEY) },
      manualOrder,
    );
    write(notes);
    return notes;
  }
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v;
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

export function createNote(name, text = '', checked = []) {
  const notes = load();
  const note = { id: nextId(notes), name, text, checked, createdAt: now(), updatedAt: now() };
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
  const notes = load().filter(n => n.id !== note.id);
  write([...notes, note]);
}

export function exportAll() {
  return { app: 'JustShoppingList', version: 2, exportedAt: now(), notes: load() };
}

// Accepts the current backup format and old (v1) item-based backups.
export function parseBackup(data) {
  if (data && Array.isArray(data.notes)) {
    return data.notes
      .filter(n => n && typeof n.text === 'string')
      .map((n, i) => ({
        id: i + 1,
        name: String(n.name || 'Shopping'),
        text: n.text,
        checked: Array.isArray(n.checked) ? n.checked.filter(k => typeof k === 'string') : [],
        createdAt: n.createdAt || now(),
        updatedAt: n.updatedAt || now(),
      }));
  }
  if (data && Array.isArray(data.lists) && Array.isArray(data.items)) {
    return v1ToNotes(data).map((n, i) => ({ ...n, id: i + 1 }));
  }
  throw new Error('Invalid backup format');
}

export function replaceAll(notes) {
  write(notes);
}
