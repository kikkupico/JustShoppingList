# Cartly

A privacy-first shopping list web app that runs entirely in your browser — no backend, no accounts, no data ever leaves your device.

## Privacy Guarantee

- No servers — the app is a static file bundle
- No accounts or sign-in required
- No analytics, cookies, or tracking of any kind
- All lists and items are stored in IndexedDB on your device only
- Shared links are fully self-contained (data encoded in the URL itself)

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
| AI-assisted item extraction | Chrome 127+ (Chrome Prompt API / `window.ai`) |
| Regex-based item extraction (fallback) | All modern browsers |

## Local Development

Serve the project root over HTTP — do **not** open `index.html` directly as a `file://` URL; Tesseract.js and ES module imports require a proper HTTP origin due to WASM CORS restrictions.

```
python3 -m http.server 8080
# or use VS Code Live Server
```

Then open `http://localhost:8080`.
