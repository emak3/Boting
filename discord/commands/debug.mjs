import {
  SlashCommandBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { canUseDebugCommands } from '../utils/raceDebugBypass.mjs';
import { buildDebugPanelPayload } from '../utils/debugHubPanel.mjs';

const commandObject = {
  command: new SlashCommandBuilder()
    .setName('debug')
    .setDescription('デバッグパネル（発売締切バイパス・BP 付与・剥奪）')
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
      buildDebugPanelPayload({ extraFlags: MessageFlags.Ephemeral }),
    );
  },
};

export default commandObject;
