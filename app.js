import { h, render } from 'https://esm.sh/preact@10.22.0';
import { useState, useEffect, useRef } from 'https://esm.sh/preact@10.22.0/hooks';
import htm from 'https://esm.sh/htm@3.1.1';
import {
  getNotes, getNote, createNote, saveNote, deleteNote, restoreNote,
  exportAll, parseBackup, replaceAll,
} from './db.js';
import {
  lineKey, isHeader, pruneChecked, countItems, remainingText, clearCheckedText, mergePaste,
} from './notes.js';

const html = htm.bind(h);

// ─── Lazy modules ─────────────────────────────────────────────────────────────
// parser.js (compromise NLP) and ocr.js (tesseract) come from CDNs. They are
// never on the startup path: if they fail to load, the notepad still works.

let parser = null;
function loadParser() {
  return import('./parser.js').then(m => (parser = m)).catch(() => null);
}

// "eggs" ≈ "egg" when the parser is loaded; plain key otherwise.
function matchKey(text) {
  return parser ? parser.dedupeKey(text) : lineKey(text);
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

function vibrate(ms = 10) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

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
const IconPlus = () => svg(html`<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`, 22, 2.5);
const IconX = () => svg(html`<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`, 18);
const IconCopy = () => svg(html`<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>`, 18);
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
      if (!sticky) setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000);
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

function recordBackup() {
  try { localStorage.setItem(BACKUP_KEY, String(Date.now())); } catch { /* ignore */ }
}

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
  recordBackup();
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
            : html`<button role="menuitem" class=${it.danger ? 'danger' : ''} onClick=${() => { setOpen(false); it.fn(); }}>${it.label}</button>`)}
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
// Photo → OCR → item lines handed back to the note. No review step: the note
// itself is the review, so junk lines can just be deleted.

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
            <p class="hint">Items are added as lines. Runs on your device.</p>
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

// ─── Note editor ──────────────────────────────────────────────────────────────
// A plain <textarea> does the editing, so typing, selection, copy/paste,
// autocorrect and undo all behave natively. A mirror layer on top renders the
// same text invisibly with identical wrapping; it supplies the check circles
// in the left margin and fades + strikes checked lines.

