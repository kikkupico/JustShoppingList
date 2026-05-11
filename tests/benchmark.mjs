#!/usr/bin/env node
// Benchmark the full OCR + parsing pipeline against a receipt dataset (e.g. ICDAR SROIE).
//
// Usage:
//   node tests/benchmark.mjs <dataset-path> [options]
//
// Options:
//   --dataset PATH    Path to the dataset (alternative to positional arg)
//   --core PATH       Alias for --dataset (convenience for core/CORD dataset)
//   --limit N         Process only first N receipts (also: --limit=N)
//   --workers N       Parallel OCR workers (default: min(4, cpus))
//   --baseline FILE   Diff item lists against a prior --report JSON
//   --verbose         Show items extracted per receipt
//   --report          Save results to JSON file
//   --skip-ocr        Use pre-OCR'd .txt or .json files in the dataset folder
//
// Dataset layout:
//   dataset/
//     box/  (or images/, img/, .)
//       X00016469611.jpg     ← OCR mode
//       X00016469611.txt     ← --skip-ocr mode

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { extractItemsFromText } from '../parser.js';

let createWorker = null;
try {
  ({ createWorker } = await import('tesseract.js'));
} catch {
  // tesseract.js not installed — only --skip-ocr mode is usable
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── arg parsing ──────────────────────────────────────────────────────────────
const VALUE_FLAGS = new Set(['limit', 'workers', 'baseline', 'dataset', 'core']);
const argv = process.argv.slice(2);
const positional = [];
const flags = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { positional.push(a); continue; }
  const eq = a.indexOf('=');
  const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
  if (eq !== -1) flags[name] = a.slice(eq + 1);
  else if (VALUE_FLAGS.has(name)) flags[name] = argv[++i];
  else flags[name] = true;
}

const datasetPath = flags.dataset || flags.core || positional[0];
const limit       = parseInt(flags.limit, 10) || Infinity;
const workerCount = Math.max(1, parseInt(flags.workers, 10) || Math.min(4, os.cpus().length));
const baseline    = typeof flags.baseline === 'string' ? flags.baseline : null;
const verbose     = flags.verbose === true;
const report      = flags.report === true;
const skipOcr     = flags['skip-ocr'] === true || !createWorker;

function printUsage() {
  console.log('Usage: node tests/benchmark.mjs <dataset-path> [options]');
  console.log('       node tests/benchmark.mjs --dataset <dataset-path> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --dataset PATH    Path to the dataset');
  console.log('  --core PATH       Alias for --dataset (e.g. CORD)');
  console.log('  --limit N         Process only first N receipts');
  console.log('  --workers N       Parallel OCR workers (default: min(4, cpus))');
  console.log('  --baseline FILE   Diff against a prior --report JSON');
  console.log('  --verbose         Show items extracted per receipt');
  console.log('  --report          Save results to JSON file');
  console.log('  --skip-ocr        Use pre-OCR\'d .txt or .json files');
  console.log('');
  console.log('Examples:');
  console.log('  node tests/benchmark.mjs ../ICDAR-SROIE-2019 --limit 10');
  console.log('  node tests/benchmark.mjs --core ../cord-dataset --skip-ocr');
}

if (!datasetPath) { printUsage(); process.exit(1); }
if (!fs.existsSync(datasetPath)) {
  console.error(`\n✗ Dataset not found: ${datasetPath}\n`);
  process.exit(1);
}

// ─── locate input files ───────────────────────────────────────────────────────
// Supports both flat layouts (dataset/box, dataset/images) and nested SROIE-style
// layouts (dataset/train/box, dataset/train/key, dataset/test/box). When nested,
// prefers train/ over test/ because train/ ships the key/ annotations.
function findSource(root) {
  let txtFallback = null;
  for (const candidate of ['box', 'images', 'image', 'figure', 'img', 'json', '.']) {
    const dir = path.join(root, candidate);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir);
    if (!skipOcr && files.some(f => /\.(jpe?g|png)$/i.test(f))) {
      return { sourceDir: dir, mode: 'ocr' };
    }
    if (files.some(f => /\.(txt|json)$/i.test(f)) && !txtFallback) {
      txtFallback = dir;
    }
  }
  if (txtFallback) return { sourceDir: txtFallback, mode: 'text' };
  return null;
}

let sourceDir = null;
let mode = null;
let datasetRoot = datasetPath;
for (const sub of ['', 'train', 'test', 'dev']) {
  const candidate = sub ? path.join(datasetPath, sub) : datasetPath;
  if (!fs.existsSync(candidate)) continue;
  const found = findSource(candidate);
  if (found) {
    ({ sourceDir, mode } = found);
    datasetRoot = candidate;
    break;
  }
}

