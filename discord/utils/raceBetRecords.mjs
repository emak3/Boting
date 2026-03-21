import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '../../utils/firebaseAdmin.mjs';
import {
  appendLedgerTx,
  getCurrentDailyPeriodKey,
  normBalance,
} from './userPointsStore.mjs';
import { sumRefundBpForTickets } from './raceBetPayout.mjs';
import { ticketCountForValidation } from './raceBetTickets.mjs';

/** Firestore: 複合インデックス raceBets (userId ==, raceId ==, status ==) が初回クエリ時に案内されます */
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
    normalized.push({
      raceId,
      raceTitle: it.raceTitle != null ? String(it.raceTitle).slice(0, 200) : '',
      betType: it.betType != null ? String(it.betType) : '',
      selectionLine: it.selectionLine != null ? String(it.selectionLine).slice(0, 500) : '',
      points,
      unitYen,
      costBp: c,
      tickets,
      netkeibaOrigin: it.netkeibaOrigin === 'nar' ? 'nar' : 'jra',
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
      tx.set(docRef, {
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
        status: 'open',
        refundBp: 0,
        purchasedAt: FieldValue.serverTimestamp(),
        settledAt: null,
      });
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

    if (betsSnap.empty) {
      const uSnap = await tx.get(userRef);
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

    const uSnap = await tx.get(userRef);
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
