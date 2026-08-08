import { Op } from 'sequelize';
import { RaceBet } from '../db/models.mjs';
import {
  getJstCalendarYear,
  jstYearPurchasedAtBounds,
} from './jstCalendar.mjs';
import {
  computeRaceBetRangeStats,
  topBetTypes,
} from './raceBetRangeStats.mjs';

function jstMonthIndex(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).getUTCMonth();
}

function emptyMonth(i) {
  return {
    month: i + 1,
    purchaseCount: 0,
    totalCostBp: 0,
    settledCount: 0,
    hitCount: 0,
    totalCostSettled: 0,
    totalRefundSettled: 0,
    recoveryRate: null,
    hitRate: null,
  };
}

function monthlyStats(plainRows) {
  const months = Array.from({ length: 12 }, (_, i) => emptyMonth(i));
  for (const row of plainRows) {
    const i = jstMonthIndex(row.purchasedAt);
    if (i == null || i < 0 || i >= months.length) continue;
    const month = months[i];
    const cost = Math.max(0, Math.round(Number(row.costBp) || 0));
    month.purchaseCount += 1;
    month.totalCostBp += cost;
    if (String(row.status || '') === 'settled' && cost > 0) {
      const refund = Math.max(0, Math.round(Number(row.refundBp) || 0));
      month.settledCount += 1;
      month.totalCostSettled += cost;
      month.totalRefundSettled += refund;
      if (refund > 0) month.hitCount += 1;
    }
  }
  return months.map((month) => ({
    ...month,
    recoveryRate:
      month.totalCostSettled > 0 ? month.totalRefundSettled / month.totalCostSettled : null,
    hitRate: month.settledCount > 0 ? month.hitCount / month.settledCount : null,
  }));
}

/**
 * JST 暦年・購入時刻ベースの年間スタッツ（その年に購入した馬券のみ）
 * @param {string} userId
 * @param {number} [year] 省略時は JST 現在年
 */
export async function fetchUserAnnualRaceStats(userId, year) {
  const uid = String(userId || '');
  const y =
    year != null && Number.isFinite(Number(year))
      ? Math.trunc(Number(year))
      : getJstCalendarYear();
  if (!uid) {
    return {
      year: y,
      ...emptyAnnual(),
    };
  }

  const { start, end } = jstYearPurchasedAtBounds(y);
  const rows = await RaceBet.findAll({
    where: {
      userId: uid,
      purchasedAt: {
        [Op.gte]: start,
        [Op.lt]: end,
      },
    },
    order: [['purchasedAt', 'ASC']],
  });
  const plain = rows.map((r) => r.get({ plain: true }));
  const st = computeRaceBetRangeStats(plain);
  const top3 = topBetTypes(st.byBetType, 3);

  return {
    year: y,
    purchaseCount: st.purchaseCount,
    totalCostBp: st.totalCostBp,
    totalRefundSettled: st.totalRefundSettled,
    settledCount: st.settledCount,
    hitCount: st.hitCount,
    hitRate: st.hitRate,
    recoveryRate: st.recoveryRate,
    maxConsecutiveMisses: st.maxConsecutiveMisses,
    topBetTypes: top3,
    monthly: monthlyStats(plain),
  };
}

function emptyAnnual() {
  return {
    purchaseCount: 0,
    totalCostBp: 0,
    totalRefundSettled: 0,
    settledCount: 0,
    hitCount: 0,
    hitRate: null,
    recoveryRate: null,
    maxConsecutiveMisses: 0,
    topBetTypes: [],
    monthly: Array.from({ length: 12 }, (_, i) => emptyMonth(i)),
  };
}
