const SYSTEM_PROMPT = `You are a grocery receipt parser. Extract only purchasable food/household items.
Ignore: store name, address, date, cashier, totals, subtotals, tax, payment info,
loyalty points, receipt numbers, and any line that is clearly not a product.
Normalise item names (e.g. MLKWHL2%1L → Whole Milk 1L).
Return ONLY valid JSON, no markdown, no explanation:
{"items":[{"name":"string","qty":1,"category":"produce|dairy|meat|bakery|frozen|drinks|snacks|household|other"}]}`;

const IGNORE_WORDS = /\b(total|subtotal|tax|change|cash|credit|debit|visa|mastercard|balance|payment|tender|loyalty|points|receipt|cashier|store|thank|welcome|vat|gst|pst|hst|void|refund|discount|coupon|savings|member)\b/i;

function regexParser(text) {
  const lines = text.split('\n');
  const items = [];
  for (let line of lines) {
    line = line.trim();
    if (line.length <= 2) continue;
    if (/^\$/.test(line)) continue;
    if (/^\d+(\.\d+)?$/.test(line)) continue;
    if (IGNORE_WORDS.test(line)) continue;
    // strip trailing prices like 3.99 or $3.99
    let clean = line.replace(/\s*\$?\d+\.\d{2}\s*[A-Z]?\s*$/, '').trim();
    if (clean.length <= 2) continue;

    let qty = 1;
    // patterns: "2x item", "item x2", "2 @ item", "2 X item"
    const m1 = clean.match(/^(\d+)\s*[xX@]\s+/);
    const m2 = clean.match(/\s+[xX]\s*(\d+)$/);
    const m3 = clean.match(/^(\d+)\s+@\s+/);
    if (m1) { qty = parseInt(m1[1]); clean = clean.slice(m1[0].length).trim(); }
    else if (m2) { qty = parseInt(m2[1]); clean = clean.slice(0, clean.length - m2[0].length).trim(); }
    else if (m3) { qty = parseInt(m3[1]); clean = clean.slice(m3[0].length).trim(); }

    if (clean.length > 2) {
      // title-case
      clean = clean.replace(/\b\w/g, c => c.toUpperCase()).replace(/\b(Ml|Kg|Lb|Oz|Pk|Ct)\b/g, s => s.toLowerCase());
      items.push({ name: clean, qty, category: 'other' });
    }
  }
  return { items };
}

export async function extractItemsFromText(rawText) {
  if (window.ai?.languageModel) {
    try {
      const session = await window.ai.languageModel.create({ systemPrompt: SYSTEM_PROMPT });
      const response = await session.prompt(rawText);
      session.destroy();
      // strip any accidental markdown fences
      const json = response.replace(/```(?:json)?/gi, '').trim();
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed?.items)) return parsed;
    } catch (_) {
      // fall through to regex
    }
  }
  return regexParser(rawText);
}
