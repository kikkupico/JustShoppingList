# Receipt extraction benchmark

Runs the full OCR + parsing pipeline against real receipt datasets (e.g. ICDAR SROIE).

## Setup

Download a receipt dataset:

- **ICDAR 2019 SROIE** (1k receipts): https://github.com/zhouyuangan/ICDAR2019-SROIE
- **ICDAR 2021 CORD** (1k receipts): https://github.com/clovaai/cord

The benchmark accepts any of these layouts:

```
dataset/                   ← flat
  box/  images/  img/

dataset/                   ← SROIE-nested (auto-detected, prefers train/)
  train/
    box/                   ← polygon-prefixed line text (Task 2)
    images/                ← receipt JPGs
    key/                   ← per-receipt JSON {company, date, address, total} (Task 3)
  test/
    box/  images/
```

When a `key/` directory is present at the chosen nesting level, its annotations are loaded and reported per company.

## Run

```bash
# Auto-detects sroie/train (it has the key/ annotations)
node tests/benchmark.mjs ../shopping-receipt-dataset/sroie

# Or point directly at a subset
node tests/benchmark.mjs ../shopping-receipt-dataset/sroie/test

# Quick test: first 10 receipts with details (both --limit forms work)
node tests/benchmark.mjs ../shopping-receipt-dataset/sroie --limit 10 --verbose
node tests/benchmark.mjs ../shopping-receipt-dataset/sroie --limit=10 --verbose

# Use 8 OCR workers in parallel (default: min(4, cpus))
node tests/benchmark.mjs ../shopping-receipt-dataset/sroie --workers 8

# Save results to JSON
node tests/benchmark.mjs ../shopping-receipt-dataset/sroie --report

# Diff against a previous report (regression detection for parser changes)
node tests/benchmark.mjs ../shopping-receipt-dataset/sroie --baseline tests/benchmark-1711296000000.json

# Use pre-OCR'd box files instead of images (no Tesseract needed)
node tests/benchmark.mjs ../shopping-receipt-dataset/sroie --skip-ocr
```

## Options

| Flag                 | Description                                              |
|----------------------|----------------------------------------------------------|
| `--limit N`          | Process only first N receipts                            |
| `--workers N`        | Parallel OCR workers (default: min(4, cpus))             |
| `--baseline FILE`    | Diff item lists against a prior `--report` JSON          |
| `--verbose`          | Show items per receipt and full diff output              |
| `--report`           | Save run results to `tests/benchmark-<ts>.json`          |
| `--skip-ocr`         | Use pre-OCR'd `.txt` files; no Tesseract needed          |

## Output

```
============================================================
Cartly Receipt Benchmark
============================================================
Dataset:   sroie
Mode:      OCR + Parse (4 workers)
Source:    ../shopping-receipt-dataset/sroie/train/images
Receipts:  876
Key annot: ../shopping-receipt-dataset/sroie/train/key
============================================================

[100%] 876 / 876

============================================================
Results
============================================================
Processed: 876 / 876
Errors:    0
Items:     5230 total, 6.0 avg/receipt
Time:      78.4s wall (11.2 receipts/s)
OCR:       p50 280ms, p95 540ms
Parse:     p50 1.10ms, p95 3.20ms

Items by category:
  other        2200  (42%)
  ...

By company (top 10 of 236):
  SANYU STATIONERY SHOP                    50 receipts    7.8 items/avg
  GARDENIA BAKERIES (KL) SDN BHD           49 receipts    4.1 items/avg
  ...
============================================================

Report saved: tests/benchmark-1711296000000.json
```

The per-company breakdown comes from SROIE Task 3 (`key/`) annotations and lets you spot stores where the parser does best or worst.

## Box-format text files vs. images

The benchmark auto-detects SROIE box format (`x1,y1,x2,y2,x3,y3,x4,y4,TEXT` per line) and reconstructs visual rows by Y-coordinate clustering. **However**, SROIE receipts typically place the item description on one row and price columns on the next row, which a line-oriented parser can't connect. Expect **~0.2 items/receipt** in `--skip-ocr` mode on SROIE.

For accurate item extraction:

```bash
npm install tesseract.js
node tests/benchmark.mjs ../shopping-receipt-dataset/sroie   # uses images/
```

Tesseract's line aggregator handles multi-column layouts and produces the `NAME ... PRICE` lines the parser expects.

## Regression workflow

Per-item ground truth isn't available (SROIE Task 3 only annotates header fields: company, date, address, total). Treat a saved `--report` JSON as your baseline and diff future runs against it:

```bash
# 1. Snapshot current parser behavior
node tests/benchmark.mjs ../shopping-receipt-dataset/sroie --report
# → tests/benchmark-<ts>.json

# 2. Make parser changes, then diff
node tests/benchmark.mjs ../shopping-receipt-dataset/sroie --baseline tests/benchmark-<ts>.json --verbose
```

Diff output groups receipts by which items appeared (`+`) or disappeared (`-`). When you're happy with the new behavior, generate a fresh `--report` and that becomes the next baseline.

## What it tests

- **Full pipeline**: real receipt images → OCR (Tesseract) → rule-based parsing
- **Scale**: thousands of receipts with diverse store formats
- **Edge cases**: OCR garbles, varied layouts, weight-priced items, deduplication
- **Performance**: end-to-end latency (p50/p95) and item extraction rates
- **Per-store quality**: stratified by company name from SROIE Task 3 annotations
- **Regressions**: per-receipt item diffs against a baseline run

## Performance notes

- **OCR phase**: ~100–300ms per image with one worker; scales near-linearly with `--workers`
- **Parse phase**: <5ms per receipt
- **First run**: tesseract.js downloads its WASM core + English model (~30MB) into `~/.cache`
