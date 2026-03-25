import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorSpacingSize,
} from 'discord.js';
import {
  fetchLedgerPage,
  LEDGER_PAGE_MAX_FETCH,
} from '../user/userPointsStore.mjs';
import { ledgerKindLabel } from './ledgerKindLabel.mjs';
import { normalizeLocale, t } from '../../../i18n/index.mjs';
import { BOTING_HUB_BUTTON_EMOJI, BOTING_HUB_PREFIX } from './botingHubConstants.mjs';
import { botingEmoji } from './botingEmojis.mjs';
import { BP_RANK_DISPLAY_MAX } from '../bp/bpRankLeaderboardEmbed.mjs';
import {
  BP_RANK_LB_ANNUAL_PREFIX,
  BP_RANK_LB_HIST_PREFIX,
  buildBpRankLeaderboardBackButtonRow,
} from '../bp/bpRankUiButtons.mjs';
import { formatBpAmount } from '../bp/bpFormat.mjs';

export const BOTING_LEDGER_NAV_PREFIX = 'boting_ledger_nav';
export const BOTING_LEDGER_OPEN_LIM_PREFIX = 'boting_ledger_open_lim';

const ACCENT = 0x3498db;
const V2_TEXT_TOTAL_MAX = 3900;
const V2_SINGLE_CHUNK = 3500;

