import axios from 'axios';
import * as cheerio from 'cheerio';
import { handleEncoding } from './utils/encoding.mjs';
import { axiosKeepAlive } from './utils/httpAgents.mjs';
import { mapWithConcurrency } from '../../utils/concurrency/mapWithConcurrency.mjs';

const BASE = 'https://race.netkeiba.com';
export const NAR_BASE = 'https://nar.netkeiba.com';

const headers = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
  Referer: 'https://race.netkeiba.com/top/',
};

const narHeaders = {
  ...headers,
  Referer: `${NAR_BASE}/top/`,
};

async function fetchHtml(url) {
  const response = await axios.get(url, {
    headers,
    responseType: 'arraybuffer',
    timeout: 20000,
    maxRedirects: 5,
    ...axiosKeepAlive,
  });
  return handleEncoding(response.data, response, { label: 'fetchHtml', url });
}

async function fetchNarHtml(url) {
  const response = await axios.get(url, {
    headers: narHeaders,
    responseType: 'arraybuffer',
    timeout: 20000,
    maxRedirects: 5,
    ...axiosKeepAlive,
  });
  return handleEncoding(response.data, response, { label: 'fetchNarHtml', url });
}

/** 同一キーへの同時リクエストは 1 本にまとめ、短時間はメモリに保持（メニュー連打・findRaceMeta の二重取得対策） */
const SCHEDULE_TTL_MS = 60_000;
const scheduleMemo = new Map();
const scheduleInflight = new Map();

async function memoSchedule(key, ttlMs, factory) {
  const now = Date.now();
  const hit = scheduleMemo.get(key);
  if (hit && hit.expires > now) return hit.value;
  if (scheduleInflight.has(key)) return scheduleInflight.get(key);
  const p = factory()
    .then((value) => {
      scheduleMemo.set(key, { expires: Date.now() + ttlMs, value });
      scheduleInflight.delete(key);
      return value;
    })
    .catch((e) => {
      scheduleInflight.delete(key);
      throw e;
    });
  scheduleInflight.set(key, p);
  return p;
}

/** NAR 開催場タブの同時取得上限（無制限並列だと netkeiba 側のレート制限に当たりやすい） */
const NAR_VENUE_FETCH_CONCURRENCY = 5;

/** 日本時間の開催日 YYYYMMDD */
export function jstYmd(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const d = parts.find((p) => p.type === 'day').value;
  return `${y}${m}${d}`;
}

function liHasActiveClass(_, el, $) {
  return /\bActive\b/i.test($(el).attr('class') || '');
}

/**
 * race_list_get_date_list の HTML から JRA の kaisai_date / current_group を取り出す（DOM 変更・空 fragment に耐性）
 * @returns {{ kaisaiDate: string, currentGroup: string } | null}
 */
