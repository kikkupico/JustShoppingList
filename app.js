import { h, render } from 'https://esm.sh/preact@10.22.0';
import { useState, useEffect, useLayoutEffect, useRef } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import {
  getNotes, getNote, createNote, saveNote, deleteNote, restoreNote,
  getCatMemory, rememberCat, exportAll, parseBackup, replaceAll,
} from './db.js';
import {
  CATEGORIES, parseLine, lineKey, nameKey, stripQty, newItem, hasText, countItems,
  viewItems, itemsToText, reconcile, planPaste, applyChecks, mergePaste,
} from './notes.js';

const html = htm.bind(h);

// ─── Lazy parser ──────────────────────────────────────────────────────────────
// parser.js (compromise NLP, from a CDN) powers auto-categories and "eggs" ≈
// "egg" matching. It is never on the startup path: if it fails to load, the
// list still works and items just stay uncategorised until you pick one.

let parser = null;
let parserPromise = null;
const parserListeners = new Set();

function loadParser() {
  if (!parserPromise) {
    parserPromise = import('./parser.js')
      .then(m => { parser = m; parserListeners.forEach(f => f()); return m; })
      .catch(() => { parserPromise = null; return null; });
  }
  return parserPromise;
}

function useParserReady() {
  const [ready, setReady] = useState(!!parser);
  useEffect(() => {
    if (parser) { setReady(true); return; }
    const f = () => setReady(true);
    parserListeners.add(f);
    return () => parserListeners.delete(f);
  }, []);
  return ready;
}

function matchKey(text) {
  return parser ? parser.dedupeKey(text) : lineKey(text);
}

function autoCategory(text) {
  if (!parser) return null;
  try {
    const name = stripQty(parseLine(text).text);
    let cat = parser.categorize(name);
    // The categorizer misses many plurals ("apples"); retry with the singular.
    if (cat === 'other') {
      const singular = parser.dedupeKey(name);
      if (singular && singular !== name.toLowerCase()) cat = parser.categorize(singular);
    }
    return CATEGORIES.includes(cat) ? cat : 'other';
  } catch {
    return 'other';
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function todayName() {
  const d = new Date();
  return `Shopping ${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`;
}

function timeAgo(date) {
  if (!date) return '';
  const seconds = Math.floor((Date.now() - new Date(date)) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

const vibrate = (ms = 10) => navigator.vibrate?.(ms);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast('Could not copy — select the text and copy it instead.');
  }
}

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Insert text at the textarea's selection, keeping the browser's own undo
// history (Cmd/Ctrl+Z) intact. Falls back to setRangeText where execCommand
// is unavailable.
function insertAtCursor(ta, text) {
  ta.focus();
  const ok = text
    ? document.execCommand('insertText', false, text)
    : document.execCommand('delete');
  if (!ok) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// Old share links (?list=…) are deflated JSON: { name, items: [{name, qty, checked}] }.
async function decodeShareLink(encoded) {
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return JSON.parse(await new Response(ds.readable).text());
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const svg = (body, size = 20, sw = 2) => html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=${sw} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const IconBack = () => svg(html`<polyline points="15 18 9 12 15 6"/>`);
const IconMore = () => svg(html`<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>`);
const IconPlus = (size = 22) => svg(html`<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`, size, 2.5);
const IconX = () => svg(html`<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`, 16);
const IconCopy = () => svg(html`<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`, 18);
const IconSearch = () => svg(html`<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>`, 16);
const IconSort = () => svg(html`<path d="M3 6h18M6 12h12M10 18h4"/>`, 16);
const IconTrash = () => svg(html`<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>`, 15);
const IconShield = () => svg(html`<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`, 14);
const IconLock = () => svg(html`<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`, 14);
const IconUpload = () => svg(html`<polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>`, 28, 1.5);

// ─── Toast ────────────────────────────────────────────────────────────────────

function toast(msg, action = null, opts = {}) {
  window.dispatchEvent(new CustomEvent('jsl-toast', { detail: { msg, action, sticky: !!opts.sticky } }));
}

function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const handler = (e) => {
      const id = Date.now() + Math.random();
      const { msg, action, sticky } = e.detail;
      setToasts(t => [...t.slice(-2), { id, msg, action, sticky }]);
      if (!sticky) setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), action ? 7000 : 4000);
    };
    window.addEventListener('jsl-toast', handler);
    return () => window.removeEventListener('jsl-toast', handler);
  }, []);

  const dismiss = (t) => setToasts(curr => curr.filter(x => x.id !== t.id));

  return html`
    <div class="toast-container" role="status" aria-live="polite">
      ${toasts.map(t => html`
        <div key=${t.id} class="toast">
          <span class="toast-msg">${t.msg}</span>
          ${t.action && html`
            <button class="toast-action" onClick=${() => { t.action.fn(); dismiss(t); }}>${t.action.label || 'Undo'}</button>
          `}
          ${t.sticky && html`<button class="toast-dismiss" onClick=${() => dismiss(t)}>Later</button>`}
        </div>
      `)}
    </div>
  `;
}

