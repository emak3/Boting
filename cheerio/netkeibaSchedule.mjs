import axios from 'axios';
import * as cheerio from 'cheerio';
import { handleEncoding } from './utils/encoding.mjs';

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
  });
  return handleEncoding(response.data, response, { label: 'fetchHtml', url });
}

async function fetchNarHtml(url) {
  const response = await axios.get(url, {
    headers: narHeaders,
    responseType: 'arraybuffer',
    timeout: 20000,
    maxRedirects: 5,
  });
  return handleEncoding(response.data, response, { label: 'fetchNarHtml', url });
}

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

/**
 * トップの日付タブ HTML を取得し、アクティブ（または本日）の kaisai_date / current_group を返す
 */
export async function fetchActiveKaisaiTab() {
  const html = await fetchHtml(`${BASE}/top/race_list_get_date_list.html?encoding=UTF-8`);
  const $ = cheerio.load(html);
  const today = jstYmd();
  let $li = $('#date_list_sub li.Active').first();
  if (!$li.length) {
    $li = $(`#date_list_sub li[date="${today}"]`).first();
  }
  if (!$li.length) {
    $li = $('#date_list_sub li').first();
  }
  if (!$li.length) {
    throw new Error('開催日タブが見つかりません');
  }
  const kaisaiDate = $li.attr('date');
  const currentGroup = $li.attr('group');
  if (!kaisaiDate || !currentGroup) {
    throw new Error('開催日情報が不正です');
  }
  return { kaisaiDate, currentGroup };
}

/**
 * 指定開催日のレース一覧 HTML を取得
 */
export async function fetchRaceListSub(kaisaiDate, currentGroup) {
  const q = new URLSearchParams({
    kaisai_date: kaisaiDate,
    current_group: currentGroup,
  });
  return fetchHtml(`${BASE}/top/race_list_sub.html?${q.toString()}`);
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

export async function fetchTodayVenuesAndRaces() {
  const { kaisaiDate, currentGroup } = await fetchActiveKaisaiTab();
  const subHtml = await fetchRaceListSub(kaisaiDate, currentGroup);
  const parsed = parseRaceListSub(subHtml, kaisaiDate);
  return { ...parsed, currentGroup };
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
    console.warn('findRaceMetaForToday (JRA):', e.message);
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
    console.warn('findRaceMetaForToday (NAR):', e.message);
  }
  return null;
}

export function filterVenueRaces(venues, kaisaiId) {
  const v = venues.find((x) => x.kaisaiId === kaisaiId);
  return v ? v.races : [];
}

// ----- 地方競馬 (NAR / nar.netkeiba.com) -----

/**
 * NAR トップの日付タブから開催日を取得（href の kaisai_id は任意）
 */
export async function fetchNarActiveKaisaiTab() {
  const html = await fetchNarHtml(`${NAR_BASE}/top/race_list_get_date_list.html?encoding=UTF-8`);
  const $ = cheerio.load(html);
  const today = jstYmd();
  let $li = $('#date_list_sub li.Active').first();
  if (!$li.length) {
    $li = $(`#date_list_sub li[date="${today}"]`).first();
  }
  if (!$li.length) {
    $li = $('#date_list_sub li').first();
  }
  if (!$li.length) {
    throw new Error('NAR: 開催日タブが見つかりません');
  }
  const kaisaiDate = $li.attr('date');
  if (!kaisaiDate) {
    throw new Error('NAR: 開催日が不正です');
  }
  const ahref = $li.find('a').attr('href') || '';
  const am = ahref.match(/kaisai_id=(\d+)/);
  return { kaisaiDate, activeKaisaiId: am ? am[1] : null };
}

/**
 * NAR レース一覧（開催場タブ切り替え用の kaisai_id 任意）
 */
export async function fetchNarRaceListSub(kaisaiDate, kaisaiId = null) {
  const q = new URLSearchParams({ kaisai_date: kaisaiDate, rf: 'race_list' });
  if (kaisaiId) q.set('kaisai_id', kaisaiId);
  return fetchNarHtml(`${NAR_BASE}/top/race_list_sub.html?${q.toString()}`);
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
  const html0 = await fetchNarRaceListSub(kaisaiDate);
  const provinces = extractNarProvinceKaisaiIds(html0);
  const venues = [];
  const loaded = new Set();

  const v0 = parseNarRaceListSubToVenue(html0, kaisaiDate);
  if (v0?.races?.length) {
    venues.push(v0);
    loaded.add(v0.kaisaiId);
  }

  for (const { kaisaiId } of provinces) {
    if (loaded.has(kaisaiId)) continue;
    const html = await fetchNarRaceListSub(kaisaiDate, kaisaiId);
    const v = parseNarRaceListSubToVenue(html, kaisaiDate);
    if (v?.races?.length) {
      venues.push(v);
      loaded.add(v.kaisaiId);
    }
  }

  return { kaisaiDateYmd: kaisaiDate, venues };
}

export async function fetchNarTodayVenuesAndRaces() {
  const { kaisaiDate } = await fetchNarActiveKaisaiTab();
  return fetchNarVenuesForDate(kaisaiDate);
}
