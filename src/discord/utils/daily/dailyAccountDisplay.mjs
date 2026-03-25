import { ContainerBuilder } from 'discord.js';
import { formatBpAmount } from '../bp/bpFormat.mjs';
import { t } from '../../../i18n/index.mjs';

const ACCENT_CLAIMED = 0xed4245;
const ACCENT_CLAIMABLE = 0x2ecc71;

/**
 * Daily 収支の Container（Embed ではなく V2 のため「メニューに戻る」で混在しない）
 * @param {Awaited<ReturnType<import('./userPointsStore.mjs').getDailyAccountView>>} view
 * @param {{ claimed: boolean, successBanner?: string | null, locale?: string | null }} opts
 */
export function buildDailyAccountV2Container(view, opts) {
  const { claimed, successBanner = null, locale = null } = opts;
  const accent = claimed ? ACCENT_CLAIMED : ACCENT_CLAIMABLE;
  const container = new ContainerBuilder().setAccentColor(accent);

  const title = claimed
    ? t('boting_hub.daily.title_claimed', null, locale)
    : t('boting_hub.daily.title_available', null, locale);

  const streakLine =
    view.dailyStreakDay != null
      ? t(
          'boting_hub.daily.streak_bonus',
          {
            n: view.dailyStreakDay,
            next: view.dailyStreakDay >= 7 ? 1 : view.dailyStreakDay + 1,
          },
          locale,
        )
      : t('boting_hub.daily.streak_none', null, locale);

  const parts = [];
  if (successBanner && String(successBanner).trim()) {
    parts.push(String(successBanner).trim());
    parts.push('');
  }
  parts.push(title);
  parts.push('');
  parts.push(t('boting_hub.daily.balance', { amount: formatBpAmount(view.balance) }, locale));
  parts.push('');
  parts.push(`${t('boting_hub.daily.streak_label', null, locale)}  ${streakLine}`);
  parts.push('');
  parts.push(t('boting_hub.daily.foot_jst', null, locale));
  parts.push(t('boting_hub.daily.foot_ledger', null, locale));

  const body = parts.join('\n').slice(0, 3900);
  container.addTextDisplayComponents((td) => td.setContent(body));
  return container;
}
