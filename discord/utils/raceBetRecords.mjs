import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '../../utils/firebaseAdmin.mjs';
import {
  appendLedgerTx,
  getCurrentDailyPeriodKey,
  getJstDailyPeriodWindowBounds,
  normBalance,
} from './userPointsStore.mjs';
import { sumRefundBpForTickets } from './raceBetPayout.mjs';
import { ticketCountForValidation } from './raceBetTickets.mjs';

/** Firestore: raceBets 複合インデックス (userId,raceId,status) / (userId,status) が初回クエリ時に案内されます */
const COLLECTION = 'raceBets';
const USER_POINTS = 'userPoints';

/**
 * @param {string} userId
 * @param {Array<object>} items 買い目（tickets / points / unitYen / raceId 等）
 */
export async function tryConfirmRacePurchase(userId, items) {
  if (!items?.length) {
    return { ok: false, reason: 'empty' };
  }

  let total = 0;
  const normalized = [];
  for (const it of items) {
    const raceId = String(it.raceId || '');
    if (!/^\d{12}$/.test(raceId)) {
      return { ok: false, reason: 'bad_race' };
    }
    const points = Math.round(Number(it.points) || 0);
    const unitYen = Math.max(1, Math.round(Number(it.unitYen) || 100));
    if (points <= 0) {
      return { ok: false, reason: 'bad_points' };
    }
    const tickets = Array.isArray(it.tickets) ? it.tickets : [];
    if (ticketCountForValidation(tickets) !== points) {
      return { ok: false, reason: 'bad_tickets' };
    }
    const c = points * unitYen;
    total += c;
    const h2f =
      it.horseNumToFrame && typeof it.horseNumToFrame === 'object'
        ? Object.fromEntries(
            Object.entries(it.horseNumToFrame).map(([k, v]) => [
              String(k),
              String(v ?? ''),
            ]),
          )
        : {};
    let trifukuFormation = null;
    if (
      it.trifukuFormation &&
      typeof it.trifukuFormation === 'object' &&
      Array.isArray(it.trifukuFormation.a)
    ) {
      trifukuFormation = {
        a: it.trifukuFormation.a.map(String),
        b: (it.trifukuFormation.b || []).map(String),
        c: (it.trifukuFormation.c || []).map(String),
      };
    }
    normalized.push({
      raceId,
      raceTitle: it.raceTitle != null ? String(it.raceTitle).slice(0, 200) : '',
      venueTitle:
        it.venueTitle != null && String(it.venueTitle).trim()
          ? String(it.venueTitle).replace(/\s+/g, ' ').trim().slice(0, 40)
          : '',
      betType: it.betType != null ? String(it.betType) : '',
      selectionLine: it.selectionLine != null ? String(it.selectionLine).slice(0, 500) : '',
      points,
      unitYen,
      costBp: c,
      tickets,
      netkeibaOrigin: it.netkeibaOrigin === 'nar' ? 'nar' : 'jra',
      horseNumToFrame: h2f,
      trifukuFormation,
    });
  }

  const period = getCurrentDailyPeriodKey();
  const db = getAdminFirestore();
  const userRef = db.collection(USER_POINTS).doc(userId);

  return db.runTransaction(async (tx) => {
    const uSnap = await tx.get(userRef);
    const balance = normBalance(uSnap.data()?.balance);
    if (balance < total) {
      return { ok: false, reason: 'insufficient', balance, need: total };
    }
    const newBal = balance - total;
    tx.set(userRef, { balance: newBal }, { merge: true });
    appendLedgerTx(tx, userRef, {
      delta: -total,
      balanceAfter: newBal,
      kind: 'race_bet',
      period,
    });

    for (const row of normalized) {
      const docRef = db.collection(COLLECTION).doc();
      const docBody = {
        userId,
        raceId: row.raceId,
        raceTitle: row.raceTitle,
        betType: row.betType,
        selectionLine: row.selectionLine,
        points: row.points,
        unitYen: row.unitYen,
        costBp: row.costBp,
        tickets: row.tickets,
        netkeibaOrigin: row.netkeibaOrigin,
        horseNumToFrame: row.horseNumToFrame || {},
        status: 'open',
        refundBp: 0,
        purchasedAt: FieldValue.serverTimestamp(),
        settledAt: null,
      };
      if (row.trifukuFormation) docBody.trifukuFormation = row.trifukuFormation;
      if (row.venueTitle) docBody.venueTitle = row.venueTitle;
      tx.set(docRef, docBody);
    }

    return { ok: true, balance: newBal, spent: total, count: normalized.length };
  });
}

