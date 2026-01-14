// src/lib/date.ts

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function parseISODateLocal(iso: string) {
  // iso = "YYYY-MM-DD"
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

export function normalizeLocal(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * ✅ isoDay baseado no calendário LOCAL (não UTC).
 * Retorna YYYY-MM-DD consistente com as colunas do teu grid.
 */
export function isoDay(d: Date) {
  const x = normalizeLocal(d);
  const y = x.getFullYear();
  const m = x.getMonth() + 1;
  const dd = x.getDate();
  return `${y}-${pad2(m)}-${pad2(dd)}`;
}