export function parseJraActiveKaisaiFromDateListHtml(html) {
  const today = jstYmd();
  const $ = cheerio.load(html);

  let $items = $('#date_list_sub li[date][group]');
  if (!$items.length) {
    $items = $('ul.Tab5 li[date][group]');
  }
  if (!$items.length) {
    $items = $('li[date][group]');
  }

  let $li = $items.filter((i, el) => liHasActiveClass(i, el, $)).first();
  if (!$li.length) {
    $li = $items.filter(`[date="${today}"]`).first();
  }
  if (!$li.length) {
    $li = $items.first();
  }
  if ($li.length) {
    const kaisaiDate = $li.attr('date');
    const currentGroup = $li.attr('group');
    if (kaisaiDate && currentGroup) {
      return { kaisaiDate, currentGroup };
    }
  }

  const activeRe =
    /<li[^>]*\bclass\s*=\s*["'][^"']*\bActive\b[^"']*["'][^>]*\bdate\s*=\s*["'](\d{8})["'][^>]*\bgroup\s*=\s*["'](\d+)["'][^>]*>/i;
  let am = html.match(activeRe);
  if (am) {
    return { kaisaiDate: am[1], currentGroup: am[2] };
  }
  const activeRe2 =
    /<li[^>]*\bdate\s*=\s*["'](\d{8})["'][^>]*\bgroup\s*=\s*["'](\d+)["'][^>]*\bclass\s*=\s*["'][^"']*\bActive\b[^"']*["'][^>]*>/i;
  am = html.match(activeRe2);
  if (am) {
    return { kaisaiDate: am[1], currentGroup: am[2] };
  }

  const re = /race_list_sub\.html\?kaisai_date=(\d{8})&current_group=(\d+)/g;
  const pairs = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    pairs.push({ kaisaiDate: m[1], currentGroup: m[2] });
  }
  if (pairs.length) {
    const hit = pairs.find((p) => p.kaisaiDate === today) || pairs[0];
    return hit;
  }

  return null;
}

/**
 * 日付リスト HTML から指定 YYYYMMDD のタブだけを取る（見つからなければ null）
 * @returns {{ kaisaiDate: string, currentGroup: string } | null}
 */
export function parseJraKaisaiTabForYmd(html, desiredYmd) {
  if (!desiredYmd || !/^\d{8}$/.test(String(desiredYmd))) return null;
  const $ = cheerio.load(html);

  let $items = $('#date_list_sub li[date][group]');
  if (!$items.length) {
    $items = $('ul.Tab5 li[date][group]');
  }
  if (!$items.length) {
    $items = $('li[date][group]');
  }

  const $li = $items.filter(`[date="${desiredYmd}"]`).first();
  if ($li.length) {
    const kaisaiDate = $li.attr('date');
    const currentGroup = $li.attr('group');
    if (kaisaiDate && currentGroup) {
      return { kaisaiDate, currentGroup };
    }
  }

  const re = new RegExp(
    `race_list_sub\\.html\\?kaisai_date=(${desiredYmd})&current_group=(\\d+)`,
    'g',
  );
  const m = re.exec(html);
  if (m) {
    return { kaisaiDate: m[1], currentGroup: m[2] };
  }

  return null;
}

/**
 * 日本時間の「その日」の中央開催一覧（ボタン・メニュー押下日と開催日を一致させる）
 * その日に JRA 開催がない（休場など）場合は venues が空・noTabForDate が true。
 */
export async function fetchVenuesAndRacesForJstYmd(desiredYmd) {
  return memoSchedule(`jra:venuesJst:${desiredYmd}`, SCHEDULE_TTL_MS, async () => {
    const url = `${BASE}/top/race_list_get_date_list.html?encoding=UTF-8`;
    let html = await fetchHtml(url);
    let parsed = parseJraKaisaiTabForYmd(html, desiredYmd);
    if (!parsed) {
      await new Promise((r) => setTimeout(r, 400));
      html = await fetchHtml(url);
      parsed = parseJraKaisaiTabForYmd(html, desiredYmd);
    }
    if (!parsed) {
      return {
        venues: [],
        kaisaiDateYmd: desiredYmd,
        currentGroup: null,
        noTabForDate: true,
      };
    }
    const { kaisaiDate, currentGroup } = parsed;
    const subHtml = await fetchRaceListSub(kaisaiDate, currentGroup);
    return { ...parseRaceListSub(subHtml, kaisaiDate), currentGroup };
  });
}

/**
 * トップの日付タブ HTML を取得し、アクティブ（または本日）の kaisai_date / current_group を返す
 */
export async function fetchActiveKaisaiTab() {
  return memoSchedule('jra:activeTab', SCHEDULE_TTL_MS, async () => {
    const url = `${BASE}/top/race_list_get_date_list.html?encoding=UTF-8`;
    let html = await fetchHtml(url);
    let parsed = parseJraActiveKaisaiFromDateListHtml(html);
    if (!parsed) {
      await new Promise((r) => setTimeout(r, 400));
      html = await fetchHtml(url);
      parsed = parseJraActiveKaisaiFromDateListHtml(html);
    }
    if (!parsed) {
      throw new Error('開催日タブが見つかりません');
    }
    return parsed;
  });
}

/**
 * 指定開催日のレース一覧 HTML を取得
 */
export async function fetchRaceListSub(kaisaiDate, currentGroup) {
  const key = `jra:list:${kaisaiDate}:${currentGroup}`;
  return memoSchedule(key, SCHEDULE_TTL_MS, async () => {
    const q = new URLSearchParams({
      kaisai_date: kaisaiDate,
      current_group: currentGroup,
    });
    return fetchHtml(`${BASE}/top/race_list_sub.html?${q.toString()}`);
  });
}

/**
 * race_list_sub.html を解析（開催場ごとに races）
 */
export function parseRaceListSub(html, kaisaiDateYmd) {
  const $ = cheerio.load(html);
  const venues = [];

  $('dl.RaceList_DataList').each((_, dl) => {
    const $dl = $(dl);
    const title = $dl.find('dt .RaceList_DataTitle').text().replace(/\s+/g, ' ').trim();
    const payHref = $dl.find('a.LinkHaraimodoshiichiran').attr('href') || '';
    let kaisaiId = (payHref.match(/kaisai_id=(\d+)/) || [])[1] || null;

    const races = [];
    $dl.find('dd.RaceList_Data li.RaceList_DataItem').each((_, li) => {
      const $a = $(li).find('a[href*="race_id="]').first();
      const href = $a.attr('href') || '';
      const rm = href.match(/race_id=(\d{12})/);
      if (!rm) return;
      const raceId = rm[1];
      const rTitle = $a.find('.ItemTitle').first().text().trim();
      const timeText = $a.find('.RaceList_Itemtime').first().text().trim();
      const numText = $a
        .find('.Race_Num')
        .first()
        .text()
        .replace(/\s+/g, ' ')
        .trim();
      const isShutuba = href.includes('shutuba');
      const isResult = href.includes('result');
      races.push({
        raceId,
        roundLabel: numText,
        title: rTitle,
        timeText,
        isShutuba,
        isResult,
      });
    });

    if (!races.length) return;
    if (!kaisaiId) {
      kaisaiId = races[0].raceId.slice(0, 10);
    }
    venues.push({ title: title || '開催', kaisaiId, races });
  });

  return { kaisaiDateYmd, venues };
}

/**
 * 発売状態（発走2分前で締切、確定・発走後は締切扱い）
 */
export function getRaceSalesStatus(race, kaisaiDateYmd, now = new Date()) {
  if (race.isResult) {
    return { shortLabel: '確定', detail: '結果確定', closed: true };
  }
  const tm = race.timeText.match(/(\d{1,2})\s*:\s*(\d{2})/);
  if (!tm) {
    return { shortLabel: '—', detail: '時刻不明', closed: false };
  }
  const hh = parseInt(tm[1], 10);
  const mm = parseInt(tm[2], 10);
  const y = parseInt(kaisaiDateYmd.slice(0, 4), 10);
  const mo = parseInt(kaisaiDateYmd.slice(4, 6), 10);
  const d = parseInt(kaisaiDateYmd.slice(6, 8), 10);
  const postIso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+09:00`;
  const postMs = Date.parse(postIso);
  if (Number.isNaN(postMs)) {
    return { shortLabel: '—', detail: '時刻解析エラー', closed: false };
  }
  const closeMs = postMs - 2 * 60 * 1000;
  const nowMs = now.getTime();
  if (nowMs >= postMs) {
    return { shortLabel: '発走済', detail: '発走済み（発売終了）', closed: true };
  }
  if (nowMs >= closeMs) {
    return { shortLabel: '締切', detail: '発売締切（発走2分前）', closed: true };
  }
  return { shortLabel: '発売中', detail: '発売中（発走約2分前まで）', closed: false };
}

/**
 * 発売締切（発走2分前）の時刻 ms（UTC）。時刻不明・結果確定時は null。
 * @param {{ isResult?: boolean, timeText?: string }} race
 * @param {string} kaisaiDateYmd
 * @returns {number | null}
 */
export function getRaceBettingCloseDeadlineMs(race, kaisaiDateYmd) {
  if (race?.isResult) return null;
  const tm = String(race?.timeText || '').match(/(\d{1,2})\s*:\s*(\d{2})/);
  if (!tm) return null;
  const hh = parseInt(tm[1], 10);
  const mm = parseInt(tm[2], 10);
  const y = parseInt(kaisaiDateYmd.slice(0, 4), 10);
  const mo = parseInt(kaisaiDateYmd.slice(4, 6), 10);
  const d = parseInt(kaisaiDateYmd.slice(6, 8), 10);
  const postIso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+09:00`;
  const postMs = Date.parse(postIso);
  if (Number.isNaN(postMs)) return null;
  return postMs - 2 * 60 * 1000;
}

export async function fetchTodayVenuesAndRaces() {
  return fetchVenuesAndRacesForJstYmd(jstYmd());
}

/**
 * 発走の暦日（JST）に使う YYYYMMDD。
 * JRA: race_id 先頭8桁が開催日。NAR: race_id 先頭は暦日と一致しないことがあるため **開催ページの kaisai_date のみ**を使う。
 * @param {{ source?: 'jra' | 'nar' }} [opts]
 * @returns {string} YYYYMMDD
 */
export function racePostDateYmdJst(race, kaisaiDateYmd, opts = {}) {
  if (opts.source === 'nar') {
    return String(kaisaiDateYmd || '');
  }
  const id = String(race?.raceId || '');
  if (/^\d{12}$/.test(id)) {
    const ymd = id.slice(0, 8);
    if (/^\d{8}$/.test(ymd)) return ymd;
  }
  return String(kaisaiDateYmd || '');
}

/**
 * 発走日（暦日・JST）が interactionYmd と一致するレースだけ残す（操作日とズレたレースを除外）
 * @param {{ source?: 'jra' | 'nar' }} [opts]
 */
export function filterRacesByInteractionPostDateYmd(
  races,
  kaisaiDateYmd,
  interactionYmd,
  opts = {},
) {
  if (!interactionYmd || !/^\d{8}$/.test(String(interactionYmd))) {
    return races || [];
  }
  return (races || []).filter(
    (r) => racePostDateYmdJst(r, kaisaiDateYmd, opts) === interactionYmd,
  );
}

/** 開催場ごとのレースを操作日で絞り、0件の場は除外 */
export function filterVenuesForInteractionPostDate(
  venues,
  kaisaiDateYmd,
  interactionYmd,
  opts = {},
) {
  return (venues || [])
    .map((v) => ({
      ...v,
      races: filterRacesByInteractionPostDateYmd(
        v.races,
        kaisaiDateYmd,
        interactionYmd,
        opts,
      ),
    }))
    .filter((v) => v.races.length > 0);
}

/** アクティブな開催日タブの一覧から raceId に一致するレースを探す（見つからなければ null） */
export async function findRaceMetaForToday(raceId) {
  try {
    const { venues, kaisaiDateYmd, currentGroup } = await fetchTodayVenuesAndRaces();
    for (const v of venues) {
      const hit = v.races.find((r) => r.raceId === raceId);
      if (hit) {
        return {
          race: hit,
          kaisaiDateYmd,
          source: 'jra',
          scheduleKaisaiId: v.kaisaiId,
          currentGroup,
          venueTitle: (v.title || '').replace(/\s+/g, ' ').trim(),
        };
      }
    }
  } catch (e) {
    console.warn('findRaceMetaForToday (JRA):', e?.message ?? e);
  }

  try {
    const { venues, kaisaiDateYmd } = await fetchNarTodayVenuesAndRaces();
    for (const v of venues) {
      const hit = v.races.find((r) => r.raceId === raceId);
      if (hit) {
        return {
          race: hit,
          kaisaiDateYmd,
          source: 'nar',
          scheduleKaisaiId: v.kaisaiId,
          currentGroup: null,
          venueTitle: (v.title || '').replace(/\s+/g, ' ').trim(),
        };
      }
    }
  } catch (e) {
    console.warn('findRaceMetaForToday (NAR):', e?.message ?? e);
  }

  return null;
}

export function filterVenueRaces(venues, kaisaiId) {
  const v = venues.find((x) => x.kaisaiId === kaisaiId);
  return v ? v.races : [];
}

// ----- 地方競馬 (NAR / nar.netkeiba.com) -----

function narKaisaiIdForDate(html, ymd) {
  const re = /race_list_sub\.html\?kaisai_date=(\d{8})(?:&kaisai_id=(\d+))?/g;
  let m;
  let lastWithId = null;
  while ((m = re.exec(html)) !== null) {
    if (m[1] !== ymd) continue;
    if (m[2]) lastWithId = m[2];
  }
  return lastWithId;
}

/**
 * NAR race_list_get_date_list の HTML から開催日・kaisai_id（任意）を取り出す
 * @returns {{ kaisaiDate: string, activeKaisaiId: string | null } | null}
 */
export function parseNarActiveKaisaiFromDateListHtml(html) {
  const today = jstYmd();
  const $ = cheerio.load(html);
  let $items = $('#date_list_sub li[date]');
  if (!$items.length) {
    $items = $('ul.Tab5 li[date]');
  }
  if (!$items.length) {
    $items = $('li[date]');
  }
  let $li = $items.filter((i, el) => liHasActiveClass(i, el, $)).first();
  if (!$li.length) {
    $li = $items.filter(`[date="${today}"]`).first();
  }
  if (!$li.length) {
    $li = $items.first();
  }
  if ($li.length) {
    const kaisaiDate = $li.attr('date');
    if (kaisaiDate) {
      const ahref = $li.find('a').attr('href') || '';
      const am = ahref.match(/kaisai_id=(\d+)/);
      return { kaisaiDate, activeKaisaiId: am ? am[1] : null };
    }
  }

  const activeRe =
    /<li[^>]*\bclass\s*=\s*["'][^"']*\bActive\b[^"']*["'][^>]*\bdate\s*=\s*["'](\d{8})["'][^>]*>/i;
  let am = html.match(activeRe);
  if (!am) {
    const activeRe2 =
      /<li[^>]*\bdate\s*=\s*["'](\d{8})["'][^>]*\bclass\s*=\s*["'][^"']*\bActive\b[^"']*["'][^>]*>/i;
    am = html.match(activeRe2);
  }
  if (am) {
    const kaisaiDate = am[1];
    return { kaisaiDate, activeKaisaiId: narKaisaiIdForDate(html, kaisaiDate) };
  }

  const re = /race_list_sub\.html\?kaisai_date=(\d{8})(?:&kaisai_id=(\d+))?/g;
  const pairs = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    pairs.push({ kaisaiDate: m[1], activeKaisaiId: m[2] ?? null });
  }
  if (pairs.length) {
    const hit = pairs.find((p) => p.kaisaiDate === today) || pairs[0];
    return hit;
  }
  return null;
}

