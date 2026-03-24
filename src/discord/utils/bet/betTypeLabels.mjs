/**
 * race_bets.betType（フロー ID）を画面表示用の日本語に変換する。
 * @see raceSchedule.mjs の BET_TYPES と揃える
 */
const BET_TYPE_LABEL_JA = {
  win: '単勝',
  place: '複勝',
  win_place: '単勝+複勝',
  frame_pair: '枠連',
  horse_pair: '馬連',
  wide: 'ワイド',
  umatan: '馬単',
  trifuku: '3連複',
  tritan: '3連単',
};

/**
 * @param {string} raw
 * @returns {string}
 */
export function betTypeDisplayLabelJa(raw) {
  const k = String(raw ?? '').trim();
  if (!k) return '（券種不明）';
  if (k === '（券種不明）') return k;
  return BET_TYPE_LABEL_JA[k] ?? k;
}
