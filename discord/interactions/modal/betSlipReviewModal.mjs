import { MessageFlags } from 'discord.js';
import {
  getSlipPendingReview,
  replaceSlipPendingItems,
} from '../../utils/betSlipStore.mjs';
import { buildSlipReviewV2Payload } from '../../utils/betSlipReview.mjs';

/** race_bet_slip_unit_modal|{raceId}|{index} */
function parseModalCustomId(customId) {
  const parts = String(customId).split('|');
  if (parts.length < 3 || parts[0] !== 'race_bet_slip_unit_modal') return null;
  const raceId = parts[1];
  const idx = parseInt(parts[2], 10);
  if (!/^\d{12}$/.test(raceId) || !Number.isFinite(idx) || idx < 0) return null;
  return { raceId, idx };
}

export default async function betSlipReviewModal(interaction) {
  if (!interaction.isModalSubmit()) return;
  const customId = interaction.customId;
  if (!customId.startsWith('race_bet_slip_unit_modal|')) return;

  const parsed = parseModalCustomId(customId);
  if (!parsed) {
    await interaction.reply({
      content:
        '❌ このフォームは使えません。**まとめて購入**の画面を開き直し、メニューから金額変更してください。',
      ephemeral: true,
    });
    return;
  }

  const userId = interaction.user.id;
  const pending = getSlipPendingReview(userId);
  if (!pending?.items?.length) {
    await interaction.reply({
      content: '❌ 買い目の確認セッションが無効です。',
      ephemeral: true,
    });
    return;
  }

  const { raceId, idx } = parsed;
  if (pending.anchorRaceId && pending.anchorRaceId !== raceId) {
    await interaction.reply({
      content: '❌ 買い目の確認セッションが一致しません。',
      ephemeral: true,
    });
    return;
  }
  const rawYen = interaction.fields.getTextInputValue('unit_yen') || '';
  const unitYen = parseInt(rawYen.trim(), 10);

  if (idx < 0 || idx >= pending.items.length) {
    await interaction.reply({
      content: '❌ 対象の買い目が見つかりません。',
      ephemeral: true,
    });
    return;
  }
  if (!Number.isFinite(unitYen) || unitYen <= 0) {
    await interaction.reply({
      content: '❌ bp は正の整数で入力してください。',
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
    await buildSlipReviewV2Payload({ userId, extraFlags }),
  );
}