/**
 * 指定ユーザーの未払戻レース買いを結果に基づき精算する（冪等：open のみ）
 * @param {string} userId
 * @param {string} raceId
 * @param {{ payouts?: object[] }} parsedResult scrapeRaceResult の戻り
 */
export async function settleOpenRaceBetsForUser(userId, raceId, parsedResult) {
  const rid = String(raceId || '');
  if (!/^\d{12}$/.test(rid)) return { settled: 0, totalRefund: 0, balance: null };

  const payouts = parsedResult?.payouts || [];
  const db = getAdminFirestore();
  const userRef = db.collection(USER_POINTS).doc(userId);
  const period = getCurrentDailyPeriodKey();

  return db.runTransaction(async (tx) => {
    const q = db
      .collection(COLLECTION)
      .where('userId', '==', userId)
      .where('raceId', '==', rid)
      .where('status', '==', 'open');
    const betsSnap = await tx.get(q);
    const uSnap = await tx.get(userRef);

    if (betsSnap.empty) {
      return {
        settled: 0,
        totalRefund: 0,
        balance: normBalance(uSnap.data()?.balance),
      };
    }

    let totalRefund = 0;
    for (const doc of betsSnap.docs) {
      const d = doc.data();
      const unitYen = Math.max(1, Math.round(Number(d.unitYen) || 100));
      const refund = sumRefundBpForTickets(d.tickets || [], payouts, unitYen);
      totalRefund += refund;
      tx.update(doc.ref, {
        status: 'settled',
        refundBp: refund,
        settledAt: FieldValue.serverTimestamp(),
      });
    }

    const balance = normBalance(uSnap.data()?.balance);
    const newBal = balance + totalRefund;
    tx.set(userRef, { balance: newBal }, { merge: true });
    if (totalRefund > 0) {
      appendLedgerTx(tx, userRef, {
        delta: totalRefund,
        balanceAfter: newBal,
        kind: 'race_refund',
        period,
      });
    }

    return {
      settled: betsSnap.size,
      totalRefund,
      balance: newBal,
    };
  });
}

/**
 * 未精算（status open）のレースをユニークな raceId ごとに結果取得→精算する。
 * スラッシュコマンド等の入口で呼び、ランキング・履歴と残高を揃える。
 * @param {string} userId
 * @param {(raceId: string) => Promise<{ confirmed?: boolean, payouts?: object[] }>} scrapeRaceResult
 * @param {{ maxRaces?: number }} [opts] 1コールあたり処理するレース数上限（netkeiba 負荷・応答時間対策）
 */
export async function settlePendingOpenRaceBetsForUser(userId, scrapeRaceResult, opts = {}) {
  const uid = String(userId || '');
  if (!uid || typeof scrapeRaceResult !== 'function') {
    return {
      raceIdsProcessed: 0,
      settledBets: 0,
      totalRefund: 0,
      balance: null,
      skippedNoResult: 0,
    };
  }

  const maxRaces = Math.max(1, Math.min(50, Math.round(Number(opts.maxRaces) || 12)));
  const db = getAdminFirestore();
  const snap = await db
    .collection(COLLECTION)
    .where('userId', '==', uid)
    .where('status', '==', 'open')
    .get();

  if (snap.empty) {
    const uRef = db.collection(USER_POINTS).doc(uid);
    const uSnap = await uRef.get();
    return {
      raceIdsProcessed: 0,
      settledBets: 0,
      totalRefund: 0,
      balance: normBalance(uSnap.data()?.balance),
      skippedNoResult: 0,
    };
  }

  const raceIdSet = new Set();
  for (const doc of snap.docs) {
    const rid = String(doc.data()?.raceId || '');
    if (/^\d{12}$/.test(rid)) raceIdSet.add(rid);
  }
  const raceIds = [...raceIdSet].sort();
  const toProcess = raceIds.slice(0, maxRaces);

  let settledBets = 0;
  let totalRefund = 0;
  let skippedNoResult = 0;
  /** @type {number | null} */
  let balance = null;

  for (const raceId of toProcess) {
    let parsed;
    try {
      parsed = await scrapeRaceResult(raceId);
    } catch (_) {
      skippedNoResult += 1;
      continue;
    }
    if (!parsed?.confirmed) {
      skippedNoResult += 1;
      continue;
    }
    try {
      const pay = await settleOpenRaceBetsForUser(uid, raceId, parsed);
      settledBets += pay.settled;
      totalRefund += pay.totalRefund;
      if (pay.balance != null) balance = pay.balance;
    } catch (_) {
      skippedNoResult += 1;
    }
  }

  if (balance == null) {
    const uRef = db.collection(USER_POINTS).doc(uid);
    const uSnap = await uRef.get();
    balance = normBalance(uSnap.data()?.balance);
  }

  return {
    raceIdsProcessed: toProcess.length,
    settledBets,
    totalRefund,
    balance,
    skippedNoResult,
  };
}

