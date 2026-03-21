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