if (!mode) {
  console.error(`\n✗ No ${skipOcr ? '.txt or .json files' : 'images, .txt, or .json files'} found under ${datasetPath}\n`);
  process.exit(1);
}

// SROIE Task 3 ground truth: key/<basename>.txt contains JSON with company/date/total.
// CORD ground truth: json/<basename>.json contains the same structure as input JSON.
const keyDir = fs.existsSync(path.join(datasetRoot, 'key')) ? path.join(datasetRoot, 'key') :
               fs.existsSync(path.join(datasetRoot, 'json')) ? path.join(datasetRoot, 'json') : null;

const filePattern = mode === 'ocr' ? /\.(jpe?g|png)$/i : /\.(txt|json)$/i;
const files = fs.readdirSync(sourceDir)
  .filter(f => filePattern.test(f))
  .sort()
  .slice(0, limit === Infinity ? undefined : limit);

if (files.length === 0) {
  console.error(`\n✗ No matching files found in ${sourceDir}\n`);
  process.exit(1);
}

// ─── header ───────────────────────────────────────────────────────────────────
const startTime = performance.now();
const bar = '='.repeat(60);
console.log(`\n${bar}\nCartly Receipt Benchmark\n${bar}`);
console.log(`Dataset:  ${path.basename(datasetPath)}`);
console.log(`Mode:     ${mode === 'ocr' ? `OCR + Parse (${workerCount} worker${workerCount === 1 ? '' : 's'})` : 'Parse (pre-OCR\'d text)'}`);
console.log(`Source:   ${sourceDir}`);
console.log(`Receipts: ${files.length}`);
if (keyDir)   console.log(`Key annot: ${keyDir}`);
if (baseline) console.log(`Baseline: ${baseline}`);
console.log(`${bar}\n`);

