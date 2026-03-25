import { t } from '../../../i18n/index.mjs';

export const BET_TYPE_IDS = [
  'win',
  'place',
  'win_place',
  'frame_pair',
  'horse_pair',
  'wide',
  'umatan',
  'trifuku',
  'tritan',
];

export const PAIR_MODE_IDS = ['normal', 'nagashi', 'box', 'formation'];
export const UMATAN_MODE_IDS = ['normal', 'nagashi1', 'nagashi2', 'box', 'formation'];
export const TRIFUKU_MODE_IDS = ['normal', 'nagashi1', 'nagashi2', 'box', 'formation'];
export const TRITAN_MODE_IDS = [
  'normal',
  'nagashi1',
  'nagashi2',
  'nagashi3',
  'nagashi12',
  'nagashi13',
  'nagashi23',
  'box',
  'formation',
];

/** @param {string | null} [locale] */
export function betTypesLabeled(locale) {
  return BET_TYPE_IDS.map((id) => ({
    id,
    label: t(`bet_flow.bet_types.${id}`, null, locale),
  }));
}

/**
 * @param {string[]} ids
 * @param {'pair_modes'|'umatan_modes'|'trifuku_modes'|'tritan_modes'} ns
 * @param {string | null} [locale]
 */
export function labeledModes(ids, ns, locale) {
  return ids.map((id) => ({
    id,
    label: t(`bet_flow.${ns}.${id}`, null, locale),
  }));
}

/** @param {string | null} [locale] */
export function pairModesLabeled(locale) {
  return labeledModes(PAIR_MODE_IDS, 'pair_modes', locale);
}

/** @param {string | null} [locale] */
export function umatanModesLabeled(locale) {
  return labeledModes(UMATAN_MODE_IDS, 'umatan_modes', locale);
}

/** @param {string | null} [locale] */
export function trifukuModesLabeled(locale) {
  return labeledModes(TRIFUKU_MODE_IDS, 'trifuku_modes', locale);
}

/** @param {string | null} [locale] */
export function tritanModesLabeled(locale) {
  return labeledModes(TRITAN_MODE_IDS, 'tritan_modes', locale);
}

/**
 * @param {string} betTypeId
 * @param {string | null} [locale]
 */
export function betTypeLabel(betTypeId, locale) {
  const k = String(betTypeId ?? '').trim();
  if (!k) return '';
  return t(`bet_flow.bet_types.${k}`, null, locale);
}
