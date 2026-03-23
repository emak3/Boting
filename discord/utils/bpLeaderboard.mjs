import { UserPoint } from './db/models.mjs';
import { normBalance } from './userPointsStore.mjs';

/**
 * balance 降順の全ユーザーを取得（同一残高は userId 昇順で安定）
 * @returns {Promise<Array<{ userId: string, balance: number }>>}
 */
export async function fetchAllUsersByBalanceDesc() {
  const rows = await UserPoint.findAll({
    order: [
      ['balance', 'DESC'],
      ['userId', 'ASC'],
    ],
  });
  const out = rows.map((r) => ({
    userId: r.get('userId'),
    balance: normBalance(r.get('balance')),
  }));
  out.sort((a, b) => b.balance - a.balance || a.userId.localeCompare(b.userId));
  return out;
}

/**
 * 同率は同順位（例: 1,2,2,4）
 * @param {Array<{ userId: string, balance: number }>} sortedDesc fetchAllUsersByBalanceDesc の戻り
 * @param {string} userId
 * @returns {{ rank: number | null, balance: number, totalUsers: number }}
 */
export function computeBpRank(sortedDesc, userId) {
  const uid = String(userId || '');
  const totalUsers = sortedDesc.length;
  const row = sortedDesc.find((r) => r.userId === uid);
  if (!row) return { rank: null, balance: 0, totalUsers };
  let higher = 0;
  for (const r of sortedDesc) {
    if (r.balance > row.balance) higher += 1;
    else break;
  }
  return { rank: higher + 1, balance: row.balance, totalUsers };
}