function NoteView({ noteId, onBack }) {
  const initial = useRef(getNote(noteId)).current;
  const [name, setName] = useState(initial?.name || todayName());
  const [text, setText] = useState(initial?.text || '');
  const [checked, setChecked] = useState(() => new Set(initial?.checked || []));
  const [showScan, setShowScan] = useState(false);
  const taRef = useRef(null);
  const checkedRef = useRef(checked);
  checkedRef.current = checked;

  // Uncontrolled textarea: set once, then the DOM owns the value so native
  // undo history survives re-renders.
  useEffect(() => {
    const ta = taRef.current;
    ta.value = initial?.text || '';
    if (!ta.value) ta.focus();
  }, []);

  // Save every change straight away (see db.js).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    saveNote(noteId, { name, text, checked: [...checked] });
  }, [name, text, checked]);

  const updateChecked = (next) => {
    checkedRef.current = next;
    setChecked(next);
  };

  function onInput(e) {
    const value = e.target.value;
    setText(value);
    const pruned = pruneChecked(value, checkedRef.current);
    if (pruned !== checkedRef.current) updateChecked(pruned);
  }

  function onPaste(e) {
    const pasted = e.clipboardData?.getData('text/plain') || '';
    if (!pasted.includes('\n')) return; // single line: let the browser paste
    e.preventDefault();
    const ta = taRef.current;
    const res = mergePaste({
      before: ta.value.slice(0, ta.selectionStart),
      after: ta.value.slice(ta.selectionEnd),
      pasted,
      checked: checkedRef.current,
      matchKey,
    });
    updateChecked(res.checked);
    if (res.insert || ta.selectionStart !== ta.selectionEnd) insertAtCursor(ta, res.insert);
    if (res.skipped) {
      const parts = [res.added && `Added ${res.added}`, `${res.skipped} already on list`].filter(Boolean);
      toast(parts.join(' · ') + (res.unchecked ? ` (${res.unchecked} unchecked)` : ''));
    }
  }

  function toggle(key) {
    const next = new Set(checkedRef.current);
    if (next.has(key)) next.delete(key); else next.add(key);
    vibrate(10);
    updateChecked(next);
  }

  // Bulk change from a menu action, with an Undo toast. Doesn't focus the
  // textarea, so the keyboard stays closed while shopping.
  function bulkChange(nextText, nextChecked, msg) {
    const prev = { text: taRef.current.value, checked: checkedRef.current };
    const apply = ({ text: t, checked: c }) => {
      taRef.current.value = t;
      setText(t);
      updateChecked(pruneChecked(t, c));
    };
    apply({ text: nextText, checked: nextChecked });
    toast(msg, { label: 'Undo', fn: () => apply(prev) });
  }

  function addLines(lines) {
    const value = taRef.current.value;
    const res = mergePaste({ before: value, after: '', pasted: lines.join('\n'), checked: checkedRef.current, matchKey });
    const msg = `Added ${plural(res.added, 'item')}` + (res.skipped ? ` · ${res.skipped} already on list` : '');
    bulkChange(value + res.insert, res.checked, msg);
  }

  const { total, done } = countItems(text, checked);
  const left = total - done;
  const canShare = typeof navigator.share === 'function';

  const menu = [
    { label: 'Copy list', fn: () => copyText(taRef.current.value.trim(), 'List copied') },
    { label: 'Copy what’s left', fn: () => copyText(remainingText(taRef.current.value, checkedRef.current), `Copied ${plural(left, 'item')}`) },
    canShare && { label: 'Share…', fn: () => navigator.share({ title: name, text: taRef.current.value.trim() }).catch(() => {}) },
    '-',
    { label: 'Scan a receipt', fn: () => setShowScan(true) },
    '-',
    { label: 'Uncheck all', fn: () => done && bulkChange(taRef.current.value, new Set(), `Unchecked ${plural(done, 'item')}`) },
    { label: 'Remove checked', fn: () => done && bulkChange(clearCheckedText(taRef.current.value, checkedRef.current), new Set(), `Removed ${plural(done, 'item')}`) },
  ];

  const lines = text.split('\n');

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
        <button class="icon-btn" onClick=${() => copyText(taRef.current.value.trim(), 'List copied')} title="Copy list" aria-label="Copy list"><${IconCopy}/></button>
        <${Menu} items=${menu}/>
      </header>
      <div class="progress" aria-hidden="true"><div style=${`width:${total ? (done / total) * 100 : 0}%`}></div></div>

      <main class="paper">
        <div class="sheet">
          <textarea ref=${taRef} class="sheet-text" aria-label="List"
            spellcheck="true" autocapitalize="sentences"
            placeholder=${'milk\neggs\n2x bread\n\nType or paste a list — one item per line.'}
            onInput=${onInput} onPaste=${onPaste}></textarea>
          <div class="sheet-mirror" aria-hidden="true">
            ${lines.map((line, i) => {
              const key = lineKey(line);
              const item = key && !isHeader(line);
              const isDone = item && checked.has(key);
              return html`
                <div key=${i} class="ln ${isDone ? 'done' : ''}">
                  ${item && html`
                    <button class="tick" tabIndex="-1"
                      aria-label=${isDone ? `Uncheck ${line}` : `Check ${line}`}
                      onPointerDown=${e => e.preventDefault()}
                      onMouseDown=${e => e.preventDefault()}
                      onClick=${() => toggle(key)}><span></span></button>
                  `}
                  <span class="ln-text">${line || ' '}</span>
                </div>
              `;
            })}
          </div>
        </div>
      </main>

      ${showScan && html`<${ScanModal} onClose=${() => setShowScan(false)} onLines=${addLines}/>`}
    </div>
  `;
}

// ─── All lists ────────────────────────────────────────────────────────────────

function preview(note) {
  const checked = new Set(note.checked || []);
  const items = note.text.split('\n').filter(l => lineKey(l) && !isHeader(l) && !checked.has(lineKey(l)));
  return items.slice(0, 4).join(', ') + (items.length > 4 ? '…' : '');
}

function NotesScreen({ onOpen }) {
  const [notes, setNotes] = useState(getNotes);
  const [importPending, setImportPending] = useState(null);
  const fileRef = useRef(null);
  const reload = () => setNotes(getNotes());

  useEffect(() => {
    if (sessionStorage.getItem('jsl_backup_reminded')) return;
    if (!backupReminderDue(notes.some(n => n.text.trim()))) return;
    sessionStorage.setItem('jsl_backup_reminded', '1');
    toast('Tip: back up your lists to a file so they survive a browser data wipe.',
      { label: 'Back up now', fn: backupAll }, { sticky: true });
  }, []);

  function handleCreate() {
    onOpen(createNote(todayName()).id);
  }

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
            const { total, done } = countItems(note.text, new Set(note.checked || []));
            return html`
              <div key=${note.id} class="card" role="button" tabIndex="0"
                onClick=${() => onOpen(note.id)}
                onKeyDown=${e => e.key === 'Enter' && onOpen(note.id)}>
                <div class="card-name">${note.name}</div>
                <div class="card-preview">${preview(note) || (total ? 'All done' : 'Empty')}</div>
                <div class="card-meta">
                  ${total ? `${done} / ${total} done · ` : ''}${timeAgo(note.updatedAt)}
                </div>
                <button class="card-del" title="Delete list" aria-label=${`Delete ${note.name}`}
                  onClick=${e => handleDelete(e, note)}><${IconTrash}/></button>
              </div>
            `;
          })}
        </div>
      </main>

      <button class="fab" onClick=${handleCreate} title="New list" aria-label="New list"><${IconPlus}/></button>

      ${importPending && html`
        <${ConfirmDialog}
          message=${`Restore ${plural(importPending.length, 'list')} from this backup? This replaces all current lists.`}
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
    // Warm the duplicate matcher in the background; harmless if it fails.
    setTimeout(loadParser, 1500);

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
    const items = shared.items || [];
    const lines = items.map(i => (i.qty > 1 ? `${i.qty}x ${i.name}` : i.name));
    const checked = items.filter(i => i.checked).map(i => lineKey(i.qty > 1 ? `${i.qty}x ${i.name}` : i.name));
    const note = createNote(shared.name || todayName(), lines.join('\n'), checked);
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