// ─── process pipeline ─────────────────────────────────────────────────────────
// SROIE box format: each line is `x1,y1,x2,y2,x3,y3,x4,y4,TEXT`. Each fragment is one
// bounding box, so a single visual receipt row often spans multiple file lines (one
// per column). We strip the coords and Y-cluster the fragments back into rows so the
// parser sees Tesseract-style output. Note: SROIE often puts the item description on
// one visual row and price columns on the next — those still won't combine, so item
// extraction from box files is sparse. Use OCR mode with images for accurate runs.
const BOX_LINE_RE = /^(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(.*)$/;
function maybeStripBoxFormat(text) {
  const rawLines = text.split(/\r?\n/);
  const firstNonEmpty = rawLines.find(l => l.trim());
  if (!firstNonEmpty || !BOX_LINE_RE.test(firstNonEmpty)) return text;

  const frags = [];
  for (const line of rawLines) {
    const m = line.match(BOX_LINE_RE);
    if (!m) continue;
    const ys = [+m[2], +m[4], +m[6], +m[8]];
    const xs = [+m[1], +m[3], +m[5], +m[7]];
    frags.push({
      yMid: (Math.min(...ys) + Math.max(...ys)) / 2,
      xMin: Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
      text: m[9],
    });
  }
  if (frags.length === 0) return text;

  frags.sort((a, b) => a.yMid - b.yMid || a.xMin - b.xMin);
  const medianH = [...frags].sort((a, b) => a.h - b.h)[Math.floor(frags.length / 2)].h;
  const tolerance = Math.max(8, medianH * 0.6);

  const rows = [];
  let cur = null;
  for (const f of frags) {
    if (!cur || Math.abs(f.yMid - cur.yMid) > tolerance) {
      cur = { yMid: f.yMid, frags: [f] };
      rows.push(cur);
    } else {
      cur.frags.push(f);
    }
  }
  return rows
    .map(r => r.frags.sort((a, b) => a.xMin - b.xMin).map(f => f.text).join(' '))
    .join('\n');
}

function loadKey(basename) {
  if (!keyDir) return null;
  const keyPath = path.join(keyDir, `${basename}.txt`);
  const keyPathJson = path.join(keyDir, `${basename}.json`);
  const p = fs.existsSync(keyPath) ? keyPath : (fs.existsSync(keyPathJson) ? keyPathJson : null);
  if (!p) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function parseText(text) {
  const t0 = performance.now();
  const parsed = extractItemsFromText(text);
  const parseMs = performance.now() - t0;
  const items = (parsed.items || []).map(it => ({
    name: it.name,
    qty: it.qty || 1,
    category: it.category || 'other',
    ...(it.weight ? { weight: it.weight } : {}),
  }));
  return { items, parseMs };
}

const results = [];
const ocrTimes = [], parseTimes = [];
const categoryCount = {};
const companyStats = new Map(); // company → { receipts, items }
let processed = 0, errors = 0, totalItems = 0, completed = 0;

function recordResult(basename, payload) {
  const key = loadKey(basename);
  if (key) payload.key = key;

  if (payload.success) {
    for (const item of payload.items) {
      categoryCount[item.category] = (categoryCount[item.category] || 0) + 1;
    }
    totalItems += payload.items.length;
    processed++;
    if (payload.ocrMs != null) ocrTimes.push(payload.ocrMs);
    parseTimes.push(payload.parseMs);

    const company = key?.company?.trim();
    if (company) {
      const s = companyStats.get(company) ?? { receipts: 0, items: 0 };
      s.receipts++;
      s.items += payload.items.length;
      companyStats.set(company, s);
    }
  } else {
    errors++;
  }
  results.push({ file: basename, ...payload });
  completed++;

  const pct = Math.round(completed / files.length * 100).toString().padStart(3);
  if (verbose) {
    if (payload.success) {
      console.log(`[${pct}%] ✓ ${basename}: ${payload.items.length} items`);
      for (const item of payload.items.slice(0, 3)) {
        console.log(`         - ${item.name} (${item.category})`);
      }
      if (payload.items.length > 3) console.log(`         ... and ${payload.items.length - 3} more`);
    } else {
      console.log(`[${pct}%] ✗ ${basename}: ${payload.error}`);
    }
  } else {
    process.stdout.write(`\r[${pct}%] ${completed} / ${files.length}`);
  }
}

async function runOcrPipeline() {
  console.log(`Initializing ${workerCount} OCR worker${workerCount === 1 ? '' : 's'}...`);
  const workers = await Promise.all(
    Array.from({ length: workerCount }, async () => {
      const w = await createWorker('eng', 1, { logger: () => {} });
      await w.setParameters({ tessedit_pageseg_mode: '4' });
      return w;
    })
  );
  console.log('OCR ready.\n');

  let nextIdx = 0;
  await Promise.all(workers.map(async (w) => {
    while (true) {
      const idx = nextIdx++;
      if (idx >= files.length) return;
      const file = files[idx];
      const filePath = path.join(sourceDir, file);
      const basename = path.basename(file, path.extname(file));
      try {
        const t0 = performance.now();
        const { data: { text } } = await w.recognize(filePath);
        const ocrMs = performance.now() - t0;
        const { items, parseMs } = parseText(text);
        recordResult(basename, { success: true, itemCount: items.length, items, ocrMs, parseMs });
      } catch (e) {
        recordResult(basename, { success: false, error: e.message });
      }
    }
  }));

  await Promise.all(workers.map(w => w.terminate()));
}

function runTextPipeline() {
  for (const file of files) {
    const filePath = path.join(sourceDir, file);
    const basename = path.basename(file, path.extname(file));
    try {
      let text;
      if (file.endsWith('.json')) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (data.valid_line) {
          // CORD format: reconstruct text lines from words
          text = data.valid_line.map(line => line.words.map(w => w.text).join(' ')).join('\n');
        } else {
          text = JSON.stringify(data);
        }
      } else {
        const raw = fs.readFileSync(filePath, 'utf8');
        text = maybeStripBoxFormat(raw);
      }
      const { items, parseMs } = parseText(text);
      recordResult(basename, { success: true, itemCount: items.length, items, parseMs });
    } catch (e) {
      recordResult(basename, { success: false, error: e.message });
    }
  }
}

if (mode === 'ocr') await runOcrPipeline();
else runTextPipeline();

const elapsed = (performance.now() - startTime) / 1000;

// ─── summary ──────────────────────────────────────────────────────────────────
function pct(values, q) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(q * s.length));
  return s[rank - 1];
}

console.log('\n');
console.log(`${bar}\nResults\n${bar}`);
console.log(`Processed: ${processed} / ${files.length}`);
console.log(`Errors:    ${errors}`);
console.log(`Items:     ${totalItems} total, ${processed ? (totalItems / processed).toFixed(1) : '0.0'} avg/receipt`);
console.log(`Time:      ${elapsed.toFixed(1)}s wall (${elapsed > 0 ? (files.length / elapsed).toFixed(1) : '–'} receipts/s)`);
if (ocrTimes.length) {
  console.log(`OCR:       p50 ${pct(ocrTimes, 0.5).toFixed(0)}ms, p95 ${pct(ocrTimes, 0.95).toFixed(0)}ms`);
}
if (parseTimes.length) {
  console.log(`Parse:     p50 ${pct(parseTimes, 0.5).toFixed(2)}ms, p95 ${pct(parseTimes, 0.95).toFixed(2)}ms`);
}
console.log();
if (totalItems > 0) {
  console.log('Items by category:');
  for (const [cat, count] of Object.entries(categoryCount).sort((a, b) => b[1] - a[1])) {
    const share = ((count / totalItems) * 100).toFixed(0);
    console.log(`  ${cat.padEnd(12)} ${count.toString().padStart(4)}  (${share}%)`);
  }
}

