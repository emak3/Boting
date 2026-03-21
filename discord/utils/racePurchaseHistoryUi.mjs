import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
} from 'discord.js';
import { fetchUserRaceBetsForDailyPeriod } from './raceBetRecords.mjs';
import { getBalance, getCurrentDailyPeriodKey } from './userPointsStore.mjs';
import {
  formatSlipPickDisplayLines,
  BET_TYPE_LABEL,
  parseSelectionBetKindLabel,
  slipRaceTitleLine,
} from './betPurchaseEmbed.mjs';
import { V2_SINGLE_CHUNK, V2_TEXT_TOTAL_MAX } from './raceCardDisplay.mjs';
import { buildRaceHubBackButtonRow } from './raceCommandHub.mjs';

export const RACE_HISTORY_PAGE_PREFIX = 'race_bet_history_pg';

/** 1ページあたりの買い目件数（レース見出しはカウントに含めない） */
export const HISTORY_BETS_PER_PAGE = 10;

const HISTORY_ACCENT = 0x9b59b6;

/** 式別のフル表記（例: 馬連（通常）、馬単（1着ながし）） */
function fullKindLabel(bet) {
  const raw = parseSelectionBetKindLabel(bet.selectionLine);
  if (raw) return raw;
  if (bet.betType && BET_TYPE_LABEL[bet.betType]) return BET_TYPE_LABEL[bet.betType];
  return '購入';
}

/** 1着・2着・3着「単軸」ながしだけ 【1着軸】→【軸】（1・2着ながし等はそのまま） */
function shortenAxisTagForHistory(tag, label) {
  if (/(1・2着ながし|1・3着ながし|2・3着ながし)/.test(label)) return tag;
  if (tag === '【1着軸】' && /（1着ながし）/.test(label)) return '【軸】';
  if (tag === '【2着軸】' && /（2着ながし）/.test(label)) return '【軸】';
  if (tag === '【3着軸】' && /（3着ながし）/.test(label)) return '【軸】';
  return tag;
}

/** Firestore の買い目1件を formatSlipPickDisplayLines 用に正規化 */
function betAsSlipItem(bet) {
  return {
    selectionLine: bet.selectionLine,
    betType: bet.betType,
    tickets: Array.isArray(bet.tickets) ? bet.tickets : [],
    horseNumToFrame: bet.horseNumToFrame && typeof bet.horseNumToFrame === 'object'
      ? bet.horseNumToFrame
      : {},
    trifukuFormation:
      bet.trifukuFormation && typeof bet.trifukuFormation === 'object'
        ? bet.trifukuFormation
        : undefined,
  };
}

/**
 * formatSlipPickDisplayLines と同じ絵文字・つなぎで、引用用の本文行だけ返す
 * 例: ['<絵文字>', '【軸】 <絵文字>', '【相手】 <絵文字>, <絵文字>']
 */
function historyPickQuotedParts(bet) {
  const it = betAsSlipItem(bet);
  const label = fullKindLabel(bet);
  const raw = formatSlipPickDisplayLines(it);
  if (!String(raw || '').trim()) return ['（内容なし）'];
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const parts = [];
  for (const line of lines) {
    const rest = line.startsWith(label) ? line.slice(label.length) : line;
    const tm = rest.match(/^([【][^】]+[】])[\uFF1A:]\s*(.+)$/s);
    if (tm) {
      const t = shortenAxisTagForHistory(tm[1], label);
      parts.push(`${t} ${tm[2].trim()}`);
      continue;
    }
    const cm = rest.match(/^[\uFF1A:]\s*(.+)$/s);
    if (cm) {
      parts.push(cm[1].trim());
      continue;
    }
    parts.push(rest.trim());
  }
  return parts.length ? parts : ['（内容なし）'];
}

function refundSuffix(bet) {
  const st = String(bet.status || 'open');
  if (st !== 'settled') return '`未確定`';
  const r = Math.round(Number(bet.refundBp) || 0);
  return r > 0 ? `\`${r}bp\`` : '`0bp`';
}

/**
 * 例:
 * 単勝
 * > <絵文字> `未確定`
 *
 * 馬連（通常）
 * > <絵文字> - <絵文字> `未確定`
 *
 * 馬単（1着ながし）
 * >【軸】 <絵文字>
 * >【相手】 <絵文字>, <絵文字>
 */
function formatBetEntryForHistory(bet) {
  const kind = fullKindLabel(bet);
  const suff = refundSuffix(bet);
  const pickParts = historyPickQuotedParts(bet)
    .map((p) => String(p).trim())
    .filter((p) => p.length > 0);
  const parts = pickParts.length ? pickParts : ['（内容なし）'];
  const last = parts.length - 1;
  const quoted = parts.map((p, i) =>
    i === last ? `> ${p} ${suff}` : `> ${p}`,
  );
  return `${kind}\n${quoted.join('\n')}`;
}

function raceSortKey(raceId) {
  if (!/^\d{12}$/.test(String(raceId))) return 999;
  const n = parseInt(String(raceId).slice(-2), 10);
  return Number.isFinite(n) && n > 0 ? n : 999;
}

