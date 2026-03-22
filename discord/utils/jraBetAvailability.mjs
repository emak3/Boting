/**
 * JRA 勝馬投票券の発売（出走予定頭数による可否）
 * @see https://www.jra.go.jp/kouza/baken/index.html#cat_sell
 *
 * 地方競馬（NAR）や頭数が取れない場合は絞り込みを行わない。
 */

export function getStarterCount(result) {
  if (!result) return 0;
  const horses = Array.isArray(result.horses) ? result.horses : [];
  if (horses.some((h) => h.excluded === true)) {
    return horses.filter((h) => !h.excluded).length;
  }
  const n = result.totalHorses;
  if (typeof n === 'number' && Number.isFinite(n) && n > 0) return n;
  return horses.length;
}

export function isNarBetContext(ctx = {}) {
  const { source, result } = ctx;
  if (source === 'nar') return true;
  if (result?.netkeibaOrigin === 'nar') return true;
  return false;
}

function hasMultiHorseSameFrame(horses) {
  if (!horses?.length) return false;
  const byFrame = new Map();
  for (const h of horses) {
    if (h.excluded) continue;
    const f = String(h.frameNumber ?? '').trim();
    if (!f) continue;
    byFrame.set(f, (byFrame.get(f) || 0) + 1);
  }
  for (const c of byFrame.values()) {
    if (c >= 2) return true;
  }
  return false;
}

/**
 * 枠連で「同枠同士」（例: 3-3）が成立するか。当該枠に2頭以上いるときのみ。
 * @param {object[]|undefined} horses
 * @param {string|number} frame
 */
export function frameAllowsWakurenSamePair(horses, frame) {
  const fs = String(frame ?? '').trim();
  if (!fs) return false;
  let c = 0;
  for (const h of horses || []) {
    if (h.excluded) continue;
    if (String(h.frameNumber ?? '').trim() === fs) c += 1;
    if (c >= 2) return true;
  }
  return false;
}

/**
 * 枠連: 9頭以上は常に発売。8頭以下でも同一枠に2頭以上いる場合は発売（JRA注記）。
 * 2頭立ては表上「枠連 発売なし」のみで注記の対象外とみなし発売しない。
 */
function jraFramePairAllowed(n, horses) {
  if (n < 3) return false;
  if (n >= 9) return true;
  return hasMultiHorseSameFrame(horses);
}

/**
 * @param {string} betTypeId
 * @param {number} n 出走頭数（確定値があるとき）
 * @param {object[]|undefined} horses 枠連例外判定用
 */
export function jraBetTypeAllowed(betTypeId, n, horses = []) {
  if (!betTypeId || n < 2) return true;

  const frameOk = jraFramePairAllowed(n, horses);

  switch (betTypeId) {
    case 'win':
      return true;
    case 'place':
    case 'win_place':
      return n >= 5;
    case 'frame_pair':
      return frameOk;
    case 'horse_pair':
      return n >= 3;
    case 'wide':
      return n >= 4;
    case 'umatan':
      return n >= 3;
    case 'trifuku':
    case 'tritan':
      return n >= 4;
    default:
      return true;
  }
}

/**
 * @param {{ id: string, label: string }[]} betTypes
 * @param {{ source?: string, result?: object }} ctx
 */
export function filterBetTypesForJraSale(betTypes, ctx = {}) {
  if (isNarBetContext(ctx)) return betTypes;
  const n = getStarterCount(ctx.result);
  if (n < 2) return betTypes;
  return betTypes.filter((t) => jraBetTypeAllowed(t.id, n, ctx.result?.horses));
}

export function isJraBetTypeAllowedForFlow(betTypeId, flow) {
  if (!flow || isNarBetContext(flow)) return true;
  const n = getStarterCount(flow.result);
  if (n < 2) return true;
  return jraBetTypeAllowed(betTypeId, n, flow.result?.horses);
}
