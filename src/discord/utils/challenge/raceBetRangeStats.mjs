/**
 * `purchasedAt` が期間内の race_bets 行（plain）から集計する。
 * 的中率・回収率は **精算済み** のみを母集団とする。
 * @param {object[]} plainRows
 */
export function computeRaceBetRangeStats(plainRows) {
  /** @type {Map<string, number>} */
  const byType = new Map();
  let purchaseCount = 0;
  let totalCostBp = 0;
  let settledCount = 0;
  let hitCount = 0;
  let totalRefundSettled = 0;
  let totalCostSettled = 0;
  const settledForStreak = [];

  for (const d of plainRows) {
    purchaseCount += 1;
    const cost = Math.max(0, Math.round(Number(d.costBp) || 0));
    totalCostBp += cost;
    const bt = String(d.betType || '').trim() || '（券種不明）';
    byType.set(bt, (byType.get(bt) || 0) + 1);

    if (String(d.status || '') === 'settled' && cost > 0) {
      const refund = Math.max(0, Math.round(Number(d.refundBp) || 0));
      settledCount += 1;
      totalRefundSettled += refund;
      totalCostSettled += cost;
      if (refund > 0) hitCount += 1;
      settledForStreak.push({
        purchasedAt: d.purchasedAt,
        refundBp: refund,
        costBp: cost,
      });
    }
  }

  settledForStreak.sort((a, b) => {
    const ta = a.purchasedAt instanceof Date ? a.purchasedAt.getTime() : 0;
    const tb = b.purchasedAt instanceof Date ? b.purchasedAt.getTime() : 0;
    return ta - tb;
  });

  let maxMiss = 0;
  let curMiss = 0;
  for (const s of settledForStreak) {
    if (s.refundBp > 0) {
      curMiss = 0;
    } else {
      curMiss += 1;
      if (curMiss > maxMiss) maxMiss = curMiss;
    }
  }

  const recoveryRate =
    totalCostSettled > 0 ? totalRefundSettled / totalCostSettled : null;
  const hitRate = settledCount > 0 ? hitCount / settledCount : null;

  return {
    purchaseCount,
    totalCostBp,
    settledCount,
    hitCount,
    totalRefundSettled,
    totalCostSettled,
    recoveryRate,
    hitRate,
    maxConsecutiveMisses: maxMiss,
    byBetType: byType,
  };
}

/**
 * @param {Map<string, number>} byTypeMap
 * @param {number} n
 * @returns {Array<[string, number]>}
 */
export function topBetTypes(byTypeMap, n = 3) {
  return [...byTypeMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}
