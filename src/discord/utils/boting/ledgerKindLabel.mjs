import { t } from '../../../i18n/index.mjs';

/**
 * BP 台帳・Daily 成功表示などで使う取引種別の短いラベル
 * @param {string} kind
 * @param {number} [streakDay]
 * @param {'ja'|'en'|string|null} [locale]
 */
export function ledgerKindLabel(kind, streakDay, locale = null) {
  const k = String(kind || '');
  if (k === 'first') return t('boting_hub.ledger_kinds.first', null, locale);
  if (k === 'debug_extra') return t('boting_hub.ledger_kinds.debug_extra', null, locale);
  if (k === 'debug_bp_adjust') return t('boting_hub.ledger_kinds.debug_bp_adjust', null, locale);
  if (k === 'race_bet') return t('boting_hub.ledger_kinds.race_bet', null, locale);
  if (k === 'race_refund') return t('boting_hub.ledger_kinds.race_refund', null, locale);
  if (k === 'race_refund_adjust') return t('boting_hub.ledger_kinds.race_refund_adjust', null, locale);
  if (k === 'weekly_challenge') return t('boting_hub.ledger_kinds.weekly_challenge', null, locale);
  if (k === 'daily') {
    const s = Number(streakDay);
    if (Number.isFinite(s) && s >= 1 && s <= 7) {
      return t('boting_hub.ledger_kinds.daily_streak', { n: s }, locale);
    }
    return t('boting_hub.ledger_kinds.daily_plain', null, locale);
  }
  return t('boting_hub.ledger_kinds.fallback', null, locale);
}
