import {
  SlashCommandBuilder,
  InteractionContextType,
  MessageFlags,
} from 'discord.js';
import {
  setDebugSalesBypass,
  isDebugSalesBypassEnabled,
  canUseDebugCommands,
} from '../utils/raceDebugBypass.mjs';

const commandObject = {
  command: new SlashCommandBuilder()
    .setName('race_debug')
    .setDescription('発売締切のデバッグバイパス（指定ユーザー専用）')
    .addSubcommand((s) =>
      s.setName('on').setDescription('バイパスを有効（許可ユーザーだけ発売終了レースを利用可）'),
    )
    .addSubcommand((s) => s.setName('off').setDescription('バイパスを無効'))
    .addSubcommand((s) => s.setName('status').setDescription('現在の状態'))
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    if (!canUseDebugCommands(interaction.user.id)) {
      await interaction.reply({
        content: '❌ このコマンドは使用できません。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'on') {
      setDebugSalesBypass(true);
      await interaction.reply({
        content:
          '🔧 デバッグ: 発売締切バイパス **ON**（あなたのみ適用。他ユーザーは従来どおり締切後は購入不可）',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (sub === 'off') {
      setDebugSalesBypass(false);
      await interaction.reply({
        content: '🔧 デバッグ: 発売締切バイパス **OFF**',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      content: `デバッグバイパス: **${isDebugSalesBypassEnabled() ? 'ON' : 'OFF'}**`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default commandObject;
