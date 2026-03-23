/** @typedef {{ raceId: string, kind: 'flow' | 'slip', slipIdx?: number, buffer: string }} UnitKeypadDraft */

const drafts = new Map();

/** @param {string} userId */
export function getUnitKeypadDraft(userId) {
  return drafts.get(userId) ?? null;
}

/** @param {string} userId @param {UnitKeypadDraft} draft */
export function setUnitKeypadDraft(userId, draft) {
  drafts.set(userId, draft);
}

/** @param {string} userId */
export function clearUnitKeypadDraft(userId) {
  drafts.delete(userId);
}
