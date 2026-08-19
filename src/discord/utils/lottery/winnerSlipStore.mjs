const savedMap = new Map();
export const WINNER_SLIP_MAX_ITEMS = 20;
const SAVED_TTL_MS = 10 * 60 * 1000;

function now() {
  return Date.now();
}

function entry(userId) {
  const e = savedMap.get(userId);
  if (!e) return null;
  if (now() - e.createdAt > SAVED_TTL_MS) {
    savedMap.delete(userId);
    return null;
  }
  return e;
}

export function getWinnerSlipItems(userId) {
  const e = entry(userId);
  return e?.items?.length ? e.items.map((it) => ({ ...it })) : [];
}

export function getWinnerSlipCount(userId) {
  return getWinnerSlipItems(userId).length;
}

export function addWinnerSlipItem(userId, item) {
  const e = entry(userId);
  const items = e?.items?.length ? e.items.map((it) => ({ ...it })) : [];
  if (items.length >= WINNER_SLIP_MAX_ITEMS) return { ok: false, reason: 'full' };
  const key = `${item.matchId}|${item.outcome}|${item.scorePick}`;
  const duplicate = items.find((it) => `${it.matchId}|${it.outcome}|${it.scorePick}` === key);
  if (duplicate) return { ok: false, reason: 'duplicate', count: items.length };
  items.push({
    ...item,
    id: `${now()}_${Math.random().toString(36).slice(2, 10)}`,
  });
  savedMap.set(userId, { items, createdAt: e?.createdAt ?? now() });
  return { ok: true, count: items.length };
}

export function removeWinnerSlipItem(userId, index) {
  const e = entry(userId);
  if (!e?.items?.length) return false;
  const idx = Math.trunc(Number(index));
  if (!Number.isFinite(idx) || idx < 0 || idx >= e.items.length) return false;
  const items = e.items.filter((_, i) => i !== idx);
  if (!items.length) savedMap.delete(userId);
  else savedMap.set(userId, { items, createdAt: now() });
  return true;
}

export function clearWinnerSlip(userId) {
  savedMap.delete(userId);
}
