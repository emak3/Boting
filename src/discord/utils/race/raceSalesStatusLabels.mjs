import { t } from '../../../i18n/index.mjs';
import { botingEmojiMarkdown } from '../boting/botingEmojis.mjs';

function resultFinalEmojiLabel() {
  return `${botingEmojiMarkdown('kaku')}${botingEmojiMarkdown('tei')}`;
}

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
  if (st?.code === 'result_final') return resultFinalEmojiLabel();
  return t(`race_schedule.sales_status.detail.${st.code}`, null, locale);
}
