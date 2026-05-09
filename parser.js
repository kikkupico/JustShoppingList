// ─── Constants ────────────────────────────────────────────────────────────────

// Footer / non-item words. Anchors a line as "not an item" regardless of price.
const IGNORE_WORDS = /\b(sub-?total|total|tax|change|cash|credit|debit|visa|mastercard|amex|balance|payment|tender|loyalty|points|rewards|receipt|cashier|store|thank|welcome|vat|gst|pst|hst|void|refund|discount|coupon|savings|member|invoice|tel|phone|address|cust|customer|amount\s+due|grand\s+total|balance\s+due|tendered|approved|auth|terminal|merchant|aid|app|reference)\b/i;

// Boundary markers — everything from this line onward is footer
const FOOTER_BOUNDARY = /^(sub-?total|total|tax|amount\s+due|grand\s+total|balance\s+due|cash|credit|debit|visa|mastercard)\b/i;

// Money tokens. Allows leading minus / currency symbol, comma or dot decimal,
// optional trailing tax-code letter, "-" or "CR" for credits.
const PRICE_TOKEN_RE = /^[-]?[$£€]?\d{1,4}[.,]\d{2}[A-Z]?[-]?$/;
const PRICE_TAIL_RE  = /\s+[-]?[$£€]?\d{1,4}[.,]\d{2}\s*([A-Z]{1,2}|CR|-)?\s*$/;

// Pure-numeric / barcode garbage line
const NUMERIC_ONLY_RE = /^[\d\s.,$£€%/x@-]+$/i;

// Quantity / weight patterns
const QTY_PREFIX_RE     = /^(\d{1,3})\s*[xX@]\s+/;
const QTY_SUFFIX_RE     = /\s+[xX]\s*(\d{1,3})$/;
const QTY_AT_PREFIX_RE  = /^(\d{1,3})\s+@\s+/;
const WEIGHT_RE         = /(\d+(?:[.,]\d+)?)\s*(kg|lb|lbs|oz|g)\b/i;
const WEIGHT_PRICED_RE  = /(\d+(?:[.,]\d+)?)\s*(kg|lb|lbs|oz)\s*@\s*\$?\d+[.,]\d{2}\s*\/\s*(kg|lb|lbs|oz)/i;

// ─── POS abbreviation map ─────────────────────────────────────────────────────
// Conservative — only unambiguous shortcodes. Resolved as whole tokens.

const ABBREVIATIONS = {
  // Dairy
  MLK: 'Milk', WHL: 'Whole', SKM: 'Skim', CHZ: 'Cheese', YGT: 'Yogurt',
  YOG: 'Yogurt', BTR: 'Butter', CRM: 'Cream', CHED: 'Cheddar', MOZZ: 'Mozzarella',
  // Produce
  BNN: 'Banana', BNNS: 'Bananas', APL: 'Apple', APLS: 'Apples',
  TOM: 'Tomato', POT: 'Potato', CAR: 'Carrot', LET: 'Lettuce', CUC: 'Cucumber',
  BRC: 'Broccoli', CAUL: 'Cauliflower', SPN: 'Spinach', AVO: 'Avocado',
  LMN: 'Lemon', LME: 'Lime', GRP: 'Grape', STRW: 'Strawberry', BLU: 'Blueberry',
  // Meat / seafood
  CHK: 'Chicken', CHKN: 'Chicken', BF: 'Beef', PRK: 'Pork', BCN: 'Bacon',
  HM: 'Ham', TKY: 'Turkey', SAU: 'Sausage', SLM: 'Salmon', TUNA: 'Tuna',
  // Bakery
  BRD: 'Bread', BGL: 'Bagel', MFN: 'Muffin', CRSNT: 'Croissant',
  // Pantry
  CER: 'Cereal', PSTA: 'Pasta', RIC: 'Rice', FLR: 'Flour', SGR: 'Sugar',
  SLT: 'Salt', PEPP: 'Pepper', VIN: 'Vinegar',
  // Drinks
  WTR: 'Water', JUI: 'Juice', SDA: 'Soda', COFF: 'Coffee',
  // Qualifiers / sizes / units
  ORG: 'Organic', LRG: 'Large', XL: 'Extra Large', MED: 'Medium',
  PKG: 'Package', CTN: 'Carton', FRZ: 'Frozen', FRSH: 'Fresh', NAT: 'Natural',
  GR: 'g', GRM: 'g', LTR: 'L', GAL: 'Gallon',
  // Household
  TP: 'Toilet Paper', DET: 'Detergent', SHMP: 'Shampoo', COND: 'Conditioner',
  TPST: 'Toothpaste', TBR: 'Toothbrush',
};

