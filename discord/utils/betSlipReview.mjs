import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { buildTextAndRowsV2Payload } from './raceCardDisplay.mjs';
import { buildBetSlipBatchV2Headline } from './betPurchaseEmbed.mjs';
import { getSlipPendingReview } from './betSlipStore.mjs';

/** セレクトの説明では絵文字が表示されないため、<:name:id> / <a:name:id> を除去する */
function stripDiscordCustomEmojiMarkup(s) {
  const t = String(s || '').replace(/<a?:[^:]+:\d+>/g, '');
  return t.replace(/  +/g, ' ').trim();
}

function slipReviewActionRows(anchorRaceId, items) {
  const rowBtns = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`race_bet_slip_unit_modal_open|${anchorRaceId}`)
      .setLabel('金額変更')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`race_bet_slip_confirm|${anchorRaceId}`)
      .setLabel('この内容で確定')
      .setStyle(ButtonStyle.Success),
  );

  const opts = items.slice(0, 25).map((it, i) => {
    const title = stripDiscordCustomEmojiMarkup(it.raceTitle || 'レース').slice(0, 70);
    const label = `${i + 1}. ${title}`.slice(0, 100);
    const desc = stripDiscordCustomEmojiMarkup(it.selectionLine || '').slice(0, 100);
    const o = new StringSelectMenuOptionBuilder()
      .setLabel(label)
      .setValue(String(i));
    if (desc.trim()) o.setDescription(desc);
    return o;
  });

  const rowRemove = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`race_bet_slip_remove|${anchorRaceId}`)
      .setPlaceholder('番号を選んで削除')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(opts),
  );

  return [rowBtns, rowRemove];
}

/**
 * まとめて購入（仮）確認画面: 本文 + 金額変更・確定・削除セレクト
 */
export function buildSlipReviewV2Payload({ userId, extraFlags = 0 }) {
  const pending = getSlipPendingReview(userId);
  if (!pending?.items?.length) {
    return buildTextAndRowsV2Payload({
      headline: '❌ 買い目データがありません。もう一度 /race からやり直してください。',
      actionRows: [],
      extraFlags,
    });
  }
  const headline = [
    buildBetSlipBatchV2Headline({ items: pending.items }),
    '',
    '**編集:** **金額変更**で番号（1〜）と1点あたりの円／下のメニューで**番号を選んで削除**。**この内容で確定**で完了します。',
  ].join('\n');
  const rows = slipReviewActionRows(pending.anchorRaceId, pending.items);
  return buildTextAndRowsV2Payload({
    headline,
    actionRows: rows,
    extraFlags,
  });
}
