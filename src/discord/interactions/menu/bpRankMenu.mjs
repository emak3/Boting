import {
  BP_RANK_SELECT_PREFIX,
  BP_RANK_DISPLAY_MAX,
  buildBpRankLeaderboardFullPayload,
  BP_RANK_MODE,
} from '../../utils/bp/bpRankLeaderboardEmbed.mjs';
import { buildTextAndRowsV2Payload } from '../../utils/race/raceCardDisplay.mjs';
import {
  deferUpdateThenEditReply,
  v2ExtraFlags,
} from '../../utils/shared/interactionResponse.mjs';
import { resolveLocaleFromInteraction, t } from '../../../i18n/index.mjs';

/**
 * ランキング種別セレクト（`/boting` のランキング画面）
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export default async function bpRankMenu(interaction) {
  if (!interaction.isStringSelectMenu()) return;
  if (!interaction.customId.startsWith(`${BP_RANK_SELECT_PREFIX}|`)) return;

  const loc = resolveLocaleFromInteraction(interaction);
  const limitPart = interaction.customId.split('|')[1];
  const limit = Math.min(
    BP_RANK_DISPLAY_MAX,
    Math.max(1, parseInt(String(limitPart || ''), 10) || 20),
  );
  const raw = interaction.values[0];
  const mode =
    raw === BP_RANK_MODE.RECOVERY ||
    raw === BP_RANK_MODE.HIT_RATE ||
    raw === BP_RANK_MODE.PURCHASE ||
    raw === BP_RANK_MODE.BALANCE
      ? raw
      : BP_RANK_MODE.BALANCE;

  const extraFlags = v2ExtraFlags(interaction);

  try {
    await deferUpdateThenEditReply(
      interaction,
      buildBpRankLeaderboardFullPayload(limit, mode, extraFlags, {
        client: interaction.client,
        guild: interaction.guild,
        refundForUserId: interaction.user.id,
        locale: loc,
      }),
    );
  } catch (e) {
    console.error('bpRankMenu:', e);
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
