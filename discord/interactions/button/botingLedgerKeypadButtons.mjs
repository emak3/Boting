import { MessageFlags } from 'discord.js';
import {
  appendDigitLedgerLimit,
  bufferToLedgerLimit,
  buildBotingLedgerLimitKeypadPayload,
  deleteLastDigitLedgerLimit,
  parseBotingLedgerLimitKeypadId,
} from '../../utils/botingLedgerKeypad.mjs';
import {
  clearBotingLedgerLimitDraft,
  getBotingLedgerLimitDraft,
  setBotingLedgerLimitDraft,
} from '../../utils/botingLedgerKeypadStore.mjs';
import { buildEphemeralWithBotingBackPayload } from '../../utils/botingBackButton.mjs';
import { buildBotingLedgerViewPayload } from '../../utils/botingLedgerView.mjs';

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

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 */
export default async function botingLedgerKeypadButtons(interaction) {
  if (!interaction.isButton()) return;
  const customId = interaction.customId;
  if (!customId.startsWith('boting_ledger_lim_kpad|')) return;

  const parsed = parseBotingLedgerLimitKeypadId(customId);
  if (!parsed) {
    await interaction.reply(
      buildEphemeralWithBotingBackPayload(
        '❌ このキーは無効です。表示数変更を開き直してください。',
      ),
    );
    return;
  }

  const userId = interaction.user.id;
  let draft = getBotingLedgerLimitDraft(userId);
  if (!draft) {
    await interaction.reply(
      buildEphemeralWithBotingBackPayload(
        '❌ セッションが無効です。直近の収支を開き直してください。',
      ),
    );
    return;
  }

  const extraFlags = v2ExtraFlags(interaction);

  if (parsed.op === 'digit' && parsed.digit != null) {
    const nextBuf = appendDigitLedgerLimit(draft.buffer, parsed.digit);
    setBotingLedgerLimitDraft(userId, { ...draft, buffer: nextBuf });
    await interaction.update(
      buildBotingLedgerLimitKeypadPayload({ buffer: nextBuf, extraFlags }),
    );
    return;
  }

  if (parsed.op === 'del') {
    const nextBuf = deleteLastDigitLedgerLimit(draft.buffer);
    setBotingLedgerLimitDraft(userId, { ...draft, buffer: nextBuf });
    await interaction.update(
      buildBotingLedgerLimitKeypadPayload({ buffer: nextBuf, extraFlags }),
    );
    return;
  }

  if (parsed.op === 'can') {
    clearBotingLedgerLimitDraft(userId);
    await interaction.deferUpdate();
    await interaction.editReply(
      await buildBotingLedgerViewPayload({
        userId,
        pageSize: draft.savedPageSize,
        pageIndex: draft.savedPageIndex,
        extraFlags,
      }),
    );
    return;
  }

  if (parsed.op === 'ok') {
    const lim = bufferToLedgerLimit(draft.buffer);
    clearBotingLedgerLimitDraft(userId);
    await interaction.deferUpdate();
    await interaction.editReply(
      await buildBotingLedgerViewPayload({
        userId,
        pageSize: lim,
        pageIndex: 0,
        extraFlags,
      }),
    );
  }
}
