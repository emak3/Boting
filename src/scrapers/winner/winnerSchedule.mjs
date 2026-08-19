import axios from 'axios';
import * as cheerio from 'cheerio';
import { createHash } from 'node:crypto';

export const WINNER_SCHEDULE_URL =
  'https://store.toto-dream.com/dcs/subos/screen/pi34/spin052/PGSPIN05201InitGameSchedule.form';
export const WINNER_ODDS_URL =
  'https://store.toto-dream.com/dcs/subos/screen/pl37/spsl023/PGSPSL02301InitGetWinnerOdds.form';
export const WINNER_CLOSE_BEFORE_KICKOFF_MS = 10 * 60 * 1000;

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = { at: 0, matches: [] };

function normText(s) {
  return String(s || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\r\n]+/g, ' ')
    .trim();
}

function shortId(parts) {
  return createHash('sha1')
    .update(parts.map((p) => String(p || '')).join('|'))
    .digest('base64url')
    .slice(0, 12);
}

function currentJstYear(now = new Date()) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCFullYear();
}

function parseMonthDay(s) {
  const m = String(s || '').match(/(\d{1,2})\s*[\/月]\s*(\d{1,2})/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

function parseHourMinute(s) {
  const m = String(s || '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

export function winnerKickoffAt(match, now = new Date()) {
  const md = parseMonthDay(match?.dateShort || match?.matchDate);
  const hm = parseHourMinute(match?.kickOff);
  if (!md || !hm) return null;
  let year = currentJstYear(now);
  let d = new Date(Date.UTC(year, md.month - 1, md.day, hm.hour - 9, hm.minute, 0));
  if (d.getTime() < now.getTime() - 180 * 24 * 60 * 60 * 1000) {
    year += 1;
    d = new Date(Date.UTC(year, md.month - 1, md.day, hm.hour - 9, hm.minute, 0));
  }
  return d;
}

export function winnerSalesCloseAt(match, now = new Date()) {
  const kickoff = winnerKickoffAt(match, now);
  return kickoff ? new Date(kickoff.getTime() - WINNER_CLOSE_BEFORE_KICKOFF_MS) : null;
}

export function isWinnerMatchClosed(match, now = new Date()) {
  const closeAt = winnerSalesCloseAt(match, now);
  return closeAt ? now.getTime() >= closeAt.getTime() : false;
}

function extractWinnerMatchKeys(html) {
  const out = [];
  const re = /doFieldSetSubmitOnce\([^)]*?['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of String(html || '').matchAll(re)) {
    const commodityId = String(m[1] || '').trim();
    const holdCntId = String(m[2] || '').trim();
    if (!commodityId || !holdCntId) continue;
    out.push({ commodityId, holdCntId });
  }
  return out;
}

function isLeagueLine(s) {
  return /(?:J[123]|Ｊ[１２３]|Jリーグ|Ｊリーグ|ルヴァン|天皇杯|プレーオフ|スーパーカップ)/.test(s);
}

function isRoundLine(s) {
  return /^第.+節$/.test(s) || /(?:準々決勝|準決勝|決勝|プレーオフ)/.test(s);
}

function isDateLine(s) {
  return /^試合開催日/.test(s);
}

function isMatchStatusLine(s) {
  return /^試合開始予定$/.test(s);
}

function isMonthDayLine(s) {
  return /^\d{1,2}\/\d{1,2}\s*\(.+\)$/.test(s);
}

function isKickOffLine(s) {
  return /^\d{1,2}:\d{2}$/.test(s);
}

function isSalesLine(s) {
  return /販売開始日/.test(s) || /販売終了/.test(s) || /締切/.test(s);
}

function isRoleLine(s) {
  return /^（?(?:ホーム|アウェイ)）?$/.test(s);
}

function cleanTeam(s) {
  return normText(s).replace(/^・+/, '').trim();
}

function teamWithRole(s, role) {
  const m = String(s || '').match(new RegExp(`^(.+?)（${role}）$`));
  return m ? cleanTeam(m[1]) : '';
}

function oddsValueAt(lines, index) {
  for (let j = index + 1; j < Math.min(lines.length, index + 5); j++) {
    const n = Number(lines[j]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function buildOddsMap(lines, homeTeam, awayTeam) {
  const odds = {};
  const home4 = `${homeTeam}4点以上`;
  const away4 = `${awayTeam}4点以上`;
  const scoreMap = {
    '1 - 0': ['home', '1-0'],
    '2 - 0': ['home', '2-0'],
    '2 - 1': ['home', '2-1'],
    '3 - 0': ['home', '3-0'],
    '3 - 1': ['home', '3-1'],
    '3 - 2': ['home', '3-2'],
    '0 - 1': ['away', '0-1'],
    '0 - 2': ['away', '0-2'],
    '1 - 2': ['away', '1-2'],
    '0 - 3': ['away', '0-3'],
    '1 - 3': ['away', '1-3'],
    '2 - 3': ['away', '2-3'],
    '0 - 0': ['draw', '0-0'],
    '1 - 1': ['draw', '1-1'],
    '2 - 2': ['draw', '2-2'],
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const mapped = scoreMap[line];
    if (mapped) {
      const [outcome, score] = mapped;
      odds[`${outcome}:${score}`] = oddsValueAt(lines, i);
      continue;
    }
    if (line.includes(home4)) odds['home:home4+'] = oddsValueAt(lines, i);
    if (line.includes(away4)) odds['away:away4+'] = oddsValueAt(lines, i);
    if (/両チーム3点以上/.test(line)) odds['draw:draw3+'] = oddsValueAt(lines, i);
  }
  return odds;
}

function parseWinnerLines(lines, keys = []) {
  const matches = [];
  let league = '';
  let round = '';
  let currentDate = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isDateLine(line)) {
      const inlineDate = normText(line.replace(/^試合開催日/, ''));
      currentDate = inlineDate || normText(lines[i + 1] || '');
      if (!inlineDate && currentDate) i += 1;
      continue;
    }
    if (isLeagueLine(line)) {
      league = line;
      continue;
    }
    if (isRoundLine(line)) {
      round = line;
      continue;
    }
    if (!isMatchStatusLine(line)) continue;

    let homeTeam = '';
    for (let j = i - 1; j >= Math.max(0, i - 10); j--) {
      homeTeam = teamWithRole(lines[j], 'ホーム');
      if (homeTeam) break;
      if (!/ホーム/.test(lines[j])) continue;
      homeTeam = cleanTeam(lines[j - 1] || '');
      break;
    }

    const dateShort = normText(lines[i + 1] || '');
    const kickOff = normText(lines[i + 2] || '');
    const venue = normText(lines[i + 3] || '');
    const awayTeam = teamWithRole(lines[i + 4], 'アウェイ') || cleanTeam(lines[i + 4] || '');
    const awayRole = normText(lines[i + 5] || '');
    if (
      !homeTeam ||
      !isMonthDayLine(dateShort) ||
      !isKickOffLine(kickOff) ||
      !awayTeam ||
      !(/アウェイ/.test(lines[i + 4]) || /アウェイ/.test(awayRole))
    ) {
      continue;
    }

    const matchDate = currentDate || dateShort;
    const id = shortId([league, round, matchDate, kickOff, venue, homeTeam, awayTeam]);
    const key = keys[matches.length] || {};
    matches.push({
      id,
      commodityId: key.commodityId || '',
      holdCntId: key.holdCntId || '',
      league,
      round,
      matchDate,
      dateShort,
      kickOff,
      venue,
      homeTeam,
      awayTeam,
      odds: buildOddsMap(lines.slice(i, Math.min(lines.length, i + 90)), homeTeam, awayTeam),
      source: 'toto_winner',
    });
  }

  const seen = new Set();
  return matches.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

export function parseWinnerScheduleHtml(html) {
  const $ = cheerio.load(html);
  const keys = extractWinnerMatchKeys(html);
  const lines = $('body')
    .text()
    .split(/\n+/)
    .map(normText)
    .filter(Boolean);
  return parseWinnerLines(lines, keys);
}

export async function fetchWinnerMatches({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.matches.length && now - cache.at < CACHE_TTL_MS) {
    return cache.matches;
  }
  let res;
  try {
    res = await axios.get(WINNER_ODDS_URL, {
      responseType: 'text',
      timeout: 15000,
      headers: {
        'user-agent': 'Boting/1.1 (+https://github.com/) Discord bot personal use',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
  } catch {
    res = await axios.get(WINNER_SCHEDULE_URL, {
      responseType: 'text',
      timeout: 15000,
      headers: {
        'user-agent': 'Boting/1.1 (+https://github.com/) Discord bot personal use',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
  }
  const matches = parseWinnerScheduleHtml(res.data);
  cache = { at: now, matches };
  return matches;
}

export async function fetchWinnerMatchesFromSchedulePage() {
  const res = await axios.get(WINNER_SCHEDULE_URL, {
    responseType: 'text',
    timeout: 15000,
    headers: {
      'user-agent': 'Boting/1.1 (+https://github.com/) Discord bot personal use',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  return parseWinnerScheduleHtml(res.data);
}

export async function findWinnerMatch(matchId) {
  const id = String(matchId || '');
  const matches = await fetchWinnerMatches();
  return matches.find((m) => m.id === id) || null;
}
