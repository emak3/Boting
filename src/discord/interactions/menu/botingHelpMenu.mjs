import { MessageFlags } from 'discord.js';
import {
  BOTING_HELP_REGION_SELECT,
  buildBotingHelpPanelPayload,
  normalizeBotingHelpRegion,
} from '../../utils/boting/botingHelpPanel.mjs';
import { resolveLocaleFromInteraction } from '../../../i18n/index.mjs';

function ephemeralExtraFromMessage(message) {
  let extra = 0;
  try {
    if (message?.flags?.has(MessageFlags.Ephemeral)) {
      extra |= MessageFlags.Ephemeral;
    }
  } catch (_) {
    /* ignore */
  }
  return extra;
}

/**
 * `/boting` ヘルプ画面の地域タブ（String Select）
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export default async function botingHelpMenu(interaction) {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId !== BOTING_HELP_REGION_SELECT) return;

  const region = normalizeBotingHelpRegion(interaction.values[0]);
  const extraFlags = ephemeralExtraFromMessage(interaction.message);
  const loc = resolveLocaleFromInteraction(interaction);

  if (interaction.deferred || interaction.replied) return;
  try {
    await interaction.deferUpdate();
  } catch (e) {
    const code = e?.code ?? e?.rawError?.code;
    if (code === 10062) return;
    throw e;
  }

  try {
    await interaction.editReply(buildBotingHelpPanelPayload({ extraFlags, region, locale: loc }));
  } catch (e) {
    console.error('botingHelpMenu', e);
  }
}
