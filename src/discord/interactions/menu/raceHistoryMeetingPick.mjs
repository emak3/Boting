import { MessageFlags } from 'discord.js';
import { RACE_HISTORY_MEETING_PREFIX, stripRaceHistoryBpCtx } from '../../components/racePurchaseHistory/ids.mjs';
import { resolveLocaleFromInteraction, t } from '../../../i18n/index.mjs';
import { buildRacePurchaseHistoryV2Payload } from '../../utils/race/racePurchaseHistoryUi.mjs';
import {
  deferUpdateThenEditReply,
  v2ExtraFlags,
} from '../../utils/shared/interactionResponse.mjs';

/**
 * 購入履歴の開催場フィルタ（String Select）
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export default async function raceHistoryMeetingPick(interaction) {
  if (!interaction.isStringSelectMenu()) return;
  const cid = interaction.customId;
  if (!cid.startsWith(`${RACE_HISTORY_MEETING_PREFIX}|`)) return;

  const { withoutCtx, bpctxUserId, rankLeaderboardReturn } = stripRaceHistoryBpCtx(cid);
  const parts = withoutCtx.split('|');
  if (parts.length < 2 || parts[0] !== RACE_HISTORY_MEETING_PREFIX) return;

  const loc = resolveLocaleFromInteraction(interaction);
  const periodKey = parts[1];
  if (!/^\d{8}$/.test(String(periodKey || ''))) {
    await interaction.reply({
      content: t('race_purchase_history.errors.invalid_period', null, loc),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const meetingFilter = String(interaction.values[0] ?? '').trim() || 'all';
  if (meetingFilter !== 'all' && !/^\d{10}$/.test(meetingFilter)) {
    await interaction.reply({
      content: t('race_purchase_history.errors.invalid_meeting', null, loc),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const subjectUserId = bpctxUserId || interaction.user.id;

  try {
    await deferUpdateThenEditReply(
      interaction,
      buildRacePurchaseHistoryV2Payload({
        userId: subjectUserId,
        periodKey,
        page: 0,
        meetingFilter,
        extraFlags: v2ExtraFlags(interaction),
        bpRankProfileUserId: bpctxUserId || null,
        rankLeaderboardReturn: rankLeaderboardReturn || null,
        locale: loc,
      }),
    );
  } catch (e) {
    console.error('raceHistoryMeetingPick', e);
    await interaction
      .editReply({
        content: t('race_purchase_history.errors.update_failed', { message: e.message }, loc),
      })
      .catch(() => {});
  }
}
