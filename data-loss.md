# Data Loss: Analysis, Fix & Caveats

_Last updated: 2026-06-20_

This document explains why JustShoppingList data could appear to "wipe out often,"
what was changed to make storage resilient, how it was verified, and the limits
that remain.

## Symptom

Data disappeared **on reload / reopen**, in a **Chrome browser tab** (not the
installed app), **intermittently** ("often"). Reloading again often brought the
data back.

## Root cause

A data-loss trap in the old IndexedDB-based `db.js`:

1. The app stored data in **IndexedDB** (via Dexie).
2. On reload, if `db.open()` **failed or was slow** (transient), the code
   silently switched to a localStorage fallback store.
3. But the migration step had already **deleted** the localStorage copy.
4. So the fallback read an **empty** store and rendered a **blank app** — while
   the real data was still sitting in IndexedDB, just invisible.
5. The next reload that opened IndexedDB cleanly made the data "come back."

That is exactly the "wiped on reload, comes back later, happens often" pattern.

The in-memory undo/redo (`useHistory`) was considered as a suspect (its restore
path deletes-then-re-adds items via `syncItems`). It was **ruled out**: the undo
and redo stacks are plain `useState([])`, empty on every reload, so `canUndo` is
`false` at mount and the destructive path cannot fire on load.

## The fix: a single, simple store

`db.js` was rewritten to use **localStorage only** — no IndexedDB, no Dexie, no
async "open" step, no CDN dependency for storage.

Why localStorage is the right tool here:

- **Eliminates the bug class structurally.** The wipe came from an async
  `db.open()` that could fail; localStorage has no open step that can fail, so
  there is nothing to silently fall back from.
- **The data is tiny.** Lists + items only; receipt *images* are never stored
  (OCR text is parsed into items and discarded). Even ~1000 items is ~150 KB,
  far under the ~5 MB localStorage budget.
- **Simpler and dependency-free.** Removing Dexie also removes one esm.sh CDN
  import, so storage no longer depends on the network at all.

Data shape (two keys):

- `jsl_lists` — array of `{ id, name, createdAt, updatedAt }`
- `jsl_items` — array of `{ id, listId, name, qty, category, checked, addedFrom, lastCheckedAt }`

All exported functions stay `async` so the call sites in `app.js` are unchanged.
Writes are wrapped in try/catch and surface a toast if storage is full.

### Service worker (`sw.js`)

The app still loads Preact / htm / compromise / tesseract from esm.sh, so CDN
vendor modules are kept in a **separate `jsl-vendor` cache** that survives
service-worker version bumps (a version bump used to purge them and could leave
the app unable to load). The app-shell cache name is bumped (`jsl-v5`) so clients
pick up the new `db.js` on next visit.

### No migration

By choice, there is **no one-time migration** from the old IndexedDB store. Any
data that existed only in IndexedDB is not carried over; the app starts from the
localStorage keys above.

## Verification

Tested in **real headless Chrome** via the DevTools Protocol:

- ✅ `db.js` imports cleanly in the browser.
- ✅ create / add / toggle works and reads back correctly.
- ✅ **Data survives reload** (the core symptom) — list, items, and checked state.
- ✅ `exportDB` returns the data; `importDB` replaces all and remaps ids.
- ✅ Storage no longer touches IndexedDB.

## Caveats & limits

localStorage protects against the in-browser failure that caused the original
bug, but it does **not** protect against the browser clearing **all** storage for
the site at once. When does that happen?

- **Chrome (tab):** rarely — only under genuine disk pressure, with
  _"Clear cookies and site data when you close all windows"_ enabled, or when the
  user manually clears browsing data. Normal day-to-day use does **not** evict.
- **Safari (iOS/macOS, tab):** more aggressive — non-installed sites can be
  purged after **~7 days** of not opening the site (ITP).

### Will data be resilient if used only as a webapp (browser tab)?

**Yes on Chrome** for the reported bug — it is fixed regardless of install state.
The remaining risk as a non-installed tab is mainly **Safari-after-a-week** or
someone **clearing browsing data** — both of which clear *all* site storage and
cannot be defended against from inside the page.

### How to make it genuinely bulletproof (no backend, stays private)

1. **Install the app** (Add to Home Screen / install icon). Installed PWAs get
   **persistent storage**, which is **exempt from automatic eviction** — the
   ~7-day cap and disk-pressure cleanup no longer apply. This covers localStorage
   too. It does **not** protect against the user *manually* clearing site data or
   uninstalling.
2. **Use the file backup** in the ⋯ menu ("Export all data") periodically. A JSON
   file on the device survives any browser wipe; "Import data" restores it.

Because the app is intentionally **backend-free and private** (no cloud sync), a
file export is the only thing that survives a true device/browser reset.

## Built-in safeguards

- **Persistent-storage request on startup** — the app calls
  `navigator.storage.persist()` on load. Installed PWAs are granted readily; it
  also improves the odds for a plain Chrome tab.
- **Periodic backup reminder** — if there's data and it's been more than 7 days
  since the last file backup (tracked via `jsl_last_backup`, seeded from
  `jsl_first_seen`), a sticky toast suggests "Back up now". Shown at most once per
  session; exporting resets the 7-day timer.
