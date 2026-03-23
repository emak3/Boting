import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '../../utils/firebaseAdmin.mjs';

const CONFIG_COLLECTION = 'config';
const DEBUG_AUTH_DOC = 'debugAuthorizedUsers';

/** 初回のみ DB に書き込むブートストラップ用（削除で外せる） */
const SEED_BOOTSTRAP_USER_IDS = ['864735082732322867'];

/** @type {Set<string>} */
let cache = new Set(SEED_BOOTSTRAP_USER_IDS);

export function canUseDebugCommandsSync(userId) {
  return cache.has(String(userId));
}

export function getDebugAuthorizedUserIdsSync() {
  return [...cache];
}

export function getDebugAuthorizedMentionsLineSync() {
  return getDebugAuthorizedUserIdsSync()
    .map((id) => `<@${id}>`)
    .join(' ');
}

/**
 * 起動時・追加/削除後に呼ぶ
 */
export async function refreshDebugAuthorizedCache() {
  const db = getAdminFirestore();
  const ref = db.collection(CONFIG_COLLECTION).doc(DEBUG_AUTH_DOC);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      userIds: SEED_BOOTSTRAP_USER_IDS,
      updatedAt: FieldValue.serverTimestamp(),
    });
    cache = new Set(SEED_BOOTSTRAP_USER_IDS);
    return;
  }
  const raw = snap.data()?.userIds;
  const arr = Array.isArray(raw)
    ? raw.map((x) => String(x).trim()).filter(Boolean)
    : [];
  if (arr.length === 0) {
    await ref.set(
      {
        userIds: SEED_BOOTSTRAP_USER_IDS,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    cache = new Set(SEED_BOOTSTRAP_USER_IDS);
    return;
  }
  cache = new Set(arr);
}

/**
 * @param {string} userId
 */
export async function addDebugAuthorizedUser(userId) {
  const id = String(userId).trim();
  if (!/^\d{17,20}$/.test(id)) {
    return { ok: false, reason: 'invalid_id' };
  }
  const db = getAdminFirestore();
  const ref = db.collection(CONFIG_COLLECTION).doc(DEBUG_AUTH_DOC);
  await ref.set(
    {
      userIds: FieldValue.arrayUnion(id),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await refreshDebugAuthorizedCache();
  return { ok: true };
}

/**
 * @param {string} userId
 */
export async function removeDebugAuthorizedUser(userId) {
  const id = String(userId).trim();
  if (!/^\d{17,20}$/.test(id)) {
    return { ok: false, reason: 'invalid_id' };
  }
  const db = getAdminFirestore();
  const ref = db.collection(CONFIG_COLLECTION).doc(DEBUG_AUTH_DOC);
  await ref.set(
    {
      userIds: FieldValue.arrayRemove(id),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await refreshDebugAuthorizedCache();
  if (cache.size === 0) {
    await ref.set(
      {
        userIds: SEED_BOOTSTRAP_USER_IDS,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await refreshDebugAuthorizedCache();
    return { ok: true, reason: 'restored_seed' };
  }
  return { ok: true };
}
