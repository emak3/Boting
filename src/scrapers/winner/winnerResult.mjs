import axios from 'axios';
import * as cheerio from 'cheerio';

export function winnerResultUrl({ commodityId, holdCntId, sprtDiv = '01' }) {
  const c = encodeURIComponent(String(commodityId || ''));
  const h = encodeURIComponent(String(holdCntId || ''));
  const s = encodeURIComponent(String(sprtDiv || '01'));
  return `https://sp.toto-dream.com/dcs/subos/screen/si43/ssin061/PGSSIN06101Init.form?commodityId=${c}&holdCntId=${h}&sprtDiv=${s}`;
}

function normText(s) {
  return String(s || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\r\n]+/g, ' ')
    .trim();
}

function yenToNumber(s) {
  const n = Number(String(s || '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function parseNumber(s) {
  const n = Number(String(s || '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function resultPickFromScore(home, away) {
  const h = Math.trunc(Number(home));
  const a = Math.trunc(Number(away));
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  if (h > a) {
    if (h >= 4) return { outcome: 'home', scorePick: 'home4+' };
    return { outcome: 'home', scorePick: `${h}-${a}` };
  }
  if (a > h) {
    if (a >= 4) return { outcome: 'away', scorePick: 'away4+' };
    return { outcome: 'away', scorePick: `${h}-${a}` };
  }
  if (h >= 3) return { outcome: 'draw', scorePick: 'draw3+' };
  return { outcome: 'draw', scorePick: `${h}-${a}` };
}

function findScore(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== 'vs') continue;
    const homeScore = parseNumber(lines[i + 2]);
    const sep = lines[i + 3];
    const awayScore = parseNumber(lines[i + 4]);
    if (Number.isFinite(homeScore) && sep === '-' && Number.isFinite(awayScore)) {
      return { homeScore, awayScore };
    }
  }
  return null;
}

function parseWinningMultiplier(lines, winningPick) {
  if (!winningPick) return null;
  const targetScore = String(winningPick.scorePick || '').replace('-', ' - ');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const normal = !winningPick.scorePick.endsWith('+') && line === targetScore;
    const home4 = winningPick.scorePick === 'home4+' && /4得点以上で勝利/.test(line);
    const away4 = winningPick.scorePick === 'away4+' && /4得点以上で勝利/.test(line);
    const draw3 = winningPick.scorePick === 'draw3+' && /両チーム3点以上/.test(line);
    if (!normal && !home4 && !away4 && !draw3) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 10); j++) {
      if (!/^払戻倍率/.test(lines[j])) continue;
      const n = parseNumber(lines[j + 1]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

export function parseWinnerResultHtml(html) {
  const $ = cheerio.load(html);
  const lines = $.root()
    .text()
    .split(/\n+/)
    .map(normText)
    .filter(Boolean);
  const score = findScore(lines);
  if (!score) {
    return { confirmed: false, payoutReady: false };
  }
  const winningPick = resultPickFromScore(score.homeScore, score.awayScore);
  const atariIdx = lines.findIndex((line) => line === '当せん金');
  const payoutYen = atariIdx >= 0 ? yenToNumber(lines[atariIdx + 1]) : null;
  const multiplierFromPrize =
    Number.isFinite(payoutYen) && payoutYen > 0 ? payoutYen / 200 : null;
  const multiplier =
    parseWinningMultiplier(lines, winningPick) ?? multiplierFromPrize ?? null;

  return {
    confirmed: true,
    payoutReady: Number.isFinite(multiplier) && multiplier > 0,
    homeScore: score.homeScore,
    awayScore: score.awayScore,
    winningOutcome: winningPick?.outcome || '',
    winningScorePick: winningPick?.scorePick || '',
    multiplier,
    payoutYen,
  };
}

export async function fetchWinnerResult({ commodityId, holdCntId, sprtDiv = '01' }) {
  if (!commodityId || !holdCntId) {
    return { confirmed: false, payoutReady: false };
  }
  const res = await axios.get(winnerResultUrl({ commodityId, holdCntId, sprtDiv }), {
    responseType: 'text',
    timeout: 15000,
    headers: {
      'user-agent': 'Boting/1.1 (+https://github.com/) Discord bot personal use',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  return parseWinnerResultHtml(res.data);
}
