/**
 * netkeiba 結果ページの払戻（100円あたり）と買い目チケットから bp 払戻を計算する
 */

/** @param {string} s */
export function parsePayoutYenPer100(s) {
  if (s == null) return 0;
  const t = String(s).replace(/[,\s]/g, '').replace(/円/g, '');
  const m = t.match(/\d+/);
  if (!m) return 0;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) ? n : 0;
}

function normNum(x) {
  const n = parseInt(String(x).replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? String(n) : String(x);
}

/**
 * @param {string[]} a
 * @param {string[]} b
 */
function sameNumsUnordered(a, b) {
  const pa = [...a].map(normNum).sort((x, y) => Number(x) - Number(y));
  const pb = [...b].map(normNum).sort((x, y) => Number(x) - Number(y));
  if (pa.length !== pb.length) return false;
  return pa.every((v, i) => v === pb[i]);
}

/**
 * @param {string[]} a
 * @param {string[]} b
 */
function sameNumsOrdered(a, b) {
  const pa = a.map(normNum);
  const pb = b.map(normNum);
  if (pa.length !== pb.length) return false;
  return pa.every((v, i) => v === pb[i]);
}

/**
 * @param {{ kind?: string|null, nums?: string[], payout?: string }} row
 * @param {{ kind: string, nums: string[] }} ticket
 */
export function payoutRowMatchesTicket(row, ticket) {
  if (!row || !ticket) return false;
  if (String(row.kind || '') !== String(ticket.kind)) return false;
  const rk = ticket.kind;
  const rnums = row.nums || [];
  const tnums = ticket.nums || [];
  if (rk === 'Umatan' || rk === 'Tan3') {
    return sameNumsOrdered(rnums, tnums);
  }
  if (rk === 'Tansho' || rk === 'Fukusho') {
    return rnums.length >= 1 && tnums.length >= 1 && normNum(rnums[0]) === normNum(tnums[0]);
  }
  return sameNumsUnordered(rnums, tnums);
}

/**
 * @param {Array<{ kind: string, nums: string[] }>} tickets
 * @param {Array<{ kind?: string|null, nums?: string[], payout?: string }>} payouts
 * @param {number} unitYen 1点あたり（=100円馬券の倍率の基準）
 */
export function sumRefundBpForTickets(tickets, payouts, unitYen = 100) {
  const u = Math.max(1, Math.round(Number(unitYen) || 100));
  let sum = 0;
  for (const t of tickets || []) {
    const row = (payouts || []).find((p) => payoutRowMatchesTicket(p, t));
    if (!row) continue;
    const per100 = parsePayoutYenPer100(row.payout);
    if (per100 <= 0) continue;
    sum += Math.floor((per100 * u) / 100);
  }
  return sum;
}
