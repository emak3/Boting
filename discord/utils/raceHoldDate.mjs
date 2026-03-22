import { netkeibaOriginFromFlow } from './netkeibaUrls.mjs';

/**
 * JRA オッズ API の official_datetime 等（ISO またはローカル風）から JST の開催日 YYYYMMDD
 * @param {unknown} raw
 * @returns {string}
 */
export function ymdFromJraOfficialDatetime(raw) {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim();
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  const shifted = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  return `${y}${String(m).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}

/**
 * 出馬表の RaceData01 相当やスラッシュ区切りから JST 開催日 YYYYMMDD
 * @param {unknown} raw
 * @returns {string} 空文字は失敗
 */
export function parseNetkeibaRaceDateTextToYmd(raw) {
  if (raw == null) return '';
  const s = String(raw).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  let m = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!m) m = s.match(/(\d{4})\s*[\/．]\s*(\d{1,2})\s*[\/．]\s*(\d{1,2})/);
  if (!m) m = s.match(/(\d{4})\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})/);
  if (!m) return '';
  const y = m[1];
  const mo = String(m[2]).padStart(2, '0');
  const da = String(m[3]).padStart(2, '0');
  const ymd = `${y}${mo}${da}`;
  return /^\d{8}$/.test(ymd) ? ymd : '';
}

/**
 * 購入確定時に Firestore へ書く開催日（優先順: 明示 > ページ日付 > オッズAPI時刻 > NAR の race_id）
 * @param {object} it 購入予定1件
 * @returns {string}
 */
export function resolveRaceHoldYmdForPurchaseItem(it) {
  const raceId = String(it.raceId || '');
  if (it.raceHoldYmd != null && /^\d{8}$/.test(String(it.raceHoldYmd).trim())) {
    return String(it.raceHoldYmd).trim();
  }
  // 地方は race_id 先頭8桁が開催日。raceInfoDate より先に採用（ページ日付の取り違えで履歴から落ちるのを防ぐ）
  if (it.netkeibaOrigin === 'nar' && /^\d{12}$/.test(raceId)) {
    const p = raceId.slice(0, 8);
    if (/^\d{8}$/.test(p)) return p;
  }
  const fromInfo = parseNetkeibaRaceDateTextToYmd(it.raceInfoDate);
  if (fromInfo) return fromInfo;
  const fromOd = ymdFromJraOfficialDatetime(it.oddsOfficialTime);
  if (fromOd) return fromOd;
  return '';
}

/**
 * 購入予定に載せる開催日（JRA は kaisaiDate / オッズ時刻 / ページの日付、NAR は race_id 先頭8桁）
 * @param {object | null | undefined} flow
 * @param {string} raceId
 * @returns {string}
 */
export function deriveRaceHoldYmdFromFlow(flow, raceId) {
  const kd = flow?.kaisaiDate;
  if (kd != null && /^\d{8}$/.test(String(kd).trim())) {
    return String(kd).trim();
  }
  const origin = netkeibaOriginFromFlow(flow);
  if (origin === 'nar' && /^\d{12}$/.test(String(raceId))) {
    const p = String(raceId).slice(0, 8);
    if (/^\d{8}$/.test(p)) return p;
  }
  const fromOd = ymdFromJraOfficialDatetime(flow?.result?.oddsOfficialTime);
  if (fromOd) return fromOd;
  const raw = flow?.result?.raceInfo?.date;
  return parseNetkeibaRaceDateTextToYmd(raw);
}
