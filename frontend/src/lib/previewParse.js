/**
 * A deliberately small, client-side guess at what's in a brief - not a port
 * of the backend's regex fallback or its LLM path. It exists to make the
 * empty-to-typed gap feel alive before submission; the real parse (with
 * elasticity, confidence, op) only ever comes from the backend after submit.
 */

const QTY_RE = /\b(\d{1,4})\s*(laptops?|units?|pieces?|items?|chairs?|monitors?|desks?)\b/i;
const RAM_RE = /\b(\d{1,3})\s*gb\b(?!\s*(ssd|storage|hdd|nvme))/i;
const STORAGE_RE = /\b(\d{1,4})\s*(gb|tb)\s*(ssd|storage|hdd|nvme)?\b/gi;
const PRICE_RE = /(?:[₹]|\brs\.?\s*)\s*([\d,]+)|\b(\d{1,3}(?:,\d{3})*|\d+)\s*k\b/i;
const DELIVERY_RE = /\b(\d{1,2})\s*days?\b/i;

export function previewParse(text) {
  if (!text || !text.trim()) return {};

  const chips = {};

  const qty = text.match(QTY_RE);
  if (qty) chips.quantity = `${qty[1]} ${qty[2].toLowerCase()}`;

  const ram = text.match(RAM_RE);
  if (ram) chips.ram = `${ram[1]}GB RAM`;

  // storage: take the largest GB/TB-with-a-disk-word match, distinct from RAM
  let storage = null;
  for (const m of text.matchAll(STORAGE_RE)) {
    if (!m[3]) continue; // no ssd/hdd/etc word nearby - probably not storage
    const gb = m[2].toLowerCase() === "tb" ? Number(m[1]) * 1024 : Number(m[1]);
    if (!storage || gb > storage.gb) storage = { gb, type: m[3].toUpperCase() };
  }
  if (storage) chips.storage = `${storage.gb}GB ${storage.type}`;

  const price = text.match(PRICE_RE);
  if (price) {
    const raw = price[1] ?? price[2];
    const isK = price[0].toLowerCase().includes("k") && !price[1];
    const value = Number(raw.replace(/,/g, "")) * (isK ? 1000 : 1);
    chips.price = `₹${value.toLocaleString("en-IN")}`;
  }

  const delivery = text.match(DELIVERY_RE);
  if (delivery) chips.delivery = `${delivery[1]}d delivery`;

  return chips;
}
