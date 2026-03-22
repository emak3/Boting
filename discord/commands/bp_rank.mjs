import {
  SlashCommandBuilder,
  InteractionContextType,
  MessageFlags,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import {
  fetchAllUsersByBalanceDesc,
  computeBpRank,
} from '../utils/bpLeaderboard.mjs';
import { runPendingRaceRefundsForUser } from '../utils/raceBetRefundSweep.mjs';
import {
  buildBpRankUserDetailV2Container,
  BP_RANK_USER_HISTORY_PREFIX,
} from '../utils/bpRankUserDetailEmbed.mjs';

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

      const historyRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${BP_RANK_USER_HISTORY_PREFIX}|${targetUser.id}`)
          .setLabel('購入履歴')
          .setStyle(ButtonStyle.Secondary),
      );

      await interaction.editReply({
        content: null,
        embeds: [],
        components: [container, historyRow],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    await interaction.deferReply();
    await runPendingRaceRefundsForUser(interaction.user.id);

    let sorted;
    try {
      sorted = await fetchAllUsersByBalanceDesc();
    } catch (e) {
      console.error('bp_rank / fetchAllUsersByBalanceDesc:', e);
      await interaction.editReply({
        content: `❌ ランキングの取得に失敗しました: ${e.message}`,
      });
      return;
    }

    const slice = sorted.slice(0, limit);
    const lines = slice.map((row, i) => {
      const medal =
        i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      return `${medal} <@${row.userId}> — **${row.balance}** bp`;
    });

    const body =
      lines.length > 0
        ? lines.join('\n')
        : 'まだ誰も BP データがありません。';

    const embed = new EmbedBuilder()
      .setTitle(`BP ランキング（上位 ${slice.length} / 全 ${sorted.length} 名）`)
      .setColor(0xf1c40f)
      .setDescription(body);

    await interaction.editReply({ embeds: [embed] });
  },
};

export default commandObject;
