import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '../../utils/firebaseAdmin.mjs';

const COLLECTION = 'userPoints';
const LEDGER = 'ledger';
const LEDGER_PREVIEW_LIMIT = 15;

/** JSTはDSTなし。UTC+9のオフセットでJSTの暦・時刻成分を得る */
function getJstYmdH(date) {
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
  };
}

/**
 * 日次リセット境界: 毎日 JST 08:00。
 * 返すキーは「その帯が始まった日」の YYYYMMDD（JST）。
 */
export function getCurrentDailyPeriodKey(now = new Date()) {
  let { y, m, d, h } = getJstYmdH(now);
  if (h < 8) {
    const t = Date.UTC(y, m - 1, d) - 24 * 60 * 60 * 1000;
    const prev = new Date(t);
    y = prev.getUTCFullYear();
    m = prev.getUTCMonth() + 1;
    d = prev.getUTCDate();
  }
  return `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
}

export function normBalance(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** period キー YYYYMMDD の「翌日」JST 8:00（次の日次帯の開始） */
export function getNextDailyWindowStartDate(periodKey) {
  const y = periodKey.slice(0, 4);
  const mo = periodKey.slice(4, 6);
  const da = periodKey.slice(6, 8);
  const thisStart = new Date(`${y}-${mo}-${da}T08:00:00+09:00`);
  return new Date(thisStart.getTime() + 24 * 60 * 60 * 1000);
}

/** 日次帯 periodKey（YYYYMMDD）の [start, end) — いずれも JST 8:00 境界 */
export function getJstDailyPeriodWindowBounds(periodKey) {
  const y = periodKey.slice(0, 4);
  const mo = periodKey.slice(4, 6);
  const da = periodKey.slice(6, 8);
  const start = new Date(`${y}-${mo}-${da}T08:00:00+09:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export function kindLabelJa(kind) {
  if (kind === 'first') return '初回ボーナス';
  if (kind === 'debug_extra') return 'デバッグ';
  if (kind === 'debug_bp_adjust') return 'デバッグ（BP調整）';
  if (kind === 'race_bet') return '競馬（購入）';
  if (kind === 'race_refund') return '競馬（払戻）';
  return 'デイリー';
}

/**
 * @param {string} userId
 * @returns {Promise<{
 *   balance: number,
 *   currentPeriodKey: string,
 *   lastDailyPeriodKey: string | null,
 *   nextClaimAt: Date | null,
 *   entries: Array<{ delta: number, balanceAfter: number, kind: string, period: string, at: Date | null }>,
 * }>}
 */
export async function getDailyAccountView(userId) {
  const db = getAdminFirestore();
  const ref = db.collection(COLLECTION).doc(userId);
  const currentPeriodKey = getCurrentDailyPeriodKey();
  const [snap, ledgerSnap] = await Promise.all([
    ref.get(),
    ref
      .collection(LEDGER)
      .orderBy('at', 'desc')
      .limit(LEDGER_PREVIEW_LIMIT)
      .get(),
  ]);

  const u = snap.exists ? snap.data() : {};
  const balance = normBalance(u.balance);
  const lastDailyPeriodKey =
    u.lastDailyPeriodKey != null ? String(u.lastDailyPeriodKey) : null;

  let nextClaimAt = null;
  if (lastDailyPeriodKey === currentPeriodKey && lastDailyPeriodKey) {
    nextClaimAt = getNextDailyWindowStartDate(lastDailyPeriodKey);
  }

  const entries = [];
  for (const d of ledgerSnap.docs) {
    const row = d.data();
    const at = row.at?.toDate?.() ?? null;
    entries.push({
      delta: normBalance(row.delta),
      balanceAfter: normBalance(row.balanceAfter),
      kind: String(row.kind ?? 'daily'),
      period: row.period != null ? String(row.period) : '',
      at,
    });
  }

  return {
    balance,
    currentPeriodKey,
    lastDailyPeriodKey,
    nextClaimAt,
    entries,
  };
}

export function appendLedgerTx(tx, userRef, payload) {
  const row = userRef.collection(LEDGER).doc();
  tx.set(row, {
    delta: payload.delta,
    balanceAfter: payload.balanceAfter,
    kind: payload.kind,
    period: payload.period,
    at: FieldValue.serverTimestamp(),
  });
}

/**
 * @param {string} userId
 * @returns {Promise<number>}
 */
export async function getBalance(userId) {
  const db = getAdminFirestore();
  const snap = await db.collection(COLLECTION).doc(userId).get();
  if (!snap.exists) return 0;
  return normBalance(snap.data()?.balance);
}

/**
 * 台帳の最古の取引時刻（初回デイリー・購入など）
 * @param {string} userId
 * @returns {Promise<Date | null>}
 */
export async function fetchFirstLedgerAt(userId) {
  const db = getAdminFirestore();
  const snap = await db
    .collection(COLLECTION)
    .doc(String(userId))
    .collection(LEDGER)
    .orderBy('at', 'asc')
    .limit(1)
    .get();
  if (snap.empty) return null;
  const at = snap.docs[0].data()?.at?.toDate?.();
  return at instanceof Date && !Number.isNaN(at.getTime()) ? at : null;
}

const DEBUG_BP_ADJUST_ABS_MAX = 99_999_999;

/**
 * デバッグ用: 指定ユーザーの bp を増減し台帳に記録する（許可ユーザーのみコマンドから呼ぶこと）
 * @param {string} targetUserId
 * @param {number} delta 正で追加、負で減算
 * @returns {Promise<
 *   | { ok: true, balanceBefore: number, balanceAfter: number, delta: number }
 *   | { ok: false, reason: 'zero_delta' | 'delta_too_large' | 'would_go_negative', balance?: number }
 * >}
 */
export async function applyDebugBpAdjustment(targetUserId, delta) {
  const d = Math.trunc(Number(delta));
  if (!Number.isFinite(d) || d === 0) {
    return { ok: false, reason: 'zero_delta' };
  }
  if (Math.abs(d) > DEBUG_BP_ADJUST_ABS_MAX) {
    return { ok: false, reason: 'delta_too_large' };
  }

  const period = getCurrentDailyPeriodKey();
  const db = getAdminFirestore();
  const ref = db.collection(COLLECTION).doc(String(targetUserId));

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const u = snap.exists ? snap.data() : {};
    const balanceBefore = normBalance(u.balance);
    const balanceAfter = balanceBefore + d;
    if (balanceAfter < 0) {
      return {
        ok: false,
        reason: 'would_go_negative',
        balance: balanceBefore,
      };
    }
    tx.set(ref, { balance: balanceAfter }, { merge: true });
    appendLedgerTx(tx, ref, {
      delta: d,
      balanceAfter,
      kind: 'debug_bp_adjust',
      period,
    });
    return { ok: true, balanceBefore, balanceAfter, delta: d };
  });
}

