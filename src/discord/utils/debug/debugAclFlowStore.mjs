/**
 * @typedef {{ mode: 'add' | 'remove', targetUserId: string }} DebugAclDraft
 */

const drafts = new Map();

/**
 * @param {string} userId
 * @param {DebugAclDraft} draft
 */
export function setDebugAclDraft(userId, draft) {
  drafts.set(String(userId), draft);
}

/**
 * @param {string} userId
 * @returns {DebugAclDraft | null}
 */
export function getDebugAclDraft(userId) {
  return drafts.get(String(userId)) ?? null;
}

/**
 * @param {string} userId
 */
export function clearDebugAclDraft(userId) {
  drafts.delete(String(userId));
}
