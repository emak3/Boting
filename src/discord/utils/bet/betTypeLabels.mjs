import { t } from '../../../i18n/index.mjs';
import { betTypeLabel } from './betFlowLabels.mjs';

const LEGACY_UNKNOWN_JA = '（券種不明）';

/**
 * race_bets.betType（フロー ID）を画面表示用に変換する。
 * @param {string} raw
 * @param {string | null} [locale]
 * @returns {string}
 */
export function betTypeDisplayLabel(raw, locale = null) {
  const k = String(raw ?? '').trim();
  const unk = t('bet_flow.unknown_bet_type', null, locale);
  if (!k || k === LEGACY_UNKNOWN_JA) return unk;
  const lbl = betTypeLabel(k, locale);
  if (!lbl || lbl.startsWith('bet_flow.')) return k;
  return lbl;
}

/**
 * @param {string} raw
 * @returns {string}
 */
export function betTypeDisplayLabelJa(raw) {
  return betTypeDisplayLabel(raw, 'ja');
}
