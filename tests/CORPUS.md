# Test receipt corpus

Five realistic receipt fixtures with different stores, product mixes, and OCR challenges.

## Fixtures

| Fixture | Store | Items | Focus |
|---------|-------|-------|-------|
| `01-synthetic` | Synthetic | 11 | Demo/bootstrap; clean OCR |
| `02-whole-foods` | Whole Foods | 11 | Organic produce, specialty foods; weight-priced items |
| `03-cvs` | CVS Pharmacy | 14 | Healthcare, household, medications; diverse categories |
| `04-costco` | Costco | 14 | Bulk, quantities, deduplication; OCR garbles (`CHIKN`, `FILLT`, `VRG`) |
| `05-trader-joes` | Trader Joe's | 15 | Specialty frozen/prepared foods; shorter names |

## Key test scenarios

- **Weight extraction**: `02-whole-foods` (3lb apples @ $2.49/lb) and `04-costco` (various bulk weights)
- **Quantity deduplication**: `04-costco` (rotisserie chicken × 2, Greek yogurt × 2)
- **OCR robustness**: `04-costco` with realistic OCR errors (D→A, garbled abbreviations)
- **Category diversity**: `03-cvs` with medications, healthcare, household; `05-trader-joes` with specialty foods
- **Price detection**: All fixtures test the price-tail regex on different layouts

## Running

```sh
node tests/run.mjs              # all
node tests/run.mjs whole        # filter
node tests/run.mjs --update     # refresh ground truth
```

## Extensibility

To add a real receipt:

1. Create `tests/receipts/NN-name/raw.txt` with the OCR text
2. `node tests/run.mjs --update name`
3. Review `expected.json`, hand-fix any parser errors
4. Commit

See `tests/README.md` for details.
