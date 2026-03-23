// 買い目: 保存中リスト（買い目に追加）と、まとめて購入の確認中リスト（メモリ・再起動で消える）
const savedMap = new Map();
const pendingMap = new Map();
const SAVED_TTL_MS = 5 * 60 * 1000;
const PENDING_TTL_MS = 5 * 60 * 1000;
export const SLIP_MAX_ITEMS = 20;

function ts() {
  return Date.now();
}

function savedEntry(userId) {
  const v = savedMap.get(userId);
  if (!v) return null;
  if (ts() - v.createdAt > SAVED_TTL_MS) {
    savedMap.delete(userId);
    return null;
  }
  return v;
}

/** 買い目に追加した分（まとめて購入の対象の一部） */
export function getSlipSavedItems(userId) {
  const e = savedEntry(userId);
  return e?.items?.length ? [...e.items] : [];
}

export function getSlipSavedCount(userId) {
  return getSlipSavedItems(userId).length;
}

/**
 * @returns {{ ok: true, count: number } | { ok: false, reason: 'full' }}
 */
export function addSlipSavedItem(userId, item) {
  const now = ts();
  let e = savedMap.get(userId);
  if (e && now - e.createdAt > SAVED_TTL_MS) {
    e = null;
    savedMap.delete(userId);
  }
  const items = e?.items?.length ? [...e.items] : [];
  if (items.length >= SLIP_MAX_ITEMS) {
    return { ok: false, reason: 'full' };
  }
  const id = `${now}_${Math.random().toString(36).slice(2, 10)}`;
  items.push({ ...item, id });
  savedMap.set(userId, { items, createdAt: e?.createdAt ?? now });
  return { ok: true, count: items.length };
}

export function clearSlipSaved(userId) {
  savedMap.delete(userId);
}

/** 買い目確認を開く前の「追加済み」をそのまま戻す */
export function restoreSlipSavedItems(userId, items) {
  if (!items?.length) {
    savedMap.delete(userId);
    return;
  }
  savedMap.set(userId, {
    items: items.map((it) => ({ ...it })),
    createdAt: ts(),
  });
}

/** まとめて購入（仮）の編集中 */
export function setSlipPendingReview(userId, { items, anchorRaceId, restore = null }) {
  pendingMap.set(userId, {
    items: items.map((it) => ({ ...it })),
    anchorRaceId,
    restore,
    reviewPage: 0,
    createdAt: ts(),
  });
}

/** まとめて購入確認のページ（0 始まり） */
export function setSlipPendingReviewPage(userId, page) {
  const e = getSlipPendingReview(userId);
  if (!e) return false;
  const n = Math.max(0, Math.floor(Number(page) || 0));
  pendingMap.set(userId, {
    ...e,
    reviewPage: n,
    createdAt: ts(),
  });
  return true;
}

export function getSlipPendingReview(userId) {
  const v = pendingMap.get(userId);
  if (!v) return null;
  if (ts() - v.createdAt > PENDING_TTL_MS) {
    pendingMap.delete(userId);
    return null;
  }
  return v;
}

export function replaceSlipPendingItems(userId, items) {
  const e = getSlipPendingReview(userId);
  if (!e) return false;
  pendingMap.set(userId, {
    ...e,
    items: items.map((it) => ({ ...it })),
    createdAt: ts(),
  });
  return true;
}

export function clearSlipPending(userId) {
  pendingMap.delete(userId);
}
