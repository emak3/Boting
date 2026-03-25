import { MessageFlags } from 'discord.js';
import { canUseDebugCommands } from '../../utils/debug/raceDebugBypass.mjs';
import { setDebugAclDraft } from '../../utils/debug/debugAclFlowStore.mjs';
import { buildDebugAclConfirmPayload } from '../../utils/debug/debugHubPanel.mjs';
import { DEBUG_HUB_MODAL_PREFIX } from '../../utils/debug/debugHubConstants.mjs';
import {
  deferEphemeralThenEditReply,
  v2ExtraFlags,
} from '../../utils/shared/interactionResponse.mjs';
import { resolveLocaleFromInteraction, t } from '../../../i18n/index.mjs';

function targetMention(userId) {
  return `<@${userId}>`;
}

/**
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 */
export default async function debugHubAclModal(interaction) {
  if (!interaction.isModalSubmit()) return;
  const customId = interaction.customId;
  const parts = customId.split('|');
  if (parts[0] !== DEBUG_HUB_MODAL_PREFIX || parts[1] !== 'acl') return;

  const loc = resolveLocaleFromInteraction(interaction);

  if (!canUseDebugCommands(interaction.user.id)) {
    await interaction.reply({
      content: t('debug_hub.errors.forbidden', null, loc),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const mode = parts[2] === 'remove' ? 'remove' : 'add';
  const raw = interaction.fields.getTextInputValue('user_id') || '';
  const id = raw.trim();
  if (!/^\d{17,20}$/.test(id)) {
    await interaction.reply({
      content: t('debug_hub.errors.invalid_user_id', null, loc),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const targetUser = await interaction.client.users.fetch(id).catch(() => null);
  if (!targetUser) {
    await interaction.reply({
      content: t('debug_hub.errors.user_fetch_failed', null, loc),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (targetUser.bot) {
    await interaction.reply({
      content: t('debug_hub.errors.bot_not_allowed', null, loc),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const extraFlags = v2ExtraFlags(interaction, { assumeEphemeral: true });
  setDebugAclDraft(interaction.user.id, { mode, targetUserId: id });

  await deferEphemeralThenEditReply(
    interaction,
    buildDebugAclConfirmPayload({
      mode,
      targetLabel: `${targetMention(id)}（\`${id}\`）`,
      extraFlags,
    }),
  );
}
