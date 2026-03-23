/** @typedef {{ savedPageSize: number, savedPageIndex: number, buffer: string }} BotingLedgerLimitDraft */

const drafts = new Map();

/** @param {string} userId */
export function getBotingLedgerLimitDraft(userId) {
  return drafts.get(userId) ?? null;
}

/** @param {string} userId @param {BotingLedgerLimitDraft} draft */
export function setBotingLedgerLimitDraft(userId, draft) {
  drafts.set(userId, draft);
}

/** @param {string} userId */
export function clearBotingLedgerLimitDraft(userId) {
  drafts.delete(userId);
}
