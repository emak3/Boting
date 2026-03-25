import { MessageFlags } from 'discord.js';
import { msgSlipBatchReviewSessionInvalid } from '../../utils/bet/betSlipCopy.mjs';
import {
  getSlipPendingReview,
  replaceSlipPendingItems,
  clearSlipPending,
} from '../../utils/bet/betSlipStore.mjs';
import { buildSlipReviewV2Payload } from '../../utils/bet/betSlipReview.mjs';
import { buildTextAndRowsV2Payload } from '../../utils/race/raceCardDisplay.mjs';
import { buildUnitKeypadPayload, initBufferFromUnitYen } from '../../utils/unit/unitYenKeypad.mjs';
import { setUnitKeypadDraft } from '../../utils/unit/unitYenKeypadStore.mjs';
import { resolveLocaleFromInteraction, t } from '../../../i18n/index.mjs';

function anchorRaceIdFromSlipCustomId(customId) {
  const parts = String(customId).split('|');
  return parts[parts.length - 1] || null;
}

export default async function betSlipMenu(interaction) {
  if (!interaction.isStringSelectMenu()) return;
  const customId = interaction.customId;
  const loc = resolveLocaleFromInteraction(interaction);

  if (customId.startsWith('race_bet_slip_unit_pick|')) {
    const userId = interaction.user.id;
    const pending = getSlipPendingReview(userId);
    if (!pending?.items?.length) {
      await interaction.reply({
        content: msgSlipBatchReviewSessionInvalid(loc),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const anchorRaceId = anchorRaceIdFromSlipCustomId(customId);
    if (!anchorRaceId || !/^\d{12}$/.test(anchorRaceId)) {
      await interaction.reply({
        content: t('bet_slip.menu_invalid_op', null, loc),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const idx = parseInt(interaction.values[0], 10);
    if (!Number.isFinite(idx) || idx < 0 || idx >= pending.items.length) {
      await interaction.reply({
        content: t('bet_slip.menu_invalid_pick', null, loc),
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
        subtitle: t('bet_slip.pick_subtitle', { n: idx + 1 }, loc),
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
      content: msgSlipBatchReviewSessionInvalid(loc),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const vi = parseInt(interaction.values[0], 10);
  if (!Number.isFinite(vi) || vi < 0 || vi >= pending.items.length) {
    await interaction.reply({
      content: t('bet_slip.menu_remove_failed', null, loc),
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
        headline: t('bet_slip.all_picks_removed', null, loc),
        actionRows: [],
        extraFlags,
        withBotingMenuBack: true,
        locale: loc,
      }),
    );
    return;
  }

  replaceSlipPendingItems(userId, next);
  await interaction.update(
    await buildSlipReviewV2Payload({ userId, extraFlags, locale: loc }),
  );
}
