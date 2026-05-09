import { h, render } from 'https://esm.sh/preact@10.22.0';
import { useState, useEffect, useRef, useCallback } from 'https://esm.sh/preact@10.22.0/hooks';
import { html } from 'https://esm.sh/htm@3.1.1/preact';
import {
  createList, getLists, updateListName, deleteList, duplicateList,
  addItem, getItems, toggleItem, deleteItem, clearChecked
} from './db.js';
import { initOCR, recogniseReceipt, isOCRReady } from './ocr.js';
import { extractItemsFromText } from './parser.js';

// ─── Utilities ────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
}

function todayName() {
  const d = new Date();
  return `Shopping ${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`;
}

const CAT_CLASSES = {
  produce: 'cat-produce', dairy: 'cat-dairy', meat: 'cat-meat',
  frozen: 'cat-frozen', bakery: 'cat-bakery', drinks: 'cat-drinks',
  snacks: 'cat-snacks', household: 'cat-household', other: 'cat-other',
};

// ─── Share URL ────────────────────────────────────────────────────────────────

async function exportAsURL(list, items) {
  const payload = {
    name: list.name,
    items: items.map(({ name, qty, checked }) => ({ name, qty, checked })),
  };
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const compressed = await new Response(cs.readable).arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(compressed)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const url = `${location.origin}${location.pathname}?list=${b64}`;
  await navigator.clipboard.writeText(url);
  return url;
}

async function importFromURL(encoded) {
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const text = await new Response(ds.readable).text();
  return JSON.parse(text);
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

const IconLock = () => html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
const IconBack = () => html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
const IconMore = () => html`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>`;
const IconCamera = () => html`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
const IconPlus = () => html`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
const IconShield = () => html`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
const IconX = () => html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const IconUpload = () => html`<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>`;

const IconCopy = () => html`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

// ─── Toast ─────────────────────────────────────────────────────────────────────

function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const handler = (e) => {
      const id = Date.now();
      setToasts(t => [...t, { id, msg: e.detail.msg }]);
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000);
    };
    window.addEventListener('cartly-toast', handler);
    return () => window.removeEventListener('cartly-toast', handler);
  }, []);

  return html`<div class="toast-container">${toasts.map(t => html`<div key=${t.id} class="toast">${t.msg}</div>`)}</div>`;
}

function toast(msg) {
  window.dispatchEvent(new CustomEvent('cartly-toast', { detail: { msg } }));
}

// ─── Confirm Dialog ────────────────────────────────────────────────────────────

function ConfirmDialog({ message, onConfirm, onCancel }) {
  return html`
    <div class="confirm-overlay" onClick=${onCancel}>
      <div class="confirm-box" onClick=${e => e.stopPropagation()}>
        <p>${message}</p>
        <div class="confirm-actions">
          <button class="cancel-btn" onClick=${onCancel}>Cancel</button>
          <button class="danger-btn" onClick=${onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  `;
}

// ─── Checkbox ─────────────────────────────────────────────────────────────────

function Checkbox({ checked, onChange }) {
  return html`
    <label class="checkbox-wrap">
      <input type="checkbox" name="item-checkbox" checked=${checked} onChange=${onChange} />
      <span class="checkbox-box">
        <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
          <polyline class="check-path" points="1.5,5 4.5,8 10.5,1.5"
            stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
    </label>
  `;
}

// ─── Receipt Modal ─────────────────────────────────────────────────────────────

