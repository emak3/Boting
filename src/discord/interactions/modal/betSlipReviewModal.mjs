import { MessageFlags } from 'discord.js';
import {
  msgSlipBatchReviewSessionInvalid,
  msgSlipBatchReviewSessionMismatch,
  msgSlipModalCustomIdInvalid,
} from '../../utils/bet/betSlipCopy.mjs';
import { resolveLocaleFromInteraction, t } from '../../../i18n/index.mjs';
import {
  getSlipPendingReview,
  replaceSlipPendingItems,
} from '../../utils/bet/betSlipStore.mjs';
import { buildSlipReviewV2Payload } from '../../utils/bet/betSlipReview.mjs';
import { normalizeUnitYen100 } from '../../utils/unit/unitYenKeypad.mjs';
import {
  updateComponent,
  v2ExtraFlags,
} from '../../utils/shared/interactionResponse.mjs';

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

  const loc = resolveLocaleFromInteraction(interaction);
  const parsed = parseModalCustomId(customId);
  if (!parsed) {
    await interaction.reply({
      content: msgSlipModalCustomIdInvalid(loc),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const userId = interaction.user.id;
  const pending = getSlipPendingReview(userId);
  if (!pending?.items?.length) {
    await interaction.reply({
      content: msgSlipBatchReviewSessionInvalid(loc),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { raceId, idx } = parsed;
  if (pending.anchorRaceId && pending.anchorRaceId !== raceId) {
    await interaction.reply({
      content: msgSlipBatchReviewSessionMismatch(loc),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (idx < 0 || idx >= pending.items.length) {
    await interaction.reply({
      content: t('bet_slip.modal_item_not_found', null, loc),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const rawYen = interaction.fields.getTextInputValue('unit_yen') || '';
  const parsedYen = parseInt(rawYen.trim(), 10);
  if (!Number.isFinite(parsedYen) || parsedYen <= 0) {
    await interaction.reply({
      content: t('bet_slip.modal_invalid_bp', null, loc),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const unitYen = normalizeUnitYen100(parsedYen);

  const next = pending.items.map((it, i) =>
    i === idx ? { ...it, unitYen } : { ...it },
  );
  replaceSlipPendingItems(userId, next);

  const extraFlags = v2ExtraFlags(interaction);

  await updateComponent(
    interaction,
    await buildSlipReviewV2Payload({ userId, extraFlags, locale: loc }),
  );
}