/**
 * 指定ユーザーの競馬購入を日次帯（JST 8:00〜翌 8:00）で取得（購入時刻順）
 * 複合インデックス: raceBets userId + purchasedAt
 */
export async function fetchUserRaceBetsForDailyPeriod(
  userId,
  periodKey = getCurrentDailyPeriodKey(),
) {
  const { start, end } = getJstDailyPeriodWindowBounds(periodKey);
  const db = getAdminFirestore();
  const q = db
    .collection(COLLECTION)
    .where('userId', '==', userId)
    .where('purchasedAt', '>=', Timestamp.fromDate(start))
    .where('purchasedAt', '<', Timestamp.fromDate(end))
    .orderBy('purchasedAt', 'asc');
  const snap = await q.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * ユーザーの競馬購入の集計（回収率は精算済みレコードのみ）
 * hitCount: 精算済みかつ払戻 bp > 0（購入履歴の「的中」と同じ）
 * @param {string} userId
 */
export async function fetchUserRaceBetAggregates(userId) {
  const uid = String(userId || '');
  if (!uid) {
    return {
      purchaseCount: 0,
      totalCostBp: 0,
      maxCostBp: 0,
      firstPurchasedAt: null,
      settledCount: 0,
      hitCount: 0,
      maxRecoveryRate: null,
      minRecoveryRate: null,
    };
  }

  const db = getAdminFirestore();
  const snap = await db.collection(COLLECTION).where('userId', '==', uid).get();

  let purchaseCount = 0;
  let totalCostBp = 0;
  let maxCostBp = 0;
  /** @type {Date | null} */
  let firstPurchasedAt = null;
  let settledCount = 0;
  let hitCount = 0;
  /** @type {number[]} */
  const recoveryRatios = [];

  for (const doc of snap.docs) {
    const d = doc.data();
    purchaseCount += 1;
    const cost = Math.max(0, Math.round(Number(d.costBp) || 0));
    totalCostBp += cost;
    if (cost > maxCostBp) maxCostBp = cost;
    const at = d.purchasedAt?.toDate?.() ?? null;
    if (at instanceof Date && !Number.isNaN(at.getTime())) {
      if (!firstPurchasedAt || at < firstPurchasedAt) firstPurchasedAt = at;
    }
    if (String(d.status || '') === 'settled' && cost > 0) {
      settledCount += 1;
      const refund = Math.max(0, Math.round(Number(d.refundBp) || 0));
      recoveryRatios.push(refund / cost);
      if (refund > 0) hitCount += 1;
    }
  }

  let maxRecoveryRate = null;
  let minRecoveryRate = null;
  if (recoveryRatios.length) {
    maxRecoveryRate = Math.max(...recoveryRatios);
    minRecoveryRate = Math.min(...recoveryRatios);
  }

  return {
    purchaseCount,
    totalCostBp,
    maxCostBp,
    firstPurchasedAt,
    settledCount,
    hitCount,
    maxRecoveryRate,
    minRecoveryRate,
  };
}
