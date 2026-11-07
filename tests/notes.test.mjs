// Unit tests for notes.js (checklist model, view, paste, migrations).
// Run: node tests/notes.test.mjs
import assert from 'node:assert/strict';
import {
  parseLine, lineKey, stripQty, nameKey, newItem, countItems, viewItems, itemsToText,
  reconcile, planPaste, applyChecks, mergePaste, textNoteToItems, listToNote, v1ToNotes,
} from '../notes.js';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message.split('\n').join('\n       ')}`); }
}

const mk = (text, checked = false, extra = {}) => newItem(text, checked, extra);
const texts = (items) => items.map(i => i.text);

test('parseLine strips bullets and reads check markers', () => {
  assert.deepEqual(parseLine('- milk'), { text: 'milk', checked: false });
  assert.deepEqual(parseLine('3. bread'), { text: 'bread', checked: false });
  assert.deepEqual(parseLine('- [ ] jam'), { text: 'jam', checked: false });
  assert.deepEqual(parseLine('- [x] jam'), { text: 'jam', checked: true });
  assert.deepEqual(parseLine('☑ tea'), { text: 'tea', checked: true });
  assert.deepEqual(parseLine('☐ tea'), { text: 'tea', checked: false });
  assert.deepEqual(parseLine('~~tea~~'), { text: 'tea', checked: true });
  assert.deepEqual(parseLine('-5 degrees'), { text: '-5 degrees', checked: false });
});

test('stripQty / nameKey', () => {
  for (const s of ['12x eggs', '12 x eggs', '2 eggs', 'eggs x2', 'eggs (2)', 'eggs']) assert.equal(stripQty(s), 'eggs');
  assert.equal(stripQty('2l milk'), '2l milk');
  assert.equal(nameKey('- 2x  Eggs'), 'eggs');
  assert.equal(lineKey('  Milk   2L '), 'milk 2l');
});

test('newItem ids are unique', () => {
  const ids = new Set(Array.from({ length: 500 }, () => newItem('x').id));
  assert.equal(ids.size, 500);
});

test('countItems ignores blank items', () => {
  assert.deepEqual(countItems([mk('a', true), mk('b'), mk('  ')]), { total: 2, done: 1 });
});

test('viewItems: status filter, category filter, search', () => {
  const items = [mk('Milk', true, { cat: 'dairy' }), mk('Apples', false, { cat: 'produce' }), mk('Cheese', false, { cat: 'dairy' })];
  assert.deepEqual(texts(viewItems(items, { status: 'todo' })), ['Apples', 'Cheese']);
  assert.deepEqual(texts(viewItems(items, { status: 'done' })), ['Milk']);
  assert.deepEqual(texts(viewItems(items, { cat: 'dairy' })), ['Milk', 'Cheese']);
  assert.deepEqual(texts(viewItems(items, { query: 'app' })), ['Apples']);
  assert.deepEqual(texts(viewItems(items, { query: 'dai' })), ['Milk', 'Cheese'], 'search matches category');
});

test('viewItems: keep overrides filters', () => {
  const items = [mk('Milk', true), mk('Eggs')];
  assert.deepEqual(texts(viewItems(items, { status: 'todo', keep: new Set([items[0].id]) })), ['Milk', 'Eggs']);
});

test('viewItems: sorts never touch the source order', () => {
  const items = [mk('2x bread', false, { cat: 'bakery' }), mk('apples', false, { cat: 'produce' }), mk('Cheese', false, { cat: 'dairy' }), mk('zucchini', false, { cat: 'produce' })];
  const before = texts(items);
  assert.deepEqual(texts(viewItems(items, { sort: 'az' })), ['apples', '2x bread', 'Cheese', 'zucchini']);
  assert.deepEqual(texts(viewItems(items, { sort: 'category' })), ['apples', 'zucchini', '2x bread', 'Cheese']);
  assert.deepEqual(texts(items), before);
});

test('viewItems: recent puts latest checked first', () => {
  const items = [
    mk('a'), mk('b', true, { checkedAt: '2026-01-01T00:00:00Z' }), mk('c', true, { checkedAt: '2026-02-01T00:00:00Z' }),
  ];
  assert.deepEqual(texts(viewItems(items, { sort: 'recent' })), ['c', 'b', 'a']);
});

test('viewItems never shows blank lines', () => {
  assert.deepEqual(texts(viewItems([mk('a'), mk(''), mk('b')])), ['a', 'b']);
});

test('itemsToText skips blanks', () => {
  const items = [mk('milk', true), mk('eggs'), mk('')];
  assert.equal(itemsToText(items), 'milk\neggs');
  assert.equal(itemsToText(items, { onlyUnchecked: true }), 'eggs');
});

const lines = (items) => items.map(i => i.text);

test('reconcile: editing a line keeps its item and check', () => {
  const items = [mk('milk', true, { cat: 'dairy' }), mk('eggs')];
  const { items: out, removed } = reconcile(items, ['oat milk', 'eggs']);
  assert.equal(out[0].id, items[0].id);
  assert.equal(out[0].checked, true);
  assert.equal(out[0].text, 'oat milk');
  assert.equal(out[1], items[1], 'untouched lines keep the same object');
  assert.equal(removed.length, 0);
});

test('reconcile: Enter mid-line splits, first half keeps the item', () => {
  const items = [mk('milkeggs', true)];
  const { items: out } = reconcile(items, ['milk', 'eggs']);
  assert.equal(out[0].id, items[0].id);
  assert.equal(out[1].checked, false);
  assert.deepEqual(lines(out), ['milk', 'eggs']);
});

test('reconcile: new blank line, deleted line, moved line', () => {
  const [a, b, c] = [mk('a'), mk('b', true), mk('c')];
  let r = reconcile([a, b, c], ['a', '', 'b', 'c']);
  assert.deepEqual(lines(r.items), ['a', '', 'b', 'c']);
  assert.equal(r.items[2].id, b.id);
  r = reconcile([a, b, c], ['a', 'c']);
  assert.deepEqual(r.removed.map(i => i.id), [b.id]);
  r = reconcile([a, b, c], ['c', 'a', 'b']);
  assert.deepEqual(r.items.map(i => i.id), [c.id, a.id, b.id], 'moved lines keep identity');
});

test('reconcile: revive restores a removed item; markChecked checks new ones', () => {
  const b = mk('butter', true, { cat: 'dairy' });
  const revive = new Map([['butter', b]]);
  const r = reconcile([mk('a')], ['a', 'butter', 'jam'], { revive, markChecked: new Set(['jam']) });
  assert.equal(r.items[1].id, b.id);
  assert.equal(r.items[1].checked, true);
  assert.equal(r.items[2].checked, true);
});

test('reconcile: filling a blank line makes a new item (pasted [x] stays checked)', () => {
  const blank = mk('', true);
  const r = reconcile([mk('a'), blank], ['a', 'jam', 'tea'], { markChecked: new Set(['jam']) });
  assert.deepEqual(r.items.slice(1).map(i => [i.text, i.checked]), [['jam', true], ['tea', false]]);
});

test('reconcile: a revived line beats pairing with a blank line; ids stay unique', () => {
  const blank = mk('');
  const milk = mk('milk', true);
  let r = reconcile([mk('a'), blank], ['a', 'milk'], { revive: new Map([['milk', milk]]) });
  assert.equal(r.items[1].id, milk.id);
  assert.equal(r.items[1].checked, true);
  r = reconcile([mk('a')], ['a', 'milk', 'milk'], { revive: new Map([['milk', milk]]) });
  assert.equal(new Set(r.items.map(i => i.id)).size, 3);
});

test('planPaste: skips duplicates (ignoring quantity), cleans bullets, reads [x]', () => {
  const items = [mk('milk', true), mk('12x Eggs'), mk('tea')];
  const plan = planPaste({ items, pasted: '- Milk\n- bread\n- eggs\n- bread\n- [x] jam\n' });
  assert.deepEqual(plan.lines, ['bread', 'jam']);
  assert.equal(plan.skipped, 2);
  assert.equal(plan.setChecked.get(items[0].id), false);
  assert.ok(plan.newChecked.has('jam'));
  const { items: out, unchecked } = applyChecks(items, plan.setChecked);
  assert.equal(unchecked, 1);
  assert.equal(out[0].checked, false);
});

test('planPaste: excluded items (being replaced) do not count as duplicates', () => {
  const items = [mk('milk'), mk('tea')];
  assert.deepEqual(planPaste({ items, pasted: 'milk\ntea', exclude: new Set([items[0].id]) }).lines, ['milk']);
});

test('planPaste: smarter matcher and a throwing matcher', () => {
  const items = [mk('eggs')];
  assert.deepEqual(planPaste({ items, pasted: 'egg\nham', matchKey: t => t.toLowerCase().replace(/s$/, '') }).lines, ['ham']);
  assert.deepEqual(planPaste({ items, pasted: 'eggs\nham', matchKey: () => { throw new Error('x'); } }).lines, ['ham']);
});

test('mergePaste appends after the last real line', () => {
  const r = mergePaste({ items: [mk('a'), mk(''), mk('')], pasted: 'b\na' });
  assert.deepEqual(lines(r.items), ['a', 'b']);
  assert.deepEqual([r.added.length, r.skipped], [1, 1]);
});

test('textNoteToItems converts the v2 notepad format', () => {
  const out = textNoteToItems('Dairy:\nmilk\n\n2x eggs', ['milk']);
  assert.deepEqual(out.map(i => [i.text, i.checked]), [['Dairy:', false], ['milk', true], ['2x eggs', false]]);
});

test('listToNote (v1): newest first, quantities, checked, categories', () => {
  const note = listToNote({ id: 3, name: 'Weekly' }, [
    { id: 1, name: 'Milk', qty: 1, checked: true, category: 'dairy' },
    { id: 2, name: 'Eggs', qty: 12, checked: false, category: 'bogus' },
    { id: 0, name: 'Apples', qty: 1, checked: false, category: 'other' },
  ]);
  assert.equal(note.id, 3);
  assert.deepEqual(note.items.map(i => [i.text, i.checked, i.cat]), [['12x Eggs', false, null], ['Milk', true, 'dairy'], ['Apples', false, null]], "'other' is recomputed");
  assert.equal(note.items[1].catKey, 'milk');
});

test('listToNote honours saved manual order, unknown items first', () => {
  const items = [1, 2, 3, 4].map(id => ({ id, name: `i${id}`, qty: 1 }));
  assert.deepEqual(texts(listToNote({ id: 1, name: 'x' }, items, [2, 1, 3]).items), ['i4', 'i2', 'i1', 'i3']);
});

test('v1ToNotes groups items by list', () => {
  const notes = v1ToNotes({
    lists: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }],
    items: [{ id: 1, listId: 1, name: 'x', qty: 1 }, { id: 2, listId: 2, name: 'y', qty: 2 }],
  });
  assert.deepEqual(notes.map(n => [n.name, texts(n.items)]), [['A', ['x']], ['B', ['2x y']]]);
});

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
