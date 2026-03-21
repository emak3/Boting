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
  historyRaceHeadingLine,
  venuePrefixForHistoryBet,
} from './betPurchaseEmbed.mjs';
import { V2_SINGLE_CHUNK, V2_TEXT_TOTAL_MAX } from './raceCardDisplay.mjs';
import { buildRaceHubBackButtonRow } from './raceCommandHub.mjs';

export const RACE_HISTORY_PAGE_PREFIX = 'race_bet_history_pg';

/** 1ページあたりの買い目件数（レース見出しはカウントに含めない） */
export const HISTORY_BETS_PER_PAGE = 10;

const HISTORY_ACCENT = 0x9b59b6;
const HISTORY_BTN_LABEL_MAX = 80;

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
      const title = historyRaceHeadingLine(bet);
      raceHead = `**${title}**`;
    }
    entries.push(formatBetEntryForHistory(bet));
  }
  flushRace();
  return chunks;
}

/**
 * 同日次帯内の開催キー（race_id 先頭10桁）ごとに 1 代表買い目でボタンラベルを作る
 * @param {object[]} bets
 * @returns {{ key: string, label: string }[]}
 */
function meetingFilterOptionsFromBets(bets) {
  const byKey = new Map();
  for (const b of bets) {
    const rid = String(b.raceId || '');
    if (!/^\d{12}$/.test(rid)) continue;
    const key = rid.slice(0, 10);
    if (!byKey.has(key)) byKey.set(key, b);
  }
  const raw = [...byKey.entries()]
    .map(([key, b]) => ({
      key,
      label: venuePrefixForHistoryBet(b) || `開催(${key.slice(-2)})`,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const labelCount = new Map();
  for (const o of raw) {
    labelCount.set(o.label, (labelCount.get(o.label) || 0) + 1);
  }
  return raw.map((o) => {
    let label = o.label;
    if (labelCount.get(o.label) > 1) {
      const suffix = `·${o.key.slice(-2)}`;
      label = `${o.label.slice(0, Math.max(1, HISTORY_BTN_LABEL_MAX - suffix.length))}${suffix}`;
    }
    return { key: o.key, label: label.slice(0, HISTORY_BTN_LABEL_MAX) };
  });
}

/**
 * @param {{ periodKey: string, page: number, totalPages: number, meetingFilter: string, meetings: { key: string, label: string }[] }} opts
 * @returns {import('discord.js').ActionRowBuilder[]}
 */
function historyFilterAndPaginationRows({
  periodKey,
  page,
  totalPages,
  meetingFilter,
  meetings,
}) {
  const rows = [];
  const showNav = totalPages > 1;
  const showMeetings = meetings.length >= 2;
  if (!showNav && !showMeetings) return rows;

  const navId = (pg) =>
    `${RACE_HISTORY_PAGE_PREFIX}|${periodKey}|${pg}|${meetingFilter}`;
  const venueId = (key) =>
    `${RACE_HISTORY_PAGE_PREFIX}|${periodKey}|0|${key}`;

  const navBtns = showNav
    ? [
        new ButtonBuilder()
          .setCustomId(navId(Math.max(0, page - 1)))
          .setLabel('前へ')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page <= 0),
        new ButtonBuilder()
          .setCustomId(navId(Math.min(totalPages - 1, page + 1)))
          .setLabel('次へ')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page >= totalPages - 1),
      ]
    : [];

  const allBtn =
    showMeetings && meetingFilter !== 'all'
      ? new ButtonBuilder()
          .setCustomId(`${RACE_HISTORY_PAGE_PREFIX}|${periodKey}|0|all`)
          .setLabel('すべて')
          .setStyle(ButtonStyle.Primary)
      : null;

  const venueBtn = (m) =>
    new ButtonBuilder()
      .setCustomId(venueId(m.key))
      .setLabel(m.label)
      .setStyle(meetingFilter === m.key ? ButtonStyle.Success : ButtonStyle.Secondary);

  if (showMeetings) {
    const head = [...navBtns];
    if (allBtn) head.push(allBtn);
    const room = Math.max(0, 5 - head.length);
    const firstVenues = meetings.slice(0, room);
    const rest = meetings.slice(room);
    const firstRow = [...head, ...firstVenues.map(venueBtn)];
    if (firstRow.length) rows.push(new ActionRowBuilder().addComponents(...firstRow));
    for (let i = 0; i < rest.length; i += 5) {
      const chunk = rest.slice(i, i + 5).map(venueBtn);
      rows.push(new ActionRowBuilder().addComponents(...chunk));
    }
  } else if (navBtns.length) {
    rows.push(new ActionRowBuilder().addComponents(...navBtns));
  }

  return rows;
}

/**
 * @param {{ userId: string, periodKey?: string, page?: number, meetingFilter?: string, extraFlags?: number }} opts
 */
export async function buildRacePurchaseHistoryV2Payload({
  userId,
  periodKey = getCurrentDailyPeriodKey(),
  page = 0,
  meetingFilter = 'all',
  extraFlags = 0,
}) {
  const [allBets, bpBalance] = await Promise.all([
    fetchUserRaceBetsForDailyPeriod(userId, periodKey),
    getBalance(userId),
  ]);
  const ymd = `${periodKey.slice(0, 4)}-${periodKey.slice(4, 6)}-${periodKey.slice(6, 8)}`;

  const meetings = meetingFilterOptionsFromBets(allBets);
  const meetingKeys = new Set(meetings.map((m) => m.key));
  let filterKey = String(meetingFilter || 'all').trim();
  if (filterKey !== 'all' && !meetingKeys.has(filterKey)) {
    filterKey = 'all';
  }

  const bets =
    filterKey === 'all'
      ? allBets
      : allBets.filter(
          (b) =>
            /^\d{12}$/.test(String(b.raceId || '')) &&
            String(b.raceId).slice(0, 10) === filterKey,
        );

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
  if (filterKey !== 'all') {
    const labelHit = bets.find(
      (b) => String(b.raceId || '').slice(0, 10) === filterKey,
    );
    const vn = labelHit
      ? venuePrefixForHistoryBet(labelHit) || meetings.find((m) => m.key === filterKey)?.label
      : meetings.find((m) => m.key === filterKey)?.label;
    if (vn) {
      summaryLines.push('', `*表示中の開催: **${vn}***`);
    }
  }
  if (totalPages > 1) {
    summaryLines.push(
      '',
      `*ページ **${safePage + 1}** / **${totalPages}**（**${HISTORY_BETS_PER_PAGE}** 件ずつ）*`,
    );
  }

  const container = new ContainerBuilder().setAccentColor(HISTORY_ACCENT);
  appendChunkedText(container, summaryLines.join('\n'));
  container.addSeparatorComponents((s) => s);

  if (!allBets.length) {
    appendChunkedText(container, '*この日次帯での購入はまだありません。*');
  } else if (!bets.length) {
    appendChunkedText(container, '*この開催に該当する購入はありません。*');
  } else {
    const raceChunks = buildHistoryRaceTextChunks(slice);
    for (let i = 0; i < raceChunks.length; i++) {
      if (i > 0) {
        container.addSeparatorComponents((separator) => separator);
      }
      appendChunkedText(container, raceChunks[i]);
    }
  }

  const filterRows = historyFilterAndPaginationRows({
    periodKey,
    page: safePage,
    totalPages,
    meetingFilter: filterKey,
    meetings,
  });
  const hubBack = buildRaceHubBackButtonRow();
  const components = [container, ...filterRows, hubBack];

  const flags = MessageFlags.IsComponentsV2 | extraFlags;
  return {
    content: null,
    embeds: [],
    components,
    flags,
  };
}
