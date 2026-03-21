// Simple in-memory store for the bet UI flow.
// Keyed by: `${userId}|${raceId}`
// Note: This resets when the bot restarts.
const store = new Map();
const TTL_MS = 5 * 60 * 1000;

function now() {
  return Date.now();
}

function makeKey(userId, raceId) {
  return `${userId}|${raceId}`;
}

export function getBetFlow(userId, raceId) {
  const key = makeKey(userId, raceId);
  const v = store.get(key);
  if (!v) return null;
  if (now() - v.createdAt > TTL_MS) {
    store.delete(key);
    return null;
  }
  return v;
}

export function setBetFlow(userId, raceId, value) {
  const key = makeKey(userId, raceId);
  store.set(key, { ...value, createdAt: now() });
}

export function patchBetFlow(userId, raceId, partial) {
  const key = makeKey(userId, raceId);
  const v = store.get(key);
  if (!v) return setBetFlow(userId, raceId, partial);
  store.set(key, { ...v, ...partial, createdAt: v.createdAt });
}

export function clearBetFlow(userId, raceId) {
  const key = makeKey(userId, raceId);
  store.delete(key);
}