// ─── Category keyword dictionary ──────────────────────────────────────────────
// First match wins (in declared order). Matched as substring (so "milk chocolate"
// goes to whatever comes first — order matters, snacks before dairy).

// Order matters — first match wins. Put unambiguous categories first; meat last
// (its bare keywords like 'roast', 'ground', 'breast' overlap with non-meat names).
const CATEGORY_KEYWORDS = {
  drinks: [
    'water','soda','juice','coffee','tea','beer','wine','vodka','whiskey',
    'lemonade','kombucha','smoothie','gatorade','sparkling','espresso','latte',
    'cappuccino','cola','pepsi','coke','sprite','fanta','seltzer','tonic',
  ],
  dairy: [
    'milk','cheese','yogurt','yoghurt','butter','cream','egg','eggs','cheddar',
    'mozzarella','parmesan','feta','ricotta','cottage','buttermilk','kefir',
    'ghee','margarine','brie','gouda','swiss','provolone',
  ],
  produce: [
    'apple','banana','tomato','lettuce','onion','potato','carrot','cucumber',
    'pepper','broccoli','cauliflower','spinach','kale','avocado','lemon','lime',
    'orange','grape','strawberry','blueberry','raspberry','blackberry','mango',
    'pineapple','melon','watermelon','peach','pear','cherry','plum','grapefruit',
    'garlic','ginger','mushroom','celery','corn','asparagus','zucchini','squash',
    'eggplant','cabbage','radish','beet','leek','scallion','parsley','cilantro',
    'basil','mint','dill','thyme','arugula','romaine','iceberg','kiwi','papaya',
    'fennel','jalapeno','chili','herb','salad','greens','sprout',
  ],
  seafood: [
    'fish','salmon','tuna','shrimp','cod','tilapia','trout','halibut','sardine',
    'anchovy','crab','lobster','scallop','mussel','oyster','clam','calamari',
    'squid','prawn',
  ],
  bakery: [
    'bread','bagel','muffin','croissant','biscuit','donut','doughnut','pastry',
    'pie','cake','brownie','baguette','pita','tortilla','naan','scone','bun',
    'sourdough','focaccia',
  ],
  frozen: [
    'frozen','ice cream','gelato','sorbet','popsicle','frozen pizza',
  ],
  snacks: [
    'chip','chips','cracker','crackers','pretzel','popcorn','candy','chocolate',
    'cookie','cookies','granola','almond','peanut','cashew','walnut','raisin',
    'pistachio','hazelnut','pecan','trail mix','protein bar',
  ],
  household: [
    'paper','towel','toilet','tissue','detergent','soap','shampoo','conditioner',
    'toothpaste','toothbrush','deodorant','razor','lotion','sunscreen','bleach',
    'sponge','garbage','trash','foil','ziploc','battery','batteries','lightbulb',
    'candle','dish','laundry','wipes','diaper','floss','mouthwash',
  ],
  meat: [
    'chicken','beef','pork','bacon','ham','sausage','turkey','steak','ribs',
    'lamb','veal','salami','pepperoni','prosciutto','jerky','meatball',
    'brisket','tenderloin','sirloin','chorizo','wings','thigh',
  ],
  other: [
    'rice','pasta','noodle','flour','sugar','salt','pepper','oil','vinegar',
    'sauce','soup','beans','lentil','oat','oatmeal','cereal','honey','syrup',
    'jam','jelly','ketchup','mustard','mayo','mayonnaise','salsa','spice',
    'olive','sesame','peanut butter','tofu','hummus','pickle','relish',
  ],
};

// ─── Fuzzy-match lexicon ──────────────────────────────────────────────────────
// Single-word entries from the dictionaries above, length ≥ 4, deduped.
// Used for OCR error correction (e.g. "M1LK" → "milk", "BNANA" → "banana").

const LEXICON = (() => {
  const set = new Set();
  for (const list of Object.values(CATEGORY_KEYWORDS)) {
    for (const w of list) {
      if (!w.includes(' ') && w.length >= 4) set.add(w.toLowerCase());
    }
  }
  for (const v of Object.values(ABBREVIATIONS)) {
    for (const w of v.toLowerCase().split(' ')) {
      if (w.length >= 4) set.add(w);
    }
  }
  return Array.from(set);
})();

// Damerau-Levenshtein with row-min early exit. Returns maxDist+1 if exceeded.
function dlDistance(a, b, maxDist) {
  const al = a.length, bl = b.length;
  if (Math.abs(al - bl) > maxDist) return maxDist + 1;
  if (a === b) return 0;
  if (!al) return bl;
  if (!bl) return al;

  let prev2 = new Array(bl + 1).fill(0);
  let prev1 = new Array(bl + 1);
  let curr  = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev1[j] = j;

  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let v = Math.min(prev1[j] + 1, curr[j - 1] + 1, prev1[j - 1] + cost);
      if (i > 1 && j > 1 &&
          a.charCodeAt(i - 1) === b.charCodeAt(j - 2) &&
          a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxDist) return maxDist + 1;
    const tmp = prev2; prev2 = prev1; prev1 = curr; curr = tmp;
  }
  return prev1[bl];
}

