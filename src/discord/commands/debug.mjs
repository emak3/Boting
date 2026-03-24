import {
  SlashCommandBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { canUseDebugCommands } from '../utils/debug/raceDebugBypass.mjs';
import { saveDebugPanelFromSlashInteraction } from '../utils/debug/debugPanelWebhookStore.mjs';
import { buildDebugPanelPayload } from '../utils/debug/debugHubPanel.mjs';

const commandObject = {
  command: new SlashCommandBuilder()
    .setName('debug')
    .setDescription(
      'デバッグパネル（発売締切バイパス・BP 付与・剥奪・週間チャレンジ設定）',
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    if (!canUseDebugCommands(interaction.user.id)) {
      await interaction.reply({
        content: '❌ このコマンドは使用できません。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply(
      await buildDebugPanelPayload({ extraFlags: MessageFlags.Ephemeral }),
    );
    await saveDebugPanelFromSlashInteraction(interaction);
  },
};

export default commandObject;
