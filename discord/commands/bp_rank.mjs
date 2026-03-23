import {
  SlashCommandBuilder,
  InteractionContextType,
  MessageFlags,
} from 'discord.js';
import { computeBpRank } from '../utils/bpLeaderboard.mjs';
import { runPendingRaceRefundsForUser } from '../utils/raceBetRefundSweep.mjs';
import { buildBpRankUserDetailV2Container } from '../utils/bpRankUserDetailEmbed.mjs';
import { buildBpRankProfileButtonsRow } from '../utils/bpRankUiButtons.mjs';
import {
  buildBpRankLeaderboardEmbed,
  buildBpRankSelectRow,
  BP_RANK_MODE,
} from '../utils/bpRankLeaderboardEmbed.mjs';

const commandObject = {
  command: new SlashCommandBuilder()
    .setName('bp_rank')
    .setDescription('BP 残高ランキング、または指定ユーザーの順位・購入統計')
    .addIntegerOption((o) =>
      o
        .setName('limit')
        .setDescription('ランキングの表示件数（1〜50、ユーザー未指定時のみ）')
        .setMinValue(1)
        .setMaxValue(50),
    )
    .addUserOption((o) =>
      o.setName('user').setDescription('詳細（順位・統計）を表示するユーザー'),
    )
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user');
    const limitRaw = interaction.options.getInteger('limit');
    const limit = Math.min(
      50,
      Math.max(1, limitRaw ?? 20),
    );

    if (targetUser) {
      if (targetUser.bot) {
        await interaction.reply({
          content: '❌ BOT ではなくユーザーを指定してください。',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply();

      let container;
      try {
        container = await buildBpRankUserDetailV2Container(
          targetUser,
          interaction.guild,
          interaction.user.id,
        );
      } catch (e) {
        console.error('bp_rank / detail:', e);
        await interaction.editReply({
          content: `❌ 詳細の取得に失敗しました: ${e.message}`,
        });
        return;
      }

      const profileRow = buildBpRankProfileButtonsRow(targetUser.id);

      await interaction.editReply({
        content: null,
        embeds: [],
        components: [container, profileRow],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    await interaction.deferReply();
    await runPendingRaceRefundsForUser(interaction.user.id);

    let embed;
    try {
      const built = await buildBpRankLeaderboardEmbed(limit, BP_RANK_MODE.BALANCE);
      embed = built.embed;
    } catch (e) {
      console.error('bp_rank / buildBpRankLeaderboardEmbed:', e);
      await interaction.editReply({
        content: `❌ ランキングの取得に失敗しました: ${e.message}`,
      });
      return;
    }

    const selectRow = buildBpRankSelectRow(limit, BP_RANK_MODE.BALANCE);

    await interaction.editReply({
      embeds: [embed],
      components: [selectRow],
    });
  },
};

export default commandObject;
