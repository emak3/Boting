export const JRA_RACE_BASE = 'https://race.netkeiba.com';
export const NAR_RACE_BASE = 'https://nar.netkeiba.com';

/**
 * @param {string} raceId
 * @param {'jra' | 'nar'} [origin]
 */
export function netkeibaResultUrl(raceId, origin = 'jra') {
  const base = origin === 'nar' ? NAR_RACE_BASE : JRA_RACE_BASE;
  return `${base}/race/result.html?race_id=${encodeURIComponent(raceId)}`;
}

/**
 * @param {{ result?: { netkeibaOrigin?: string }, source?: string, netkeibaOrigin?: string }} [flow]
 * @returns {'jra' | 'nar'}
 */
export function netkeibaOriginFromFlow(flow) {
  const o = flow?.result?.netkeibaOrigin || flow?.source || flow?.netkeibaOrigin;
  return o === 'nar' ? 'nar' : 'jra';
}

/**
 * race_id 12桁の 9〜10 桁目が netkeiba の場コード。中央は 01〜10、地方は 31 台以降が多い。
 * フローで nar が欠落し jra で保存された行の補正・履歴側の判定に使う。
 * @param {string} raceId
 * @returns {boolean}
 */
export function isLikelyLocalNarRaceId(raceId) {
  if (!/^\d{12}$/.test(String(raceId || ''))) return false;
  const n = parseInt(String(raceId).slice(8, 10), 10);
  return Number.isFinite(n) && n >= 31 && n <= 65;
}

/**
 * @param {{ raceId?: string, netkeibaOrigin?: string }} it
 * @returns {'jra' | 'nar'}
 */
export function inferNetkeibaOriginForPurchaseItem(it) {
  if (it?.netkeibaOrigin === 'nar') return 'nar';
  const rid = String(it?.raceId || '');
  if (isLikelyLocalNarRaceId(rid)) return 'nar';
  return 'jra';
}