/**
 * NAR トップの日付タブから開催日を取得（href の kaisai_id は任意）
 */
export async function fetchNarActiveKaisaiTab() {
  return memoSchedule('nar:activeTab', SCHEDULE_TTL_MS, async () => {
    const url = `${NAR_BASE}/top/race_list_get_date_list.html?encoding=UTF-8`;
    let html = await fetchNarHtml(url);
    let parsed = parseNarActiveKaisaiFromDateListHtml(html);
    if (!parsed) {
      await new Promise((r) => setTimeout(r, 400));
      html = await fetchNarHtml(url);
      parsed = parseNarActiveKaisaiFromDateListHtml(html);
    }
    if (!parsed) {
      throw new Error('NAR: 開催日タブが見つかりません');
    }
    const { kaisaiDate, activeKaisaiId } = parsed;
    if (!kaisaiDate) {
      throw new Error('NAR: 開催日が不正です');
    }
    return { kaisaiDate, activeKaisaiId };
  });
}

/**
 * NAR レース一覧（開催場タブ切り替え用の kaisai_id 任意）
 */
export async function fetchNarRaceListSub(kaisaiDate, kaisaiId = null) {
  const key = `nar:list:${kaisaiDate}:${kaisaiId ?? ''}`;
  return memoSchedule(key, SCHEDULE_TTL_MS, async () => {
    const q = new URLSearchParams({ kaisai_date: kaisaiDate, rf: 'race_list' });
    if (kaisaiId) q.set('kaisai_id', kaisaiId);
    return fetchNarHtml(`${NAR_BASE}/top/race_list_sub.html?${q.toString()}`);
  });
}

