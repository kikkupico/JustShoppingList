// Unit tests for notes.js (notepad model + v1 migration).
// Run: node tests/notes.test.mjs
import assert from 'node:assert/strict';
import {
  parseLine, lineKey, isHeader, pruneChecked, countItems, remainingText,
  clearCheckedText, mergePaste, listToNote, v1ToNotes, stripQty,
} from '../notes.js';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message.split('\n').join('\n       ')}`); }
}

test('parseLine strips bullets and reads check markers', () => {
  assert.deepEqual(parseLine('- milk'), { text: 'milk', checked: false });
  assert.deepEqual(parseLine('  * eggs '), { text: 'eggs', checked: false });
  assert.deepEqual(parseLine('3. bread'), { text: 'bread', checked: false });
  assert.deepEqual(parseLine('- [ ] jam'), { text: 'jam', checked: false });
  assert.deepEqual(parseLine('- [x] jam'), { text: 'jam', checked: true });
  assert.deepEqual(parseLine('[X] jam'), { text: 'jam', checked: true });
  assert.deepEqual(parseLine('☐ tea'), { text: 'tea', checked: false });
  assert.deepEqual(parseLine('☑ tea'), { text: 'tea', checked: true });
  assert.deepEqual(parseLine('✓ tea'), { text: 'tea', checked: true });
  assert.deepEqual(parseLine('~~tea~~'), { text: 'tea', checked: true });
  assert.deepEqual(parseLine('2x bread'), { text: '2x bread', checked: false });
  assert.deepEqual(parseLine('-5 degrees'), { text: '-5 degrees', checked: false });
});

test('lineKey normalises case, spacing and bullets', () => {
  assert.equal(lineKey('  Milk   2L '), 'milk 2l');
  assert.equal(lineKey('- milk 2l'), 'milk 2l');
  assert.equal(lineKey('   '), '');
});

test('isHeader', () => {
  assert.ok(isHeader('Produce:'));
  assert.ok(isHeader('# Dairy'));
  assert.ok(!isHeader('milk'));
  assert.ok(!isHeader(':'));
});

test('pruneChecked drops keys for removed lines and keeps identity when unchanged', () => {
  const c = new Set(['milk', 'eggs']);
  assert.equal(pruneChecked('milk\neggs', c), c);
  assert.deepEqual([...pruneChecked('milk', c)], ['milk']);
});

test('countItems ignores blanks and headers', () => {
  assert.deepEqual(countItems('Dairy:\nmilk\n\neggs\n', new Set(['milk'])), { total: 2, done: 1 });
});

test('remainingText keeps headers only when they have items left', () => {
  const text = 'Dairy:\nmilk\neggs\nProduce:\napples\n\nbread';
  assert.equal(remainingText(text, new Set(['milk', 'eggs'])), 'Produce:\napples\nbread');
});

test('clearCheckedText removes checked items, keeps the rest verbatim', () => {
  assert.equal(clearCheckedText('Dairy:\nmilk\n\neggs', new Set(['milk'])), 'Dairy:\n\neggs');
});

test('mergePaste adds new lines, skips existing ones and unchecks them', () => {
  const r = mergePaste({ before: 'milk\neggs', after: '', pasted: '- Milk\n- bread\n- bread\n', checked: new Set(['milk']) });
  assert.equal(r.insert, '\nbread');
  assert.deepEqual([r.added, r.skipped, r.unchecked], [1, 1, 1]);
  assert.ok(!r.checked.has('milk'));
});

test('mergePaste keeps pasted check state', () => {
  const r = mergePaste({ before: '', after: '', pasted: '- [x] jam\n- [ ] tea', checked: new Set() });
  assert.equal(r.insert, 'jam\ntea');
  assert.ok(r.checked.has('jam'));
  assert.ok(!r.checked.has('tea'));
});

test('mergePaste puts the block on its own lines mid-text', () => {
  const r = mergePaste({ before: 'apples', after: 'pears', pasted: 'kiwi\nlime', checked: new Set() });
  assert.equal(r.insert, '\nkiwi\nlime\n');
});

test('mergePaste uses the smarter matcher when given', () => {
  const singular = t => t.toLowerCase().replace(/s$/, '');
  const r = mergePaste({ before: 'eggs', after: '', pasted: 'egg\nham', checked: new Set(['eggs']), matchKey: singular });
  assert.equal(r.insert, '\nham');
  assert.ok(!r.checked.has('eggs'));
});

test('stripQty', () => {
  for (const s of ['12x eggs', '12 x eggs', '2 eggs', 'eggs x2', 'eggs (2)', 'eggs']) assert.equal(stripQty(s), 'eggs');
  assert.equal(stripQty('2l milk'), '2l milk');
  assert.equal(stripQty('42'), '42');
});

test('mergePaste ignores quantities when spotting duplicates', () => {
  const r = mergePaste({ before: '12x Eggs', after: '', pasted: 'eggs\n2 milk', checked: new Set(['12x eggs']) });
  assert.equal(r.insert, '\n2 milk');
  assert.ok(!r.checked.has('12x eggs'));
});

test('mergePaste survives a throwing matcher', () => {
  const r = mergePaste({ before: 'milk', after: '', pasted: 'milk\ntea', checked: new Set(), matchKey: () => { throw new Error('x'); } });
  assert.equal(r.insert, '\ntea');
});

test('listToNote: newest first, quantities, checked state', () => {
  const note = listToNote({ id: 3, name: 'Weekly' }, [
    { id: 1, name: 'Milk', qty: 1, checked: true },
    { id: 2, name: 'Eggs', qty: 12, checked: false },
  ]);
  assert.equal(note.id, 3);
  assert.equal(note.text, '12x Eggs\nMilk');
  assert.deepEqual(note.checked, ['milk']);
});

test('listToNote honours saved manual order, unknown items first', () => {
  const items = [1, 2, 3, 4].map(id => ({ id, name: `i${id}`, qty: 1, checked: false }));
  assert.equal(listToNote({ id: 1, name: 'x' }, items, [2, 1, 3]).text, 'i4\ni2\ni1\ni3');
});

test('v1ToNotes groups items by list', () => {
  const notes = v1ToNotes({
    lists: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }],
    items: [{ id: 1, listId: 1, name: 'x', qty: 1 }, { id: 2, listId: 2, name: 'y', qty: 2 }],
  }, id => (id === 1 ? [1] : null));
  assert.deepEqual(notes.map(n => [n.name, n.text]), [['A', 'x'], ['B', '2x y']]);
});

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
