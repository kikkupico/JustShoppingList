#!/usr/bin/env node
// Receipt extraction test runner.
// Usage:
//   node tests/run.mjs                  # run every fixture
//   node tests/run.mjs <filter>         # run fixtures whose folder name matches <filter>
//   node tests/run.mjs --update         # write actual output as expected.json (golden refresh)
//   node tests/run.mjs --update <name>  # bootstrap one fixture
//
// A fixture is a folder under tests/receipts/ containing:
//   raw.txt        — OCR text (input)
//   expected.json  — { "items": [...] } ground truth
// Anything else in the folder (e.g. image.jpg) is ignored.

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractItemsFromText } from '../parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const receiptsDir = join(__dirname, 'receipts');

const args = process.argv.slice(2);
const update = args.includes('--update');
const filter = args.find(a => !a.startsWith('--'));

const tty = process.stdout.isTTY;
const c = (code, s) => tty ? `\x1b[${code}m${s}\x1b[0m` : s;
const green = s => c('32', s);
const red   = s => c('31', s);
const dim   = s => c('2',  s);
const bold  = s => c('1',  s);

function listFixtures() {
  if (!existsSync(receiptsDir)) return [];
  return readdirSync(receiptsDir)
    .filter(name => statSync(join(receiptsDir, name)).isDirectory())
    .filter(name => !filter || name.includes(filter))
    .sort();
}

function canon(item) {
  const out = { name: item.name, qty: item.qty ?? 1, category: item.category ?? 'other' };
  if (item.weight) out.weight = item.weight;
  return out;
}

function compareItems(actual, expected) {
  const fails = [];
  const max = Math.max(actual.length, expected.length);
  for (let i = 0; i < max; i++) {
    const a = actual[i], e = expected[i];
    if (!a) { fails.push(`[${i}] missing: ${JSON.stringify(e)}`); continue; }
    if (!e) { fails.push(`[${i}] extra:   ${JSON.stringify(a)}`); continue; }
    const keys = new Set([...Object.keys(a), ...Object.keys(e)]);
    for (const k of keys) {
      if (a[k] !== e[k]) {
        fails.push(`[${i}] ${k}: got ${JSON.stringify(a[k])}, expected ${JSON.stringify(e[k])}`);
      }
    }
  }
  return fails;
}

let pass = 0, fail = 0, skipped = 0, written = 0;

const fixtures = listFixtures();
if (fixtures.length === 0) {
  console.log(dim(`No fixtures found in ${receiptsDir}${filter ? ` matching "${filter}"` : ''}`));
  process.exit(0);
}

for (const name of fixtures) {
  const dir = join(receiptsDir, name);
  const rawPath = join(dir, 'raw.txt');
  const expectedPath = join(dir, 'expected.json');

  if (!existsSync(rawPath)) {
    console.log(dim(`- ${name}: no raw.txt, skipping`));
    skipped++;
    continue;
  }

  const raw = readFileSync(rawPath, 'utf8');
  const result = extractItemsFromText(raw);
  const actual = (result.items || []).map(canon);

  const missingExpected = !existsSync(expectedPath);
  if (update || missingExpected) {
    writeFileSync(expectedPath, JSON.stringify({ items: actual }, null, 2) + '\n');
    const verb = missingExpected ? 'created' : 'updated';
    console.log(dim(`✎ ${name}: ${verb} expected.json (${actual.length} items)`));
    written++;
    continue;
  }

  const expected = JSON.parse(readFileSync(expectedPath, 'utf8')).items.map(canon);
  const fails = compareItems(actual, expected);

  if (fails.length === 0) {
    console.log(`${green('✓')} ${name} ${dim(`(${actual.length} items)`)}`);
    pass++;
  } else {
    console.log(`${red('✗')} ${bold(name)} ${dim(`(${fails.length} mismatch${fails.length === 1 ? '' : 'es'})`)}`);
    for (const f of fails) console.log(`    ${f}`);
    fail++;
  }
}

const total = pass + fail;
console.log();
if (written && !total) {
  console.log(dim(`${written} fixture${written === 1 ? '' : 's'} written`));
  process.exit(0);
}
if (fail === 0) {
  console.log(green(`${pass}/${total} passed`) + (skipped ? dim(`, ${skipped} skipped`) : '') + (written ? dim(`, ${written} written`) : ''));
  process.exit(0);
}
console.log(red(`${fail}/${total} failed`) + dim(`, ${pass} passed`) + (skipped ? dim(`, ${skipped} skipped`) : ''));
process.exit(1);
