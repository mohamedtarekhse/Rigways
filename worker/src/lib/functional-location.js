export function buildFunctionalLocationAliases(rawValue, rows = []) {
  const raw = String(rawValue || '').trim();
  if (!raw) return [];

  const aliases = [];
  const seen = new Set();
  const push = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    aliases.push(normalized);
  };

  push(raw);

  for (const row of Array.isArray(rows) ? rows : []) {
    const values = [row?.fl_id, row?.id, row?.name];
    const match = values.some((value) => String(value || '').trim().toLowerCase() === raw.toLowerCase());
    if (!match) continue;
    for (const value of values) push(value);
  }

  return aliases;
}
