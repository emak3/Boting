import {
  BP_RANK_SELECT_PREFIX,
  BP_RANK_DISPLAY_MAX,
  buildBpRankLeaderboardFullPayload,
  BP_RANK_MODE,
} from '../../utils/bp/bpRankLeaderboardEmbed.mjs';
import { MessageFlags } from 'discord.js';
import { buildTextAndRowsV2Payload } from '../../utils/race/raceCardDisplay.mjs';

/**
 * ランキング種別セレクト（`/boting` のランキング画面）
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export default async function bpRankMenu(interaction) {
  if (!interaction.isStringSelectMenu()) return;
  if (!interaction.customId.startsWith(`${BP_RANK_SELECT_PREFIX}|`)) return;

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

  await interaction.deferUpdate();

  let extraFlags = 0;
  try {
    if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
      extraFlags |= MessageFlags.Ephemeral;
    }
  } catch (_) {
    /* ignore */
  }

  try {
    await interaction.editReply(
      await buildBpRankLeaderboardFullPayload(limit, mode, extraFlags, {
        client: interaction.client,
        guild: interaction.guild,
        refundForUserId: interaction.user.id,
      }),
    );
  } catch (e) {
    console.error('bpRankMenu:', e);
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
