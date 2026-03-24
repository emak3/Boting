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
  };
}