// ─── Backup reminder ──────────────────────────────────────────────────────────

const BACKUP_KEY = 'jsl_last_backup';
const FIRST_SEEN_KEY = 'jsl_first_seen';
const REMIND_AFTER_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function backupReminderDue(hasData) {
  if (!hasData) return false;
  let firstSeen = Number(localStorage.getItem(FIRST_SEEN_KEY));
  if (!firstSeen) {
    firstSeen = Date.now();
    try { localStorage.setItem(FIRST_SEEN_KEY, String(firstSeen)); } catch { /* ignore */ }
  }
  const last = Number(localStorage.getItem(BACKUP_KEY)) || firstSeen;
  return Date.now() - last > REMIND_AFTER_DAYS * DAY_MS;
}

function backupAll() {
  downloadJSON(exportAll(), `jsl-backup-${new Date().toISOString().slice(0, 10)}.json`);
  try { localStorage.setItem(BACKUP_KEY, String(Date.now())); } catch { /* ignore */ }
}

// ─── Small shared pieces ──────────────────────────────────────────────────────

function useClickOutside(ref, open, close) {
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) close(); };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [open]);
}

function Menu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickOutside(ref, open, () => setOpen(false));
  return html`
    <div class="menu-wrap" ref=${ref}>
      <button class="icon-btn" onClick=${() => setOpen(v => !v)} title="More" aria-label="More" aria-expanded=${open}>
        <${IconMore}/>
      </button>
      ${open && html`
        <div class="menu" role="menu">
          ${items.filter(Boolean).map(it => it === '-'
            ? html`<hr/>`
            : html`<button role="menuitem" onClick=${() => { setOpen(false); it.fn(); }}>${it.label}</button>`)}
        </div>
      `}
    </div>
  `;
}

function ConfirmDialog({ message, confirmLabel, onConfirm, onCancel }) {
  return html`
    <div class="overlay" onClick=${onCancel}>
      <div class="dialog" onClick=${e => e.stopPropagation()}>
        <p>${message}</p>
        <div class="dialog-actions">
          <button class="btn" onClick=${onCancel}>Cancel</button>
          <button class="btn btn-primary" onClick=${onConfirm}>${confirmLabel}</button>
        </div>
      </div>
    </div>
  `;
}

// ─── Receipt scan ─────────────────────────────────────────────────────────────
// Photo → OCR → item lines added to the list. No review step: the items can
// be edited or deleted like any other.

