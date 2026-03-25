import { t } from '../../../i18n/index.mjs';

/**
 * @param {{ code: string, closed: boolean }} st
 * @param {'ja' | 'en' | string | null} [locale]
 */
export function raceSalesStatusShortLabel(st, locale = null) {
  return t(`race_schedule.sales_status.short.${st.code}`, null, locale);
}

/**
 * @param {{ code: string, closed: boolean }} st
 * @param {'ja' | 'en' | string | null} [locale]
 */
export function raceSalesStatusDetailLabel(st, locale = null) {
  return t(`race_schedule.sales_status.detail.${st.code}`, null, locale);
}
