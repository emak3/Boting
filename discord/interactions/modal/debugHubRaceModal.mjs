import { MessageFlags } from 'discord.js';
import { findRaceMetaForToday } from '../../../cheerio/netkeibaSchedule.mjs';
import { canUseDebugCommands } from '../../utils/raceDebugBypass.mjs';
import { buildRaceMenuSelectionPayload } from '../menu/raceSchedule.mjs';
import { buildTextAndRowsV2Payload } from '../../utils/raceCardDisplay.mjs';
import { venueSelectionStore } from '../../utils/venueSelectionStore.mjs';
import { DEBUG_RACE_MODAL_PREFIX } from '../../utils/debugHubConstants.mjs';

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

/**
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 */
export default async function debugHubRaceModal(interaction) {
  if (!interaction.isModalSubmit()) return;
  const customId = interaction.customId;
  if (!customId.startsWith(`${DEBUG_RACE_MODAL_PREFIX}|`)) return;

  if (!canUseDebugCommands(interaction.user.id)) {
    await interaction.reply({
      content: '❌ この操作は使用できません。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const kind = customId.split('|')[1];
  if (kind !== 'jra' && kind !== 'nar') return;

  const raceId = (interaction.fields.getTextInputValue('race_id') || '').trim();
  if (!/^\d{12}$/.test(raceId)) {
    await interaction.reply({
      content: '❌ レースIDは 12 桁の数字で入力してください。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const userId = interaction.user.id;
  const meta = await findRaceMetaForToday(raceId);
  if (meta) {
    venueSelectionStore.set(userId, {
      source: meta.source,
      kaisaiDate: meta.kaisaiDateYmd,
      currentGroup: meta.currentGroup ?? null,
      kaisaiId: meta.scheduleKaisaiId,
    });
  } else {
    venueSelectionStore.delete(userId);
  }

  const extraFlags = v2ExtraFlags(interaction);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const payload = await buildRaceMenuSelectionPayload(interaction, {
      raceId,
      isResultFlag: '0',
    });
    await interaction.editReply(payload);
  } catch (e) {
    console.error('debugHubRaceModal', e);
    await interaction.editReply(
      buildTextAndRowsV2Payload({
        headline: `❌ 出馬表の取得に失敗: ${e.message}`,
        actionRows: [],
        extraFlags,
      }),
    );
  }
}
