import { MessageFlags } from 'discord.js';
import {
  getSlipPendingReview,
  replaceSlipPendingItems,
} from '../../utils/betSlipStore.mjs';
import { buildSlipReviewV2Payload } from '../../utils/betSlipReview.mjs';

export default async function betSlipReviewModal(interaction) {
  if (!interaction.isModalSubmit()) return;
  const customId = interaction.customId;
  if (!customId.startsWith('race_bet_slip_unit_modal|')) return;

  const userId = interaction.user.id;
  const pending = getSlipPendingReview(userId);
  if (!pending?.items?.length) {
    await interaction.reply({
      content: '❌ 買い目の確認セッションが無効です。',
      ephemeral: true,
    });
    return;
  }

  const rawNo = interaction.fields.getTextInputValue('item_no') || '';
  const rawYen = interaction.fields.getTextInputValue('unit_yen') || '';
  const idx = parseInt(rawNo.trim(), 10) - 1;
  const unitYen = parseInt(rawYen.trim(), 10);

  if (!Number.isFinite(idx) || idx < 0 || idx >= pending.items.length) {
    await interaction.reply({
      content: `❌ 番号は 1 から ${pending.items.length} の整数で指定してください。`,
      ephemeral: true,
    });
    return;
  }
  if (!Number.isFinite(unitYen) || unitYen <= 0) {
    await interaction.reply({
      content: '❌ 金額は正の整数で入力してください。',
      ephemeral: true,
    });
    return;
  }

  const next = pending.items.map((it, i) =>
    i === idx ? { ...it, unitYen } : { ...it },
  );
  replaceSlipPendingItems(userId, next);

  let extraFlags = 0;
  try {
    if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
      extraFlags |= MessageFlags.Ephemeral;
    }
  } catch (_) {
    /* ignore */
  }

  await interaction.update(
    buildSlipReviewV2Payload({ userId, extraFlags }),
  );
}