/**
 * 開催場タブの kaisai_id 一覧（表示順）
 */
export function extractNarProvinceKaisaiIds(html) {
  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();
  $('ul.RaceList_ProvinceSelect li a[href*="kaisai_id="]').each((_, a) => {
    const href = $(a).attr('href') || '';
    const m = href.match(/kaisai_id=(\d+)/);
    if (!m) return;
    const kaisaiId = m[1];
    if (seen.has(kaisaiId)) return;
    seen.add(kaisaiId);
    const label = $(a).text().replace(/\s+/g, ' ').trim();
    out.push({ kaisaiId, label });
  });
  return out;
}

/**
 * NAR race_list_sub 1ページ分から 1開催場分を解析
 * @returns {{ title: string, kaisaiId: string, races: object[] } | null}
 */
export function parseNarRaceListSubToVenue(html, kaisaiDateYmd) {
  const $ = cheerio.load(html);
  let $dl = $('dl.RaceList_DataList')
    .filter((_, el) => /display\s*:\s*block/i.test($(el).attr('style') || ''))
    .first();
  if (!$dl.length) {
    $dl = $('dl.RaceList_DataList').first();
  }
  if (!$dl.length) return null;

  const payHref = $dl.find('a[href*="payback_list.html"]').first().attr('href') || '';
  let kaisaiId = (payHref.match(/kaisai_id=(\d+)/) || [])[1] || null;

  const title = $dl.find('dt .RaceList_DataTitle').first().text().replace(/\s+/g, ' ').trim();

  const races = [];
  $dl.find('dd.RaceList_Data li.RaceList_DataItem').each((_, li) => {
    const $a = $(li).find('a[href*="race_id="]').first();
    const href = $a.attr('href') || '';
    const rm = href.match(/race_id=(\d{12})/);
    if (!rm) return;
    const raceId = rm[1];
    const rTitle = $a.find('.ItemTitle').first().text().trim();
    let timeText = '';
    $a.find('.RaceData span').each((__, sp) => {
      const t = $(sp).text().trim();
      if (/\d{1,2}\s*:\s*\d{2}/.test(t)) {
        timeText = t;
        return false;
      }
    });
    const numText = $a.find('.Race_Num').first().text().replace(/\s+/g, ' ').trim();
    const isShutuba = href.includes('shutuba');
    const isResult = href.includes('result');
    races.push({
      raceId,
      roundLabel: numText,
      title: rTitle,
      timeText,
      isShutuba,
      isResult,
    });
  });

  if (!races.length) return null;
  if (!kaisaiId) {
    kaisaiId = races[0].raceId.slice(0, 10);
  }
  return { title: title || '開催', kaisaiId, races };
}

