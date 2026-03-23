/**
 * @typedef {{ mode: 'grant' | 'revoke', targetUserId: string, buffer: string }} DebugBpDraft
 */

const drafts = new Map();

/**
 * @param {string} userId
 * @param {DebugBpDraft} draft
 */
export function setDebugBpDraft(userId, draft) {
  drafts.set(String(userId), draft);
}

/**
 * @param {string} userId
 * @returns {DebugBpDraft | null}
 */
export function getDebugBpDraft(userId) {
  return drafts.get(String(userId)) ?? null;
}

/**
 * @param {string} userId
 */
export function clearDebugBpDraft(userId) {
  drafts.delete(String(userId));
}
