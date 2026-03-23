import { MessageFlags } from 'discord.js';
import { canUseDebugCommands } from '../../utils/raceDebugBypass.mjs';
import { setDebugAclDraft } from '../../utils/debugAclFlowStore.mjs';
import { buildDebugAclConfirmPayload } from '../../utils/debugHubPanel.mjs';
import { DEBUG_HUB_PREFIX } from '../../utils/debugHubConstants.mjs';

function v2ExtraFlags(interaction) {
  let extraFlags = 0;
  try {
    if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
      extraFlags |= MessageFlags.Ephemeral;
    }
  } catch (_) {
    /* ignore */
  }
  return extraFlags;
}

function targetMention(userId) {
  return `<@${userId}>`;
}

/**
 * @param {import('discord.js').UserSelectMenuInteraction} interaction
 */
export default async function debugHubAclUserSelect(interaction) {
  if (!interaction.isUserSelectMenu()) return;
  const customId = interaction.customId;
  if (!customId.startsWith(`${DEBUG_HUB_PREFIX}|acl_user_pick|`)) return;

  if (!canUseDebugCommands(interaction.user.id)) {
    await interaction.reply({
      content: '❌ この操作は使用できません。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const modeStr = customId.split('|')[2];
  const mode = modeStr === 'remove' ? 'remove' : 'add';
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
  setDebugAclDraft(interaction.user.id, { mode, targetUserId: targetId });

  await interaction.update(
    buildDebugAclConfirmPayload({
      mode,
      targetLabel: `${targetMention(targetId)}（\`${targetId}\`）`,
      extraFlags,
    }),
  );
}
