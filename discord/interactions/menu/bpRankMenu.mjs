import {
  BP_RANK_SELECT_PREFIX,
  buildBpRankLeaderboardEmbed,
  buildBpRankSelectRow,
  BP_RANK_MODE,
} from '../../utils/bpRankLeaderboardEmbed.mjs';
import { runPendingRaceRefundsForUser } from '../../utils/raceBetRefundSweep.mjs';

/**
 * `/bp_rank` のランキング種別セレクト
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export default async function bpRankMenu(interaction) {
  if (!interaction.isStringSelectMenu()) return;
  if (!interaction.customId.startsWith(`${BP_RANK_SELECT_PREFIX}|`)) return;

  const limitPart = interaction.customId.split('|')[1];
  const limit = Math.min(
    50,
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
  await runPendingRaceRefundsForUser(interaction.user.id);

  try {
    const { embed } = await buildBpRankLeaderboardEmbed(limit, mode);
    const selectRow = buildBpRankSelectRow(limit, mode);
    await interaction.editReply({ embeds: [embed], components: [selectRow] });
  } catch (e) {
    console.error('bpRankMenu:', e);
    await interaction.editReply({
      content: `❌ ランキングの更新に失敗しました: ${e.message}`,
      embeds: [],
      components: [],
    });
  }
}