function ScanModal({ onClose, onLines }) {
  const [phase, setPhase] = useState('pick'); // pick | scanning | error
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  async function processFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    setPhase('scanning');
    try {
      const [ocr, parserMod] = await Promise.all([import('./ocr.js'), loadParser()]);
      if (!parserMod) throw new Error('parser unavailable');
      await ocr.initOCR();
      const { text, lines } = await ocr.recogniseReceipt(file);
      const { items } = parserMod.extractItemsFromText(text, lines);
      if (!items || !items.length) throw new Error('No items found — try a clearer photo.');
      onLines(items.map(i => (i.qty > 1 ? `${i.qty}x ${i.name}` : i.name)));
      onClose();
    } catch (e) {
      setError(e?.message?.startsWith('No items') ? e.message
        : navigator.onLine ? 'Could not read that receipt — try a clearer photo.'
        : 'Receipt scanning needs a connection the first time.');
      setPhase('error');
    }
  }

  return html`
    <div class="overlay" onClick=${onClose}>
      <div class="dialog" onClick=${e => e.stopPropagation()}>
        <div class="dialog-header">
          <span class="dialog-title">Scan a receipt</span>
          <button class="icon-btn" onClick=${onClose} aria-label="Close"><${IconX}/></button>
        </div>
        ${phase === 'pick' && html`
          <div class="drop-zone ${dragOver ? 'drag-over' : ''}"
            onDragOver=${e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave=${() => setDragOver(false)}
            onDrop=${e => { e.preventDefault(); setDragOver(false); processFile(e.dataTransfer.files[0]); }}
            onClick=${() => fileRef.current.click()}>
            <${IconUpload}/>
            <p>Take or choose a photo</p>
            <p class="hint">Items are added to the list. Runs on your device.</p>
            <input ref=${fileRef} type="file" accept="image/*" hidden
              onChange=${e => processFile(e.target.files[0])} />
          </div>
        `}
        ${phase === 'scanning' && html`<div class="spinner-row"><div class="spinner"></div> Reading receipt…</div>`}
        ${phase === 'error' && html`
          <p class="error-msg">${error}</p>
          <button class="btn btn-primary btn-block" onClick=${() => setPhase('pick')}>Try again</button>
        `}
      </div>
    </div>
  `;
}

// ─── Category picker ──────────────────────────────────────────────────────────
// One floating menu for the whole list, placed under the chip that opened it.

function CatPicker({ picker, onPick, onClose }) {
  const ref = useRef(null);
  useClickOutside(ref, true, onClose);
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('scroll', close, { passive: true });
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close); window.removeEventListener('resize', close); };
  }, []);
  const { rect, cat } = picker;
  const below = rect.bottom + 340 < window.innerHeight;
  const style = `right:${Math.max(8, window.innerWidth - rect.right)}px;`
    + (below ? `top:${rect.bottom + 4}px` : `bottom:${window.innerHeight - rect.top + 4}px`);
  return html`
    <div class="menu cat-menu" role="menu" ref=${ref} style=${style}>
      ${CATEGORIES.map(c => html`
        <button role="menuitem" class=${c === cat ? 'active' : ''}
          onPointerDown=${e => e.preventDefault()} onMouseDown=${e => e.preventDefault()}
          onClick=${() => onPick(c)}>
          <span class="dot cat-${c}"></span>${capital(c)}
        </button>
      `)}
    </div>
  `;
}

function CatChip({ item, onOpen, stop = false }) {
  const shown = item.cat || 'other';
  return html`
    <button class="cat-chip cat-${shown} ${item.cat ? '' : 'unknown'}" tabIndex="-1"
      title=${`Category: ${shown}`} aria-label=${`Category: ${shown}. Change`}
      onPointerDown=${e => e.preventDefault()} onMouseDown=${e => e.preventDefault()}
      onClick=${e => { if (stop) e.stopPropagation(); onOpen(item, e.currentTarget); }}>
      <span class="dot"></span><span class="cat-label">${shown}</span>
    </button>
  `;
}

// ─── List view ────────────────────────────────────────────────────────────────
// The editor is one plain <textarea>, so selecting, copying, pasting, undo and
// keyboard shortcuts work like any text editor. A mirror layer on top renders
// the same text invisibly with identical wrapping; it supplies the check
// circles (left margin) and category chips (right margin), and fades + strikes
// checked lines. Each line is an item; reconcile() maps edits back to items.
//
// Search, filters and sort hide or reorder lines, which a text editor can't
// do, so they switch to a shopping view: tap an item to check it off.

