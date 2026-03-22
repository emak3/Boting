import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '../../utils/firebaseAdmin.mjs';
import {
  appendLedgerTx,
  addJstCalendarDays,
  getCurrentDailyPeriodKey,
  getJstCalendarYmd,
  getJstDailyPeriodWindowBounds,
  isJstAtOrAfter2130,
  normBalance,
} from './userPointsStore.mjs';
import { sumRefundBpForTickets } from './raceBetPayout.mjs';
import { ticketCountForValidation } from './raceBetTickets.mjs';
import { resolveRaceHoldYmdForPurchaseItem } from './raceHoldDate.mjs';
import { inferNetkeibaOriginForPurchaseItem } from './netkeibaUrls.mjs';

/** Firestore: raceBets 複合インデックス (userId,raceId,status) / (userId,status) が初回クエリ時に案内されます */
const COLLECTION = 'raceBets';
const USER_POINTS = 'userPoints';

/**
 * 中央など: race_id 先頭8桁が YYYYMMDD の12桁帯（例 202603220405）
 * @param {string} ymd8 YYYYMMDD
 * @returns {{ start: string, end: string }} end は排他（翌日の下限）
 */
function raceIdRangeStringsForHoldYmd(ymd8) {
  const y = String(ymd8);
  return {
    start: `${y}0000`,
    end: `${addJstCalendarDays(y, 1)}0000`,
  };
}

/**
 * 地方(NAR): race_id は YYYY(4) + 場コード(2) + MMDD(4) + 通し(2) 例 202636032205
 * JRA 用の YYYYMMDD0000 範囲に入らないため別クエリが必要。
 * @param {string} ymd8 YYYYMMDD
 * @returns {{ start: string, end: string, mmdd: string }}
 */
function narRaceIdRangeStringsForHoldYmd(ymd8) {
  const y = String(ymd8);
  const yyyy = y.slice(0, 4);
  const mmdd = y.slice(4, 8);
  return {
    start: `${yyyy}00${mmdd}00`,
    end: `${yyyy}99${mmdd}99`,
    mmdd,
  };
}

/** NAR race_id の 7〜10 桁目が開催日の月日（MMDD）と一致するか */
function narRaceIdMatchesHoldYmd(raceId, mmdd) {
  const r = String(raceId || '');
  return /^\d{12}$/.test(r) && r.slice(6, 10) === mmdd;
}

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
    const origin = inferNetkeibaOriginForPurchaseItem({ ...it, raceId });
    const holdFromItem = resolveRaceHoldYmdForPurchaseItem({
      ...it,
      raceId,
      netkeibaOrigin: origin,
    });
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
      netkeibaOrigin: origin,
      horseNumToFrame: h2f,
      trifukuFormation,
      raceHoldYmd: holdFromItem,
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
      if (row.raceHoldYmd) docBody.raceHoldYmd = row.raceHoldYmd;
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
      const refund = sumRefundBpForTickets(d.tickets || [], payouts, unitYen, {
        excludedHorseNumbers: parsedResult?.excludedHorseNumbers || [],
        horseNumToFrame: d.horseNumToFrame || {},
        raceHorses: parsedResult?.horses || [],
      });
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
 * 開催日 JST（YYYYMMDD）で購入を取得。前日購入分も含む。
 * 複合インデックス: userId + raceHoldYmd / userId + raceId / userId + netkeibaOrigin + raceId
 * 中央: race_id の YYYYMMDD 帯 + raceHoldYmd。地方(NAR): YYYY+場+MMDD+通し のため別範囲 + MMDD 一致。
 */
