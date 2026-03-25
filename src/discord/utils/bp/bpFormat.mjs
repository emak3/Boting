/**
 * Discord 上で bp（および同じ見せ方にしたい整数）をカンマ区切りで表示する。
 * 例: 1000 → "1,000"（ロケール ja-JP）
 */

const BP_DISPLAY_LOCALE = 'ja-JP';

/**
 * @param {number|string|null|undefined} value
 * @returns {string}
 */
export function formatBpAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  return Math.round(n).toLocaleString(BP_DISPLAY_LOCALE);
}

/**
 * コードブロック用など `1,000bp` 形式（単位直結）
 * @param {number|string|null|undefined} value
 */
export function formatBpWithUnit(value) {
  return `${formatBpAmount(value)}bp`;
}
