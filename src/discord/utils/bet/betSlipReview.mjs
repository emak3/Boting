import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import {
  buildTextAndRowsV2Payload,
  V2_TEXT_TOTAL_MAX,
} from '../race/raceCardDisplay.mjs';
import {
  formatBetSlipItemBlock,
  historyRaceHeadingLine,
  slipItemDescriptionForSelect,
} from './betPurchaseEmbed.mjs';
import { msgSlipBatchReviewPendingMissing } from './betSlipCopy.mjs';
import { t } from '../../../i18n/index.mjs';
import {
  getSlipPendingReview,
  setSlipPendingReviewPage,
} from './betSlipStore.mjs';
import { getBalanceAfterPendingRaceRefunds } from '../race/raceBetRefundSweep.mjs';
import { botingEmoji } from '../boting/botingEmojis.mjs';
import { formatBpAmount } from '../bp/bpFormat.mjs';

/** まとめて購入確認 Container のアクセント */
const BET_SLIP_REVIEW_ACCENT = 0x2ecc71;

/** ヘッダー余裕（文字数目安） */
const SUMMARY_RESERVE = 620;

/** セレクトの説明では絵文字が表示されないため、<:name:id> / <a:name:id> を除去する */
function stripDiscordCustomEmojiMarkup(s) {
  const t = String(s || '').replace(/<a?:[^:]+:\d+>/g, '');
  return t.replace(/  +/g, ' ').trim();
}

function slipItemSelectOptions(items, locale) {
  return items.slice(0, 25).map((it, i) => {
    const title = stripDiscordCustomEmojiMarkup(historyRaceHeadingLine(it)).slice(
      0,
      70,
    );
    const label = `${i + 1}. ${title}`.slice(0, 100);
    const desc = stripDiscordCustomEmojiMarkup(
      slipItemDescriptionForSelect(it, locale),
    ).slice(0, 100);
    const o = new StringSelectMenuOptionBuilder()
      .setLabel(label)
      .setValue(String(i));
    if (desc.trim()) o.setDescription(desc);
    return o;
  });
}

function buildMoneySummaryText({
  grandPoints,
  grandYen,
  balance,
  pageIndex,
  totalPages,
  locale,
}) {
  const loc = locale;
  const lines = [
    t('bet_slip_review.summary_title', null, loc),
    '',
    t('bet_slip_review.payment_header', null, loc),
    t('bet_slip_review.line_total_at_confirm', { amount: formatBpAmount(grandYen) }, loc),
    t('bet_slip_review.line_balance', { amount: formatBpAmount(balance) }, loc),
  ];
  if (balance >= grandYen) {
    lines.push(
      t('bet_slip_review.line_balance_after', { amount: formatBpAmount(balance - grandYen) }, loc),
    );
  } else {
    lines.push(
      '',
      t('bet_slip_review.bp_short_warn', { short: formatBpAmount(grandYen - balance) }, loc),
    );
  }
  lines.push('', t('bet_slip_review.total_points', { n: formatBpAmount(grandPoints) }, loc));
  if (totalPages > 1) {
    lines.push(
      t('bet_slip_review.page', { cur: pageIndex + 1, total: totalPages }, loc),
    );
  }
  return lines.join('\n');
}

/**
 * 買い目本文だけをページ分割（全 Text Display 合算の上限を見越す）
 * @param {string[]} itemBlocks
 * @returns {string[][]}
 */
function partitionItemBlocks(itemBlocks, locale) {
  const trunc = t('bet_slip_review.text_truncated', null, locale);
  const itemBudget = Math.max(
    400,
    V2_TEXT_TOTAL_MAX - SUMMARY_RESERVE,
  );
  const pages = [];
  let i = 0;
  while (i < itemBlocks.length) {
    const chunk = [];
    let used = 0;
    while (i < itemBlocks.length) {
      const s = itemBlocks[i];
      const len = s.length;
      if (chunk.length && used + len > itemBudget) break;
      if (!chunk.length && len > itemBudget) {
        const cap = itemBudget - 40;
        chunk.push(
          len > cap ? `${s.slice(0, cap)}\n${trunc}` : s,
        );
        i++;
        break;
      }
      chunk.push(s);
      used += len;
      i++;
    }
    pages.push(chunk);
  }
  return pages.length ? pages : [[]];
}

/** ページの文字数が上限を超えないよう、末尾から次ページへ繰り出す */
function rebalancePagesForDiscord(pages, headerForPage) {
  const out = pages.map((p) => [...p]);
  let guard = 0;
  while (guard++ < 50) {
    let moved = false;
    for (let p = 0; p < out.length; p++) {
      const header = headerForPage(p, out.length);
      const body = out[p].join('\n\n');
      const total = header.length + body.length;
      if (total <= V2_TEXT_TOTAL_MAX) continue;
      if (out[p].length <= 1) continue;
      const last = out[p].pop();
      if (!out[p + 1]) out.push([]);
      out[p + 1].unshift(last);
      moved = true;
    }
    if (!moved) break;
  }
  return out.filter((pg) => pg.length > 0);
}

