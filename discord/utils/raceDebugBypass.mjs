import {
  findRaceMetaForToday,
  fetchRaceListSub,
  parseRaceListSub,
  filterVenueRaces,
  getRaceSalesStatus,
} from '../../cheerio/netkeibaSchedule.mjs';

const DEBUG_BYPASS_USER_ID = '864735082732322867';

let debugSalesBypassEnabled = false;

export function canBypassSalesClosed(userId) {
  return debugSalesBypassEnabled && userId === DEBUG_BYPASS_USER_ID;
}

export function setDebugSalesBypass(enabled) {
  debugSalesBypassEnabled = !!enabled;
}

export function isDebugSalesBypassEnabled() {
  return debugSalesBypassEnabled;
}

/**
 * 発売が締切かどうか。判定不能時は null（従来どおり購入フローを阻害しない）。
 * @param {string} raceId
 * @param {Record<string, unknown>} [flow]
 * @returns {Promise<boolean|null>}
 */
export async function resolveSalesClosedForRace(raceId, flow) {
  try {
    const meta = await findRaceMetaForToday(raceId);
    if (meta) {
      return getRaceSalesStatus(meta.race, meta.kaisaiDateYmd).closed;
    }
    if (flow?.kaisaiDate && flow?.currentGroup && flow?.kaisaiId) {
      const html = await fetchRaceListSub(flow.kaisaiDate, flow.currentGroup);
      const { venues } = parseRaceListSub(html, flow.kaisaiDate);
      const races = filterVenueRaces(venues, flow.kaisaiId);
      const r = races.find((x) => x.raceId === raceId);
      if (r) return getRaceSalesStatus(r, flow.kaisaiDate).closed;
    }
  } catch (e) {
    console.warn('resolveSalesClosedForRace:', e.message);
  }
  return null;
}
