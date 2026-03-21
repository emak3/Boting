import axios from 'axios';
import * as cheerio from 'cheerio';
import { handleEncoding } from './utils/encoding.mjs';

const BASE = 'https://race.netkeiba.com';

const headers = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
  Referer: 'https://race.netkeiba.com/top/',
};

async function fetchHtml(url) {
  const response = await axios.get(url, {
    headers,
    responseType: 'arraybuffer',
    timeout: 20000,
    maxRedirects: 5,
  });
  return handleEncoding(response.data, response);
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

export function filterVenueRaces(venues, kaisaiId) {
  const v = venues.find((x) => x.kaisaiId === kaisaiId);
  return v ? v.races : [];
}
