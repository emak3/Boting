import { randomUUID } from 'node:crypto';
import { sequelize, LotteryBet, UserPoint } from '../db/models.mjs';
import {
  appendLedgerTransaction,
  getCurrentDailyPeriodKey,
  normBalance,
} from '../user/userPointsStore.mjs';
import { isWinnerMatchClosed } from '../../../scrapers/winner/winnerSchedule.mjs';

export const WINNER_UNIT_BP = Math.max(
  1,
  Math.round(Number(process.env.WINNER_UNIT_BP || process.env.LOTTERY_UNIT_BP || 200) || 200),
);

export async function tryConfirmWinnerPurchase(userId, items) {
  const uid = String(userId || '');
  const list = Array.isArray(items) ? items : [items].filter(Boolean);
  if (!list.length) return { ok: false, reason: 'empty' };

  let total = 0;
  let stakes = 0;
  const normalized = [];
  for (const item of list) {
    const stakeCount = Math.max(1, Math.round(Number(item?.stakeCount) || 1));
    const costBp = stakeCount * WINNER_UNIT_BP;
    if (!uid || !item?.matchId || !item?.homeTeam || !item?.awayTeam || !item?.outcome || !item?.scorePick) {
      return { ok: false, reason: 'bad_item' };
    }
    if (isWinnerMatchClosed(item)) {
      return { ok: false, reason: 'closed', matchId: item.matchId };
    }
    total += costBp;
    stakes += stakeCount;
    normalized.push({ ...item, stakeCount, costBp });
  }

  const period = getCurrentDailyPeriodKey();
  return sequelize.transaction(async (t) => {
    const userRow = await UserPoint.findByPk(uid, {
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
        userId: uid,
        balance: newBal,
        firstDailyDone: userRow?.get('firstDailyDone') ?? false,
        lastDailyPeriodKey: userRow?.get('lastDailyPeriodKey') ?? null,
        dailyStreakDay: userRow?.get('dailyStreakDay') ?? null,
      },
      { transaction: t },
    );
    await appendLedgerTransaction(t, uid, {
      delta: -total,
      balanceAfter: newBal,
      kind: 'winner_bet',
      period,
    });
    const purchasedAt = new Date();
    const ids = [];
    for (const item of normalized) {
      const id = randomUUID();
      ids.push(id);
      await LotteryBet.create(
        {
          id,
          userId: uid,
          matchId: String(item.matchId).slice(0, 40),
          commodityId: String(item.commodityId || '').slice(0, 16),
          holdCntId: String(item.holdCntId || '').slice(0, 16),
          league: String(item.league || '').slice(0, 64),
          round: String(item.round || '').slice(0, 64),
          matchDate: String(item.matchDate || '').slice(0, 16),
          kickOff: String(item.kickOff || '').slice(0, 16),
          venue: String(item.venue || '').slice(0, 64),
          homeTeam: String(item.homeTeam).slice(0, 80),
          awayTeam: String(item.awayTeam).slice(0, 80),
          outcome: String(item.outcome).slice(0, 16),
          scorePick: String(item.scorePick).slice(0, 32),
          selectionLine: String(item.selectionLine || '').slice(0, 256),
          odds: Number.isFinite(Number(item.odds)) ? Number(item.odds) : null,
          stakeCount: item.stakeCount,
          costBp: item.costBp,
          source: String(item.source || 'toto_winner').slice(0, 32),
          status: 'open',
          refundBp: 0,
          purchasedAt,
          settledAt: null,
        },
        { transaction: t },
      );
    }
    return { ok: true, ids, balance: newBal, spent: total, count: normalized.length, stakes };
  });
}
