import { MessageFlags } from 'discord.js';
import { findRaceMetaForToday } from '../../../scrapers/netkeiba/netkeibaSchedule.mjs';
import { canUseDebugCommands } from '../../utils/debug/raceDebugBypass.mjs';
import { buildRaceMenuSelectionPayload } from '../menu/raceSchedule.mjs';
import { buildTextAndRowsV2Payload } from '../../utils/race/raceCardDisplay.mjs';
import { venueSelectionStore } from '../../utils/race/venueSelectionStore.mjs';
import { DEBUG_RACE_MODAL_PREFIX } from '../../utils/debug/debugHubConstants.mjs';
import { v2ExtraFlags } from '../../utils/shared/interactionResponse.mjs';
import { resolveLocaleFromInteraction, t } from '../../../i18n/index.mjs';

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

  const extraFlags = v2ExtraFlags(interaction, { assumeEphemeral: true });
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
        headline: t('race_schedule.errors.card_fetch_failed', { message: e.message }, loc),
        actionRows: [],
        extraFlags,
        locale: loc,
      }),
    );
  }
}