export async function fetchUserRaceBetsForRaceHoldDateYmd(userId, ymd) {
  const uid = String(userId || '');
  if (!uid || !/^\d{8}$/.test(String(ymd))) return [];
  const ymdStr = String(ymd);
  const { start, end } = raceIdRangeStringsForHoldYmd(ymdStr);
  const narR = narRaceIdRangeStringsForHoldYmd(ymdStr);
  const db = getAdminFirestore();

  const [resHold, resRid, resNar] = await Promise.allSettled([
    db
      .collection(COLLECTION)
      .where('userId', '==', uid)
      .where('raceHoldYmd', '==', ymdStr)
      .get(),
    db
      .collection(COLLECTION)
      .where('userId', '==', uid)
      .where('raceId', '>=', start)
      .where('raceId', '<', end)
      .orderBy('raceId', 'asc')
      .get(),
    db
      .collection(COLLECTION)
      .where('userId', '==', uid)
      .where('netkeibaOrigin', '==', 'nar')
      .where('raceId', '>=', narR.start)
      .where('raceId', '<=', narR.end)
      .orderBy('raceId', 'asc')
      .get(),
  ]);
  if (resHold.status === 'rejected') {
    console.warn('raceBets fetch raceHoldYmd:', resHold.reason?.message || resHold.reason);
  }
  if (resRid.status === 'rejected') {
    console.warn('raceBets fetch raceId range:', resRid.reason?.message || resRid.reason);
  }
  if (resNar.status === 'rejected') {
    console.warn('raceBets fetch NAR raceId range:', resNar.reason?.message || resNar.reason);
  }
  const snapField = resHold.status === 'fulfilled' ? resHold.value : { docs: [] };
  const snapRaceIdDay = resRid.status === 'fulfilled' ? resRid.value : { docs: [] };
  const snapNar = resNar.status === 'fulfilled' ? resNar.value : { docs: [] };

  const byId = new Map();
  for (const d of snapField.docs) {
    const data = d.data();
    // raceHoldYmd == 開催日で取れている行は採用（race_id 先頭8桁が日付と一致しない表記でも除外しない）
    byId.set(d.id, { id: d.id, ...data });
  }
  for (const d of snapRaceIdDay.docs) {
    if (byId.has(d.id)) continue;
    const data = d.data();
    // race_id 先頭8桁がこの開催日（中央・origin 不問）
    byId.set(d.id, { id: d.id, ...data });
  }
  for (const d of snapNar.docs) {
    if (byId.has(d.id)) continue;
    const data = d.data();
    if (!narRaceIdMatchesHoldYmd(data.raceId, narR.mmdd)) continue;
    byId.set(d.id, { id: d.id, ...data });
  }

  const rows = [...byId.values()];
  rows.sort((a, b) => {
    const ra = String(a.raceId || '');
    const rb = String(b.raceId || '');
    if (ra !== rb) return ra.localeCompare(rb);
    const ta = a.purchasedAt?.toDate?.()?.getTime?.() ?? 0;
    const tb = b.purchasedAt?.toDate?.()?.getTime?.() ?? 0;
    return ta - tb;
  });
  return rows;
}

/**
 * 開催日 ymd に1件でも購入があるか（履歴のデフォルト日付切替用）
 */
export async function hasUserRaceBetsForRaceHoldDateYmd(userId, ymd) {
  const uid = String(userId || '');
  if (!uid || !/^\d{8}$/.test(String(ymd))) return false;
  const ymdStr = String(ymd);
  const { start, end } = raceIdRangeStringsForHoldYmd(ymdStr);
  const narR = narRaceIdRangeStringsForHoldYmd(ymdStr);
  const db = getAdminFirestore();
  const [resA, resB, resNar] = await Promise.allSettled([
    db
      .collection(COLLECTION)
      .where('userId', '==', uid)
      .where('raceHoldYmd', '==', ymdStr)
      .limit(40)
      .get(),
    db
      .collection(COLLECTION)
      .where('userId', '==', uid)
      .where('raceId', '>=', start)
      .where('raceId', '<', end)
      .orderBy('raceId', 'asc')
      .limit(1)
      .get(),
    db
      .collection(COLLECTION)
      .where('userId', '==', uid)
      .where('netkeibaOrigin', '==', 'nar')
      .where('raceId', '>=', narR.start)
      .where('raceId', '<=', narR.end)
      .orderBy('raceId', 'asc')
      .limit(80)
      .get(),
  ]);
  if (resA.status === 'rejected') {
    console.warn('has raceHoldYmd:', resA.reason?.message || resA.reason);
  }
  if (resB.status === 'rejected') {
    console.warn('has raceId range:', resB.reason?.message || resB.reason);
  }
  if (resNar.status === 'rejected') {
    console.warn('has NAR raceId range:', resNar.reason?.message || resNar.reason);
  }
  const a = resA.status === 'fulfilled' ? resA.value : { docs: [] };
  const b = resB.status === 'fulfilled' ? resB.value : { empty: true, docs: [] };
  const narSnap = resNar.status === 'fulfilled' ? resNar.value : { docs: [] };
  if (!b.empty) return true;
  if (a.docs.length) return true;
  for (const d of narSnap.docs) {
    if (narRaceIdMatchesHoldYmd(d.data()?.raceId, narR.mmdd)) return true;
  }
  return false;
}

/** 開催フィルタ時の逐日探索の上限 */
const MAX_HISTORY_DAY_SKIP_MEETING = 120;
/** 「すべて」: has と同一判定で空日をスキップ（JRA/NAR のインデックスマージは表示とずれるため使わない） */
const ADJACENT_DAY_BATCH = 7;
const ADJACENT_DAY_BATCH_COUNT = 18; // 7*18 = 126 >= MAX_HISTORY_DAY_SKIP_MEETING

