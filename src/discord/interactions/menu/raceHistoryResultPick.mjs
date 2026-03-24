import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { buildRaceMenuSelectionPayload } from './raceSchedule.mjs';
import { botingEmoji } from '../../utils/boting/botingEmojis.mjs';
import {
  RACE_HISTORY_RESULT_PICK_PREFIX,
  buildRaceHistoryNavCustomId,
  stripRaceHistoryBpCtx,
} from '../../utils/race/racePurchaseHistoryUi.mjs';

function v2ExtraFlags(interaction) {
  try {
    if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
      return MessageFlags.Ephemeral;
    }
  } catch (_) {
    /* ignore */
  }
  return 0;
}

/**
 * レース結果・出馬表ペイロードの本文ブロック直下に「購入履歴に戻る」を差し込む
 * @param {import('discord.js').BaseMessageOptions} payload
 */
function injectPurchaseHistoryBack(payload, ctx) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildRaceHistoryNavCustomId(ctx))
      .setLabel('購入履歴に戻る')
      .setEmoji(botingEmoji('history'))
      .setStyle(ButtonStyle.Secondary),
  );
  const c = [...(payload.components || [])];
  if (!c.length) return payload;
  c.splice(1, 0, row);
  return { ...payload, components: c };
}

/**
 * 購入履歴ページの String Select → レース結果（戻るはページングと同じ customId）
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export default async function raceHistoryResultPick(interaction) {
  if (!interaction.isStringSelectMenu()) return;
  const cid = interaction.customId;
  if (!cid.startsWith(`${RACE_HISTORY_RESULT_PICK_PREFIX}|`)) return;

  const { withoutCtx, bpctxUserId, rankLeaderboardReturn } = stripRaceHistoryBpCtx(cid);
  const parts = withoutCtx.split('|');
  if (parts.length < 4 || parts[0] !== RACE_HISTORY_RESULT_PICK_PREFIX) return;

  const periodKey = parts[1];
  const page = parseInt(parts[2], 10);
  let meetingFilter = parts[3];
  if (meetingFilter === undefined || meetingFilter === '') meetingFilter = 'all';

  if (!/^\d{8}$/.test(String(periodKey || '')) || !Number.isFinite(page) || page < 0) {
    await interaction.reply({
      content: '❌ 指定が無効です。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (meetingFilter !== 'all' && !/^\d{10}$/.test(String(meetingFilter))) {
    await interaction.reply({
      content: '❌ 開催の指定が無効です。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const rawVal = interaction.values[0];
  const [raceId, flag] = String(rawVal || '').split('|');
  if (!/^\d{12}$/.test(raceId) || (flag !== '0' && flag !== '1')) {
    await interaction.reply({
      content: '❌ レースの指定が無効です。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();

  const ctx = {
    periodKey,
    page,
    meetingFilter,
    bpRankProfileUserId: bpctxUserId || null,
    rankLeaderboardReturn: rankLeaderboardReturn || null,
  };

  try {
    let payload = await buildRaceMenuSelectionPayload(interaction, {
      raceId,
      isResultFlag: flag,
    });
    payload = injectPurchaseHistoryBack(payload, ctx);
    const xf = v2ExtraFlags(interaction);
    if (xf) {
      payload.flags = (payload.flags ?? 0) | xf;
    }
    await interaction.editReply(payload);
  } catch (e) {
    console.error('raceHistoryResultPick', e);
    await interaction
      .editReply({
        content: `❌ 表示に失敗しました: ${e.message}`,
      })
      .catch(() => {});
  }
}
