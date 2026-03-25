import { MessageFlags } from 'discord.js';
import { canUseDebugCommands } from '../../utils/debug/raceDebugBypass.mjs';
import { buildDebugBpKeypadPayload } from '../../utils/debug/debugBpKeypad.mjs';
import { setDebugBpDraft } from '../../utils/debug/debugBpFlowStore.mjs';
import { DEBUG_HUB_MODAL_PREFIX } from '../../utils/debug/debugHubConstants.mjs';
import {
  deferEphemeralThenEditReply,
  v2ExtraFlags,
} from '../../utils/shared/interactionResponse.mjs';
import { resolveLocaleFromInteraction, t } from '../../../i18n/index.mjs';

function isValidSnowflake(s) {
  return /^\d{17,20}$/.test(String(s).trim());
}

function targetMention(userId) {
  return `<@${userId}>`;
}

/**
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 */
export default async function debugHubModal(interaction) {
  if (!interaction.isModalSubmit()) return;
  const customId = interaction.customId;
  if (!customId.startsWith(`${DEBUG_HUB_MODAL_PREFIX}|`)) return;
  const segs = customId.split('|');
  if (segs[1] === 'acl') return;

  const loc = resolveLocaleFromInteraction(interaction);

  if (!canUseDebugCommands(interaction.user.id)) {
    await interaction.reply({
      content: t('debug_hub.errors.forbidden', null, loc),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const mode = segs[1] === 'revoke' ? 'revoke' : 'grant';
  const raw = interaction.fields.getTextInputValue('user_id') || '';
  const id = raw.trim();
  if (!isValidSnowflake(id)) {
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
  setDebugBpDraft(interaction.user.id, {
    mode,
    targetUserId: id,
    buffer: '',
  });

  await deferEphemeralThenEditReply(
    interaction,
    buildDebugBpKeypadPayload({
      mode,
      targetLabel: targetMention(id),
      buffer: '',
      extraFlags,
    }),
  );
}
