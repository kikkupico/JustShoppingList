// Pure helpers for the checklist model. No DOM, no storage — unit-tested in
// tests/notes.test.mjs.
//
// A list is an ordered array of items: { id, text, checked, cat, catKey, checkedAt }.
// The array order is "my order". Search, filters and sort only change the view.
//   cat:    category name, or null until one has been worked out
//   catKey: the item key `cat` was worked out for; when the text changes the
//           category is recomputed (unless the user picked one for that name)

export const CATEGORIES = [
  'produce', 'bakery', 'meat', 'seafood', 'dairy', 'frozen', 'snacks', 'drinks', 'household', 'other',
];

const BULLET_RE = /^(?:[-*•◦▪·+–]|\d{1,3}[.)])\s+/;
const BOX_RE = /^(?:\[([ xX✓✔]?)\]|([☐☑☒✓✔✅]))\s*/;

// Strip list decoration from a line and report whether it was marked done.
// Handles "- milk", "1. milk", "- [x] milk", "☑ milk", "~~milk~~".
export function parseLine(raw) {
  let s = raw.trim().replace(BULLET_RE, '');
  let checked = false;
  const box = s.match(BOX_RE);
  if (box) {
    checked = box[1] !== undefined ? box[1] !== ' ' && box[1] !== '' : box[2] !== '☐';
    s = s.slice(box[0].length);
  }
  const strike = s.match(/^~~(.+)~~$/);
  if (strike) { s = strike[1]; checked = true; }
  return { text: s.trim(), checked };
}

// "12x eggs", "2 eggs", "eggs x2", "eggs (2)" → "eggs".
export function stripQty(text) {
  const name = text
    .replace(/^\d{1,3}\s*[x×]\s+|^\d{1,3}\s+/i, '')
    .replace(/\s+[x×]\s*\d{1,3}$|\s*\(\d{1,3}\)$/i, '')
    .trim();
  return name || text;
}

// Normalised item text: lowercase, single spaces, no bullets.
export function lineKey(line) {
  return parseLine(line).text.toLowerCase().replace(/\s+/g, ' ');
}

// Key for remembering a category the user picked: quantity doesn't matter.
export function nameKey(text) {
  return lineKey(stripQty(parseLine(text).text));
}

let seq = 0;
export function uid() {
  return Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);
}

export function newItem(text = '', checked = false, extra = {}) {
  return { id: uid(), text, checked, cat: null, catKey: null, checkedAt: checked ? new Date().toISOString() : null, ...extra };
}

export const hasText = (item) => !!item.text.trim();

export function countItems(items) {
  let total = 0, done = 0;
  for (const i of items) {
    if (!hasText(i)) continue;
    total++;
    if (i.checked) done++;
  }
  return { total, done };
}

// ─── View: search, filters, sort ──────────────────────────────────────────────

export function matchesQuery(item, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return item.text.toLowerCase().includes(q) || (item.cat || 'other').startsWith(q);
}

// status: 'all' | 'todo' | 'done'.  sort: 'mine' | 'az' | 'category' | 'recent'.
// `keep` holds ids that stay visible even if a filter would hide them (an item
// that was just checked, so it doesn't vanish under your finger).
export function viewItems(items, { query = '', status = 'all', cat = null, sort = 'mine', keep = null } = {}) {
  const visible = items.filter(i => {
    if (keep && keep.has(i.id)) return true;
    if (status === 'todo' && i.checked) return false;
    if (status === 'done' && !i.checked) return false;
    if (cat && (i.cat || 'other') !== cat) return false;
    return matchesQuery(i, query);
  });
  const pos = new Map(items.map((i, n) => [i.id, n]));
  const byMine = (a, b) => pos.get(a.id) - pos.get(b.id);
  if (sort === 'az') {
    return visible.sort((a, b) => stripQty(a.text).localeCompare(stripQty(b.text), undefined, { sensitivity: 'base' }) || byMine(a, b));
  }
  if (sort === 'category') {
    const rank = (i) => { const r = CATEGORIES.indexOf(i.cat || 'other'); return r === -1 ? CATEGORIES.length : r; };
    return visible.sort((a, b) => rank(a) - rank(b) || byMine(a, b));
  }
  if (sort === 'recent') {
    // Most recently checked first, then everything else in my order.
    return visible.sort((a, b) => {
      const ta = a.checked ? a.checkedAt || '' : '', tb = b.checked ? b.checkedAt || '' : '';
      return tb.localeCompare(ta) || byMine(a, b);
    });
  }
  return visible.sort(byMine);
}

// ─── Text in / out ────────────────────────────────────────────────────────────

export function itemsToText(items, { markChecked = false, onlyUnchecked = false } = {}) {
  return items
    .filter(i => hasText(i) && !(onlyUnchecked && i.checked))
    .map(i => (markChecked && i.checked ? `[x] ${i.text}` : i.text))
    .join('\n');
}