function splitForTextDisplays(fullText) {
  const capped = fullText.slice(0, V2_TEXT_TOTAL_MAX);
  if (capped.length <= V2_SINGLE_CHUNK) return [capped];
  const out = [];
  let rest = capped;
  while (rest.length > 0) {
    if (rest.length <= V2_SINGLE_CHUNK) {
      out.push(rest);
      break;
    }
    let cut = rest.lastIndexOf('\n\n', V2_SINGLE_CHUNK);
    if (cut < V2_SINGLE_CHUNK / 2) cut = V2_SINGLE_CHUNK;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  return out;
}

function appendChunkedText(container, text) {
  const chunks = splitForTextDisplays(String(text || '').trimEnd()).filter((c) => String(c).trim());
  for (const ch of chunks) {
    container.addTextDisplayComponents((td) => td.setContent(ch));
  }
}

function flattenBetsByRace(bets) {
  const byRace = new Map();
  for (const b of bets) {
    const rid = String(b.raceId || '');
    if (!byRace.has(rid)) byRace.set(rid, []);
    byRace.get(rid).push(b);
  }
  const sortedRids = [...byRace.keys()].sort(
    (a, b) => raceSortKey(a) - raceSortKey(b) || a.localeCompare(b),
  );
  const flat = [];
  for (const rid of sortedRids) {
    for (const bet of byRace.get(rid)) {
      flat.push({ rid, bet });
    }
  }
  return flat;
}

/** レース単位のテキストチャンク（チャンクの間に Separator を挟む） */
function buildHistoryRaceTextChunks(slice) {
  let currentRid = null;
  const chunks = [];
  let raceHead = null;
  const entries = [];

  function flushRace() {
    if (!raceHead && !entries.length) return;
    if (!entries.length) return;
    const body = entries.join('\n\n');
    chunks.push(`${raceHead}\n${body}`);
    raceHead = null;
    entries.length = 0;
  }

  for (const { rid, bet } of slice) {
    if (rid !== currentRid) {
      flushRace();
      currentRid = rid;
      const title = slipRaceTitleLine({
        raceId: rid,
        raceTitle: bet.raceTitle,
      });
      raceHead = `**${title}**`;
    }
    entries.push(formatBetEntryForHistory(bet));
  }
  flushRace();
  return chunks;
}

function historyPaginationRow(periodKey, page, totalPages) {
  if (totalPages <= 1) return null;
  const safePrev = Math.max(0, page - 1);
  const safeNext = Math.min(totalPages - 1, page + 1);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${RACE_HISTORY_PAGE_PREFIX}|${periodKey}|${safePrev}`)
      .setLabel('前へ')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`${RACE_HISTORY_PAGE_PREFIX}|${periodKey}|${safeNext}`)
      .setLabel('次へ')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  );
}

/**
 * @param {{ userId: string, periodKey?: string, page?: number, extraFlags?: number }} opts
 */
export async function buildRacePurchaseHistoryV2Payload({
  userId,
  periodKey = getCurrentDailyPeriodKey(),
  page = 0,
  extraFlags = 0,
}) {
  const [bets, bpBalance] = await Promise.all([
    fetchUserRaceBetsForDailyPeriod(userId, periodKey),
    getBalance(userId),
  ]);
  const ymd = `${periodKey.slice(0, 4)}-${periodKey.slice(4, 6)}-${periodKey.slice(6, 8)}`;

  let hits = 0;
  let misses = 0;
  let pending = 0;
  let totalInvestBp = 0;
  let totalRefundBp = 0;

  for (const b of bets) {
    totalInvestBp += Math.round(Number(b.costBp) || 0);
    totalRefundBp += Math.round(Number(b.refundBp) || 0);
    const st = String(b.status || 'open');
    if (st === 'open') {
      pending += 1;
    } else {
      const ref = Math.round(Number(b.refundBp) || 0);
      if (ref > 0) hits += 1;
      else misses += 1;
    }
  }

  const returnRatePct =
    totalInvestBp > 0 ? (totalRefundBp / totalInvestBp) * 100 : null;
  const returnRateStr =
    returnRatePct !== null ? `${returnRatePct.toFixed(1)}%` : '—%';

  const flat = flattenBetsByRace(bets);
  const totalBets = flat.length;
  const totalPages = Math.max(1, Math.ceil(totalBets / HISTORY_BETS_PER_PAGE));
  const safePage = Math.min(Math.max(0, Number(page) || 0), totalPages - 1);
  const start = safePage * HISTORY_BETS_PER_PAGE;
  const slice = flat.slice(start, start + HISTORY_BETS_PER_PAGE);

  const summaryLines = [
    '**今日の購入履歴**',
    `対象: **${ymd}** 日次帯（JST 8:00〜翌 8:00）`,
    '',
    `現在のBP残高 **${bpBalance}** bp`,
    '',
    `的中 **${hits}** 件　不的中 **${misses}** 件　未決着 **${pending}** 件`,
    `回収率 **${returnRateStr}**（払い戻し **${totalRefundBp}** bp ÷ 投資 **${totalInvestBp}** bp）`,
  ];
  if (totalPages > 1) {
    summaryLines.push(
      '',
      `*ページ **${safePage + 1}** / **${totalPages}**（**${HISTORY_BETS_PER_PAGE}** 件ずつ）*`,
    );
  }

  const container = new ContainerBuilder().setAccentColor(HISTORY_ACCENT);
  appendChunkedText(container, summaryLines.join('\n'));
  container.addSeparatorComponents((s) => s);

  if (!bets.length) {
    appendChunkedText(container, '*この日次帯での購入はまだありません。*');
  } else {
    const raceChunks = buildHistoryRaceTextChunks(slice);
    for (let i = 0; i < raceChunks.length; i++) {
      if (i > 0) {
        container.addSeparatorComponents((separator) => separator);
      }
      appendChunkedText(container, raceChunks[i]);
    }
  }

  const row = historyPaginationRow(periodKey, safePage, totalPages);
  const hubBack = buildRaceHubBackButtonRow();
  const components = row ? [container, row, hubBack] : [container, hubBack];

  const flags = MessageFlags.IsComponentsV2 | extraFlags;
  return {
    content: null,
    embeds: [],
    components,
    flags,
  };
}
