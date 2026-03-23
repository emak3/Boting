/** @type {Map<string, 'jra' | 'nar'>} */
const drafts = new Map();

/**
 * @param {string} userId
 * @param {'jra' | 'nar'} kind
 */
export function setDebugRaceKindDraft(userId, kind) {
  drafts.set(String(userId), kind);
}

/**
 * @param {string} userId
 * @returns {'jra' | 'nar' | null}
 */
export function getDebugRaceKindDraft(userId) {
  return drafts.get(String(userId)) ?? null;
}

/**
 * @param {string} userId
 */
export function clearDebugRaceKindDraft(userId) {
  drafts.delete(String(userId));
}
