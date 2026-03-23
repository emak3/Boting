import { MessageFlags } from 'discord.js';
import {
  getSlipPendingReview,
  replaceSlipPendingItems,
  clearSlipPending,
} from '../../utils/betSlipStore.mjs';
import { buildSlipReviewV2Payload } from '../../utils/betSlipReview.mjs';
import { buildTextAndRowsV2Payload } from '../../utils/raceCardDisplay.mjs';
import { buildUnitKeypadPayload, initBufferFromUnitYen } from '../../utils/unitYenKeypad.mjs';
import { setUnitKeypadDraft } from '../../utils/unitYenKeypadStore.mjs';

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
        content: '❌ 購入予定の確認セッションが無効です。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const anchorRaceId = anchorRaceIdFromSlipCustomId(customId);
    if (!anchorRaceId || !/^\d{12}$/.test(anchorRaceId)) {
      await interaction.reply({
        content: '❌ 操作が無効です。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const idx = parseInt(interaction.values[0], 10);
    if (!Number.isFinite(idx) || idx < 0 || idx >= pending.items.length) {
      await interaction.reply({
        content: '❌ 選択が無効です。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const it = pending.items[idx];
    const buf = initBufferFromUnitYen(it.unitYen ?? 100);
    setUnitKeypadDraft(userId, {
      raceId: anchorRaceId,
      kind: 'slip',
      slipIdx: idx,
      buffer: buf,
    });

    let extraFlags = 0;
    try {
      if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
        extraFlags |= MessageFlags.Ephemeral;
      }
    } catch (_) {
      /* ignore */
    }

    await interaction.update(
      buildUnitKeypadPayload({
        raceId: anchorRaceId,
        kind: 'slip',
        slipIdx: idx,
        buffer: buf,
        subtitle: `**${idx + 1}番の購入予定**`,
        extraFlags,
      }),
    );
    return;
  }

  if (!customId.startsWith('race_bet_slip_remove|')) return;

  const userId = interaction.user.id;
  const pending = getSlipPendingReview(userId);
  if (!pending?.items?.length) {
    await interaction.reply({
      content: '❌ 購入予定の確認セッションが無効です。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const vi = parseInt(interaction.values[0], 10);
  if (!Number.isFinite(vi) || vi < 0 || vi >= pending.items.length) {
    await interaction.reply({
      content: '❌ 削除できませんでした。',
      flags: MessageFlags.Ephemeral,
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
          '購入予定をすべて削除しました。\n\nもう一度 **/boting** からやり直してください。',
        actionRows: [],
        extraFlags,
        withBotingMenuBack: true,
      }),
    );
    return;
  }

  replaceSlipPendingItems(userId, next);
  await interaction.update(await buildSlipReviewV2Payload({ userId, extraFlags }));
}
