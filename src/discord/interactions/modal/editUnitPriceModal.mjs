import { MessageFlags } from 'discord.js';
import { getBetFlow, patchBetFlow } from '../../utils/bet/betFlowStore.mjs';
import { normalizeUnitYen100 } from '../../utils/unit/unitYenKeypad.mjs';
import {
  buildTextAndRowsV2Payload,
  extractTopLevelActionRowsFromMessage,
} from '../../utils/race/raceCardDisplay.mjs';

function safeParseRaceId(customId) {
  // race_bet_unit_modal|{raceId}
  const parts = customId.split('|');
  return parts[parts.length - 1] || null;
}

function formatTotal(points, unitYen) {
  const yen = points * unitYen;
  return `点数: ${points}点 | 合計: ${yen} bp（${unitYen} bp/点）`;
}

export default async function editUnitPriceModal(interaction) {
  if (!interaction.isModalSubmit()) return;
  const customId = interaction.customId;
  if (!customId.startsWith('race_bet_unit_modal|')) return;

  const raceId = safeParseRaceId(customId);
  const userId = interaction.user.id;
  const flow = getBetFlow(userId, raceId);
  if (!flow?.purchase) {
    await interaction.reply({
      content: '❌ セッションが無効です。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const raw = interaction.fields.getTextInputValue('unit_yen') || '';
  const parsed = parseInt(raw.trim(), 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    await interaction.reply({
      content: '❌ bp は正の整数で入力してください。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const unitYen = normalizeUnitYen100(parsed);

  patchBetFlow(userId, raceId, { unitYen });

  const selectionLine = flow.purchase.selectionLine || '（選択なし）';
  const points = flow.purchase.points || 0;
  const newLine = formatTotal(points, unitYen);
  const newContent = `${selectionLine}\n${newLine}`;

  await interaction.update(
    buildTextAndRowsV2Payload({
      headline: newContent,
      actionRows: extractTopLevelActionRowsFromMessage(interaction.message),
    }),
  );
}