function fuzzyMatch(token) {
  const lower = token.toLowerCase();
  if (lower.length < 4) return null;
  // Allow more edits for longer tokens
  const maxDist = lower.length >= 8 ? 2 : 1;
  if (LEXICON.includes(lower)) return lower;
  let best = null, bestDist = maxDist + 1;
  for (const word of LEXICON) {
    const d = dlDistance(lower, word, bestDist - 1);
    if (d < bestDist) { bestDist = d; best = word; if (d === 0) break; }
  }
  return best;
}

// ─── Per-token expansion ──────────────────────────────────────────────────────

// Common OCR digit-for-letter substitutions
function ocrUndigit(s) {
  return s.replace(/0/g, 'O').replace(/1/g, 'I')
          .replace(/5/g, 'S').replace(/8/g, 'B');
}

function expandToken(token) {
  // Preserve leading/trailing units like "1L", "500g", "2%"
  const m = token.match(/^([0-9.,%]*)([A-Za-z]+)([0-9.,%a-zA-Z]*)$/);
  if (!m) return token;
  const [, lead, core, tail] = m;

  // Direct abbreviation hit (whole-token, uppercase)
  const upper = core.toUpperCase();
  if (ABBREVIATIONS[upper]) return lead + ABBREVIATIONS[upper] + tail;

  // Fuzzy lexicon match for OCR garble
  if (core.length >= 4) {
    const matched = fuzzyMatch(core);
    if (matched) {
      const cased = matched.charAt(0).toUpperCase() + matched.slice(1);
      return lead + cased + tail;
    }
  }

  // OCR digit-substitution recovery (M1LK → MILK, C0KE → COKE).
  // Only retry when the *whole token* becomes pure letters after substitution —
  // otherwise we'd corrupt unit tokens like "1L" → "IL".
  const undigited = ocrUndigit(token);
  if (undigited !== token && /^[A-Za-z]+$/.test(undigited) && undigited.length >= 4) {
    const matched = fuzzyMatch(undigited);
    if (matched) {
      const cased = matched.charAt(0).toUpperCase() + matched.slice(1);
      return cased;
    }
  }

  // Default: convert SHOUTING POS uppercase to Titlecase so the receipt reads naturally
  if (core.length >= 2 && /^[A-Z]+$/.test(core)) {
    return lead + core.charAt(0) + core.slice(1).toLowerCase() + tail;
  }
  return token;
}

// ─── Quantity / weight extraction ─────────────────────────────────────────────

function extractQty(text) {
  let qty = 1;
  let weight = null;
  let clean = text;

  // Weight on its own ("0.45 kg", "1.5 lb") — keep in name, don't treat as qty
  const wm = clean.match(WEIGHT_RE);
  if (wm) weight = `${wm[1]}${wm[2].toLowerCase()}`;

  // "0.45 kg @ $4.99/kg" pricing line — strip the @price part, keep weight
  const priced = clean.match(WEIGHT_PRICED_RE);
  if (priced) {
    clean = clean.replace(priced[0], `${priced[1]}${priced[2].toLowerCase()}`).trim();
  }

  let m;
  if ((m = clean.match(QTY_PREFIX_RE))) {
    qty = parseInt(m[1], 10);
    clean = clean.slice(m[0].length).trim();
  } else if ((m = clean.match(QTY_AT_PREFIX_RE))) {
    qty = parseInt(m[1], 10);
    clean = clean.slice(m[0].length).trim();
  } else if ((m = clean.match(QTY_SUFFIX_RE))) {
    qty = parseInt(m[1], 10);
    clean = clean.slice(0, clean.length - m[0].length).trim();
  }
  return { qty, weight, clean };
}

// ─── Line filtering ───────────────────────────────────────────────────────────

function junkRatio(text) {
  let letters = 0, total = 0;
  for (const c of text) {
    if (/\s/.test(c)) continue;
    total++;
    if (/[a-zA-Z]/.test(c)) letters++;
  }
  return total ? letters / total : 0;
}

function looksLikeItemLine(line) {
  if (!line) return false;
  if (line.length < 3) return false;
  if (IGNORE_WORDS.test(line)) return false;
  if (NUMERIC_ONLY_RE.test(line)) return false;
  if (junkRatio(line) < 0.4) return false;
  return PRICE_TAIL_RE.test(line);
}

