import { MessageFlags } from 'discord.js';
import { canUseDebugCommands } from '../../utils/debug/raceDebugBypass.mjs';
import { buildDebugBpKeypadPayload } from '../../utils/debug/debugBpKeypad.mjs';
import { setDebugBpDraft } from '../../utils/debug/debugBpFlowStore.mjs';
import { DEBUG_HUB_PREFIX } from '../../utils/debug/debugHubConstants.mjs';
import { v2ExtraFlags } from '../../utils/shared/interactionResponse.mjs';

function targetMention(userId) {
  return `<@${userId}>`;
}

/**
 * @param {import('discord.js').UserSelectMenuInteraction} interaction
 */
export default async function debugHubUserSelect(interaction) {
  if (!interaction.isUserSelectMenu()) return;
  const customId = interaction.customId;
  if (!customId.startsWith(`${DEBUG_HUB_PREFIX}|user_pick|`)) return;

  if (!canUseDebugCommands(interaction.user.id)) {
    await interaction.reply({
      content: '❌ この操作は使用できません。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const modeStr = customId.split('|')[2];
  const mode = modeStr === 'revoke' ? 'revoke' : 'grant';
  const targetId = interaction.values[0];
  let user = interaction.users?.first?.() ?? null;
  if (!user) {
    user = await interaction.client.users.fetch(targetId).catch(() => null);
  }
  if (!user) {
    await interaction.reply({
      content: '❌ ユーザーを取得できませんでした。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (user.bot) {
    await interaction.reply({
      content: '❌ BOT ではなくユーザーを選んでください。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const extraFlags = v2ExtraFlags(interaction);
  setDebugBpDraft(interaction.user.id, {
    mode,
    targetUserId: targetId,
    buffer: '',
  });

  await interaction.update(
    buildDebugBpKeypadPayload({
      mode,
      targetLabel: targetMention(targetId),
      buffer: '',
      extraFlags,
    }),
  );
}
