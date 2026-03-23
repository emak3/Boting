import { MessageFlags } from 'discord.js';
import {
  appendDigitLimit,
  BP_RANK_DISPLAY_MAX,
  bufferToLimit,
  buildBpRankLimitKeypadPayload,
  deleteLastDigitLimit,
  parseBpRankLimitKeypadId,
} from '../../utils/bpRankLimitKeypad.mjs';
import {
  clearBpRankLimitDraft,
  getBpRankLimitDraft,
  setBpRankLimitDraft,
} from '../../utils/bpRankLimitKeypadStore.mjs';
import {
  BP_RANK_MODE,
  buildBpRankLeaderboardFullPayload,
} from '../../utils/bpRankLeaderboardEmbed.mjs';
import { buildEphemeralWithBotingBackPayload } from '../../utils/botingBackButton.mjs';
import { buildTextAndRowsV2Payload } from '../../utils/raceCardDisplay.mjs';

function v2ExtraFlags(interaction) {
  let extraFlags = 0;
  try {
    if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
      extraFlags |= MessageFlags.Ephemeral;
    }
  } catch (_) {
    /* ignore */
  }
  return extraFlags;
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 */
export default async function bpRankLimitKeypadButtons(interaction) {
  if (!interaction.isButton()) return;
  const customId = interaction.customId;
  if (!customId.startsWith('bp_rank_lim_kpad|')) return;

  const parsed = parseBpRankLimitKeypadId(customId);
  if (!parsed) {
    await interaction.reply(
      buildEphemeralWithBotingBackPayload(
        '❌ このキーは無効です。表示数変更を開き直してください。',
      ),
    );
    return;
  }

  const userId = interaction.user.id;
  let draft = getBpRankLimitDraft(userId);
  if (!draft || !draft.mode) {
    await interaction.reply(
      buildEphemeralWithBotingBackPayload(
        '❌ セッションが無効です。ランキングを開き直してください。',
      ),
    );
    return;
  }

  const mode =
    draft.mode === BP_RANK_MODE.RECOVERY ||
    draft.mode === BP_RANK_MODE.HIT_RATE ||
    draft.mode === BP_RANK_MODE.PURCHASE ||
    draft.mode === BP_RANK_MODE.BALANCE
      ? draft.mode
      : BP_RANK_MODE.BALANCE;

  const extraFlags = v2ExtraFlags(interaction);

  if (parsed.op === 'digit' && parsed.digit != null) {
    const nextBuf = appendDigitLimit(draft.buffer, parsed.digit);
    setBpRankLimitDraft(userId, { ...draft, buffer: nextBuf });
    await interaction.update(
      buildBpRankLimitKeypadPayload({ buffer: nextBuf, extraFlags }),
    );
    return;
  }

  if (parsed.op === 'del') {
    const nextBuf = deleteLastDigitLimit(draft.buffer);
    setBpRankLimitDraft(userId, { ...draft, buffer: nextBuf });
    await interaction.update(
      buildBpRankLimitKeypadPayload({ buffer: nextBuf, extraFlags }),
    );
    return;
  }

  if (parsed.op === 'can') {
    clearBpRankLimitDraft(userId);
    await interaction.deferUpdate();
    const lim = Math.min(BP_RANK_DISPLAY_MAX, Math.max(1, draft.savedLimit));
    try {
      await interaction.editReply(
        await buildBpRankLeaderboardFullPayload(lim, mode, extraFlags, {
          client: interaction.client,
          guild: interaction.guild,
          refundForUserId: userId,
        }),
      );
    } catch (e) {
      console.error('bpRankLimitKeypad cancel:', e);
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline: `❌ ランキングの復元に失敗しました: ${e.message}`,
          actionRows: [],
          extraFlags,
          withBotingMenuBack: true,
        }),
      );
    }
    return;
  }

  if (parsed.op === 'ok') {
    const lim = bufferToLimit(draft.buffer);
    clearBpRankLimitDraft(userId);
    await interaction.deferUpdate();
    try {
      await interaction.editReply(
        await buildBpRankLeaderboardFullPayload(lim, mode, extraFlags, {
          client: interaction.client,
          guild: interaction.guild,
          refundForUserId: userId,
        }),
      );
    } catch (e) {
      console.error('bpRankLimitKeypad ok:', e);
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline: `❌ ランキングの更新に失敗しました: ${e.message}`,
          actionRows: [],
          extraFlags,
          withBotingMenuBack: true,
        }),
      );
    }
  }
}
