import { ContainerBuilder } from 'discord.js';
import { formatBpAmount } from '../bp/bpFormat.mjs';

const ACCENT_CLAIMED = 0xed4245;
const ACCENT_CLAIMABLE = 0x2ecc71;

function formatJst(d) {
  return d.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * Daily 収支の Container（Embed ではなく V2 のため「メニューに戻る」で混在しない）
 * @param {Awaited<ReturnType<import('./userPointsStore.mjs').getDailyAccountView>>} view
 * @param {{ claimed: boolean, successBanner?: string | null }} opts
 */
export function buildDailyAccountV2Container(view, opts) {
  const { claimed, successBanner = null } = opts;
  const accent = claimed ? ACCENT_CLAIMED : ACCENT_CLAIMABLE;
  const container = new ContainerBuilder().setAccentColor(accent);

  const title = claimed
    ? '## 本日分は受け取り済み'
    : '## 今日の Daily を受け取れます';

  const streakLine =
    view.dailyStreakDay != null
      ? `**${view.dailyStreakDay}** 日（次の日は ${view.dailyStreakDay >= 7 ? 1 : view.dailyStreakDay + 1} 日目のボーナス）`
      : '—';

  const parts = [];
  if (successBanner && String(successBanner).trim()) {
    parts.push(String(successBanner).trim());
    parts.push('');
  }
  parts.push(title);
  parts.push('');
  parts.push(`**残高**  **${formatBpAmount(view.balance)}** bp`);
  parts.push('');
  parts.push(`**いまの連続記録**  ${streakLine}`);
  parts.push('');
  parts.push('*日次は日本時間 毎日 8:00 で切り替わります*');
  parts.push('*直近の収支は **直近の収支** ボタンから表示できます。*');

  const body = parts.join('\n').slice(0, 3900);
  container.addTextDisplayComponents((td) => td.setContent(body));
  return container;
}