function ReceiptModal({ listId, onClose, onAdded }) {
  const [phase, setPhase] = useState('drop'); // drop | scanning | extracting | results | error
  const [previewUrl, setPreviewUrl] = useState(null);
  const [ocrPct, setOcrPct] = useState(0);
  const [foundItems, setFoundItems] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const fileRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => () => { clearInterval(timerRef.current); }, []);

  async function processFile(file) {
    if (!file.type.startsWith('image/')) return;
    setPreviewUrl(URL.createObjectURL(file));
    setPhase('scanning');
    setOcrPct(0);

    // fake progress 0→85 over 3s
    const start = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min(85, Math.round((elapsed / 3000) * 85));
      setOcrPct(pct);
    }, 100);

    let ocrResult;
    try {
      if (!isOCRReady) {
        toast('OCR loading, please wait...');
        await initOCR();
      }
      ocrResult = await recogniseReceipt(file);
    } catch (e) {
      clearInterval(timerRef.current);
      setPhase('error');
      setErrorMsg('OCR failed — try a clearer photo.');
      return;
    }
    clearInterval(timerRef.current);
    setOcrPct(100);

    setPhase('extracting');
    let result;
    try {
      result = extractItemsFromText(ocrResult.text, ocrResult.lines);
    } catch (e) {
      setPhase('error');
      setErrorMsg('Could not extract items. Try again.');
      return;
    }

    if (!result.items || result.items.length === 0) {
      setPhase('error');
      setErrorMsg('No items found — try a clearer photo.');
      return;
    }

    setFoundItems(result.items);
    setSelected(new Set(result.items.map((_, i) => i)));
    setPhase('results');
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  async function handleAdd() {
    const toAdd = foundItems.filter((_, i) => selected.has(i));
    for (const item of toAdd) {
      await addItem(listId, { ...item, addedFrom: 'receipt' });
    }
    onAdded();
    onClose();
  }

  function toggleFound(i) {
    setSelected(s => {
      const next = new Set(s);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  return html`
    <div class="modal-overlay" onClick=${onClose}>
      <div class="modal" onClick=${e => e.stopPropagation()}>
        <div class="modal-header">
          <span class="modal-title">Scan Receipt</span>
          <button class="icon-btn" onClick=${onClose}><${IconX}/></button>
        </div>

        ${phase === 'drop' && html`
          <div class="drop-zone ${dragOver ? 'drag-over' : ''}"
            onDragOver=${e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave=${() => setDragOver(false)}
            onDrop=${handleDrop}
            onClick=${() => fileRef.current.click()}>
            <${IconUpload}/>
            <p>Drag & drop a receipt photo</p>
            <p style="font-size:0.75rem;margin-top:0.25rem">or tap to choose / take photo</p>
            <input ref=${fileRef} type="file" name="receipt-file" id="receipt-file" accept="image/*"
              style="display:none"
              onChange=${e => { const f = e.target.files[0]; if (f) processFile(f); }} />
          </div>
        `}

        ${phase === 'scanning' && html`
          ${previewUrl && html`<img class="preview-img" src=${previewUrl} alt="Receipt preview"/>`}
          <div class="ocr-progress-wrap">
            <span class="ocr-progress-label">Scanning receipt... ${ocrPct}%</span>
            <div class="ocr-progress-bar">
              <div class="ocr-progress-fill" style="width:${ocrPct}%"></div>
            </div>
          </div>
        `}

        ${phase === 'extracting' && html`
          ${previewUrl && html`<img class="preview-img" src=${previewUrl} alt="Receipt preview"/>`}
          <div class="spinner-row"><div class="spinner"></div> Extracting items...</div>
        `}

        ${phase === 'results' && html`
          ${previewUrl && html`<img class="preview-img" src=${previewUrl} alt="Receipt preview"/>`}
          <p class="found-items-header">Found ${foundItems.length} item${foundItems.length !== 1 ? 's' : ''} — deselect any to skip</p>
          <ul class="found-items-list">
            ${foundItems.map((item, i) => html`
              <li key=${i} class="found-item-row" onClick=${(e) => { e.preventDefault(); toggleFound(i); }}>
                <${Checkbox} checked=${selected.has(i)} onChange=${(e) => { e.stopPropagation(); toggleFound(i); }}/>
                <span class="item-name">${item.name}</span>
                ${item.qty > 1 && html`<span class="qty-badge">×${item.qty}</span>`}
                <span class="cat-dot ${CAT_CLASSES[item.category] || 'cat-other'}"></span>
              </li>
            `)}
          </ul>
          <button class="primary-btn"
            disabled=${selected.size === 0}
            onClick=${handleAdd}>
            Add ${selected.size} item${selected.size !== 1 ? 's' : ''} to list
          </button>
        `}

        ${phase === 'error' && html`
          <div class="error-msg">${errorMsg}</div>
          <button class="primary-btn" onClick=${() => setPhase('drop')}>Try again</button>
        `}
      </div>
    </div>
  `;
}

// ─── ListView ──────────────────────────────────────────────────────────────────

function ListView({ listId, listName: initialName, onBack }) {
  const [items, setItems] = useState([]);
  const [listName, setListName] = useState(initialName);
  const [addText, setAddText] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const menuRef = useRef(null);

  const loadItems = useCallback(async () => {
    const data = await getItems(listId);
    setItems(data);
  }, [listId]);

  useEffect(() => { loadItems(); }, [loadItems]);

  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function handleAdd() {
    const lines = addText.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const existing = new Set(items.map(i => i.name.toLowerCase()));
    const toAdd = [...new Set(lines)].filter(l => !existing.has(l.toLowerCase()));
    await Promise.all(toAdd.map(name => addItem(listId, { name })));
    setAddText('');
    loadItems();
  }

  function handlePaste(e) {
    const text = e.clipboardData.getData('text');
    if (!text.includes('\n')) return;
    e.preventDefault();
    setAddText(prev => {
      const joined = prev ? prev + '\n' + text : text;
      return joined;
    });
  }

  async function handleToggle(id) {
    await toggleItem(id);
    loadItems();
  }

  async function handleDelete(id) {
    await deleteItem(id);
    loadItems();
  }

  async function handleRename(name) {
    const trimmed = name.trim() || todayName();
    setListName(trimmed);
    await updateListName(listId, trimmed);
  }

  async function handleClearChecked() {
    setShowMenu(false);
    await clearChecked(listId);
    loadItems();
  }

  function handleExportJSON() {
    setShowMenu(false);
    const data = { name: listName, exportedAt: new Date().toISOString(), items };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${listName.replace(/[^a-z0-9]/gi, '_')}.json`;
    a.click();
  }

  async function handleShareURL() {
    setShowMenu(false);
    try {
      await exportAsURL({ name: listName }, items);
      toast('Link copied!');
    } catch {
      toast('Could not copy link.');
    }
  }

  const unchecked = items.filter(i => !i.checked);
  const checked = items.filter(i => i.checked);
  const total = items.length;
  const checkedCount = checked.length;
  const pct = total ? Math.round((checkedCount / total) * 100) : 0;

  return html`
    <div class="list-view">
      <div class="list-header">
        <button class="icon-btn" onClick=${onBack}><${IconBack}/></button>
        <input class="list-name-input" name="list-name" id="list-name" value=${listName}
          onInput=${e => setListName(e.target.value)}
          onBlur=${e => handleRename(e.target.value)}
          onKeyDown=${e => e.key === 'Enter' && e.target.blur()}
        />
        <div class="overflow-menu-wrap" ref=${menuRef}>
          <button class="icon-btn" onClick=${() => setShowMenu(v => !v)}><${IconMore}/></button>
          ${showMenu && html`
            <div class="overflow-menu">
              <button onClick=${handleClearChecked}>Clear checked</button>
              <button onClick=${handleExportJSON}>Export JSON</button>
              <button onClick=${handleShareURL}>Share as URL</button>
            </div>
          `}
        </div>
      </div>

      <div class="progress-bar-wrap">
        <div class="progress-bar-fill" style="width:${pct}%"></div>
      </div>

      <div class="screen list-scroll-area">
        <ul class="items-list">
          ${unchecked.map(item => html`
            <li key=${item.id} class="item-row">
              <${Checkbox} checked=${false} onChange=${() => handleToggle(item.id)}/>
              <span class="item-name mono">${item.name}</span>
              ${item.qty > 1 && html`<span class="qty-badge">×${item.qty}</span>`}
              <span class="cat-dot ${CAT_CLASSES[item.category] || 'cat-other'}"></span>
              <button class="delete-btn" onClick=${() => handleDelete(item.id)}>
                <${IconX}/>
              </button>
            </li>
          `)}
        </ul>

        ${checked.length > 0 && html`
          <p class="section-label">Checked (${checkedCount})</p>
          <ul class="items-list">
            ${checked.map(item => html`
              <li key=${item.id} class="item-row checked">
                <${Checkbox} checked=${true} onChange=${() => handleToggle(item.id)}/>
                <span class="item-name mono">${item.name}</span>
                ${item.qty > 1 && html`<span class="qty-badge">×${item.qty}</span>`}
                <span class="cat-dot ${CAT_CLASSES[item.category] || 'cat-other'}"></span>
                <button class="delete-btn" onClick=${() => handleDelete(item.id)}>
                  <${IconX}/>
                </button>
              </li>
            `)}
          </ul>
        `}

        ${items.length === 0 && html`
          <div class="empty-state" style="padding:2rem 0">
            <p>No items yet — add one below.</p>
          </div>
        `}
      </div>

      <div class="add-item-bar">
        <textarea
          class="add-item-input"
          name="add-item"
          id="add-item"
          placeholder="Add item... (paste a list to bulk-add)"
          value=${addText}
          onInput=${e => setAddText(e.target.value)}
          onPaste=${handlePaste}
          onKeyDown=${e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAdd(); } }}
        />
        <button class="add-btn" onClick=${handleAdd}><${IconPlus}/></button>
      </div>

      <button class="fab" onClick=${() => setShowReceipt(true)} title="Scan receipt">
        <${IconCamera}/>
      </button>

      ${showReceipt && html`
        <${ReceiptModal}
          listId=${listId}
          onClose=${() => setShowReceipt(false)}
          onAdded=${loadItems}
        />
      `}
    </div>
  `;
}

// ─── ListsScreen ───────────────────────────────────────────────────────────────

function ListsScreen({ onOpen }) {
  const [lists, setLists] = useState([]);
  const [confirm, setConfirm] = useState(null); // { id, name }
  const longPressRef = useRef(null);

  const loadLists = useCallback(async () => {
    const data = await getLists();
    setLists(data);
  }, []);

  useEffect(() => { loadLists(); }, [loadLists]);

  async function handleCreate() {
    const id = await createList(todayName());
    await loadLists();
    // open immediately
    const fresh = await getLists();
    const created = fresh.find(l => l.id === id);
    if (created) onOpen(created);
  }

  function startLongPress(list) {
    longPressRef.current = setTimeout(() => {
      setConfirm(list);
    }, 600);
  }

  function cancelLongPress() {
    clearTimeout(longPressRef.current);
  }

  async function handleDelete() {
    if (!confirm) return;
    await deleteList(confirm.id);
    setConfirm(null);
    loadLists();
  }

  async function handleDuplicate(e, list) {
    e.stopPropagation();
    const newId = await duplicateList(list.id, list.name);
    await loadLists();
    const fresh = await getLists();
    const created = fresh.find(l => l.id === newId);
    if (created) onOpen(created);
  }

  return html`
    <div>
      <header class="app-header">
        <div class="header-left">
          <span class="wordmark">Cartly</span>
        </div>
        <div class="header-right">
          <${IconLock}/>
          <span class="private-badge">100% private</span>
        </div>
      </header>

      <div class="screen">
        ${lists.length === 0 && html`
          <div class="empty-state">
            <svg class="empty-cart" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="8" y="18" width="64" height="44" rx="4" stroke="#E0D8CC" stroke-width="2"/>
              <path d="M8 30h64" stroke="#E0D8CC" stroke-width="2"/>
              <circle cx="28" cy="70" r="4" fill="#E0D8CC"/>
              <circle cx="52" cy="70" r="4" fill="#E0D8CC"/>
              <path d="M20 18V14a4 4 0 0 1 4-4h32a4 4 0 0 1 4 4v4" stroke="#E0D8CC" stroke-width="2"/>
              <line x1="32" y1="42" x2="48" y2="42" stroke="#C8C0B4" stroke-width="2" stroke-linecap="round"/>
              <line x1="40" y1="34" x2="40" y2="50" stroke="#C8C0B4" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <p>No lists yet</p>
            <p style="font-size:0.78rem">Tap + to create your first shopping list</p>
          </div>
        `}

        <div class="lists-grid">
          ${lists.map(list => html`
            <div key=${list.id} class="list-card"
              onClick=${() => onOpen(list)}
              onMouseDown=${() => startLongPress(list)}
              onMouseUp=${cancelLongPress}
              onMouseLeave=${cancelLongPress}
              onTouchStart=${() => startLongPress(list)}
              onTouchEnd=${cancelLongPress}>
              <div class="list-card-name">${list.name}</div>
              <button class="list-card-dup" title="Duplicate list" onClick=${e => handleDuplicate(e, list)}>
                <${IconCopy}/>
              </button>
            </div>
          `)}
        </div>
      </div>

      <button class="fab" onClick=${handleCreate} title="New list">
        <${IconPlus}/>
      </button>

      ${confirm && html`
        <${ConfirmDialog}
          message=${'Delete "' + confirm.name + '"? This cannot be undone.'}
          onConfirm=${handleDelete}
          onCancel=${() => setConfirm(null)}
        />
      `}
    </div>
  `;
}

// ─── Import Prompt ─────────────────────────────────────────────────────────────

function ImportPrompt({ data, onImport, onDismiss }) {
  return html`
    <div class="confirm-overlay" onClick=${onDismiss}>
      <div class="confirm-box" onClick=${e => e.stopPropagation()}>
        <p>Import shared list <strong>"${data.name}"</strong> with ${data.items.length} item${data.items.length !== 1 ? 's' : ''}?</p>
        <div class="confirm-actions">
          <button class="cancel-btn" onClick=${onDismiss}>Skip</button>
          <button class="primary-btn" style="flex:1" onClick=${onImport}>Import</button>
        </div>
      </div>
    </div>
  `;
}

// ─── Footer ────────────────────────────────────────────────────────────────────

function Footer() {
  return html`
    <footer class="privacy-footer">
      <${IconShield}/>
      <span>Everything stays on your device. No servers, no accounts, no tracking.</span>
    </footer>
  `;
}

// ─── App Root ──────────────────────────────────────────────────────────────────

function App() {
  const [view, setView] = useState('lists'); // lists | list
  const [activeList, setActiveList] = useState(null);
  const [importData, setImportData] = useState(null);

  useEffect(() => {
    initOCR().catch(() => {});

    // Check for shared list URL
    const params = new URLSearchParams(location.search);
    const encoded = params.get('list');
    if (encoded) {
      importFromURL(encoded)
        .then(data => setImportData(data))
        .catch(() => {});
      // clean URL
      history.replaceState({}, '', location.pathname);
    }
  }, []);

  async function handleImport() {
    if (!importData) return;
    const id = await createList(importData.name);
    for (const item of importData.items) {
      await addItem(id, { name: item.name, qty: item.qty || 1, addedFrom: 'manual', checked: false });
    }
    setImportData(null);
    toast('List imported!');
  }

  function openList(list) {
    setActiveList(list);
    setView('list');
  }

  return html`
    <div id="app">
      ${view === 'lists' && html`<${ListsScreen} onOpen=${openList}/>`}
      ${view === 'list' && activeList && html`
        <${ListView}
          listId=${activeList.id}
          listName=${activeList.name}
          onBack=${() => setView('lists')}
        />
      `}
      <${Footer}/>
      <${ToastContainer}/>
      ${importData && html`
        <${ImportPrompt}
          data=${importData}
          onImport=${handleImport}
          onDismiss=${() => setImportData(null)}
        />
      `}
    </div>
  `;
}

render(h(App, null), document.getElementById('root'));
