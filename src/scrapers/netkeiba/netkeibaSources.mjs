export const NETKEIBA_SOURCES = Object.freeze({
  jra: Object.freeze({
    origin: 'jra',
    baseUrl: 'https://race.netkeiba.com',
  }),
  nar: Object.freeze({
    origin: 'nar',
    baseUrl: 'https://nar.netkeiba.com',
  }),
});

export function netkeibaBaseUrlForOrigin(origin) {
  return NETKEIBA_SOURCES[origin]?.baseUrl ?? NETKEIBA_SOURCES.jra.baseUrl;
}

export function requestHeadersForNetkeibaBase(baseUrl, baseHeaders) {
  return {
    ...baseHeaders,
    Referer: `${baseUrl.replace(/\/$/, '')}/top/`,
  };
}

export function likelyOriginFromRaceId(raceId) {
  const venueCode = String(raceId || '').slice(8, 10);
  const code = Number(venueCode);
  if (!Number.isInteger(code)) return null;
  return code >= 1 && code <= 10 ? 'jra' : 'nar';
}

export function orderedRaceCardSources(preferredOrigin = null) {
  if (preferredOrigin === 'jra' || preferredOrigin === 'nar') {
    const preferred = NETKEIBA_SOURCES[preferredOrigin];
    const fallback =
      preferredOrigin === 'jra' ? NETKEIBA_SOURCES.nar : NETKEIBA_SOURCES.jra;
    return [preferred, fallback];
  }
  return [NETKEIBA_SOURCES.jra, NETKEIBA_SOURCES.nar];
}

export function orderedRaceResultSources(raceId) {
  const sources = [NETKEIBA_SOURCES.jra, NETKEIBA_SOURCES.nar];
  return likelyOriginFromRaceId(raceId) === 'nar' ? sources.reverse() : sources;
}

export function racePageUrl({ baseUrl }, page, raceId) {
  return `${baseUrl}/race/${page}.html?race_id=${encodeURIComponent(String(raceId))}`;
}
