import { t } from '../../../i18n/index.mjs';

/**
 * 馬券フロー（betFlowStore）が無い・result / purchase 欠落など
 * @param {string | null} [locale]
 */
export function msgRaceBetFlowSessionInvalid(locale = null) {
  return t('bet_session.race_flow_invalid', null, locale);
}
