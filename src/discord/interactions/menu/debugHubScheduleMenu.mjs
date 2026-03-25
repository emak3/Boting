import { MessageFlags } from 'discord.js';
import { canUseDebugCommands } from '../../utils/debug/raceDebugBypass.mjs';
import { buildRaceIdModal } from '../../utils/debug/debugHubPanel.mjs';
import { DEBUG_HUB_SCHEDULE_KIND_ID } from '../../utils/debug/debugHubConstants.mjs';
import { setDebugRaceKindDraft } from '../../utils/debug/debugRaceKindStore.mjs';
import { resolveLocaleFromInteraction, t } from '../../../i18n/index.mjs';

/**
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export default async function debugHubScheduleMenu(interaction) {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId !== DEBUG_HUB_SCHEDULE_KIND_ID) return;

  const loc = resolveLocaleFromInteraction(interaction);

  if (!canUseDebugCommands(interaction.user.id)) {
    await interaction.reply({
      content: t('debug_hub.errors.forbidden', null, loc),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const kind = interaction.values[0];
  if (kind !== 'jra' && kind !== 'nar') {
    await interaction.reply({
      content: t('debug_hub.errors.invalid_schedule_choice', null, loc),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  setDebugRaceKindDraft(interaction.user.id, kind);
  await interaction.showModal(buildRaceIdModal(kind));
}
