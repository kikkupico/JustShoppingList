// Unit tests for notes.js (checklist model, view, paste, migrations).
// Run: node tests/notes.test.mjs
import assert from 'node:assert/strict';
import {
  parseLine, lineKey, stripQty, nameKey, newItem, countItems, viewItems, itemsToText,
  textToItems, mergePaste, textNoteToItems, listToNote, v1ToNotes,
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

test('itemsToText', () => {
  const items = [mk('milk', true), mk('eggs'), mk('')];
  assert.equal(itemsToText(items), 'milk\neggs');
  assert.equal(itemsToText(items, { markChecked: true }), '[x] milk\neggs');
  assert.equal(itemsToText(items, { onlyUnchecked: true }), 'eggs');
});

test('textToItems keeps ids and categories of matching lines', () => {
  const milk = mk('Milk', true, { cat: 'dairy', catKey: 'milk' });
  const out = textToItems('[x] milk\n- bread\n\n', [milk]);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, milk.id);
  assert.equal(out[0].cat, 'dairy');
  assert.equal(out[0].checked, true);
  assert.equal(out[1].text, 'bread');
});

test('mergePaste: new lines after the anchor, duplicates unchecked', () => {
  const items = [mk('milk', true), mk('12x Eggs'), mk('tea')];
  const r = mergePaste({ items, afterId: items[0].id, pasted: '- Milk\n- bread\n- eggs\n- bread\n' });
  assert.deepEqual(texts(r.items), ['milk', 'bread', '12x Eggs', 'tea']);
  assert.deepEqual([r.added.length, r.skipped, r.unchecked], [1, 2, 1]);
  assert.equal(r.items[0].checked, false);
});

test('mergePaste: replaces an empty row and keeps pasted check state', () => {
  const blank = mk('');
  const items = [mk('a'), blank, mk('b')];
  const r = mergePaste({ items, replaceId: blank.id, pasted: '- [x] jam\n- [ ] tea' });
  assert.deepEqual(texts(r.items), ['a', 'jam', 'tea', 'b']);
  assert.equal(r.items[1].checked, true);
});

test('mergePaste: appends when no anchor; smarter matcher; throwing matcher', () => {
  const items = [mk('eggs')];
  const singular = t => t.toLowerCase().replace(/s$/, '');
  assert.deepEqual(texts(mergePaste({ items, pasted: 'egg\nham', matchKey: singular }).items), ['eggs', 'ham']);
  assert.deepEqual(texts(mergePaste({ items, pasted: 'eggs\nham', matchKey: () => { throw new Error('x'); } }).items), ['eggs', 'ham']);
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
