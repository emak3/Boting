import { DebugAuthorizedUser } from '../db/models.mjs';

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
  const rows = await DebugAuthorizedUser.findAll();
  if (!rows.length) {
    for (const id of SEED_BOOTSTRAP_USER_IDS) {
      await DebugAuthorizedUser.create({ userId: id });
    }
    cache = new Set(SEED_BOOTSTRAP_USER_IDS);
    return;
  }
  cache = new Set(rows.map((r) => String(r.get('userId'))));
}

/**
 * @param {string} userId
 */
export async function addDebugAuthorizedUser(userId) {
  const id = String(userId).trim();
  if (!/^\d{17,20}$/.test(id)) {
    return { ok: false, reason: 'invalid_id' };
  }
  await DebugAuthorizedUser.findOrCreate({
    where: { userId: id },
    defaults: { userId: id },
  });
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
  await DebugAuthorizedUser.destroy({ where: { userId: id } });
  await refreshDebugAuthorizedCache();
  if (cache.size === 0) {
    for (const sid of SEED_BOOTSTRAP_USER_IDS) {
      await DebugAuthorizedUser.create({ userId: sid });
    }
    await refreshDebugAuthorizedCache();
    return { ok: true, reason: 'restored_seed' };
  }
  return { ok: true };
}