/**
 * 指定日の地方開催場一覧（タブごとに取得して結合）
 */
export async function fetchNarVenuesForDate(kaisaiDate) {
  return memoSchedule(`nar:venues:${kaisaiDate}`, SCHEDULE_TTL_MS, async () => {
    const html0 = await fetchNarRaceListSub(kaisaiDate);
    const provinces = extractNarProvinceKaisaiIds(html0);
    const venues = [];
    const loaded = new Set();

    const v0 = parseNarRaceListSubToVenue(html0, kaisaiDate);
    if (v0?.races?.length) {
      venues.push(v0);
      loaded.add(v0.kaisaiId);
    }

    const toFetch = provinces.filter(({ kaisaiId }) => !loaded.has(kaisaiId));
    const fetched = await mapWithConcurrency(
      toFetch,
      NAR_VENUE_FETCH_CONCURRENCY,
      ({ kaisaiId }) =>
        fetchNarRaceListSub(kaisaiDate, kaisaiId).then((html) => ({ kaisaiId, html })),
    );

    for (const { kaisaiId, html } of fetched) {
      const v = parseNarRaceListSubToVenue(html, kaisaiDate);
      if (v?.races?.length && !loaded.has(v.kaisaiId)) {
        venues.push(v);
        loaded.add(v.kaisaiId);
      }
    }

    return { kaisaiDateYmd: kaisaiDate, venues };
  });
}

export async function fetchNarTodayVenuesAndRaces() {
  return fetchNarVenuesForDate(jstYmd());
}