/**
 * 開催日 ymd に、開催フィルタに一致する購入が1件でもあるか
 * @param {string} meetingFilter 'all' または race_id 先頭10桁
 */
async function holdDateHasMatchingBets(userId, ymd, meetingFilter) {
  const mf = String(meetingFilter || 'all').trim();
  if (mf === 'all') {
    return hasUserRaceBetsForRaceHoldDateYmd(userId, ymd);
  }
  if (!/^\d{10}$/.test(mf)) {
    return hasUserRaceBetsForRaceHoldDateYmd(userId, ymd);
  }
  const bets = await fetchUserRaceBetsForRaceHoldDateYmd(userId, ymd);
  return bets.some(
    (b) =>
      /^\d{12}$/.test(String(b.raceId || '')) &&
      String(b.raceId).slice(0, 10) === mf,
  );
}

/**
 * 「すべて」: 履歴一覧と同じ hasUserRaceBetsForRaceHoldDateYmd で日を進め、
 * 最初に購入がある日を返す（NAR のみの日・JRA のみの日の混在でも前後がずれない）。
 */
async function findAdjacentHoldYmdWithBetsAllByHas(userId, fromYmd, direction) {
  const uid = String(userId || '');
  let cursor = addJstCalendarDays(String(fromYmd), direction);
  for (let b = 0; b < ADJACENT_DAY_BATCH_COUNT; b++) {
    const days = [];
    for (let i = 0; i < ADJACENT_DAY_BATCH; i++) {
      days.push(addJstCalendarDays(cursor, i * direction));
    }
    const settled = await Promise.allSettled(
      days.map((d) => hasUserRaceBetsForRaceHoldDateYmd(uid, d)),
    );
    const hitIdx = settled.findIndex(
      (r) => r.status === 'fulfilled' && r.value === true,
    );
    if (hitIdx >= 0) return days[hitIdx];
    cursor = addJstCalendarDays(cursor, ADJACENT_DAY_BATCH * direction);
  }
  return null;
}

async function findAdjacentHoldYmdWithBetsSequential(
  userId,
  fromYmd,
  direction,
  meetingFilter,
  maxSteps = MAX_HISTORY_DAY_SKIP_MEETING,
) {
  const uid = String(userId || '');
  let ymd = addJstCalendarDays(String(fromYmd), direction);
  for (let i = 0; i < maxSteps; i++) {
    const ok = await holdDateHasMatchingBets(uid, ymd, meetingFilter);
    if (ok) return ymd;
    ymd = addJstCalendarDays(ymd, direction);
  }
  return null;
}

/**
 * 現在の開催日から前後に進み、購入がある最寄りの開催日（空の日はスキップ）
 * @param {string} userId
 * @param {string} fromYmd 表示中の開催日 YYYYMMDD
 * @param {-1 | 1} direction 前: -1 / 次: +1
 * @param {string} [meetingFilter] 'all' または先頭10桁（開催で絞っているときはその条件で判定）
 * @returns {Promise<string | null>}
 */
export async function findAdjacentHoldYmdWithBets(
  userId,
  fromYmd,
  direction,
  meetingFilter = 'all',
) {
  const uid = String(userId || '');
  if (!uid || !/^\d{8}$/.test(String(fromYmd))) return null;
  if (direction !== -1 && direction !== 1) return null;
  const mf = String(meetingFilter || 'all').trim();
  if (mf === 'all') {
    return findAdjacentHoldYmdWithBetsAllByHas(uid, fromYmd, direction);
  }
  return findAdjacentHoldYmdWithBetsSequential(uid, fromYmd, direction, mf);
}

/**
 * 購入履歴の初期表示日（開催日 JST）。
 * JST 21:30 以降かつ翌開催日の購入が1件でもあれば翌開催日、なければ当日。
 */
export async function resolveDefaultRaceHistoryHoldYmd(
  userId,
  now = new Date(),
) {
  const todayYmd = getJstCalendarYmd(now);
  const tomorrowYmd = addJstCalendarDays(todayYmd, 1);
  if (!isJstAtOrAfter2130(now)) return todayYmd;
  const [hasToday, hasTomorrow] = await Promise.all([
    hasUserRaceBetsForRaceHoldDateYmd(userId, todayYmd),
    hasUserRaceBetsForRaceHoldDateYmd(userId, tomorrowYmd),
  ]);
  if (hasToday) return todayYmd;
  if (hasTomorrow) return tomorrowYmd;
  return todayYmd;
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
