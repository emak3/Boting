import {
  SlashCommandBuilder,
  InteractionContextType,
  MessageFlags,
} from 'discord.js';
import { canUseDebugCommands } from '../utils/raceDebugBypass.mjs';
import { applyDebugBpAdjustment } from '../utils/userPointsStore.mjs';

const commandObject = {
  command: new SlashCommandBuilder()
    .setName('debug_bp')
    .setDescription('指定ユーザーの bp を増減（デバッグ権限者のみ）')
    .addUserOption((o) =>
      o.setName('user').setDescription('対象ユーザー').setRequired(true),
    )
    .addIntegerOption((o) =>
      o
        .setName('amount')
        .setDescription('増やす量（マイナスで減らす）')
        .setRequired(true)
        .setMinValue(-99_999_999)
        .setMaxValue(99_999_999),
    )
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    if (!canUseDebugCommands(interaction.user.id)) {
      await interaction.reply({
        content: '❌ このコマンドは使用できません。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const target = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);

    if (target.bot) {
      await interaction.reply({
        content: '❌ BOT ではなくユーザーを指定してください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await applyDebugBpAdjustment(target.id, amount);
    if (!result.ok) {
      if (result.reason === 'zero_delta') {
        await interaction.editReply({
          content: '❌ 0 以外の整数を指定してください。',
        });
        return;
      }
      if (result.reason === 'delta_too_large') {
        await interaction.editReply({
          content: '❌ 調整量が大きすぎます。',
        });
        return;
      }
      if (result.reason === 'would_go_negative') {
        await interaction.editReply({
          content: `❌ 残高が負になります（現在 **${result.balance}** bp）。`,
        });
        return;
      }
      await interaction.editReply({ content: '❌ 調整に失敗しました。' });
      return;
    }

    const sign = result.delta > 0 ? '+' : '';
    const who = `${target}（\`${target.id}\`）`;
    await interaction.editReply({
      content: [
        who,
        `${sign}${result.delta} bp → 残高 **${result.balanceAfter}** bp（調整前 ${result.balanceBefore} bp）`,
      ].join('\n'),
    });
  },
};

export default commandObject;