const SORTS = { mine: 'My order', az: 'A–Z', category: 'Category', recent: 'Recently checked' };
const STATUSES = { all: 'All', todo: 'To buy', done: 'Done' };
const linesOf = (items) => items.map(i => i.text);

function NoteView({ noteId, onBack }) {
  const initial = useRef(getNote(noteId)).current;
  const startEmpty = !initial?.items?.some(hasText);
  const [name, setName] = useState(initial?.name || todayName());
  // One item per line, always (an item holding a newline would break that).
  const [items, setItemsState] = useState(() => {
    const base = initial?.items || [];
    return reconcile(base, linesOf(base).join('\n').split('\n')).items;
  });
  const itemsRef = useRef(items);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [cat, setCat] = useState(null);
  const [sort, setSort] = useState('mine');
  const [keep, setKeep] = useState(() => new Set());
  const [picker, setPicker] = useState(null); // { id, cat, rect }
  const [showScan, setShowScan] = useState(false);
  const taRef = useRef(null);
  const graveyard = useRef(new Map()); // text -> recently removed item
  const pendingChecked = useRef(null);
  const lastCopied = useRef(null);
  const parserReady = useParserReady();
  const editing = sort === 'mine' && status === 'all' && !cat && !query.trim();

  const setItems = (next) => {
    const value = typeof next === 'function' ? next(itemsRef.current) : next;
    itemsRef.current = value;
    setItemsState(value);
  };

  // Programmatic edits go through here so the textarea stays in step. (This
  // resets the browser's own undo history; callers offer an Undo toast.)
  const replaceItems = (next) => {
    setItems(next);
    if (taRef.current) taRef.current.value = linesOf(next).join('\n');
  };

  // Save every change straight away (see db.js).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    saveNote(noteId, { name, items });
  }, [name, items]);

  // Uncontrolled textarea: fill it when the editor (re)appears.
  const focusedOnce = useRef(false);
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!editing || !ta) return;
    ta.value = linesOf(itemsRef.current).join('\n');
    if (startEmpty && !focusedOnce.current) { focusedOnce.current = true; ta.focus(); }
  }, [editing]);

  // Work out categories for items whose text changed, a moment after typing
  // stops. A category picked by hand for that name wins. Only metadata
  // changes, so the textarea (and its caret) is untouched.
  useEffect(() => {
    const t = setTimeout(() => {
      const memory = getCatMemory();
      setItems(prev => {
        let changed = false;
        const next = prev.map(i => {
          const key = lineKey(i.text);
          if (!key || i.catKey === key) return i;
          const c = memory[nameKey(i.text)] || autoCategory(i.text);
          if (!c) return i;
          changed = true;
          return { ...i, cat: c, catKey: key };
        });
        return changed ? next : prev;
      });
    }, 400);
    return () => clearTimeout(t);
  }, [items, parserReady]);

  // Paste with nothing focused adds to the end of the list.
  useEffect(() => {
    const onDocPaste = (e) => {
      if (e.target.closest?.('input, textarea, [contenteditable]')) return;
      const pasted = e.clipboardData?.getData('text/plain') || '';
      if (!pasted.trim()) return;
      e.preventDefault();
      appendLines(pasted);
    };
    document.addEventListener('paste', onDocPaste);
    return () => document.removeEventListener('paste', onDocPaste);
  }, []);

  function withUndo(msg, next) {
    const before = itemsRef.current;
    replaceItems(next);
    toast(msg, { label: 'Undo', fn: () => replaceItems(before) });
  }

  function appendLines(text) {
    const r = mergePaste({ items: itemsRef.current, pasted: text, matchKey });
    if (!r.added.length && !r.skipped) return;
    const parts = [`Added ${plural(r.added.length, 'item')}`];
    if (r.skipped) parts.push(`${r.skipped} already on list` + (r.unchecked ? ` (${r.unchecked} unchecked)` : ''));
    withUndo(parts.join(' · '), r.items);
  }

  // ── Editor events ──

  function onInput(e) {
    const type = e.inputType || '';
    const revive = /^(history|insertFromPaste|insertFromDrop)/.test(type) ? graveyard.current : null;
    const r = reconcile(itemsRef.current, e.target.value.split('\n'), { revive, markChecked: pendingChecked.current });
    pendingChecked.current = null;
    const g = graveyard.current;
    if (revive) for (const it of r.items) if (g.get(it.text)?.id === it.id) g.delete(it.text);
    for (const it of r.removed) {
      if (!hasText(it)) continue;
      g.delete(it.text);
      g.set(it.text, it);
    }
    while (g.size > 200) g.delete(g.keys().next().value);
    setItems(r.items);
  }

  function rememberCopy(e) {
    const ta = e.target;
    lastCopied.current = ta.value.slice(ta.selectionStart, ta.selectionEnd);
  }

  function onPaste(e) {
    const pasted = (e.clipboardData?.getData('text/plain') || '').replace(/\r\n?/g, '\n');
    // Lines copied or cut from this list paste as-is, like any text editor
    // (a moved checked line stays checked). Only text from elsewhere is tidied.
    if (pasted === lastCopied.current || !pasted.includes('\n')) return;
    e.preventDefault();
    const ta = taRef.current;
    const v = ta.value, s = ta.selectionStart, en = ta.selectionEnd;
    const startLine = v.slice(0, s).split('\n').length - 1;
    const endLine = startLine + v.slice(s, en).split('\n').length - 1;
    const exclude = s !== en ? new Set(itemsRef.current.slice(startLine, endLine + 1).map(i => i.id)) : null;
    const plan = planPaste({ items: itemsRef.current, pasted, exclude, matchKey });
    const { items: next, unchecked } = applyChecks(itemsRef.current, plan.setChecked);
    setItems(next);
    const before = v.slice(0, s), after = v.slice(en);
    let insert = plan.lines.join('\n');
    if (insert) {
      if (before && !before.endsWith('\n')) insert = '\n' + insert;
      if (after && !after.startsWith('\n')) insert += '\n';
    }
    pendingChecked.current = plan.newChecked;
    if (insert || s !== en) insertAtCursor(ta, insert);
    if (plan.skipped) {
      const parts = [plan.lines.length && `Added ${plural(plan.lines.length, 'item')}`, `${plan.skipped} already on list`].filter(Boolean);
      toast(parts.join(' · ') + (unchecked ? ` (${unchecked} unchecked)` : ''));
    }
  }

  // ── Item actions ──

  function toggle(id) {
    const now = new Date().toISOString();
    vibrate(10);
    setItems(prev => prev.map(i => (i.id === id ? { ...i, checked: !i.checked, checkedAt: i.checked ? i.checkedAt : now } : i)));
    // In a filtered view, keep it on screen briefly so it doesn't vanish under your finger.
    setKeep(k => new Set(k).add(id));
    setTimeout(() => setKeep(k => { const n = new Set(k); n.delete(id); return n; }), 1200);
  }

  function openPicker(item, el) {
    setPicker(p => (p?.id === item.id ? null : { id: item.id, cat: item.cat, rect: el.getBoundingClientRect() }));
  }

  function pickCat(c) {
    const item = itemsRef.current.find(i => i.id === picker.id);
    setPicker(null);
    if (!item) return;
    const nk = nameKey(item.text);
    rememberCat(nk, c);
    setItems(prev => prev.map(i => (nameKey(i.text) === nk ? { ...i, cat: c, catKey: lineKey(i.text) } : i)));
  }

  function showAll() {
    setQuery(''); setCat(null); setStatus('all'); setSort('mine');
  }

  const { total, done } = countItems(items);
  const left = total - done;
  const filled = items.filter(hasText);
  const presentCats = CATEGORIES.filter(c => filled.some(i => (i.cat || 'other') === c));
  const visible = editing ? null : viewItems(items, { query, status, cat, sort, keep });

  const menu = [
    { label: 'Copy list', fn: () => copyText(itemsToText(itemsRef.current), 'List copied') },
    { label: 'Copy what’s left', fn: () => copyText(itemsToText(itemsRef.current, { onlyUnchecked: true }), `Copied ${plural(left, 'item')}`) },
    typeof navigator.share === 'function' && { label: 'Share…', fn: () => navigator.share({ title: name, text: itemsToText(itemsRef.current) }).catch(() => {}) },
    '-',
    { label: 'Scan a receipt', fn: () => setShowScan(true) },
    '-',
    { label: 'Uncheck all', fn: () => done && withUndo(`Unchecked ${plural(done, 'item')}`, itemsRef.current.map(i => (i.checked ? { ...i, checked: false } : i))) },
    { label: 'Remove checked', fn: () => done && withUndo(`Removed ${plural(done, 'item')}`, itemsRef.current.filter(i => !(i.checked && hasText(i)))) },
  ];

  let lastGroup = null;

  return html`
    <div class="note-view">
      <header class="bar">
        <button class="icon-btn" onClick=${onBack} title="All lists" aria-label="All lists"><${IconBack}/></button>
        <div class="bar-title">
          <input class="name-input" value=${name} aria-label="List name"
            onInput=${e => setName(e.target.value)}
            onBlur=${e => { if (!e.target.value.trim()) setName(todayName()); }}
            onKeyDown=${e => e.key === 'Enter' && e.target.blur()} />
          <span class="bar-sub">${total === 0 ? 'Empty' : left === 0 ? `All ${total} done` : `${left} of ${total} left`}</span>
        </div>
        <button class="icon-btn" onClick=${() => copyText(itemsToText(itemsRef.current), 'List copied')} title="Copy list" aria-label="Copy list"><${IconCopy}/></button>
        <${Menu} items=${menu}/>
      </header>
      <div class="progress" aria-hidden="true"><div style=${`width:${total ? (done / total) * 100 : 0}%`}></div></div>

      <div class="tools">
        <div class="tools-row">
          <label class="search">
            <${IconSearch}/>
            <input type="search" placeholder="Search" value=${query} aria-label="Search items"
              onInput=${e => setQuery(e.target.value)}
              onKeyDown=${e => e.key === 'Escape' && setQuery('')} />
            ${query && html`<button class="clear" onClick=${() => setQuery('')} aria-label="Clear search"><${IconX}/></button>`}
          </label>
          <label class="sort ${sort !== 'mine' ? 'active' : ''}">
            <${IconSort}/>
            <select value=${sort} aria-label="Sort" onChange=${e => setSort(e.target.value)}>
              ${Object.entries(SORTS).map(([k, v]) => html`<option value=${k}>${v}</option>`)}
            </select>
          </label>
        </div>
        <div class="chips" role="toolbar" aria-label="Filters">
          ${Object.entries(STATUSES).map(([k, v]) => html`
            <button class="chip ${status === k ? 'on' : ''}" aria-pressed=${status === k} onClick=${() => setStatus(k)}>
              ${v}${k === 'todo' ? ` ${left}` : k === 'done' ? ` ${done}` : ''}
            </button>
          `)}
          ${presentCats.length > 1 && html`<span class="chip-sep"></span>`}
          ${presentCats.length > 1 && presentCats.map(c => html`
            <button class="chip ${cat === c ? 'on' : ''}" aria-pressed=${cat === c} onClick=${() => setCat(cat === c ? null : c)}>
              <span class="dot cat-${c}"></span>${capital(c)}
            </button>
          `)}
        </div>
      </div>

      ${editing ? html`
        <main class="paper">
          <div class="sheet">
            <textarea ref=${taRef} class="sheet-text" aria-label="List — one item per line"
              spellcheck="true" autocapitalize="sentences"
              placeholder=${'milk\neggs\n2x bread\n\nType or paste a list — one item per line.'}
              onInput=${onInput} onPaste=${onPaste} onCopy=${rememberCopy} onCut=${rememberCopy}></textarea>
            <div class="sheet-mirror">
              ${items.map(item => {
                const filledLine = hasText(item);
                return html`
                  <div key=${item.id} class="ln ${filledLine && item.checked ? 'done' : ''}">
                    ${filledLine && html`
                      <button class="tick" tabIndex="-1" aria-pressed=${item.checked}
                        aria-label=${item.checked ? `Uncheck ${item.text}` : `Check ${item.text}`}
                        onPointerDown=${e => e.preventDefault()} onMouseDown=${e => e.preventDefault()}
                        onClick=${() => toggle(item.id)}><span></span></button>
                    `}
                    <span class="ln-text" aria-hidden="true">${item.text || ' '}</span>
                    ${filledLine && html`<${CatChip} item=${item} onOpen=${openPicker}/>`}
                  </div>
                `;
              })}
            </div>
          </div>
        </main>
      ` : html`
        <div class="shop-bar">
          <span>Shopping view — tap an item to check it off.</span>
          <button class="link" onClick=${showAll}>Edit list</button>
        </div>
        <main class="paper">
          <ul class="shop">
            ${visible.map((item, n) => {
              let header = null;
              if (sort === 'category') {
                const group = item.cat || 'other';
                if (group !== lastGroup) header = html`<li key=${`h-${group}-${n}`} class="group" aria-hidden="true">${capital(group)}</li>`;
                lastGroup = group;
              }
              return html`
                ${header}
                <li key=${item.id} class="shop-row ${item.checked ? 'done' : ''}" role="checkbox" aria-checked=${item.checked}
                  tabIndex="0" onClick=${() => toggle(item.id)}
                  onKeyDown=${e => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), toggle(item.id))}>
                  <span class="tick" aria-hidden="true"><span></span></span>
                  <span class="shop-text">${item.text}</span>
                  <${CatChip} item=${item} onOpen=${openPicker} stop=${true}/>
                </li>
              `;
            })}
          </ul>
          ${visible.length === 0 && html`
            <p class="empty-note">${total === 0 ? 'No items yet.' : 'Nothing matches.'}
              ${' '}<button class="link" onClick=${showAll}>Show all</button></p>
          `}
        </main>
      `}

      ${picker && html`<${CatPicker} picker=${picker} onPick=${pickCat} onClose=${() => setPicker(null)}/>`}
      ${showScan && html`<${ScanModal} onClose=${() => setShowScan(false)} onLines=${lines => appendLines(lines.join('\n'))}/>`}
    </div>
  `;
}

