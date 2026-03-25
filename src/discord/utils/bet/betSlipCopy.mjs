import { SLIP_MAX_ITEMS } from './betSlipStore.mjs';
import { t } from '../../../i18n/index.mjs';

/** @param {string | null} [locale] */
export function msgSlipBatchReviewSessionInvalid(locale = null) {
  return t('bet_slip.batch_review_invalid', null, locale);
}

/** @param {string | null} [locale] */
export function msgSlipBatchReviewSessionMismatch(locale = null) {
  return t('bet_slip.batch_review_mismatch', null, locale);
}

/** @param {string | null} [locale] */
export function msgSlipBatchReviewOpenEmpty(locale = null) {
  return t('bet_slip.batch_review_open_empty', null, locale);
}

/** @param {string | null} [locale] */
export function msgSlipBatchReviewPendingMissing(locale = null) {
  return t('bet_slip.batch_review_pending_missing', null, locale);
}

/** @param {string | null} [locale] */
export function msgSlipModalCustomIdInvalid(locale = null) {
  return t('bet_slip.modal_custom_id_invalid', null, locale);
}

/** @param {string | null} [locale] */
export function msgSlipSavedMaxItemsExceeded(locale = null) {
  return t('bet_slip.saved_max_exceeded', { max: SLIP_MAX_ITEMS }, locale);
}

/** @param {string | null} [locale] */
export function msgSlipTooManyForOtherUser(username, locale = null) {
  const u = username || t('bet_slip.other_user_fallback_name', null, locale);
  return t('bet_slip.too_many_for_other_user', { username: u, max: SLIP_MAX_ITEMS }, locale);
}
