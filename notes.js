// Pure helpers for the notepad model. No DOM, no storage — unit-tested in
// tests/notes.test.mjs.
//
// A list is plain text, one item per line. Checked state lives beside the text
// as a set of line keys, so the text itself stays clean for copy/paste.

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

// Cheap key used for checked state. Runs on every keystroke.
export function lineKey(line) {
  return parseLine(line).text.toLowerCase().replace(/\s+/g, ' ');
}

// "Produce:" or "# Produce" — a section label, not an item.
export function isHeader(line) {
  const t = line.trim();
  return t.length > 1 && (t.startsWith('#') || t.endsWith(':'));
}

export function isItem(line) {
  return !!lineKey(line) && !isHeader(line);
}

// Drop checked keys whose line no longer exists. Returns the same Set when
// nothing changed, so callers can skip a state update.
export function pruneChecked(text, checked) {
  if (!checked.size) return checked;
  const present = new Set(text.split('\n').map(lineKey));
  let changed = false;
  const next = new Set();
  for (const k of checked) {
    if (present.has(k)) next.add(k);
    else changed = true;
  }
  return changed ? next : checked;
}

export function countItems(text, checked) {
  let total = 0, done = 0;
  for (const line of text.split('\n')) {
    if (!isItem(line)) continue;
    total++;
    if (checked.has(lineKey(line))) done++;
  }
  return { total, done };
}

// Unchecked items, keeping only the section headers that still have items.
export function remainingText(text, checked) {
  const out = [];
  let pendingHeader = null;
  for (const line of text.split('\n')) {
    if (!lineKey(line)) continue;
    if (isHeader(line)) { pendingHeader = line; continue; }
    if (checked.has(lineKey(line))) continue;
    if (pendingHeader !== null) { out.push(pendingHeader); pendingHeader = null; }
    out.push(line);
  }
  return out.join('\n');
}

export function clearCheckedText(text, checked) {
  return text.split('\n')
    .filter(line => !(isItem(line) && checked.has(lineKey(line))))
    .join('\n');
}

// "12x eggs", "2 eggs", "eggs x2", "eggs (2)" → "eggs". Used only to spot
// duplicates; the text itself is never changed.
export function stripQty(text) {
  const name = text
    .replace(/^\d{1,3}\s*[x×]\s+|^\d{1,3}\s+/i, '')
    .replace(/\s+[x×]\s*\d{1,3}$|\s*\(\d{1,3}\)$/i, '')
    .trim();
  return name || text;
}

// Merge pasted text into a note at the cursor.
//   before/after: note text on either side of the selection being replaced
//   matchKey:     smarter key for spotting duplicates ("eggs" ≈ "egg")
// Lines already in the note are skipped and set to the pasted check state
// (normally unchecked — "need it again"). New lines are cleaned of bullets.
export function mergePaste({ before, after, pasted, checked, matchKey = lineKey }) {
  const next = new Set(checked);
  const safeMatch = (t) => {
    if (isHeader(t)) return lineKey(t);
    const name = stripQty(t);
    try { return matchKey(name) || lineKey(name); } catch { return lineKey(name); }
  };

  const existing = new Map(); // match key -> line keys of existing lines
  for (const line of `${before}\n${after}`.split('\n')) {
    const key = lineKey(line);
    if (!key) continue;
    const mk = safeMatch(parseLine(line).text);
    if (!existing.has(mk)) existing.set(mk, []);
    existing.get(mk).push(key);
  }

  const out = [];
  const seen = new Set();
  let added = 0, skipped = 0, unchecked = 0;
  for (const raw of pasted.split(/\r?\n/)) {
    const { text, checked: done } = parseLine(raw);
    if (!text) continue;
    const mk = safeMatch(text);
    if (seen.has(mk)) continue;
    seen.add(mk);
    if (existing.has(mk)) {
      skipped++;
      for (const key of existing.get(mk)) {
        if (done) next.add(key);
        else if (next.delete(key)) unchecked++;
      }
      continue;
    }
    out.push(text);
    added++;
    if (done) next.add(lineKey(text)); else next.delete(lineKey(text));
  }

  let insert = out.join('\n');
  if (insert) {
    if (before && !before.endsWith('\n')) insert = '\n' + insert;
    if (after && !after.startsWith('\n')) insert += '\n';
  }
  return { insert, checked: next, added, skipped, unchecked };
}

// ─── Old item-based format (v1) → notes ───────────────────────────────────────

function itemLine(item) {
  const name = String(item.name || '').trim();
  return item.qty > 1 ? `${item.qty}x ${name}` : name;
}

// Lines appear in the order the old app showed them: the saved manual order
// when present (items missing from it first, newest first), else newest first.
export function listToNote(list, items, manualOrder) {
  let ordered = items.slice().sort((a, b) => b.id - a.id);
  if (Array.isArray(manualOrder)) {
    const pos = new Map(manualOrder.map((id, i) => [id, i]));
    ordered = [
      ...ordered.filter(i => !pos.has(i.id)),
      ...ordered.filter(i => pos.has(i.id)).sort((a, b) => pos.get(a.id) - pos.get(b.id)),
    ];
  }
  const lines = ordered.map(itemLine).filter(Boolean);
  const checked = [...new Set(ordered.filter(i => i.checked).map(i => lineKey(itemLine(i))).filter(Boolean))];
  return {
    id: list.id,
    name: list.name || 'Shopping',
    text: lines.join('\n'),
    checked,
    createdAt: list.createdAt || new Date().toISOString(),
    updatedAt: list.updatedAt || list.createdAt || new Date().toISOString(),
  };
}

export function v1ToNotes({ lists = [], items = [] }, getManualOrder = () => null) {
  return lists.map(list => listToNote(
    list,
    items.filter(i => i.listId === list.id),
    getManualOrder(list.id),
  ));
}
