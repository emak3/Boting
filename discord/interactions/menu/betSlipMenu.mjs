import { MessageFlags } from 'discord.js';
import {
  getSlipPendingReview,
  replaceSlipPendingItems,
  clearSlipPending,
} from '../../utils/betSlipStore.mjs';
import { buildSlipReviewV2Payload } from '../../utils/betSlipReview.mjs';
import { buildTextAndRowsV2Payload } from '../../utils/raceCardDisplay.mjs';

export default async function betSlipMenu(interaction) {
  if (!interaction.isStringSelectMenu()) return;
  const customId = interaction.customId;
  if (!customId.startsWith('race_bet_slip_remove|')) return;

  const userId = interaction.user.id;
  const pending = getSlipPendingReview(userId);
  if (!pending?.items?.length) {
    await interaction.reply({
      content: '❌ 買い目の確認セッションが無効です。',
      ephemeral: true,
    });
    return;
  }

  const vi = parseInt(interaction.values[0], 10);
  if (!Number.isFinite(vi) || vi < 0 || vi >= pending.items.length) {
    await interaction.reply({
      content: '❌ 削除できませんでした。',
      ephemeral: true,
    });
    return;
  }

  const next = pending.items.filter((_, i) => i !== vi);

  let extraFlags = 0;
  try {
    if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
      extraFlags |= MessageFlags.Ephemeral;
    }
  } catch (_) {
    /* ignore */
  }

  if (!next.length) {
    clearSlipPending(userId);
    await interaction.update(
      buildTextAndRowsV2Payload({
        headline:
          '買い目をすべて削除しました。\n\nもう一度 **/race** からやり直してください。',
        actionRows: [],
        extraFlags,
      }),
    );
    return;
  }

  replaceSlipPendingItems(userId, next);
  await interaction.update(buildSlipReviewV2Payload({ userId, extraFlags }));
}
