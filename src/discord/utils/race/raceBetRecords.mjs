import { Op } from 'sequelize';
import { randomUUID } from 'node:crypto';
import { sequelize, RaceBet, UserPoint } from '../db/models.mjs';
import { mapWithConcurrency } from '../../../utils/concurrency/mapWithConcurrency.mjs';
import {
  appendLedgerTransaction,
  addJstCalendarDays,
  getCurrentDailyPeriodKey,
  getJstCalendarYmd,
  getJstDailyPeriodWindowBounds,
  isJstAtOrAfter2130,
  normBalance,
} from '../user/userPointsStore.mjs';
import { sumRefundBpForTickets } from './raceBetPayout.mjs';
import { ticketCountForValidation } from './raceBetTickets.mjs';
import { resolveRaceHoldYmdForPurchaseItem } from './raceHoldDate.mjs';
import { inferNetkeibaOriginForPurchaseItem } from '../netkeiba/netkeibaUrls.mjs';

/**
 * 中央など: race_id 先頭8桁が YYYYMMDD の12桁帯（例 202603220405）
 * @param {string} ymd8 YYYYMMDD
 */
function raceIdRangeStringsForHoldYmd(ymd8) {
  const y = String(ymd8);
  return {
    start: `${y}0000`,
    end: `${addJstCalendarDays(y, 1)}0000`,
  };
}

/**
 * 地方(NAR): race_id は YYYY(4) + 場コード(2) + MMDD(4) + 通し(2)
 * @param {string} ymd8 YYYYMMDD
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

function narRaceIdMatchesHoldYmd(raceId, mmdd) {
  const r = String(raceId || '');
  return /^\d{12}$/.test(r) && r.slice(6, 10) === mmdd;
}

function betRowToLegacyDoc(row) {
  const p = row.get ? row.get({ plain: true }) : row;
  const purchasedAt = p.purchasedAt instanceof Date ? p.purchasedAt : null;
  const settledAt = p.settledAt instanceof Date ? p.settledAt : null;
  return {
    ...p,
    purchasedAt: purchasedAt
      ? { toDate: () => purchasedAt }
      : null,
    settledAt: settledAt ? { toDate: () => settledAt } : null,
  };
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
    const oddsTimeRaw =
      it.oddsOfficialTime != null && String(it.oddsOfficialTime).trim()
        ? String(it.oddsOfficialTime).replace(/\s+/g, ' ').trim().slice(0, 128)
        : '';
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
      jraMulti: it.jraMulti === true,
      jraMultiOffered: it.jraMultiOffered === true,
      pickCompact:
        it.pickCompact != null ? String(it.pickCompact).slice(0, 500) : '',
      oddsOfficialTime: oddsTimeRaw || null,
    });
  }

  const period = getCurrentDailyPeriodKey();

  return sequelize.transaction(async (t) => {
    const userRow = await UserPoint.findByPk(userId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    const balance = normBalance(userRow?.get('balance'));
    if (balance < total) {
      return { ok: false, reason: 'insufficient', balance, need: total };
    }
    const newBal = balance - total;
    await UserPoint.upsert(
      {
        userId,
        balance: newBal,
        firstDailyDone: userRow?.get('firstDailyDone') ?? false,
        lastDailyPeriodKey: userRow?.get('lastDailyPeriodKey') ?? null,
        dailyStreakDay: userRow?.get('dailyStreakDay') ?? null,
      },
      { transaction: t },
    );
    await appendLedgerTransaction(t, userId, {
      delta: -total,
      balanceAfter: newBal,
      kind: 'race_bet',
      period,
    });

    const now = new Date();
    for (const row of normalized) {
      const id = randomUUID();
      const body = {
        id,
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
        purchasedAt: now,
        settledAt: null,
      };
      if (row.trifukuFormation) body.trifukuFormation = row.trifukuFormation;
      if (row.venueTitle) body.venueTitle = row.venueTitle;
      if (row.raceHoldYmd) body.raceHoldYmd = row.raceHoldYmd;
      body.jraMulti = !!row.jraMulti;
      body.jraMultiOffered = !!row.jraMultiOffered;
      body.pickCompact = row.pickCompact != null ? String(row.pickCompact).slice(0, 500) : '';
      if (row.oddsOfficialTime) {
        body.oddsOfficialTime = String(row.oddsOfficialTime).slice(0, 128);
      }
      await RaceBet.create(body, { transaction: t });
    }

    return { ok: true, balance: newBal, spent: total, count: normalized.length };
  });
}

/**
 * @param {string} userId
 * @param {string} raceId
 * @param {{ payouts?: object[] }} parsedResult scrapeRaceResult の戻り
 * @returns {Promise<{ settled: number, totalRefund: number, reconcileBalanceDelta: number, balance: number | null }>}
 */
