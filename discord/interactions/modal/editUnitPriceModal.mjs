import { TextInputStyle } from 'discord.js';
import { getBetFlow, patchBetFlow } from '../../utils/betFlowStore.mjs';

function safeParseRaceId(customId) {
  // race_bet_unit_modal|{raceId}
  const parts = customId.split('|');
  return parts[parts.length - 1] || null;
}

function formatTotal(points, unitYen) {
  const yen = points * unitYen;
  return `点数: ${points}点 | 合計目安: ${yen}円（${unitYen}円/点）`;
}

export default async function editUnitPriceModal(interaction) {
  if (!interaction.isModalSubmit()) return;
  const customId = interaction.customId;
  if (!customId.startsWith('race_bet_unit_modal|')) return;

  const raceId = safeParseRaceId(customId);
  const userId = interaction.user.id;
  const flow = getBetFlow(userId, raceId);
  if (!flow?.purchase) {
    await interaction.reply({ content: '❌ セッションが無効です。', ephemeral: true });
    return;
  }

  const raw = interaction.fields.getTextInputValue('unit_yen') || '';
  const unitYen = parseInt(raw, 10);

  if (!Number.isFinite(unitYen) || unitYen <= 0) {
    await interaction.reply({ content: '❌ 1点単価は正の整数で入力してください。', ephemeral: true });
    return;
  }

  patchBetFlow(userId, raceId, { unitYen });

  const selectionLine = flow.purchase.selectionLine || '（選択なし）';
  const points = flow.purchase.points || 0;
  const newLine = formatTotal(points, unitYen);
  const newContent = `${selectionLine}\n${newLine}`;

  await interaction.update({
    content: newContent,
  });
}