if (companyStats.size > 0) {
  console.log();
  console.log(`By company (top 10 of ${companyStats.size}):`);
  const sorted = [...companyStats.entries()].sort((a, b) => b[1].receipts - a[1].receipts);
  for (const [company, s] of sorted.slice(0, 10)) {
    const avg = (s.items / s.receipts).toFixed(1);
    const trimmed = company.length > 38 ? company.slice(0, 35) + '...' : company;
    console.log(`  ${trimmed.padEnd(38)} ${s.receipts.toString().padStart(4)} receipts  ${avg.padStart(5)} items/avg`);
  }
}

// ─── baseline diff ────────────────────────────────────────────────────────────
if (baseline) {
  if (!fs.existsSync(baseline)) {
    console.warn(`\n⚠ Baseline file not found: ${baseline}`);
  } else {
    const prev = JSON.parse(fs.readFileSync(baseline, 'utf8'));
    const prevByFile = new Map((prev.results || []).map(r => [r.file, r]));
    const succeededNow = results.filter(r => r.success);
    const diffs = [];
    let addedOnly = 0, removedOnly = 0;
    for (const r of succeededNow) {
      const prevR = prevByFile.get(r.file);
      if (!prevR || !prevR.success) continue;
      const cur = new Set(r.items.map(i => `${i.name}|${i.qty}`));
      const old = new Set((prevR.items || []).map(i => `${i.name}|${i.qty}`));
      const added = [...cur].filter(x => !old.has(x));
      const removed = [...old].filter(x => !cur.has(x));
      if (added.length || removed.length) {
        if (added.length && !removed.length) addedOnly++;
        else if (removed.length && !added.length) removedOnly++;
        diffs.push({ file: r.file, added, removed });
      }
    }
    console.log(`\n${bar}\nDiff vs ${path.basename(baseline)}\n${bar}`);
    console.log(`Changed receipts: ${diffs.length} / ${succeededNow.length}`);
    console.log(`  +items only:    ${addedOnly}`);
    console.log(`  -items only:    ${removedOnly}`);
    console.log(`  mixed:          ${diffs.length - addedOnly - removedOnly}`);
    const showLimit = verbose ? diffs.length : Math.min(10, diffs.length);
    for (const d of diffs.slice(0, showLimit)) {
      console.log(`  ${d.file}:`);
      for (const a of d.added)   console.log(`    + ${a}`);
      for (const r of d.removed) console.log(`    - ${r}`);
    }
    if (diffs.length > showLimit) console.log(`  ... and ${diffs.length - showLimit} more (use --verbose to see all)`);
  }
}
console.log(`${bar}\n`);

if (report) {
  const reportPath = path.join(__dirname, `benchmark-${Date.now()}.json`);
  const summary = {
    dataset: path.basename(datasetPath),
    mode,
    workerCount: mode === 'ocr' ? workerCount : 1,
    processedAt: new Date().toISOString(),
    elapsedSeconds: parseFloat(elapsed.toFixed(2)),
    totalReceipts: files.length,
    successfulReceipts: processed,
    failedReceipts: errors,
    totalItemsExtracted: totalItems,
    avgItemsPerReceipt: processed ? parseFloat((totalItems / processed).toFixed(2)) : 0,
    ocrMsP50:   ocrTimes.length ? Math.round(pct(ocrTimes, 0.5)) : null,
    ocrMsP95:   ocrTimes.length ? Math.round(pct(ocrTimes, 0.95)) : null,
    parseMsP50: parseTimes.length ? parseFloat(pct(parseTimes, 0.5).toFixed(2)) : null,
    parseMsP95: parseTimes.length ? parseFloat(pct(parseTimes, 0.95).toFixed(2)) : null,
    itemsByCategory: categoryCount,
    byCompany: Object.fromEntries(companyStats),
  };
  fs.writeFileSync(reportPath, JSON.stringify({ summary, results }, null, 2));
  console.log(`Report saved: ${reportPath}\n`);
}