// ─── Item construction ────────────────────────────────────────────────────────

function categorize(name) {
  const lower = name.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (cat === 'other') continue;
    for (const kw of keywords) {
      if (lower.includes(kw)) return cat;
    }
  }
  // 'other' category falls through to a final pass so e.g. "rice" still matches
  for (const kw of CATEGORY_KEYWORDS.other) {
    if (lower.includes(kw)) return 'other';
  }
  return 'other';
}

function titleCase(s) {
  return s.replace(/\b\w/g, c => c.toUpperCase())
          .replace(/\b(Ml|Kg|Lb|Lbs|Oz|Pk|Ct)\b/g, w => w.toLowerCase());
}

function processItemLine(rawText) {
  // Normalise weird Unicode that OCR likes to emit
  let text = rawText.normalize('NFKC')
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .trim();

  // Strip trailing price
  let clean = text.replace(PRICE_TAIL_RE, '').trim();
  if (clean.length < 2) return null;
  if (junkRatio(clean) < 0.4) return null;

  const { qty, weight, clean: afterQty } = extractQty(clean);
  if (afterQty.length < 2) return null;

  // Token-level expansion + fuzzy correction
  const expanded = afterQty.split(/\s+/).map(expandToken).join(' ');
  let name = titleCase(expanded).replace(/\s+/g, ' ').trim();
  if (name.length < 2) return null;

  const item = { name, qty, category: categorize(name) };
  if (weight) item.weight = weight;
  return item;
}

function dedupe(items) {
  const map = new Map();
  for (const item of items) {
    // Key on lowercased alphanum so "Milk 1L" and "milk 1l" merge,
    // but "Milk 1L" and "Milk 2L" stay separate.
    const key = item.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (map.has(key)) {
      map.get(key).qty += item.qty;
    } else {
      map.set(key, { ...item });
    }
  }
  return Array.from(map.values());
}

// ─── Price-column-aware line parser (uses Tesseract word boxes) ──────────────

function detectPriceColumnX(lines) {
  const xs = [];
  for (const line of lines) {
    const words = line.words || [];
    for (const w of words) {
      const t = (w.text || '').trim();
      if (PRICE_TOKEN_RE.test(t) && w.bbox) xs.push(w.bbox.x0);
    }
  }
  if (xs.length < 3) return null;
  xs.sort((a, b) => a - b);
  // Median of price-token x-positions = the price column
  return xs[Math.floor(xs.length / 2)];
}

function parseFromLines(lines) {
  if (!lines || !lines.length) return null;

  // Find footer boundary; only parse above it
  let endIdx = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (FOOTER_BOUNDARY.test((lines[i].text || '').trim())) { endIdx = i; break; }
  }

  const priceColX = detectPriceColumnX(lines.slice(0, endIdx));

  const items = [];
  for (let i = 0; i < endIdx; i++) {
    const line = lines[i];
    const allWords = line.words || [];
    if (!allWords.length) continue;

    // Drop low-confidence words; OCR wins are usually high-confidence anyway
    const words = allWords.filter(w => (w.confidence ?? 100) >= 50 && w.text);
    if (!words.length) continue;

    const text = words.map(w => w.text).join(' ').trim();
    if (!looksLikeItemLine(text)) continue;

    // Sanity-check: the price token's x should be near the price column.
    // Discards lines where the "price" is actually a mid-line number.
    if (priceColX != null) {
      const priceWord = [...words].reverse().find(w => PRICE_TOKEN_RE.test(w.text.trim()));
      if (priceWord?.bbox) {
        const dx = Math.abs(priceWord.bbox.x0 - priceColX);
        // Tolerance: ~15% of the rightmost x as a rough page-width proxy
        const tolerance = Math.max(40, priceColX * 0.15);
        if (dx > tolerance) continue;
      }
    }

    const item = processItemLine(text);
    if (item) items.push(item);
  }
  return { items: dedupe(items) };
}

// ─── Plain-text fallback parser ───────────────────────────────────────────────

function parseFromText(text) {
  if (!text) return { items: [] };
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  let endIdx = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (FOOTER_BOUNDARY.test(lines[i])) { endIdx = i; break; }
  }

  const items = [];
  for (let i = 0; i < endIdx; i++) {
    if (!looksLikeItemLine(lines[i])) continue;
    const item = processItemLine(lines[i]);
    if (item) items.push(item);
  }
  return { items: dedupe(items) };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function extractItemsFromText(rawText, lines) {
  // Prefer block/word output when available — geometric column detection
  // weeds out false positives the text-only parser can't see.
  if (lines && lines.length) {
    const result = parseFromLines(lines);
    if (result && result.items.length) return result;
  }
  return parseFromText(rawText);
}