// Turn edited text back into items. Lines that match an existing item keep
// its id and category, so editing as text doesn't lose anything.
export function textToItems(text, existing = []) {
  const pool = new Map();
  for (const i of existing) {
    const k = lineKey(i.text);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k).push(i);
  }
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const { text: t, checked } = parseLine(raw);
    if (!t) continue;
    const prev = pool.get(lineKey(t))?.shift();
    if (prev) {
      out.push({ ...prev, text: t, checked, checkedAt: checked ? prev.checkedAt || new Date().toISOString() : null });
    } else {
      out.push(newItem(t, checked));
    }
  }
  return out;
}

// Add pasted lines to a list.
//   afterId:   insert new items after this item (end of list when null)
//   replaceId: an empty item to replace (pasting into a blank row)
//   matchKey:  smarter duplicate key ("eggs" ≈ "egg"); quantities are ignored
// Lines already on the list are not added again; they take the pasted check
// state instead (normally unchecked — "need it again").
export function mergePaste({ items, pasted, afterId = null, replaceId = null, matchKey = lineKey }) {
  const safeMatch = (t) => {
    const name = stripQty(t);
    try { return matchKey(name) || lineKey(name); } catch { return lineKey(name); }
  };

  const existing = new Map(); // match key -> ids
  for (const i of items) {
    if (i.id === replaceId || !hasText(i)) continue;
    const mk = safeMatch(i.text);
    if (!existing.has(mk)) existing.set(mk, []);
    existing.get(mk).push(i.id);
  }

  const now = new Date().toISOString();
  const setChecked = new Map(); // id -> checked
  const fresh = [];
  const seen = new Set();
  let skipped = 0, unchecked = 0;
  for (const raw of pasted.split(/\r?\n/)) {
    const { text, checked } = parseLine(raw);
    if (!text) continue;
    const mk = safeMatch(text);
    if (seen.has(mk)) continue;
    seen.add(mk);
    if (existing.has(mk)) {
      skipped++;
      for (const id of existing.get(mk)) setChecked.set(id, checked);
    } else {
      fresh.push(newItem(text, checked));
    }
  }

  let next = items.map(i => {
    if (!setChecked.has(i.id)) return i;
    const checked = setChecked.get(i.id);
    if (i.checked === checked) return i;
    if (!checked) unchecked++;
    return { ...i, checked, checkedAt: checked ? now : i.checkedAt };
  });

  const anchor = replaceId ?? afterId;
  const at = anchor == null ? -1 : next.findIndex(i => i.id === anchor);
  if (at === -1) {
    next = [...next.filter(i => i.id !== replaceId), ...fresh];
  } else {
    next = [...next.slice(0, replaceId ? at : at + 1), ...fresh, ...next.slice(at + 1)];
  }
  return { items: next, added: fresh, skipped, unchecked };
}

// ─── Older formats → items ────────────────────────────────────────────────────

// v2 (notepad): { text, checked: [line keys] }
export function textNoteToItems(text = '', checkedKeys = []) {
  const checked = new Set(checkedKeys);
  return text.split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => newItem(line, checked.has(lineKey(line))));
}

function itemLine(item) {
  const name = String(item.name || '').trim();
  return item.qty > 1 ? `${item.qty}x ${name}` : name;
}

// v1 (item-based): items in the order the old app showed them — the saved
// manual order when present (items missing from it first, newest first), else
// newest first. Categories carry over as-is.
export function listToNote(list, items, manualOrder) {
  let ordered = items.slice().sort((a, b) => b.id - a.id);
  if (Array.isArray(manualOrder)) {
    const pos = new Map(manualOrder.map((id, i) => [id, i]));
    ordered = [
      ...ordered.filter(i => !pos.has(i.id)),
      ...ordered.filter(i => pos.has(i.id)).sort((a, b) => pos.get(a.id) - pos.get(b.id)),
    ];
  }
  const now = new Date().toISOString();
  return {
    id: list.id,
    name: list.name || 'Shopping',
    items: ordered.filter(i => itemLine(i)).map(i => {
      const text = itemLine(i);
      // Keep real categories; 'other' was often just a miss, so let it be recomputed.
      const cat = CATEGORIES.includes(i.category) && i.category !== 'other' ? i.category : null;
      return newItem(text, !!i.checked, {
        cat,
        catKey: cat ? lineKey(text) : null,
        checkedAt: i.checked ? i.lastCheckedAt || now : null,
      });
    }),
    createdAt: list.createdAt || now,
    updatedAt: list.updatedAt || list.createdAt || now,
  };
}

export function v1ToNotes({ lists = [], items = [] }, getManualOrder = () => null) {
  return lists.map(list => listToNote(
    list,
    items.filter(i => i.listId === list.id),
    getManualOrder(list.id),
  ));
}