function slipReviewActionRows(anchorRaceId, items, { pageIndex, totalPages, locale }) {
  const loc = locale;
  const opts = slipItemSelectOptions(items, loc);

  const rowBtns = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`race_bet_slip_back|${anchorRaceId}`)
      .setLabel(t('bet_slip_review.btn_back', null, loc))
      .setEmoji(botingEmoji('modoru'))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`race_bet_slip_confirm|${anchorRaceId}`)
      .setLabel(t('bet_slip_review.btn_confirm', null, loc))
      .setEmoji(botingEmoji('naiyoukakutei'))
      .setStyle(ButtonStyle.Success),
  );

  const rows = [rowBtns];

  if (totalPages > 1) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`race_bet_slip_pg|${anchorRaceId}|prev`)
          .setLabel(t('bet_slip_review.page_prev', null, loc))
          .setEmoji(botingEmoji('mae'))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pageIndex <= 0),
        new ButtonBuilder()
          .setCustomId(`race_bet_slip_pg|${anchorRaceId}|next`)
          .setLabel(t('bet_slip_review.page_next', null, loc))
          .setEmoji(botingEmoji('tsugi'))
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pageIndex >= totalPages - 1),
      ),
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`race_bet_slip_unit_pick|${anchorRaceId}`)
        .setPlaceholder(t('bet_slip_review.ph_unit_pick', null, loc))
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(opts),
    ),
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`race_bet_slip_remove|${anchorRaceId}`)
        .setPlaceholder(t('bet_slip_review.ph_remove', null, loc))
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(opts),
    ),
  );

  return rows;
}

/**
 * 長いテキストを複数 Text Display に分け、間に Separator（小さめの区切り線）を挟む
 */
function appendTextWithOverflowSplits(container, text) {
  let rest = String(text || '').trimEnd();
  const chunkSize = 3500;
  let first = true;
  while (rest.length > 0) {
    if (!first) {
      container.addSeparatorComponents((sep) =>
        sep.setSpacing(SeparatorSpacingSize.Small).setDivider(true),
      );
    }
    first = false;
    const take =
      rest.length <= chunkSize
        ? rest
        : rest.slice(0, rest.lastIndexOf('\n', chunkSize) + 1 || chunkSize);
    container.addTextDisplayComponents((td) => td.setContent(take.trimEnd()));
    rest = rest.slice(take.length).trimStart();
  }
}

function buildSlipReviewContainer({ summaryText, itemBlocksOnPage }) {
  const container = new ContainerBuilder().setAccentColor(BET_SLIP_REVIEW_ACCENT);
  appendTextWithOverflowSplits(container, summaryText);
  container.addSeparatorComponents((separator) => separator);

  for (let i = 0; i < itemBlocksOnPage.length; i++) {
    if (i > 0) {
      container.addSeparatorComponents((separator) => separator);
    }
    appendTextWithOverflowSplits(container, itemBlocksOnPage[i]);
  }

  return container;
}

/**
 * まとめて購入（仮）確認画面: Container + 確定・ページ・金額変更・削除
 */
export async function buildSlipReviewV2Payload({ userId, extraFlags = 0, locale = null }) {
  const pending = getSlipPendingReview(userId);
  if (!pending?.items?.length) {
    return buildTextAndRowsV2Payload({
      headline: msgSlipBatchReviewPendingMissing(locale),
      actionRows: [],
      extraFlags,
      withBotingMenuBack: true,
      locale,
    });
  }

  const grandPoints = pending.items.reduce(
    (s, it) => s + Math.round(Number(it.points) || 0),
    0,
  );
  const grandYen = pending.items.reduce(
    (s, it) =>
      s +
      Math.round(Number(it.points) || 0) *
        Math.max(1, Math.round(Number(it.unitYen) || 100)),
    0,
  );
  const balance = await getBalanceAfterPendingRaceRefunds(userId);

  const itemBlocks = pending.items.map((it, idx) =>
    formatBetSlipItemBlock(it, idx, locale),
  );
  let pages = partitionItemBlocks(itemBlocks, locale);

  const headerForPage = (pageIdx, totalPg) =>
    buildMoneySummaryText({
      grandPoints,
      grandYen,
      balance,
      pageIndex: pageIdx,
      totalPages: totalPg,
      locale,
    });

  pages = rebalancePagesForDiscord(pages, headerForPage);

  const totalPages = Math.max(1, pages.length);
  let pageIndex = Math.min(
    Math.max(0, pending.reviewPage ?? 0),
    totalPages - 1,
  );
  if (pageIndex !== (pending.reviewPage ?? 0)) {
    setSlipPendingReviewPage(userId, pageIndex);
  }

  const summaryText = headerForPage(pageIndex, totalPages);
  const itemBlocksOnPage = pages[pageIndex] ?? [];

  const container = buildSlipReviewContainer({
    summaryText,
    itemBlocksOnPage,
  });

  const rows = slipReviewActionRows(pending.anchorRaceId, pending.items, {
    pageIndex,
    totalPages,
    locale,
  });

  return {
    content: null,
    embeds: [],
    components: [container, ...rows],
    flags: MessageFlags.IsComponentsV2 | extraFlags,
  };
}
