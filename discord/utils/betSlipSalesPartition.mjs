import { getBetFlow } from './betFlowStore.mjs';
import { resolveSalesClosedForRace } from './raceDebugBypass.mjs';

/**
 * 買い目1件が発売締切扱いか（判定不能は締切とみなさない）
 */
export async function isSlipItemSalesClosed(userId, it, flowCache) {
  if (it?.isResult === true) return true;
  const rid = it?.raceId;
  if (!rid || !/^\d{12}$/.test(String(rid))) return false;
  let flow = flowCache.get(rid);
  if (flow === undefined) {
    flow = getBetFlow(userId, rid);
    flowCache.set(rid, flow);
  }
  const closed = await resolveSalesClosedForRace(rid, flow);
  return closed === true;
}

/**
 * @returns {Promise<{ closed: object[], open: object[] }>}
 */
export async function partitionPendingItemsBySalesClosed(userId, items) {
  const flowCache = new Map();
  const closed = [];
  const open = [];
  for (const it of items || []) {
    if (await isSlipItemSalesClosed(userId, it, flowCache)) closed.push(it);
    else open.push(it);
  }
  return { closed, open };
}
