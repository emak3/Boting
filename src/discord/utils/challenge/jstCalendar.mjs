import { addJstCalendarDays, getJstCalendarYmd } from '../user/userPointsStore.mjs';

/**
 * 瞬間 `now` における JST の暦年（例: 2025）
 * @param {Date} [now]
 */
export function getJstCalendarYear(now = new Date()) {
  const shifted = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return shifted.getUTCFullYear();
}

/**
 * その瞬間を含む JST 週の月曜日（暦）YYYYMMDD。週の範囲は月曜 0:00 ～翌月曜 0:00（JST）。
 * @param {Date} [now]
 */
export function getJstMondayYmdForInstant(now = new Date()) {
  const ymd = getJstCalendarYmd(now);
  const shifted = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const dow = shifted.getUTCDay();
  const daysFromMonday = (dow + 6) % 7;
  return addJstCalendarDays(ymd, -daysFromMonday);
}

/**
 * @param {string} monYmd 月曜の YYYYMMDD（JST）
 */
export function weekBoundsUtcFromMondayYmd(monYmd) {
  const y = monYmd.slice(0, 4);
  const mo = monYmd.slice(4, 6);
  const da = monYmd.slice(6, 8);
  const start = new Date(`${y}-${mo}-${da}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 7 * 86400000);
  return { start, end, mondayYmd: monYmd };
}

/**
 * 購入時刻 `purchasedAt` の年次窓 [start, end)（JST 暦年）
 * @param {number} year
 */
export function jstYearPurchasedAtBounds(year) {
  const y = Math.trunc(Number(year));
  const start = new Date(`${y}-01-01T00:00:00+09:00`);
  const end = new Date(`${y + 1}-01-01T00:00:00+09:00`);
  return { start, end };
}

/**
 * すでに終了した週（翌週月曜 0:00 JST 以降のみ）の月曜 YYYYMMDDを、新しい順に最大 `maxWeeks` 件
 * @param {Date} now
 * @param {number} [maxWeeks]
 */
export function enumerateCompletedWeekMondaysDescending(now, maxWeeks = 52) {
  const out = [];
  let mon = getJstMondayYmdForInstant(now);
  for (let i = 0; i < maxWeeks + 16; i++) {
    const { end } = weekBoundsUtcFromMondayYmd(mon);
    if (now >= end) {
      out.push(mon);
      if (out.length >= maxWeeks) break;
    }
    mon = addJstCalendarDays(mon, -7);
  }
  return out;
}
