import { MessageFlags } from 'discord.js';
import { getBetFlow, patchBetFlow } from '../../utils/bet/betFlowStore.mjs';
import { normalizeUnitYen100 } from '../../utils/unit/unitYenKeypad.mjs';
import {
  buildTextAndRowsV2Payload,
  extractTopLevelActionRowsFromMessage,
} from '../../utils/race/raceCardDisplay.mjs';
import { formatBpAmount } from '../../utils/bp/bpFormat.mjs';
import { resolveLocaleFromInteraction, t } from '../../../i18n/index.mjs';

function safeParseRaceId(customId) {
  // race_bet_unit_modal|{raceId}
  const parts = customId.split('|');
  return parts[parts.length - 1] || null;
}

function formatTotal(points, unitYen, locale = null) {
  const yen = points * unitYen;
  return t(
    'race_schedule.format.bet_points',
    {
      points: formatBpAmount(points),
      yen: formatBpAmount(yen),
      unit: formatBpAmount(unitYen),
    },
    locale,
  );
}

export default async function editUnitPriceModal(interaction) {
  if (!interaction.isModalSubmit()) return;
  const customId = interaction.customId;
  if (!customId.startsWith('race_bet_unit_modal|')) return;

  const loc = resolveLocaleFromInteraction(interaction);
  const raceId = safeParseRaceId(customId);
  const userId = interaction.user.id;
  const flow = getBetFlow(userId, raceId);
  if (!flow?.purchase) {
    await interaction.reply({
      content: t('bet_flow.unit_modal.errors.session_invalid', null, loc),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const raw = interaction.fields.getTextInputValue('unit_yen') || '';
  const parsed = parseInt(raw.trim(), 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    await interaction.reply({
      content: t('bet_flow.unit_modal.errors.bp_positive_int', null, loc),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const unitYen = normalizeUnitYen100(parsed);

  patchBetFlow(userId, raceId, { unitYen });

  const selectionLine =
    flow.purchase.selectionLine || t('bet_flow.unit_modal.selection_none', null, loc);
  const points = flow.purchase.points || 0;
  const newLine = formatTotal(points, unitYen, loc);
  const newContent = `${selectionLine}\n${newLine}`;

  await interaction.update(
    buildTextAndRowsV2Payload({
      headline: newContent,
      actionRows: extractTopLevelActionRowsFromMessage(interaction.message),
      locale: loc,
    }),
  );
}