// ─── All lists ────────────────────────────────────────────────────────────────

function preview(note) {
  const todo = note.items.filter(i => hasText(i) && !i.checked).map(i => i.text);
  return todo.slice(0, 4).join(', ') + (todo.length > 4 ? '…' : '');
}

function NotesScreen({ onOpen }) {
  const [notes, setNotes] = useState(getNotes);
  const [importPending, setImportPending] = useState(null);
  const fileRef = useRef(null);
  const reload = () => setNotes(getNotes());

  useEffect(() => {
    if (sessionStorage.getItem('jsl_backup_reminded')) return;
    if (!backupReminderDue(notes.some(n => n.items.some(hasText)))) return;
    sessionStorage.setItem('jsl_backup_reminded', '1');
    toast('Tip: back up your lists to a file so they survive a browser data wipe.',
      { label: 'Back up now', fn: backupAll }, { sticky: true });
  }, []);

  function handleDelete(e, note) {
    e.stopPropagation();
    const removed = deleteNote(note.id);
    vibrate(10);
    reload();
    toast(`Deleted “${note.name}”`, { label: 'Undo', fn: () => { restoreNote(removed); reload(); } });
  }

  function handleImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    file.text().then(raw => {
      try {
        setImportPending(parseBackup(JSON.parse(raw)));
      } catch {
        toast('That file isn’t a JustShoppingList backup.');
      }
    });
  }

  function confirmImport() {
    replaceAll(importPending);
    setImportPending(null);
    reload();
    toast('Backup restored');
  }

  return html`
    <div class="notes-screen">
      <header class="bar">
        <span class="wordmark">JustShoppingList</span>
        <span class="private-badge"><${IconLock}/> 100% private</span>
        <${Menu} items=${[
          { label: 'Back up all lists', fn: backupAll },
          { label: 'Restore from backup…', fn: () => fileRef.current?.click() },
        ]}/>
      </header>
      <input ref=${fileRef} type="file" accept=".json,application/json" hidden onChange=${handleImportFile} />

      <main class="screen">
        ${notes.length === 0 && html`
          <div class="empty-state">
            <p class="empty-title">No lists yet</p>
            <p>Tap + to start one, then type or paste your items.</p>
          </div>
        `}
        <div class="cards">
          ${notes.map(note => {
            const { total, done } = countItems(note.items);
            return html`
              <div key=${note.id} class="card" role="button" tabIndex="0"
                onClick=${() => onOpen(note.id)}
                onKeyDown=${e => e.key === 'Enter' && onOpen(note.id)}>
                <div class="card-name">${note.name}</div>
                <div class="card-preview">${preview(note) || (total ? 'All done' : 'Empty')}</div>
                <div class="card-meta">${total ? `${done} / ${total} done · ` : ''}${timeAgo(note.updatedAt)}</div>
                <button class="card-del" title="Delete list" aria-label=${`Delete ${note.name}`}
                  onClick=${e => handleDelete(e, note)}><${IconTrash}/></button>
              </div>
            `;
          })}
        </div>
      </main>

      <button class="fab" onClick=${() => onOpen(createNote(todayName()).id)} title="New list" aria-label="New list">${IconPlus()}</button>

      ${importPending && html`
        <${ConfirmDialog}
          message=${`Restore ${plural(importPending.notes.length, 'list')} from this backup? This replaces all current lists.`}
          confirmLabel="Replace"
          onConfirm=${confirmImport}
          onCancel=${() => setImportPending(null)} />
      `}
    </div>
  `;
}

