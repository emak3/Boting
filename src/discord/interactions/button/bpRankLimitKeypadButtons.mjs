import {
  appendDigitLimit,
  BP_RANK_DISPLAY_MAX,
  bufferToLimit,
  buildBpRankLimitKeypadPayload,
  deleteLastDigitLimit,
  parseBpRankLimitKeypadId,
} from '../../utils/bp/bpRankLimitKeypad.mjs';
import {
  clearBpRankLimitDraft,
  getBpRankLimitDraft,
  setBpRankLimitDraft,
} from '../../utils/bp/bpRankLimitKeypadStore.mjs';
import {
  BP_RANK_MODE,
  buildBpRankLeaderboardFullPayload,
} from '../../utils/bp/bpRankLeaderboardEmbed.mjs';
import { buildEphemeralWithBotingBackPayload } from '../../utils/boting/botingBackButton.mjs';
import { buildTextAndRowsV2Payload } from '../../utils/race/raceCardDisplay.mjs';
import { v2ExtraFlags } from '../../utils/shared/interactionResponse.mjs';
import { resolveLocaleFromInteraction, t } from '../../../i18n/index.mjs';

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 */
export default async function bpRankLimitKeypadButtons(interaction) {
  if (!interaction.isButton()) return;
  const customId = interaction.customId;
  if (!customId.startsWith('bp_rank_lim_kpad|')) return;

  const loc = resolveLocaleFromInteraction(interaction);

  const parsed = parseBpRankLimitKeypadId(customId);
  if (!parsed) {
    await interaction.reply(
      buildEphemeralWithBotingBackPayload(
        t('bp_rank.errors.keypad_invalid', null, loc),
        { locale: loc },
      ),
    );
    return;
  }

  const userId = interaction.user.id;
  let draft = getBpRankLimitDraft(userId);
  if (!draft || !draft.mode) {
    await interaction.reply(
      buildEphemeralWithBotingBackPayload(
        t('bp_rank.errors.keypad_session_expired', null, loc),
        { locale: loc },
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
      buildBpRankLimitKeypadPayload({
        buffer: nextBuf,
        extraFlags,
        locale: loc,
      }),
    );
    return;
  }

  if (parsed.op === 'del') {
    const nextBuf = deleteLastDigitLimit(draft.buffer);
    setBpRankLimitDraft(userId, { ...draft, buffer: nextBuf });
    await interaction.update(
      buildBpRankLimitKeypadPayload({
        buffer: nextBuf,
        extraFlags,
        locale: loc,
      }),
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
          locale: loc,
        }),
      );
    } catch (e) {
      console.error('bpRankLimitKeypad cancel:', e);
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline: t('bp_rank.errors.leaderboard_restore_failed', { message: e.message }, loc),
          actionRows: [],
          extraFlags,
          withBotingMenuBack: true,
          locale: loc,
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
          locale: loc,
        }),
      );
    } catch (e) {
      console.error('bpRankLimitKeypad ok:', e);
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline: t('bp_rank.errors.leaderboard_update_failed', { message: e.message }, loc),
          actionRows: [],
          extraFlags,
          withBotingMenuBack: true,
          locale: loc,
        }),
      );
    }
  }
}
