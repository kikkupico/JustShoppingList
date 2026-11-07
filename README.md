# Cartly

A privacy-first, AI-free shopping list web app that runs entirely in your browser — no backend, no accounts, no data ever leaves your device.

## How it works

Each list is a checklist, like a notes app in checklist mode: every line is an item.

- Type to add items. Enter starts the next item, Backspace on an empty item removes it, and Backspace at the start of an item joins it to the one above.
- Tap the circle to check an item off. Checked items stay in place, struck through.
- Paste a list into any item (or anywhere on the page) and each line becomes an item. Bullets and `- [ ]` / `- [x]` checkboxes are cleaned up; items already on the list are skipped and unchecked so they're "needed again".
- Items get a category automatically (on-device keyword rules, no AI). Tap the category chip to change it; your choice is remembered for that item name.
- **Search**, **filter** (All / To buy / Done, or by category) and **sort** (My order, A–Z, Category, Recently checked) only change the view, never your list order.
- The ⋯ menu has Copy list, Copy what's left, Share, Edit as text (the whole list as plain text), Scan a receipt, Uncheck all and Remove checked (with Undo).

## Privacy Guarantee

- No servers — the app is a static file bundle
- No accounts or sign-in required
- No analytics, cookies, or tracking of any kind
- No AI / LLM calls — receipt parsing is fully deterministic and runs locally
- All lists are stored in localStorage on your device only

## Deploy on GitHub Pages

1. Fork this repository
2. In your fork, go to **Settings → Pages**
3. Under **Source**, select **GitHub Actions**
4. Push to `main` — the Actions workflow deploys automatically
5. Your app will be live at `https://<your-username>.github.io/<repo-name>/`

## Browser Compatibility

| Feature | Requirement |
|---|---|
| Full functionality (OCR + lists) | All modern browsers |
| Receipt item extraction | All modern browsers (rule-based, runs locally) |

## Local Development

Serve the project root over HTTP — do **not** open `index.html` directly as a `file://` URL; Tesseract.js and ES module imports require a proper HTTP origin due to WASM CORS restrictions.

```
python3 -m http.server 8080
# or use VS Code Live Server
```

Then open `http://localhost:8080`.

## Tests

**Notepad logic** — paste merging, checked state, migration from the old item format:
```sh
node tests/notes.test.mjs
```

**Regression tests** — unit tests against realistic synthetic receipts:
```sh
node tests/run.mjs          # Run all (instant)
node tests/run.mjs costco   # Filter by store name
```

**Benchmark** — full OCR + parsing pipeline against the ICDAR receipt dataset:
```sh
node tests/benchmark.mjs ../ICDAR-SROIE-2019 --limit 10 --verbose
```

See `tests/README.md` for unit test fixture format. See `tests/BENCHMARK.md` for setup and running the large-scale benchmark.
