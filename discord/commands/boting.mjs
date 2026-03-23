import {
  SlashCommandBuilder,
  InteractionContextType,
  MessageFlags,
} from 'discord.js';
import { buildBotingPanelPayload } from '../utils/raceCommandHub.mjs';
import { runPendingRaceRefundsForUser } from '../utils/raceBetRefundSweep.mjs';

const commandObject = {
  command: new SlashCommandBuilder()
    .setName('boting')
    .setDescription(
      'メインメニュー（Daily・馬券・履歴・購入予定・ランキング）',
    )
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await runPendingRaceRefundsForUser(interaction.user.id);

    try {
      await interaction.editReply(
        await buildBotingPanelPayload({
          user: interaction.user,
          guild: interaction.guild,
          extraFlags: MessageFlags.Ephemeral,
        }),
      );
    } catch (e) {
      console.error('boting:', e);
      await interaction.editReply({
        content: `❌ 表示に失敗しました: ${e.message}`,
      });
    }
  },
};

export default commandObject;
