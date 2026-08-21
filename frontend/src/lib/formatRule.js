const OP_WORD = { ">=": "≥", "<=": "≤", "==": "=", "~": "≈", ">": ">", "<": "<" };

const LABELS = {
  quantity: (r) => `${OP_WORD[r.op] ?? r.op} ${r.value} units`,
  ram_gb: (r) => `${OP_WORD[r.op] ?? r.op} ${r.value}GB RAM`,
  storage_gb: (r) => `${OP_WORD[r.op] ?? r.op} ${r.value}GB storage`,
  price_per_unit: (r) => `${OP_WORD[r.op] ?? r.op} ₹${Number(r.value).toLocaleString("en-IN")}`,
  delivery_days: (r) => `${OP_WORD[r.op] ?? r.op} ${r.value}d delivery`,
};

/** parsed_rules (the backend's flat rule dict, known fields + "other") -> a
 * flat list of { key, label, elastic } chip descriptors, in a stable order. */
export function rulesToChips(parsedRules) {
  if (!parsedRules) return [];
  const order = ["quantity", "ram_gb", "storage_gb", "price_per_unit", "delivery_days"];
  const chips = [];

  for (const key of order) {
    const rule = parsedRules[key];
    if (!rule) continue;
    chips.push({ key, label: LABELS[key](rule), elastic: rule.elastic });
  }
  for (const [key, rule] of Object.entries(parsedRules)) {
    if (order.includes(key) || !rule || typeof rule !== "object") continue;
    const niceKey = key.replace(/_/g, " ");
    chips.push({ key, label: `${niceKey}: ${rule.value}`, elastic: rule.elastic });
  }
  return chips;
}
