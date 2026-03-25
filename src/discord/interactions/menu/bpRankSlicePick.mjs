import { MessageFlags } from 'discord.js';
import {
  BP_RANK_DISPLAY_MAX,
  BP_RANK_SLICE_PICK_MAX,
  BP_RANK_SLICE_PICK_PREFIX,
  loadBpRankLeaderboardState,
} from '../../utils/bp/bpRankLeaderboardEmbed.mjs';
import { buildTextAndRowsV2Payload } from '../../utils/race/raceCardDisplay.mjs';
import { buildAnnualStatsPanelPayload } from '../../utils/boting/botingStatsPanels.mjs';
import { runPendingRaceRefundsForUser } from '../../utils/race/raceBetRefundSweep.mjs';
import { v2ExtraFlags } from '../../utils/shared/interactionResponse.mjs';
import { resolveLocaleFromInteraction, t } from '../../../i18n/index.mjs';

function normalizeMode(raw) {
  const m = String(raw || '');
  if (m === 'recovery' || m === 'hit_rate' || m === 'purchase') return m;
  return 'balance';
}

/**
 * 表示中ランキングの String Select → 年間統計（下段から購入履歴・収支・ランキングへ）
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export default async function bpRankSlicePick(interaction) {
  if (!interaction.isStringSelectMenu()) return;
  const cid = interaction.customId;
  if (!cid.startsWith(`${BP_RANK_SLICE_PICK_PREFIX}|`)) return;

  const loc = resolveLocaleFromInteraction(interaction);
  const parts = cid.split('|');
  const lim = Math.min(BP_RANK_DISPLAY_MAX, Math.max(1, parseInt(parts[1], 10) || 20));
  const mode = normalizeMode(parts[2]);
  const targetId = interaction.values[0];

  const { slice } = await loadBpRankLeaderboardState(lim, mode, {
    refundForUserId: interaction.user.id,
  });
  const allowed = new Set(
    slice.slice(0, BP_RANK_SLICE_PICK_MAX).map((r) => r.userId),
  );
  if (!allowed.has(targetId)) {
    await interaction.reply({
      content: t('bp_rank.errors.slice_invalid', null, loc),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const u = await interaction.client.users.fetch(targetId).catch(() => null);
  if (u?.bot) {
    await interaction.reply({
      content: t('bp_rank.errors.bot_stats_forbidden', null, loc),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const extraFlags = v2ExtraFlags(interaction);

  await interaction.deferUpdate();

  try {
    await runPendingRaceRefundsForUser(targetId);
    const payload = await buildAnnualStatsPanelPayload({
      userId: targetId,
      extraFlags,
      rankLeaderboardReturn: { limit: lim, mode },
      locale: loc,
    });
    await interaction.editReply(payload);
  } catch (e) {
    console.error('bpRankSlicePick:', e);
    await interaction.editReply(
      buildTextAndRowsV2Payload({
        headline: t('bp_rank.errors.annual_stats_failed', { message: e.message }, loc),
        actionRows: [],
        extraFlags,
        withBotingMenuBack: true,
        locale: loc,
      }),
    );
  }
}