// ─── App root ─────────────────────────────────────────────────────────────────

const LAST_NOTE_KEY = 'jsl_last_note';

function lastNoteId() {
  const id = Number(localStorage.getItem(LAST_NOTE_KEY));
  if (id) return id;
  try { return JSON.parse(localStorage.getItem('jsl_last_list') || 'null')?.id || null; } catch { return null; }
}

function App() {
  const [noteId, setNoteId] = useState(() => {
    if (new URLSearchParams(location.search).has('list')) return null;
    const id = lastNoteId();
    return id && getNote(id) ? id : null;
  });
  const [shared, setShared] = useState(null);

  useEffect(() => {
    navigator.storage?.persist?.().catch(() => {});
    setTimeout(loadParser, 300); // categories + duplicate matching; harmless if it fails

    const encoded = new URLSearchParams(location.search).get('list');
    if (encoded) {
      history.replaceState({}, '', location.pathname);
      decodeShareLink(encoded).then(setShared).catch(() => toast('That share link looks broken.'));
    }
  }, []);

  function open(id) {
    try { localStorage.setItem(LAST_NOTE_KEY, String(id)); } catch { /* ignore */ }
    setNoteId(id);
  }

  function back() {
    try { localStorage.removeItem(LAST_NOTE_KEY); localStorage.removeItem('jsl_last_list'); } catch { /* ignore */ }
    setNoteId(null);
  }

  function importShared() {
    const items = (shared.items || []).map(i => newItem(i.qty > 1 ? `${i.qty}x ${i.name}` : String(i.name), !!i.checked));
    const note = createNote(shared.name || todayName(), items);
    setShared(null);
    open(note.id);
  }

  return html`
    <div id="app">
      ${noteId
        ? html`<${NoteView} key=${noteId} noteId=${noteId} onBack=${back}/>`
        : html`<${NotesScreen} onOpen=${open}/>`}
      <footer class="privacy-footer">
        <${IconShield}/>
        <span>Everything stays on your device. No servers, no accounts, no tracking.</span>
      </footer>
      <${ToastContainer}/>
      ${shared && html`
        <${ConfirmDialog}
          message=${`Add the shared list “${shared.name}” (${plural((shared.items || []).length, 'item')})?`}
          confirmLabel="Add list"
          onConfirm=${importShared}
          onCancel=${() => setShared(null)} />
      `}
    </div>
  `;
}

render(h(App, null), document.getElementById('root'));
