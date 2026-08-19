import { Op } from 'sequelize';
import { fetchWinnerResult } from '../../../scrapers/winner/winnerResult.mjs';
import { sequelize, LotteryBet, UserPoint } from '../db/models.mjs';
import {
  appendLedgerTransaction,
  getCurrentDailyPeriodKey,
  normBalance,
} from '../user/userPointsStore.mjs';
import { WINNER_UNIT_BP } from './winnerBetRecords.mjs';

const refundSweepTailByUserId = new Map();

function resultKey(result) {
  if (!result?.confirmed) return null;
  return `${result.winningOutcome}:${result.winningScorePick}`;
}

function betKey(row) {
  return `${row.outcome}:${row.scorePick}`;
}

function calcRefundBp(row, result) {
  if (resultKey(result) !== betKey(row)) return 0;
  const stakeCount = Math.max(1, Math.round(Number(row.stakeCount) || 1));
  const officialMultiplier = Number(result.multiplier);
  const savedOdds = Number(row.odds);
  const multiplier =
    Number.isFinite(officialMultiplier) && officialMultiplier > 0
      ? officialMultiplier
      : Number.isFinite(savedOdds) && savedOdds > 0
        ? savedOdds
        : 0;
  if (multiplier <= 0) return 0;
  return Math.max(0, Math.round(stakeCount * WINNER_UNIT_BP * multiplier));
}

async function settleOpenWinnerBetsForKey(userId, commodityId, holdCntId, result) {
  if (!result?.confirmed || result.payoutReady === false) {
    return { settled: 0, totalRefund: 0, balance: null };
  }
  const period = getCurrentDailyPeriodKey();
  return sequelize.transaction(async (t) => {
    const userRow = await UserPoint.findByPk(userId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    const rows = await LotteryBet.findAll({
      where: { userId, commodityId, holdCntId, status: 'open' },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    let settled = 0;
    let totalRefund = 0;
    const now = new Date();
    for (const doc of rows) {
      const row = doc.get({ plain: true });
      const refundBp = calcRefundBp(row, result);
      const [affected] = await LotteryBet.update(
        { status: 'settled', refundBp, settledAt: now },
        {
          where: { id: row.id, userId, status: 'open' },
          transaction: t,
        },
      );
      if (affected === 1) {
        settled += 1;
        totalRefund += refundBp;
      }
    }

    const balance = normBalance(userRow?.get('balance'));
    if (totalRefund <= 0) {
      return { settled, totalRefund, balance };
    }

    const newBal = balance + totalRefund;
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
      delta: totalRefund,
      balanceAfter: newBal,
      kind: 'winner_refund',
      period,
    });
    return { settled, totalRefund, balance: newBal };
  });
}

export async function settlePendingOpenWinnerBetsForUser(userId, opts = {}) {
  const uid = String(userId || '');
  if (!uid) {
    return { resultIdsProcessed: 0, settledBets: 0, totalRefund: 0, balance: null, skippedNoResult: 0 };
  }
  const maxResults = Math.max(1, Math.min(50, Math.round(Number(opts.maxResults) || 12)));
  const rows = await LotteryBet.findAll({
    where: {
      userId: uid,
      status: 'open',
      commodityId: { [Op.ne]: '' },
      holdCntId: { [Op.ne]: '' },
    },
    attributes: ['commodityId', 'holdCntId'],
  });

  const keys = [];
  const seen = new Set();
  for (const row of rows) {
    const commodityId = String(row.get('commodityId') || '');
    const holdCntId = String(row.get('holdCntId') || '');
    const key = `${commodityId}|${holdCntId}`;
    if (!commodityId || !holdCntId || seen.has(key)) continue;
    seen.add(key);
    keys.push({ commodityId, holdCntId });
  }

  if (!keys.length) {
    const userRow = await UserPoint.findByPk(uid);
    return {
      resultIdsProcessed: 0,
      settledBets: 0,
      totalRefund: 0,
      balance: normBalance(userRow?.get('balance')),
      skippedNoResult: 0,
    };
  }

  let settledBets = 0;
  let totalRefund = 0;
  let skippedNoResult = 0;
  let balance = null;

  for (const key of keys.slice(0, maxResults)) {
    try {
      const result = await fetchWinnerResult(key);
      if (!result?.confirmed || result.payoutReady === false) {
        skippedNoResult += 1;
        continue;
      }
      const settled = await settleOpenWinnerBetsForKey(
        uid,
        key.commodityId,
        key.holdCntId,
        result,
      );
      settledBets += settled.settled;
      totalRefund += settled.totalRefund;
      if (settled.balance != null) balance = settled.balance;
    } catch (_) {
      skippedNoResult += 1;
    }
  }

  if (balance == null) {
    const userRow = await UserPoint.findByPk(uid);
    balance = normBalance(userRow?.get('balance'));
  }
  return {
    resultIdsProcessed: Math.min(keys.length, maxResults),
    settledBets,
    totalRefund,
    balance,
    skippedNoResult,
  };
}

export async function runPendingWinnerRefundsForUser(userId) {
  const uid = String(userId || '');
  if (!uid) return;
  const prev = refundSweepTailByUserId.get(uid) ?? Promise.resolve();
  const run = async () => {
    try {
      await settlePendingOpenWinnerBetsForUser(uid);
    } catch (e) {
      console.warn('runPendingWinnerRefundsForUser', e);
    }
  };
  const next = prev.catch(() => {}).then(() => run());
  refundSweepTailByUserId.set(uid, next);
  try {
    await next;
  } finally {
    if (refundSweepTailByUserId.get(uid) === next) {
      refundSweepTailByUserId.delete(uid);
    }
  }
}
