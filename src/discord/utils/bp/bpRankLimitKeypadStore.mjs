/** @typedef {{ mode: string, savedLimit: number, buffer: string }} BpRankLimitDraft */

const drafts = new Map();

/** @param {string} userId */
export function getBpRankLimitDraft(userId) {
  return drafts.get(userId) ?? null;
}

/** @param {string} userId @param {BpRankLimitDraft} draft */
export function setBpRankLimitDraft(userId, draft) {
  drafts.set(userId, draft);
}

/** @param {string} userId */
export function clearBpRankLimitDraft(userId) {
  drafts.delete(userId);
}
