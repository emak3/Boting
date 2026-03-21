import {
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js';
import {
  getSlipPendingReview,
  replaceSlipPendingItems,
  clearSlipPending,
} from '../../utils/betSlipStore.mjs';
import { buildSlipReviewV2Payload } from '../../utils/betSlipReview.mjs';
import { buildTextAndRowsV2Payload } from '../../utils/raceCardDisplay.mjs';

function anchorRaceIdFromSlipCustomId(customId) {
  const parts = String(customId).split('|');
  return parts[parts.length - 1] || null;
}

export default async function betSlipMenu(interaction) {
  if (!interaction.isStringSelectMenu()) return;
  const customId = interaction.customId;

  if (customId.startsWith('race_bet_slip_unit_pick|')) {
    const userId = interaction.user.id;
    const pending = getSlipPendingReview(userId);
    if (!pending?.items?.length) {
      await interaction.reply({
        content: '❌ 買い目の確認セッションが無効です。',
        ephemeral: true,
      });
      return;
    }

    const anchorRaceId = anchorRaceIdFromSlipCustomId(customId);
    if (!anchorRaceId || !/^\d{12}$/.test(anchorRaceId)) {
      await interaction.reply({
        content: '❌ 操作が無効です。',
        ephemeral: true,
      });
      return;
    }

    const idx = parseInt(interaction.values[0], 10);
    if (!Number.isFinite(idx) || idx < 0 || idx >= pending.items.length) {
      await interaction.reply({
        content: '❌ 選択が無効です。',
        ephemeral: true,
      });
      return;
    }

    const it = pending.items[idx];
    const modal = new ModalBuilder()
      .setCustomId(`race_bet_slip_unit_modal|${anchorRaceId}|${idx}`)
      .setTitle(`金額変更（${idx + 1}番）`.slice(0, 45));
    const yenInput = new TextInputBuilder()
      .setCustomId('unit_yen')
      .setLabel('1点あたりの bp（ポイント）')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(7)
      .setValue(String(it.unitYen ?? 100));
    modal.addComponents(new ActionRowBuilder().addComponents(yenInput));
    await interaction.showModal(modal);
    return;
  }

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
  await interaction.update(await buildSlipReviewV2Payload({ userId, extraFlags }));
}