function formatJst(d, locale = null) {
  const tag = normalizeLocale(locale) === 'en' ? 'en-US' : 'ja-JP';
  return d.toLocaleString(tag, {
    timeZone: 'Asia/Tokyo',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatLedgerLines(entries, locale = null) {
  if (!entries.length) {
    return t('boting_hub.ledger.empty_page', null, locale);
  }
  const lines = entries.map((e) => {
    const timeStr = e.at ? formatJst(e.at, locale) : '—';
    const sign = e.delta >= 0 ? `+${formatBpAmount(e.delta)}` : formatBpAmount(e.delta);
    return `\`${timeStr}\` **${sign}** bp → **${formatBpAmount(e.balanceAfter)}** bp（${ledgerKindLabel(e.kind, e.streakDay, locale)}）`;
  });
  let text = lines.join('\n');
  if (text.length > 3500) {
    text = lines.slice(0, 8).join('\n') + t('boting_hub.ledger.truncated_suffix', null, locale);
  }
  return text;
}

/** @returns {string[]} */
function splitForTextDisplays(fullText) {
  const capped = fullText.slice(0, V2_TEXT_TOTAL_MAX);
  if (capped.length <= V2_SINGLE_CHUNK) return [capped];
  const out = [];
  let rest = capped;
  while (rest.length > 0) {
    if (rest.length <= V2_SINGLE_CHUNK) {
      out.push(rest);
      break;
    }
    let cut = rest.lastIndexOf('\n\n', V2_SINGLE_CHUNK);
    if (cut < V2_SINGLE_CHUNK / 2) cut = V2_SINGLE_CHUNK;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  return out;
}

function appendChunkedToContainer(container, text) {
  const chunks = splitForTextDisplays(String(text || '').trimEnd()).filter((c) =>
    String(c).trim(),
  );
  for (let i = 0; i < chunks.length; i++) {
    container.addTextDisplayComponents((td) => td.setContent(chunks[i]));
    if (i < chunks.length - 1) {
      container.addSeparatorComponents((sep) =>
        sep.setSpacing(SeparatorSpacingSize.Small).setDivider(true),
      );
    }
  }
}

/**
 * @param {{ userId: string, pageSize: number, pageIndex: number, extraFlags?: number, rankLeaderboardReturn?: { limit: number, mode: string } | null, locale?: string | null }} opts
 */
export async function buildBotingLedgerViewPayload({
  userId,
  pageSize,
  pageIndex,
  extraFlags = 0,
  rankLeaderboardReturn = null,
  locale = null,
}) {
  const ps = Math.min(50, Math.max(1, Math.round(Number(pageSize) || 10)));
  const pi = Math.max(0, Math.floor(Number(pageIndex) || 0));

  const { entries, hasMore, hasPrev, capped } = await fetchLedgerPage(
    userId,
    ps,
    pi,
  );

  const targetLine =
    rankLeaderboardReturn && userId
      ? t('boting_hub.ledger.target_line', { mention: `<@${userId}>` }, locale)
      : '';

  const head = [
    t('boting_hub.ledger.title', null, locale),
    targetLine,
    t('boting_hub.ledger.page_line', { size: ps, page: pi + 1 }, locale),
    capped
      ? t('boting_hub.ledger.capped_warning', { max: LEDGER_PAGE_MAX_FETCH }, locale)
      : '',
  ]
    .filter(Boolean)
    .join('');

  const body = `${head}\n\n${formatLedgerLines(entries, locale)}`;

  const container = new ContainerBuilder().setAccentColor(ACCENT);
  appendChunkedToContainer(container, body);

  const lb = rankLeaderboardReturn;
  const rkLim =
    lb?.limit != null
      ? Math.min(BP_RANK_DISPLAY_MAX, Math.max(1, Math.round(Number(lb.limit) || 20)))
      : null;
  const rkMode = String(lb?.mode || 'balance');
  const safeMode =
    rkMode === 'recovery' ||
    rkMode === 'hit_rate' ||
    rkMode === 'purchase' ||
    rkMode === 'balance'
      ? rkMode
      : 'balance';
  const navSuffix =
    lb && rkLim != null && userId && /^\d{17,20}$/.test(String(userId))
      ? `|${userId}|lb|${rkLim}|${safeMode}`
      : '';

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(
        `${BOTING_LEDGER_NAV_PREFIX}|prev|${ps}|${pi}${navSuffix}`,
      )
      .setLabel(t('race_purchase_history.nav.prev_page', null, locale))
      .setEmoji(botingEmoji('mae'))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasPrev),
    new ButtonBuilder()
      .setCustomId(
        `${BOTING_LEDGER_NAV_PREFIX}|next|${ps}|${pi}${navSuffix}`,
      )
      .setLabel(t('race_purchase_history.nav.next_page', null, locale))
      .setEmoji(botingEmoji('tsugi'))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasMore),
    new ButtonBuilder()
      .setCustomId(`${BOTING_LEDGER_OPEN_LIM_PREFIX}|${ps}|${pi}${navSuffix}`)
      .setLabel(t('boting_hub.ledger.change_page_size', null, locale))
      .setEmoji(botingEmoji('hyouji'))
      .setStyle(ButtonStyle.Secondary),
  );

  const menuBackBtn = new ButtonBuilder()
    .setCustomId(`${BOTING_HUB_PREFIX}|back`)
    .setLabel(t('common.menu_back', null, locale))
    .setEmoji(botingEmoji('home'))
    .setStyle(ButtonStyle.Secondary);

  const rankBackRow = buildBpRankLeaderboardBackButtonRow(
    rkLim ?? 20,
    safeMode,
    locale,
  );
  const rankBackBtn = lb ? rankBackRow.components.at(0) : null;

  const histBackBtn =
    lb && rkLim != null && userId && /^\d{17,20}$/.test(String(userId))
      ? new ButtonBuilder()
          .setCustomId(
            `${BP_RANK_LB_HIST_PREFIX}|${rkLim}|${safeMode}|${userId}`,
          )
          .setLabel(t('race_schedule.buttons.purchase_history', null, locale))
          .setEmoji(botingEmoji('history'))
          .setStyle(ButtonStyle.Secondary)
      : null;

  const annualBtn =
    lb && rkLim != null && userId && /^\d{17,20}$/.test(String(userId))
      ? new ButtonBuilder()
          .setCustomId(
            `${BP_RANK_LB_ANNUAL_PREFIX}|${rkLim}|${safeMode}|${userId}`,
          )
          .setLabel(t('boting_hub.buttons.annual_stats', null, locale))
          .setEmoji(BOTING_HUB_BUTTON_EMOJI.annualStats)
          .setStyle(ButtonStyle.Secondary)
      : null;

  const row2 = new ActionRowBuilder().addComponents(
    ...(annualBtn ? [annualBtn] : []),
    ...(histBackBtn ? [histBackBtn] : []),
    lb && rankBackBtn ? rankBackBtn : menuBackBtn,
  );

  return {
    content: null,
    embeds: [],
    components: [container, navRow, row2],
    flags: MessageFlags.IsComponentsV2 | extraFlags,
  };
}
