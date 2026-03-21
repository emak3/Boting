import { MessageFlags } from 'discord.js';
import { getBetFlow, patchBetFlow } from '../../utils/betFlowStore.mjs';
import {
  getSlipPendingReview,
  replaceSlipPendingItems,
} from '../../utils/betSlipStore.mjs';
import {
  appendDigit,
  bufferToUnitYen,
  buildUnitKeypadPayload,
  deleteLastDigit,
  initBufferFromUnitYen,
  parseUnitKeypadCustomId,
} from '../../utils/unitYenKeypad.mjs';
import {
  clearUnitKeypadDraft,
  getUnitKeypadDraft,
  setUnitKeypadDraft,
} from '../../utils/unitYenKeypadStore.mjs';
import { buildSlipReviewV2Payload } from '../../utils/betSlipReview.mjs';
import { buildTextAndRowsV2Payload } from '../../utils/raceCardDisplay.mjs';

function v2ExtraFlags(interaction) {
  let extraFlags = 0;
  try {
    if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
      extraFlags |= MessageFlags.Ephemeral;
    }
  } catch (_) {
    /* ignore */
  }
  return extraFlags;
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

  const parsed = parseUnitKeypadCustomId(customId);
  if (!parsed) {
    await interaction.reply({
      content: '❌ このキーは無効です。金額変更を開き直してください。',
      ephemeral: true,
    });
    return;
  }

  const userId = interaction.user.id;
  const draft = ensureDraft(userId, parsed);
  if (!draft) {
    await interaction.reply({
      content: '❌ セッションが無効です。画面を開き直してください。',
      ephemeral: true,
    });
    return;
  }

  const extraFlags = v2ExtraFlags(interaction);
  const slipSubtitle =
    parsed.kind === 'slip' ? `**${parsed.slipIdx + 1}番の購入予定**` : null;

  if (parsed.op === 'digit' && parsed.digit != null) {
    const nextBuf = appendDigit(draft.buffer, parsed.digit);
    setUnitKeypadDraft(userId, { ...draft, buffer: nextBuf });
    await interaction.update(
      buildUnitKeypadPayload({
        raceId: parsed.raceId,
        kind: parsed.kind,
        slipIdx: parsed.kind === 'slip' ? parsed.slipIdx : null,
        buffer: nextBuf,
        subtitle: slipSubtitle,
        extraFlags,
      }),
    );
    return;
  }

  if (parsed.op === 'del') {
    const nextBuf = deleteLastDigit(draft.buffer);
    setUnitKeypadDraft(userId, { ...draft, buffer: nextBuf });
    await interaction.update(
      buildUnitKeypadPayload({
        raceId: parsed.raceId,
        kind: parsed.kind,
        slipIdx: parsed.kind === 'slip' ? parsed.slipIdx : null,
        buffer: nextBuf,
        subtitle: slipSubtitle,
        extraFlags,
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
    await interaction.editReply(await buildSlipReviewV2Payload({ userId, extraFlags }));
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
            headline: '❌ セッションが無効です。もう一度 /race から開き直してください。',
            actionRows: [],
            extraFlags,
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
          headline: '❌ 購入予定の確認セッションが無効です。まとめて購入の画面を開き直してください。',
          actionRows: [],
          extraFlags,
        }),
      );
      return;
    }

    const next = pending.items.map((it, i) =>
      i === parsed.slipIdx ? { ...it, unitYen } : { ...it },
    );
    replaceSlipPendingItems(userId, next);
    await interaction.editReply(await buildSlipReviewV2Payload({ userId, extraFlags }));
  }
}