export async function settleOpenRaceBetsForUser(userId, raceId, parsedResult) {
  const rid = String(raceId || '');
  if (!/^\d{12}$/.test(rid)) {
    return {
      settled: 0,
      totalRefund: 0,
      reconcileBalanceDelta: 0,
      balance: null,
    };
  }

  const payouts = parsedResult?.payouts || [];
  const period = getCurrentDailyPeriodKey();
  const passBaseOpts = {
    excludedHorseNumbers: parsedResult?.excludedHorseNumbers || [],
    raceHorses: parsedResult?.horses || [],
  };

  return sequelize.transaction(async (t) => {
    const userRow = await UserPoint.findByPk(userId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    const openBets = await RaceBet.findAll({
      where: { userId, raceId: rid, status: 'open' },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    let totalRefund = 0;
    let settled = 0;
    const now = new Date();
    for (const doc of openBets) {
      const d = doc.get({ plain: true });
      const unitYen = Math.max(1, Math.round(Number(d.unitYen) || 100));
      const refund = sumRefundBpForTickets(d.tickets || [], payouts, unitYen, {
        ...passBaseOpts,
        horseNumToFrame: d.horseNumToFrame || {},
      });
      const [affected] = await RaceBet.update(
        {
          status: 'settled',
          refundBp: refund,
          settledAt: now,
        },
        {
          where: { id: d.id, userId, raceId: rid, status: 'open' },
          transaction: t,
        },
      );
      if (affected === 1) {
        settled += 1;
        totalRefund += refund;
      }
    }

    const settledRows = await RaceBet.findAll({
      where: { userId, raceId: rid, status: 'settled' },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    let reconcileBalanceDelta = 0;
    for (const doc of settledRows) {
      const d = doc.get({ plain: true });
      const unitYen = Math.max(1, Math.round(Number(d.unitYen) || 100));
      const newRefund = sumRefundBpForTickets(d.tickets || [], payouts, unitYen, {
        ...passBaseOpts,
        horseNumToFrame: d.horseNumToFrame || {},
      });
      const oldRefund = Math.max(0, Math.round(Number(d.refundBp) || 0));
      if (newRefund === oldRefund) continue;
      const [affected] = await RaceBet.update(
        { refundBp: newRefund },
        {
          where: {
            id: d.id,
            userId,
            raceId: rid,
            status: 'settled',
            refundBp: oldRefund,
          },
          transaction: t,
        },
      );
      if (affected === 1) {
        reconcileBalanceDelta += newRefund - oldRefund;
      }
    }

    const balance = normBalance(userRow?.get('balance'));
    const newBal = balance + totalRefund + reconcileBalanceDelta;

    if (totalRefund === 0 && reconcileBalanceDelta === 0) {
      return {
        settled,
        totalRefund,
        reconcileBalanceDelta,
        balance,
      };
    }

    let ledgerBal = balance;
    if (totalRefund > 0) {
      ledgerBal += totalRefund;
      await appendLedgerTransaction(t, userId, {
        delta: totalRefund,
        balanceAfter: ledgerBal,
        kind: 'race_refund',
        period,
      });
    }
    if (reconcileBalanceDelta !== 0) {
      ledgerBal += reconcileBalanceDelta;
      await appendLedgerTransaction(t, userId, {
        delta: reconcileBalanceDelta,
        balanceAfter: ledgerBal,
        kind: 'race_refund_adjust',
        period,
      });
    }

    await UserPoint.upsert(
      {
        userId,
        balance: newBal,
        firstDailyDone: userRow?.get('firstDailyDone') ?? false,
        lastDailyPeriodKey: userRow?.get('lastDailyPeriodKey') ?? null,
        dailyStreakDay: userRow?.get('dailyStreakDay') ?? null,
      },
      { transaction: t },
    );

    return {
      settled,
      totalRefund,
      reconcileBalanceDelta,
      balance: newBal,
    };
  });
}

/**
 * 未精算の精算に加え、精算済みレースは買い目・払戻の差分があれば refundBp と残高を調整する。
 * 1 回あたり最大 maxRaces 件の raceId（未精算と精算済みの和集合、開催日の新しい順）。
 */
export async function settlePendingOpenRaceBetsForUser(userId, scrapeRaceResult, opts = {}) {
  const uid = String(userId || '');
  if (!uid || typeof scrapeRaceResult !== 'function') {
    return {
      raceIdsProcessed: 0,
      settledBets: 0,
      totalRefund: 0,
      reconcileBalanceDelta: 0,
      balance: null,
      skippedNoResult: 0,
    };
  }

  const maxRaces = Math.max(1, Math.min(50, Math.round(Number(opts.maxRaces) || 12)));
  const [openRows, settledRows] = await Promise.all([
    RaceBet.findAll({
      where: { userId: uid, status: 'open' },
      attributes: ['raceId'],
    }),
    RaceBet.findAll({
      where: { userId: uid, status: 'settled' },
      attributes: ['raceId'],
    }),
  ]);

  const openRaceIdSet = new Set();
  for (const r of openRows) {
    const rid = String(r.get('raceId') || '');
    if (/^\d{12}$/.test(rid)) openRaceIdSet.add(rid);
  }
  const settledRaceIdSet = new Set();
  for (const r of settledRows) {
    const rid = String(r.get('raceId') || '');
    if (/^\d{12}$/.test(rid)) settledRaceIdSet.add(rid);
  }
  const raceIdSet = new Set([...openRaceIdSet, ...settledRaceIdSet]);

  if (!raceIdSet.size) {
    const uRow = await UserPoint.findByPk(uid);
    return {
      raceIdsProcessed: 0,
      settledBets: 0,
      totalRefund: 0,
      reconcileBalanceDelta: 0,
      balance: normBalance(uRow?.get('balance')),
      skippedNoResult: 0,
    };
  }

  /** 未精算は古い raceId 優先。精算のみのレースは新しい順で再計算枠に回す。 */
  const openSorted = [...openRaceIdSet].sort((a, b) => a.localeCompare(b));
  const settledOnlySorted = [...settledRaceIdSet]
    .filter((id) => !openRaceIdSet.has(id))
    .sort((a, b) => b.localeCompare(a));
  const toProcess = [...openSorted, ...settledOnlySorted].slice(0, maxRaces);

  let settledBets = 0;
  let totalRefund = 0;
  let reconcileBalanceDelta = 0;
  let skippedNoResult = 0;
  /** @type {number | null} */
  let balance = null;

  const SETTLE_SCRAPE_CONCURRENCY = 3;
  const scrapeResults = await mapWithConcurrency(
    toProcess,
    SETTLE_SCRAPE_CONCURRENCY,
    async (raceId) => {
      try {
        const parsed = await scrapeRaceResult(raceId);
        return { raceId, parsed, scrapeErr: null };
      } catch (_) {
        return { raceId, parsed: null, scrapeErr: true };
      }
    },
  );

  for (const { raceId, parsed, scrapeErr } of scrapeResults) {
    if (scrapeErr || !parsed?.confirmed) {
      skippedNoResult += 1;
      continue;
    }
    try {
      const pay = await settleOpenRaceBetsForUser(uid, raceId, parsed);
      settledBets += pay.settled;
      totalRefund += pay.totalRefund;
      reconcileBalanceDelta += pay.reconcileBalanceDelta || 0;
      if (pay.balance != null) balance = pay.balance;
    } catch (_) {
      skippedNoResult += 1;
    }
  }

  if (balance == null) {
    const uRow = await UserPoint.findByPk(uid);
    balance = normBalance(uRow?.get('balance'));
  }

  return {
    raceIdsProcessed: toProcess.length,
    settledBets,
    totalRefund,
    reconcileBalanceDelta,
    balance,
    skippedNoResult,
  };
}

/**
 * 指定ユーザーの競馬購入を日次帯（JST 8:00〜翌 8:00）で取得（購入時刻順）
 */
export async function fetchUserRaceBetsForDailyPeriod(
  userId,
  periodKey = getCurrentDailyPeriodKey(),
) {
  const { start, end } = getJstDailyPeriodWindowBounds(periodKey);
  const rows = await RaceBet.findAll({
    where: {
      userId,
      purchasedAt: {
        [Op.gte]: start,
        [Op.lt]: end,
      },
    },
    order: [['purchasedAt', 'ASC']],
  });
  return rows.map((r) => ({
    id: r.get('id'),
    ...r.get({ plain: true }),
  }));
}

/**
 * 開催日 JST（YYYYMMDD）で購入を取得。前日購入分も含む。
 */
export async function fetchUserRaceBetsForRaceHoldDateYmd(userId, ymd) {
  const uid = String(userId || '');
  if (!uid || !/^\d{8}$/.test(String(ymd))) return [];
  const ymdStr = String(ymd);
  const { start, end } = raceIdRangeStringsForHoldYmd(ymdStr);
  const narR = narRaceIdRangeStringsForHoldYmd(ymdStr);

  const [resHold, resRid, resNar] = await Promise.allSettled([
    RaceBet.findAll({ where: { userId: uid, raceHoldYmd: ymdStr } }),
    RaceBet.findAll({
      where: {
        userId: uid,
        raceId: { [Op.gte]: start, [Op.lt]: end },
      },
      order: [['raceId', 'ASC']],
    }),
    RaceBet.findAll({
      where: {
        userId: uid,
        netkeibaOrigin: 'nar',
        raceId: { [Op.gte]: narR.start, [Op.lte]: narR.end },
      },
      order: [['raceId', 'ASC']],
    }),
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
  const snapField = resHold.status === 'fulfilled' ? resHold.value : [];
  const snapRaceIdDay = resRid.status === 'fulfilled' ? resRid.value : [];
  const snapNar = resNar.status === 'fulfilled' ? resNar.value : [];

  const byId = new Map();
  for (const r of snapField) {
    const p = r.get({ plain: true });
    byId.set(p.id, { id: p.id, ...p });
  }
  for (const r of snapRaceIdDay) {
    const p = r.get({ plain: true });
    if (byId.has(p.id)) continue;
    byId.set(p.id, { id: p.id, ...p });
  }
  for (const r of snapNar) {
    const p = r.get({ plain: true });
    if (byId.has(p.id)) continue;
    if (!narRaceIdMatchesHoldYmd(p.raceId, narR.mmdd)) continue;
    byId.set(p.id, { id: p.id, ...p });
  }

  const rows = [...byId.values()];
  rows.sort((a, b) => {
    const ra = String(a.raceId || '');
    const rb = String(b.raceId || '');
    if (ra !== rb) return ra.localeCompare(rb);
    const ta =
      a.purchasedAt instanceof Date ? a.purchasedAt.getTime() : 0;
    const tb =
      b.purchasedAt instanceof Date ? b.purchasedAt.getTime() : 0;
    return ta - tb;
  });
  return rows.map((row) => betRowToLegacyDoc(row));
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

  const [resA, resB, resNar] = await Promise.allSettled([
    RaceBet.findAll({
      where: { userId: uid, raceHoldYmd: ymdStr },
      limit: 40,
    }),
    RaceBet.findOne({
      where: {
        userId: uid,
        raceId: { [Op.gte]: start, [Op.lt]: end },
      },
      order: [['raceId', 'ASC']],
    }),
    RaceBet.findAll({
      where: {
        userId: uid,
        netkeibaOrigin: 'nar',
        raceId: { [Op.gte]: narR.start, [Op.lte]: narR.end },
      },
      order: [['raceId', 'ASC']],
      limit: 80,
    }),
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
  const a = resA.status === 'fulfilled' ? resA.value : [];
  const b = resB.status === 'fulfilled' ? resB.value : null;
  const narSnap = resNar.status === 'fulfilled' ? resNar.value : [];
  if (b) return true;
  if (a.length) return true;
  for (const d of narSnap) {
    if (narRaceIdMatchesHoldYmd(d.get('raceId'), narR.mmdd)) return true;
  }
  return false;
}

/** 開催フィルタ時の逐日探索の上限 */
const MAX_HISTORY_DAY_SKIP_MEETING = 120;
const ADJACENT_DAY_BATCH = 7;
const ADJACENT_DAY_BATCH_COUNT = 18;

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
 * @typedef {object} RaceBetAggregates
 * @property {number} purchaseCount
 * @property {number} totalCostBp
 * @property {number} maxCostBp
 * @property {Date | null} firstPurchasedAt
 * @property {number} settledCount
 * @property {number} hitCount
 * @property {number | null} maxRecoveryRate
 * @property {number | null} minRecoveryRate
 * @property {number} totalRefundBpSettled
 * @property {number} totalCostBpSettled
 * @property {number | null} totalRecoveryRate 精算済み合計: 払戻合計 ÷ 購入合計
 */

function createEmptyMutableRaceBetAggregates() {
  return {
    purchaseCount: 0,
    totalCostBp: 0,
    maxCostBp: 0,
    /** @type {Date | null} */
    firstPurchasedAt: null,
    settledCount: 0,
    hitCount: 0,
    /** @type {number | null} */
    maxRecoveryRate: null,
    /** @type {number | null} */
    minRecoveryRate: null,
    totalRefundBpSettled: 0,
    totalCostBpSettled: 0,
  };
}

function purchasedAtToDate(d) {
  const v = d.purchasedAt;
  if (v instanceof Date) return v;
  if (v && typeof v.toDate === 'function') {
    const x = v.toDate();
    return x instanceof Date && !Number.isNaN(x.getTime()) ? x : null;
  }
  return null;
}

/**
 * @param {ReturnType<typeof createEmptyMutableRaceBetAggregates>} agg
 * @param {object} d
 */
function accumulateRaceBetDoc(agg, d) {
  agg.purchaseCount += 1;
  const cost = Math.max(0, Math.round(Number(d.costBp) || 0));
  agg.totalCostBp += cost;
  if (cost > agg.maxCostBp) agg.maxCostBp = cost;
  const at = purchasedAtToDate(d);
  if (at instanceof Date && !Number.isNaN(at.getTime())) {
    if (!agg.firstPurchasedAt || at < agg.firstPurchasedAt) {
      agg.firstPurchasedAt = at;
    }
  }
  if (String(d.status || '') === 'settled' && cost > 0) {
    agg.settledCount += 1;
    const refund = Math.max(0, Math.round(Number(d.refundBp) || 0));
    agg.totalRefundBpSettled += refund;
    agg.totalCostBpSettled += cost;
    const ratio = refund / cost;
    if (agg.maxRecoveryRate == null || ratio > agg.maxRecoveryRate) {
      agg.maxRecoveryRate = ratio;
    }
    if (agg.minRecoveryRate == null || ratio < agg.minRecoveryRate) {
      agg.minRecoveryRate = ratio;
    }
    if (refund > 0) agg.hitCount += 1;
  }
}

/**
 * @param {ReturnType<typeof createEmptyMutableRaceBetAggregates>} agg
 * @returns {RaceBetAggregates}
 */
function finalizeRaceBetAggregates(agg) {
  const totalRecoveryRate =
    agg.totalCostBpSettled > 0
      ? agg.totalRefundBpSettled / agg.totalCostBpSettled
      : null;
  return {
    purchaseCount: agg.purchaseCount,
    totalCostBp: agg.totalCostBp,
    maxCostBp: agg.maxCostBp,
    firstPurchasedAt: agg.firstPurchasedAt,
    settledCount: agg.settledCount,
    hitCount: agg.hitCount,
    maxRecoveryRate: agg.maxRecoveryRate,
    minRecoveryRate: agg.minRecoveryRate,
    totalRefundBpSettled: agg.totalRefundBpSettled,
    totalCostBpSettled: agg.totalCostBpSettled,
    totalRecoveryRate,
  };
}

/** @returns {RaceBetAggregates} */
export function emptyRaceBetAggregates() {
  return finalizeRaceBetAggregates(createEmptyMutableRaceBetAggregates());
}

/**
 * 全ユーザーの競馬購入集計（race_bets 全件を1回スキャン）
 * @returns {Promise<Map<string, RaceBetAggregates>>}
 */
export async function fetchAllRaceBetAggregatesByUserId() {
  const rows = await RaceBet.findAll();
  /** @type {Map<string, ReturnType<typeof createEmptyMutableRaceBetAggregates>>} */
  const mut = new Map();
  for (const doc of rows) {
    const d = doc.get({ plain: true });
    const uid = String(d.userId || '');
    if (!uid) continue;
    let agg = mut.get(uid);
    if (!agg) {
      agg = createEmptyMutableRaceBetAggregates();
      mut.set(uid, agg);
    }
    accumulateRaceBetDoc(agg, d);
  }
  /** @type {Map<string, RaceBetAggregates>} */
  const out = new Map();
  for (const [uid, a] of mut) {
    out.set(uid, finalizeRaceBetAggregates(a));
  }
  return out;
}

/**
 * ユーザーの競馬購入の集計（回収率は精算済みレコードのみ）
 */
export async function fetchUserRaceBetAggregates(userId) {
  const uid = String(userId || '');
  if (!uid) {
    return emptyRaceBetAggregates();
  }

  const rows = await RaceBet.findAll({ where: { userId: uid } });
  const agg = createEmptyMutableRaceBetAggregates();
  for (const doc of rows) {
    accumulateRaceBetDoc(agg, doc.get({ plain: true }));
  }
  return finalizeRaceBetAggregates(agg);
}

/**
 * 購入時刻が [start, end) に入る馬券のみ（精算状況は問わない）
 * @param {string} userId
 * @param {Date} start
 * @param {Date} end
 */
export async function fetchUserRaceBetsPurchasedBetween(userId, start, end) {
  const uid = String(userId || '');
  if (!uid) return [];
  return RaceBet.findAll({
    where: {
      userId: uid,
      purchasedAt: {
        [Op.gte]: start,
        [Op.lt]: end,
      },
    },
    order: [['purchasedAt', 'ASC']],
  });
}
