import {
  SlashCommandBuilder,
  InteractionContextType,
  MessageFlags,
} from 'discord.js';
import { buildBotingPanelPayload } from '../utils/race/raceCommandHub.mjs';
import { isDatabaseCapacityError } from '../utils/shared/databaseErrors.mjs';

const commandObject = {
  command: new SlashCommandBuilder()
    .setName('boting')
    .setDescription(
      'メインメニュー（Daily・馬券・履歴・購入予定・ランキング）',
    )
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
      if (isDatabaseCapacityError(e)) {
        await interaction.editReply({
          content:
            '❌ データベースの利用上限に達しました（クォータ超過またはディスク不足）。\n' +
            'ホストの空き容量や、クラウド DB の場合はコンソールの上限設定を確認してください。',
        });
        return;
      }
      await interaction.editReply({
        content: `❌ 表示に失敗しました: ${e.message}`,
      });
    }
  },
};

export default commandObject;