/**
 * @param {string} userId
 * @param {{ debugBypass?: boolean }} [opts]
 * @returns {Promise<{ ok: true, granted: number, balance: number, kind: 'first' | 'daily' | 'debug_extra' } | { ok: false, reason: 'already_claimed', balance: number }>}
 */
export async function tryClaimDaily(userId, opts = {}) {
  const debugBypass = !!opts.debugBypass;
  const period = getCurrentDailyPeriodKey();
  const db = getAdminFirestore();
  const ref = db.collection(COLLECTION).doc(userId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const u = snap.exists ? snap.data() : {};
    const balance = normBalance(u.balance);
    const firstDailyDone = !!u.firstDailyDone;
    const lastDailyPeriodKey =
      u.lastDailyPeriodKey != null ? String(u.lastDailyPeriodKey) : null;

    if (!firstDailyDone) {
      const newBal = balance + 10000;
      tx.set(
        ref,
        {
          balance: newBal,
          firstDailyDone: true,
          lastDailyPeriodKey: period,
        },
        { merge: true },
      );
      appendLedgerTx(tx, ref, {
        delta: 10000,
        balanceAfter: newBal,
        kind: 'first',
        period,
      });
      return { ok: true, granted: 10000, balance: newBal, kind: 'first' };
    }

    if (lastDailyPeriodKey === period) {
      if (debugBypass) {
        const newBal = balance + 10;
        tx.set(ref, { balance: newBal }, { merge: true });
        appendLedgerTx(tx, ref, {
          delta: 10,
          balanceAfter: newBal,
          kind: 'debug_extra',
          period,
        });
        return { ok: true, granted: 10, balance: newBal, kind: 'debug_extra' };
      }
      return {
        ok: false,
        reason: 'already_claimed',
        balance,
      };
    }

    const newBal = balance + 10;
    tx.set(
      ref,
      {
        balance: newBal,
        lastDailyPeriodKey: period,
      },
      { merge: true },
    );
    appendLedgerTx(tx, ref, {
      delta: 10,
      balanceAfter: newBal,
      kind: 'daily',
      period,
    });
    return { ok: true, granted: 10, balance: newBal, kind: 'daily' };
  });
}
