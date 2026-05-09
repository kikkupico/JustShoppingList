# Receipt extraction tests

Regression tests for `parser.js`. Each fixture is a folder with the raw OCR text from a receipt and the expected parsed items.

## Run

```sh
node tests/run.mjs                  # all fixtures
node tests/run.mjs walmart          # filter by folder name
node tests/run.mjs --update         # rewrite every expected.json from current parser output
node tests/run.mjs --update walmart # bootstrap one fixture
```

Exit code is `1` if any fixture fails, `0` otherwise. No npm dependencies.

## Add a real receipt

1. Make a folder under `tests/receipts/`, named `NN-shortname` (e.g. `02-trader-joes`).
2. Put the receipt's OCR text in `raw.txt` inside that folder.
   - Easiest way today: scan the receipt in the app, then read the OCR text from devtools (`recogniseReceipt` returns `{ text, lines }`).
   - You can also drop the original `image.jpg` / `.png` in the folder for reference — the runner ignores anything that isn't `raw.txt` / `expected.json`.
3. Run `node tests/run.mjs --update <shortname>` to generate `expected.json` from the parser's current output.
4. **Open `expected.json` and review every line** — this is the ground truth, so any current parser bugs will be baked in if you don't fix them by hand.
5. Commit. Future parser changes that regress this receipt will fail the test.

## Fixture format

```
tests/receipts/01-synthetic/
  raw.txt          # OCR text — anything tesseract.js produces from the photo
  expected.json    # { "items": [{ "name": "...", "qty": 1, "category": "...", "weight": "..."? }] }
```

`weight` is optional (only present for weight-priced items like produce). Unknown fields on items are ignored by the comparator.

## Privacy note

Real receipts can contain personally identifiable info — store, time, last 4 digits of a card. This repo doesn't gitignore `tests/receipts/` by default; if you don't want to commit a particular receipt, redact `raw.txt` (the parser only cares about item lines anyway) or add it to `.gitignore` locally.
