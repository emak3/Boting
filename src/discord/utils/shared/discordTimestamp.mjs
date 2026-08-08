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
  const m = String(text || '').match(/(\d{1,2})\s*[:\uFF1A]\s*(\d{2})/);
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

function ymdFromText(text) {
  const s = String(text || '');
  const bare = s.match(/\b(\d{8})\b/);
  if (bare) return normalizeYmd(bare[1]);
  const m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return '';
  const ymd = `${m[1]}${String(m[2]).padStart(2, '0')}${String(m[3]).padStart(2, '0')}`;
  return normalizeYmd(ymd);
}

export function dateFromJstYmdHm(ymd, hmText) {
  const day = normalizeYmd(ymd);
  const hm = hmFromText(hmText);
  if (!day || !hm) return null;
  const iso =
    `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}` +
    `T${String(hm.h).padStart(2, '0')}:${String(hm.mi).padStart(2, '0')}:00+09:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function dateFromJstYmd(ymd) {
  const day = normalizeYmd(ymd);
  if (!day) return null;
  const iso = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T00:00:00+09:00`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function dateFromRaceTime({
  raceId = '',
  holdYmd = '',
  timeText = '',
} = {}) {
  return dateFromJstYmdHm(normalizeYmd(holdYmd) || ymdFromRaceId(raceId), timeText);
}

export function discordTimestampFromJstYmdHm(ymd, hmText, style = 't') {
  const d = dateFromJstYmdHm(ymd, hmText);
  return d ? discordTimestamp(d, style) : '';
}

export function discordTimestampFromJstYmd(ymd, style = 'D') {
  const d = dateFromJstYmd(ymd);
  return d ? discordTimestamp(d, style) : '';
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

export function discordTimestampFromRaceInfoDate(raw, style = 't') {
  const s = String(raw || '').trim();
  if (!s) return '';
  const ymd = ymdFromText(s);
  if (!ymd) return '';
  return discordTimestampFromJstYmdHm(ymd, s, style);
}

export function replaceRaceInfoDateTimesWithDiscordTimestamps(raw, style = 't') {
  const s = String(raw || '');
  if (!s) return '';
  const ymd = ymdFromText(s);
  if (!ymd) return s;
  return s.replace(/(\d{1,2}\s*[:\uFF1A]\s*\d{2})/g, (hm) => {
    return discordTimestampFromJstYmdHm(ymd, hm, style) || hm;
  });
}

export function replaceDateAndTimeWithDiscordTimestamps(raw, {
  dateStyle = 'D',
  timeStyle = 't',
} = {}) {
  let s = String(raw || '');
  if (!s) return '';
  const ymd = ymdFromText(s);
  if (!ymd) return s;

  const dateTs = discordTimestampFromJstYmd(ymd, dateStyle);
  if (dateTs) {
    s = s.replace(
      /\b\d{8}\b|(\d{4})\D+(\d{1,2})\D+(\d{1,2})(?:\u65E5)?/,
      dateTs,
    );
  }

  return s.replace(/(\d{1,2}\s*[:\uFF1A]\s*\d{2})/g, (hm) => {
    return discordTimestampFromJstYmdHm(ymd, hm, timeStyle) || hm;
  });
}
