function validDiscordStyle(style) {
  return /^[tTdDfFR]$/.test(String(style || ''));
}

export function discordTimestamp(input, style = 't') {
  const d =
    input instanceof Date
      ? input
      : typeof input === 'number'
        ? new Date(input)
        : new Date(String(input || ''));
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const unix = Math.floor(d.getTime() / 1000);
  const s = validDiscordStyle(style) ? style : 't';
  return `<t:${unix}:${s}>`;
}

function ymdFromRaceId(raceId) {
  const rid = String(raceId || '');
  if (!/^\d{12}$/.test(rid)) return '';
  const ymd = rid.slice(0, 8);
  return /^\d{8}$/.test(ymd) ? ymd : '';
}

function normalizeYmd(ymd) {
  const s = String(ymd || '').replace(/\D/g, '');
  return /^\d{8}$/.test(s) ? s : '';
}

function hmFromText(text) {
  const m = String(text || '').match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (!m) return null;
  const h = Number.parseInt(m[1], 10);
  const mi = Number.parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return null;
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return { h, mi };
}

function hasExplicitTimezone(text) {
  const s = String(text || '').trim();
  return /Z$/i.test(s) || /[+-]\d{2}:?\d{2}$/.test(s);
}

export function discordTimestampFromJstYmdHm(ymd, hmText, style = 't') {
  const day = normalizeYmd(ymd);
  const hm = hmFromText(hmText);
  if (!day || !hm) return '';
  const iso =
    `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}` +
    `T${String(hm.h).padStart(2, '0')}:${String(hm.mi).padStart(2, '0')}:00+09:00`;
  return discordTimestamp(iso, style);
}

export function discordTimestampFromRaceTime({
  raceId = '',
  holdYmd = '',
  timeText = '',
  style = 't',
} = {}) {
  return discordTimestampFromJstYmdHm(
    normalizeYmd(holdYmd) || ymdFromRaceId(raceId),
    timeText,
    style,
  );
}

export function discordTimestampFromOddsOfficialTime(
  raw,
  { raceId = '', holdYmd = '', style = 't' } = {},
) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (hasExplicitTimezone(s)) {
    const ts = discordTimestamp(s, style);
    if (ts) return ts;
  }
  return discordTimestampFromRaceTime({
    raceId,
    holdYmd,
    timeText: s,
    style,
  });
}
