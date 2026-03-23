import { MessageFlags } from 'discord.js';
import { canUseDebugCommands } from '../../utils/debug/raceDebugBypass.mjs';
import { buildDebugBpKeypadPayload } from '../../utils/debug/debugBpKeypad.mjs';
import { setDebugBpDraft } from '../../utils/debug/debugBpFlowStore.mjs';
import { DEBUG_HUB_MODAL_PREFIX } from '../../utils/debug/debugHubConstants.mjs';

function v2ExtraFlags(interaction) {
  let extraFlags = MessageFlags.Ephemeral;
  try {
    if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
      extraFlags |= MessageFlags.Ephemeral;
    }
  } catch (_) {
    /* ignore */
  }
  return extraFlags;
}

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

  if (!canUseDebugCommands(interaction.user.id)) {
    await interaction.reply({
      content: '❌ この操作は使用できません。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const mode = segs[1] === 'revoke' ? 'revoke' : 'grant';
  const raw = interaction.fields.getTextInputValue('user_id') || '';
  const id = raw.trim();
  if (!isValidSnowflake(id)) {
    await interaction.reply({
      content: '❌ ユーザーIDの形式が不正です（17〜20桁の数字）。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const targetUser = await interaction.client.users.fetch(id).catch(() => null);
  if (!targetUser) {
    await interaction.reply({
      content: '❌ その ID のユーザーを取得できませんでした。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (targetUser.bot) {
    await interaction.reply({
      content: '❌ BOT ではなくユーザーを指定してください。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const extraFlags = v2ExtraFlags(interaction);
  setDebugBpDraft(interaction.user.id, {
    mode,
    targetUserId: id,
    buffer: '',
  });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.editReply(
    buildDebugBpKeypadPayload({
      mode,
      targetLabel: targetMention(id),
      buffer: '',
      extraFlags,
    }),
  );
}
