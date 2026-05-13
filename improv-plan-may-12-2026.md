# JustShoppingList — UX & App Improvement Proposals

_Date: 2026-05-12_

Proposals only — nothing implemented. Grouped by impact.

**Mental model:** a list is curated once and reused every shopping trip. The hot loop is _open list → check items as you grab them → reset for next time_. Adding items is rare and intentional; checking and resetting are constant. Proposals below are weighted toward the trip itself.

## Quick wins (small effort, big feel)

- **Undo toasts for destructive actions.** Swipe-delete, "Clear checked", and even list delete fire instantly. A 5-second "Undo" in the existing toast infra is cheap and prevents the worst class of regret — especially painful here, since deleting an item undoes curation that may have taken weeks of trips to settle. The list-delete confirm dialog could even go away in favor of this.
- **List cards show real signal.** Right now each card only shows the name. Add `3 / 12 items · last shopped 2d ago` and a thin progress bar — turns the lists screen into something you can actually scan, and surfaces which list is "ready to go" vs "in progress".
- **Tap the category dot to recategorize.** The auto-categorizer will mis-classify sometimes ("eggs" → dairy or other?). Tapping the colored dot to cycle/pick is discoverable, one-time work per item, and respects the no-AI rule.
- **Haptics.** `navigator.vibrate(10)` on check toggle and swipe completion makes the app feel native on mobile. This is the primary action — it should feel good.
- **First-run swipe hint.** Right-swipe = check, left-swipe = delete is invisible. One-time inline coachmark on the first item. Critical because swipe IS the hot path during a trip.
- **Show/Hide Unchecked** Today, checked and unchecked items are split into groups. This makes checking an item non-intuitive, as the item moves to another list. Instead, let's keep showing the checked items in-line with the same style as they as being shown now under the 'checked' group. Add a show/hide checked button on the toolbar to quickly show/hide the checked items, in case the user is in a shopping trip and wants the checked items out of view.

## Bigger UX wins

- **Aisle order for category sort.** Let users drag categories into the order they actually walk through their store. Category sort then matches the physical aisle, which is the entire point during a trip. (This is the single highest-leverage feature in the doc given the reuse model.)
- **Real manual reorder.** Sort mode "manual" today is just `id DESC`. Touch/drag reordering would make it meaningful — useful both for ad-hoc lists and for fine-tuning aisle order within a category.
- **Resume last list.** Open the PWA → land on the list you were last using, not the lists screen. Reflects the reality that most users have one main "groceries" list and want to be in it immediately when they walk into the store.

## Receipt-scan improvements

- **Crop / rotate before OCR.** Big accuracy lift; people photograph receipts at angles. Note: with the reuse model, receipt scan is mostly useful for _seeding_ a brand new list, not adding to an existing one — so making it accurate matters more than making it fast.
- **Drop the fake progress bar.** 0 → 85% in 3s regardless of actual OCR time is dishonest and makes long scans feel broken. Use an indeterminate spinner, or wire Tesseract.js's real `logger` callback (it emits progress events).

## Sharing & data

- **QR code for in-person share.** The URL-encoded list is already self-contained — rendering it as a QR (one local lib, no server) makes "show this to the other person at the store" work without typing.
- **Markdown / plain-text export** alongside JSON, for pasting into Notes / Messages.
- **Full-app backup + restore.** Today export is per-list. A "download everything" / "import backup" pair makes the app feel safe to commit to — especially important when the list represents months of curation.
- **Archive instead of delete** for completed lists. Personal record + searchable. Especially relevant if trip logging lands.
