import {
  SlashCommandBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  MessageFlags,
  Locale,
} from 'discord.js';
import { canUseDebugCommands } from '../utils/debug/raceDebugBypass.mjs';
import { saveDebugPanelFromSlashInteraction } from '../utils/debug/debugPanelWebhookStore.mjs';
import { buildDebugPanelPayload } from '../utils/debug/debugHubPanel.mjs';
import { deferEphemeralThenEditReply } from '../utils/shared/interactionResponse.mjs';
import { resolveLocaleFromInteraction, t } from '../../i18n/index.mjs';

const commandObject = {
  command: new SlashCommandBuilder()
    .setName('debug')
    .setDescription(
      'デバッグパネル（発売締切バイパス・BP 付与・剥奪・週間チャレンジ設定）',
    )
    .setDescriptionLocalizations({
      [Locale.EnglishUS]: t('slash_commands.debug', null, 'en'),
    })
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    if (!canUseDebugCommands(interaction.user.id)) {
      const loc = resolveLocaleFromInteraction(interaction);
      await interaction.reply({
        content: t('slash_commands.debug_forbidden', null, loc),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await deferEphemeralThenEditReply(
      interaction,
      buildDebugPanelPayload({ extraFlags: MessageFlags.Ephemeral }),
    );
    await saveDebugPanelFromSlashInteraction(interaction);
  },
};

export default commandObject;
