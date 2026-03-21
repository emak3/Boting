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
import { getBalance } from './userPointsStore.mjs';

/** セレクトの説明では絵文字が表示されないため、<:name:id> / <a:name:id> を除去する */
function stripDiscordCustomEmojiMarkup(s) {
  const t = String(s || '').replace(/<a?:[^:]+:\d+>/g, '');
  return t.replace(/  +/g, ' ').trim();
}

function slipItemSelectOptions(items) {
  return items.slice(0, 25).map((it, i) => {
    const title = stripDiscordCustomEmojiMarkup(it.raceTitle || 'レース').slice(0, 70);
    const label = `${i + 1}. ${title}`.slice(0, 100);
    const desc = stripDiscordCustomEmojiMarkup(it.selectionLine || '').slice(0, 100);
    const o = new StringSelectMenuOptionBuilder()
      .setLabel(label)
      .setValue(String(i));
    if (desc.trim()) o.setDescription(desc);
    return o;
  });
}

function slipReviewActionRows(anchorRaceId, items) {
  const opts = slipItemSelectOptions(items);

  const rowBtns = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`race_bet_slip_back|${anchorRaceId}`)
      .setLabel('戻る')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`race_bet_slip_confirm|${anchorRaceId}`)
      .setLabel('この内容で確定')
      .setStyle(ButtonStyle.Success),
  );

  const rowUnit = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`race_bet_slip_unit_pick|${anchorRaceId}`)
      .setPlaceholder('金額を変える買い目を選択')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(opts),
  );

  const rowRemove = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`race_bet_slip_remove|${anchorRaceId}`)
      .setPlaceholder('番号を選んで削除')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(opts),
  );

  return [rowBtns, rowUnit, rowRemove];
}

/**
 * まとめて購入（仮）確認画面: 本文 + 確定・金額変更セレクト・削除セレクト
 */
export async function buildSlipReviewV2Payload({ userId, extraFlags = 0 }) {
  const pending = getSlipPendingReview(userId);
  if (!pending?.items?.length) {
    return buildTextAndRowsV2Payload({
      headline: '❌ 買い目データがありません。もう一度 /race からやり直してください。',
      actionRows: [],
      extraFlags,
    });
  }
  const totalBp = pending.items.reduce(
    (s, it) =>
      s + Math.round(Number(it.points) || 0) * Math.max(1, Math.round(Number(it.unitYen) || 100)),
    0,
  );
  const balance = await getBalance(userId);
  const headline = [
    buildBetSlipBatchV2Headline({ items: pending.items }),
    '',
    `**合計消費（確定時）** ${totalBp} bp　**いまの残高** ${balance} bp`,
    balance < totalBp
      ? '⚠️ 残高が足りません。`/daily` で受け取るか、金額・買い目を調整してください。'
      : null,
    '',
    '**編集:** **金額を変える買い目を選択**から選ぶと **100 bp 単位**のテンキーが表示されます。下のメニューで**番号を選んで削除**。**戻る**でひとつ前の画面へ。**この内容で確定**で bp を消費して購入します。',
  ]
    .filter(Boolean)
    .join('\n');
  const rows = slipReviewActionRows(pending.anchorRaceId, pending.items);
  return buildTextAndRowsV2Payload({
    headline,
    actionRows: rows,
    extraFlags,
  });
}
