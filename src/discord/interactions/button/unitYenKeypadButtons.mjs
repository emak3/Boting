import { MessageFlags } from 'discord.js';
import { getBetFlow, patchBetFlow } from '../../utils/bet/betFlowStore.mjs';
import { jraMultiEligibleLastMenu } from '../../utils/race/raceBetTickets.mjs';
import {
  getSlipPendingReview,
  replaceSlipPendingItems,
} from '../../utils/bet/betSlipStore.mjs';
import {
  appendDigit,
  bufferToUnitYen,
  buildUnitKeypadPayload,
  deleteLastDigit,
  initBufferFromUnitYen,
  parseUnitKeypadCustomId,
} from '../../utils/unit/unitYenKeypad.mjs';
import {
  clearUnitKeypadDraft,
  getUnitKeypadDraft,
  setUnitKeypadDraft,
} from '../../utils/unit/unitYenKeypadStore.mjs';
import { msgRaceBetFlowSessionInvalid } from '../../utils/bet/betFlowSessionCopy.mjs';
import { msgSlipBatchReviewSessionInvalid } from '../../utils/bet/betSlipCopy.mjs';
import { resolveLocaleFromInteraction, t } from '../../../i18n/index.mjs';
import { buildSlipReviewV2Payload } from '../../utils/bet/betSlipReview.mjs';
import { buildTextAndRowsV2Payload } from '../../utils/race/raceCardDisplay.mjs';
import { buildEphemeralWithBotingBackPayload } from '../../utils/boting/botingBackButton.mjs';
import { v2ExtraFlags } from '../../utils/shared/interactionResponse.mjs';

function jraMultiStripForKeypad(userId, raceId, kind) {
  if (kind !== 'flow') return null;
  const flow = getBetFlow(userId, raceId);
  const lastId = flow?.purchase?.lastMenuCustomId;
  if (!lastId || !jraMultiEligibleLastMenu(lastId)) return null;
  return { on: flow.jraMulti === true };
}

function ensureDraft(userId, parsed) {
  let d = getUnitKeypadDraft(userId);
  if (
    d &&
    d.raceId === parsed.raceId &&
    d.kind === parsed.kind &&
    (parsed.kind !== 'slip' || d.slipIdx === parsed.slipIdx)
  ) {
    return d;
  }

  if (parsed.kind === 'flow') {
    const flow = getBetFlow(userId, parsed.raceId);
    const u = flow?.unitYen ?? 100;
    d = { raceId: parsed.raceId, kind: 'flow', buffer: initBufferFromUnitYen(u) };
    setUnitKeypadDraft(userId, d);
    return d;
  }

  const pending = getSlipPendingReview(userId);
  const it = pending?.items?.[parsed.slipIdx];
  if (!it) return null;
  d = {
    raceId: parsed.raceId,
    kind: 'slip',
    slipIdx: parsed.slipIdx,
    buffer: initBufferFromUnitYen(it.unitYen ?? 100),
  };
  setUnitKeypadDraft(userId, d);
  return d;
}

export default async function unitYenKeypadButtons(interaction) {
  if (!interaction.isButton()) return;
  const customId = interaction.customId;
  if (!customId.startsWith('race_unit_kpad|')) return;

  const loc = resolveLocaleFromInteraction(interaction);
  const parsed = parseUnitKeypadCustomId(customId);
  if (!parsed) {
    await interaction.reply(
      buildEphemeralWithBotingBackPayload(t('bet_slip.keypad_invalid', null, loc), {
        locale: loc,
      }),
    );
    return;
  }

  const userId = interaction.user.id;
  const draft = ensureDraft(userId, parsed);
  if (!draft) {
    await interaction.reply(
      buildEphemeralWithBotingBackPayload(msgRaceBetFlowSessionInvalid(loc), {
        locale: loc,
      }),
    );
    return;
  }

  const extraFlags = v2ExtraFlags(interaction);
  const slipSubtitle =
    parsed.kind === 'slip'
      ? t('bet_slip.pick_subtitle', { n: parsed.slipIdx + 1 }, loc)
      : null;

  if (parsed.op === 'digit' && parsed.digit != null) {
    const nextBuf = appendDigit(draft.buffer, parsed.digit);
    setUnitKeypadDraft(userId, { ...draft, buffer: nextBuf });
    const jraMultiStrip = jraMultiStripForKeypad(userId, parsed.raceId, parsed.kind);
    await interaction.update(
      buildUnitKeypadPayload({
        raceId: parsed.raceId,
        kind: parsed.kind,
        slipIdx: parsed.kind === 'slip' ? parsed.slipIdx : null,
        buffer: nextBuf,
        subtitle: slipSubtitle,
        extraFlags,
        jraMultiStrip,
      }),
    );
    return;
  }

  if (parsed.op === 'del') {
    const nextBuf = deleteLastDigit(draft.buffer);
    setUnitKeypadDraft(userId, { ...draft, buffer: nextBuf });
    const jraMultiStrip = jraMultiStripForKeypad(userId, parsed.raceId, parsed.kind);
    await interaction.update(
      buildUnitKeypadPayload({
        raceId: parsed.raceId,
        kind: parsed.kind,
        slipIdx: parsed.kind === 'slip' ? parsed.slipIdx : null,
        buffer: nextBuf,
        subtitle: slipSubtitle,
        extraFlags,
        jraMultiStrip,
      }),
    );
    return;
  }

  if (parsed.op === 'can') {
    clearUnitKeypadDraft(userId);
    await interaction.deferUpdate();
    if (parsed.kind === 'flow') {
      const { editReplyPurchaseSummaryFromFlow } = await import('../menu/raceSchedule.mjs');
      await editReplyPurchaseSummaryFromFlow(interaction, userId, parsed.raceId);
      return;
    }
    await interaction.editReply(
      await buildSlipReviewV2Payload({ userId, extraFlags, locale: loc }),
    );
    return;
  }

  if (parsed.op === 'ok') {
    const unitYen = bufferToUnitYen(draft.buffer);
    clearUnitKeypadDraft(userId);
    await interaction.deferUpdate();

    if (parsed.kind === 'flow') {
      const flow = getBetFlow(userId, parsed.raceId);
      if (!flow?.purchase) {
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline: msgRaceBetFlowSessionInvalid(loc),
            actionRows: [],
            extraFlags,
            withBotingMenuBack: true,
            locale: loc,
          }),
        );
        return;
      }
      patchBetFlow(userId, parsed.raceId, { unitYen });
      const { editReplyPurchaseSummaryFromFlow } = await import('../menu/raceSchedule.mjs');
      await editReplyPurchaseSummaryFromFlow(interaction, userId, parsed.raceId);
      return;
    }

    const pending = getSlipPendingReview(userId);
    if (
      !pending?.items?.length ||
      (pending.anchorRaceId && pending.anchorRaceId !== parsed.raceId) ||
      parsed.slipIdx < 0 ||
      parsed.slipIdx >= pending.items.length
    ) {
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline: msgSlipBatchReviewSessionInvalid(loc),
          actionRows: [],
          extraFlags,
          withBotingMenuBack: true,
          locale: loc,
        }),
      );
      return;
    }

    const next = pending.items.map((it, i) =>
      i === parsed.slipIdx ? { ...it, unitYen } : { ...it },
    );
    replaceSlipPendingItems(userId, next);
    await interaction.editReply(
      await buildSlipReviewV2Payload({ userId, extraFlags, locale: loc }),
    );
  }
}
