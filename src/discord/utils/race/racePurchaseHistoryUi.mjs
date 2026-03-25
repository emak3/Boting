import {
  ActionRowBuilder,
  ContainerBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import {
  fetchUserRaceBetsForRaceHoldDateYmd,
  findAdjacentHoldYmdWithBets,
  resolveDefaultRaceHistoryHoldYmd,
} from './raceBetRecords.mjs';
import { runPendingRaceRefundsForUser } from './raceBetRefundSweep.mjs';
import {
  addJstCalendarDays,
  getBalance,
  getJstCalendarYmd,
} from '../user/userPointsStore.mjs';
import {
  formatSlipPickDisplayLines,
  BET_TYPE_LABEL,
  parseSelectionBetKindLabel,
  formatCompactPostTimeForHistory,
  historyRaceHeadingLine,
  venuePrefixForHistoryBet,
} from '../bet/betPurchaseEmbed.mjs';
import {
  DISCORD_SELECT_OPTION_DESCRIPTION_MAX,
  DISCORD_SELECT_OPTION_LABEL_MAX,
} from './raceNumberEmoji.mjs';
import { V2_SINGLE_CHUNK } from './raceCardDisplay.mjs';
import { buildBotingMenuBackRow } from './raceCommandHub.mjs';
import {
  buildBpRankProfileBackButtonRow,
  buildBpRankLbHistoryFooterRow,
} from '../bp/bpRankUiButtons.mjs';
import { botingEmoji, botingEmojiMarkdown } from '../boting/botingEmojis.mjs';
import { formatBpAmount, formatBpWithUnit } from '../bp/bpFormat.mjs';
import { t } from '../../../i18n/index.mjs';
import { buildRaceHistoryResultPickCustomId } from '../../components/racePurchaseHistory/ids.mjs';
import {
  historyDayAndPageNavRow,
  historyMeetingFilterRow,
  historyMeetingSelectMaxVenues,
} from '../../components/racePurchaseHistory/nav.mjs';

export {
  stripRaceHistoryBpCtx,
  RACE_HISTORY_PAGE_PREFIX,
  RACE_HISTORY_DAY_PREFIX,
  RACE_HISTORY_RESULT_PICK_PREFIX,
  RACE_HISTORY_MEETING_PREFIX,
  buildRaceHistoryNavCustomId,
  buildRaceHistoryResultPickCustomId,
} from '../../components/racePurchaseHistory/ids.mjs';

/**
 * 前後日ナビ用フィルタ（findAdjacent と同じ扱い）。無効な customId は all として探索する。
 * @param {string} meetingFilter
 */
function adjacentMeetingFilterForHistory(meetingFilter) {
  const mf = String(meetingFilter || 'all').trim() || 'all';
  if (mf === 'all') return 'all';
  if (!/^\d{10}$/.test(mf)) return 'all';
  return mf;
}

const HISTORY_ACCENT = 0x9b59b6;
/**
 * Components V2: メッセージ内の Text Display 本文の合計が 4000 を超えると API エラーになる。
 * プレースホルダ・ボタンラベル等の余裕を残す。
 */
const HISTORY_V2_DISPLAY_TEXT_MAX = 3780;
/**
 * シミュレーションと実描画の差・絵文字長のブレを吸収して本文パック時に残す余白。
 * 超えた場合は exclusiveEnd を縮める検証ループでさらに抑える。
 */
const HISTORY_V2_BODY_PACK_SLACK = 320;
/** 1ページに並べるレース（race_id）の上限。これでも文字が溢れるときは買い目件数を減らす */
export const HISTORY_PURCHASE_MAX_RACES_PER_PAGE = 7;

/** 式別のフル表記（例: 馬連（通常）、馬単（1着ながし）、末尾に ` マルチ` が付く場合もそのまま） */
function fullKindLabel(bet) {
  const m = String(bet.selectionLine || '').match(/^選択:\s*(.+?)\s*=>\s*/s);
  if (m) return m[1].trim();
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

/** 買い目1件を formatSlipPickDisplayLines 用に正規化 */
function betAsSlipItem(bet) {
  return {
    selectionLine: bet.selectionLine,
    betType: bet.betType,
    jraMulti: bet.jraMulti === true,
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
  /** formatSlipPickDisplayLines 行頭と一致させる（` マルチ` は parse 側で除く） */
  const slipLabel =
    parseSelectionBetKindLabel(bet.selectionLine) ||
    BET_TYPE_LABEL[bet.betType] ||
    '';
  const labelForAxisShorten = fullKindLabel(bet);
  const raw = formatSlipPickDisplayLines(it);
  if (!String(raw || '').trim()) return ['（内容なし）'];
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const parts = [];
  for (const line of lines) {
    const rest =
      slipLabel && line.startsWith(slipLabel) ? line.slice(slipLabel.length) : line;
    const tm = rest.match(/^([【][^】]+[】])[\uFF1A:]\s*(.+)$/s);
    if (tm) {
      const t = shortenAxisTagForHistory(tm[1], labelForAxisShorten);
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
  return r > 0 ? `\`${formatBpWithUnit(r)}\`` : `\`${formatBpWithUnit(0)}\``;
}

/** 精算済みかつ払戻 bp が 1 以上＝的中（購入履歴サマリと同じ） */
function isSettledHitBet(bet) {
  if (String(bet.status || 'open') !== 'settled') return false;
  return Math.round(Number(bet.refundBp) || 0) > 0;
}

/**
 * `1点`100bp` 合計`3点` `300bp`（1点＝1点あたりのbp、合計＝点数と総額）。全券種共通。
 */
function betCostBpLine(bet) {
  const costBp = Math.max(0, Math.round(Number(bet.costBp) || 0));
  const points = Math.max(0, Math.round(Number(bet.points) || 0));
  const unitYen = Math.max(1, Math.round(Number(bet.unitYen) || 100));
  if (points <= 0) {
    return `合計\`${formatBpWithUnit(costBp)}\``;
  }
  return `1点\`${formatBpWithUnit(unitYen)}\` 合計${formatBpAmount(points)}点 \`${formatBpWithUnit(costBp)}\``;
}

/**
 * 例:
 * 単勝 1点`100bp` 合計`1点` `100bp`
 * > <絵文字> `未確定`
 *
 * ワイド（ボックス）1点`500bp` 合計`3点` `1500bp`
 * > <絵文字> - <絵文字> `未確定`
 *
 * 馬単（1着ながし）
 * >【軸】 <絵文字>
 * >【相手】 <絵文字>, <絵文字>
 */
function formatBetEntryForHistory(bet) {
  const kind = fullKindLabel(bet);
  const hitMark = isSettledHitBet(bet) ? `${botingEmojiMarkdown('maru')} ` : '';
  const costPart = betCostBpLine(bet);
  const suff = refundSuffix(bet);
  const pickParts = historyPickQuotedParts(bet)
    .map((p) => String(p).trim())
    .filter((p) => p.length > 0);
  const parts = pickParts.length ? pickParts : ['（内容なし）'];
  const last = parts.length - 1;
  const quoted = parts.map((p, i) =>
    i === last ? `> ${p} ${suff}` : `> ${p}`,
  );
  return `${hitMark}${kind}${costPart}\n${quoted.join('\n')}`;
}

function betPurchasedAtMs(bet) {
  const v = bet?.purchasedAt;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.getTime();
  if (v && typeof v.toDate === 'function') {
    const d = v.toDate();
    if (d instanceof Date && !Number.isNaN(d.getTime())) return d.getTime();
  }
  return 0;
}

/** 1 つの Text Display に収めやすい長さに分割（本文合計上限とは別） */
function splitLongTextForDisplays(fullText) {
  const s = String(fullText || '').trimEnd();
  if (!s) return [];
  if (s.length <= V2_SINGLE_CHUNK) return [s];
  const out = [];
  let rest = s;
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

const HISTORY_TRUNCATION_TAIL = '\n\n*（表示の長さ上限により省略）*';

/**
 * @param {{ remaining: number }} budget
 * @returns {boolean} 文字数上限で途中までしか出せなかった
 */
function appendChunkedTextWithinBudget(container, text, budget) {
  const chunks = splitLongTextForDisplays(String(text || '').trimEnd()).filter((c) => String(c).trim());
  for (const ch of chunks) {
    if (budget.remaining <= 0) return true;
    if (ch.length <= budget.remaining) {
      container.addTextDisplayComponents((td) => td.setContent(ch));
      budget.remaining -= ch.length;
      continue;
    }
    const room = Math.max(0, budget.remaining - HISTORY_TRUNCATION_TAIL.length);
    let body = room > 0 ? ch.slice(0, room).trimEnd() : '';
    const lastPara = body.lastIndexOf('\n\n');
    if (lastPara > room * 0.3) body = body.slice(0, lastPara).trimEnd();
    container.addTextDisplayComponents((td) =>
      td.setContent(body ? body + HISTORY_TRUNCATION_TAIL : HISTORY_TRUNCATION_TAIL.trim()),
    );
    budget.remaining = 0;
    return true;
  }
  return false;
}

/**
 * appendChunkedTextWithinBudget と同じ split 規則で、本文に割り当て可能な残り文字数を求める。
 * @returns {{ remaining: number, truncated: boolean }}
 */
function simulateTextChunksBudget(text, initialRemaining) {
  let remaining = initialRemaining;
  const chunks = splitLongTextForDisplays(String(text || '').trimEnd()).filter((c) =>
    String(c).trim(),
  );
  for (const ch of chunks) {
    if (remaining <= 0) return { remaining: 0, truncated: true };
    if (ch.length <= remaining) {
      remaining -= ch.length;
      continue;
    }
    return { remaining: 0, truncated: true };
  }
  return { remaining, truncated: false };
}

/**
 * @param {string[]} raceChunks buildHistoryRaceTextChunks の戻り値
 */
function simulateRaceChunksWithinBudget(raceChunks, initialRemaining) {
  let remaining = initialRemaining;
  for (const chunk of raceChunks) {
    const r = simulateTextChunksBudget(chunk, remaining);
    if (r.truncated) return { ok: false, remaining: r.remaining };
    remaining = r.remaining;
  }
  return { ok: true, remaining };
}

/**
 * @param {{ rid: string, bet: object }[]} slice
 * @param {Map<string, string>} timeByRaceId
 */
function historyRaceBodyFitsBudget(slice, timeByRaceId, budget, locale) {
  const raceChunks = buildHistoryRaceTextChunks(slice, timeByRaceId, locale);
  return simulateRaceChunksWithinBudget(raceChunks, budget).ok;
}

/**
 * ページネーション行の最長想定（桁数は totalBets に合わせて上振れ）
 * @param {number} totalBets
 */
function worstHistoryPaginationLine(totalBets, locale) {
  const d = String(Math.max(1, totalBets)).length;
  const x = '9'.repeat(d);
  return t('race_purchase_history.pagination_line', { a: x, b: x, c: x }, locale);
}

function formatHistoryPaginationLine(pageIndex0, totalPages, countOnPage, locale) {
  return t(
    'race_purchase_history.pagination_line',
    { a: pageIndex0 + 1, b: totalPages, c: countOnPage },
    locale,
  );
}

/**
 * 先頭から最大 maxRaces 種類の race_id に属する買い目だけを含む排他的 end（9レース目の先頭で切る）
 * @param {{ rid: string, bet: object }[]} flat
 * @param {number} startIdx
 * @param {number} maxRaces
 */
function maxExclusiveEndForRaceLimit(flat, startIdx, maxRaces) {
  const seen = new Set();
  let i = startIdx;
  const n = flat.length;
  while (i < n) {
    const rid = String(flat[i].rid || '');
    if (!seen.has(rid)) {
      if (seen.size >= maxRaces) break;
      seen.add(rid);
    }
    i += 1;
  }
  return i;
}

/**
 * 二分探索後、本文が budget に収まるまで end を詰める（API 4000 字超えの最終防波堤）
 * @param {{ rid: string, bet: object }[]} flat
 * @param {number} startIdx
 * @param {number} endExclusive
 * @param {number} bodyBudget
 */
function shrinkHistoryPageEndUntilFits(flat, startIdx, endExclusive, bodyBudget, locale) {
  let end = endExclusive;
  while (end > startIdx + 1) {
    const slice = flat.slice(startIdx, end);
    const tm = oddsOfficialTimeMapFromSlice(slice);
    if (historyRaceBodyFitsBudget(slice, tm, bodyBudget, locale)) return end;
    end -= 1;
  }
  return startIdx + 1;
}

/**
 * @param {{ rid: string, bet: object }[]} flat
 * @param {number} startIdx
 * @param {number} verifyBudget サマリー後に本文へ使える残り（最悪長のページ行を含む想定）。収まり検証に使う
 * @returns {number} 排他的 end（flat.slice(startIdx, end) が 1 ページ分）
 */
function exclusiveEndForHistoryPage(flat, startIdx, verifyBudget, locale) {
  const n = flat.length;
  if (startIdx >= n) return startIdx;
  const packBudget = Math.max(0, verifyBudget - HISTORY_V2_BODY_PACK_SLACK);
  const raceCapEnd = maxExclusiveEndForRaceLimit(
    flat,
    startIdx,
    HISTORY_PURCHASE_MAX_RACES_PER_PAGE,
  );
  const hiBound = Math.min(n, raceCapEnd);
  const one = flat.slice(startIdx, startIdx + 1);
  const tm1 = oddsOfficialTimeMapFromSlice(one);
  if (!historyRaceBodyFitsBudget(one, tm1, packBudget, locale)) {
    return shrinkHistoryPageEndUntilFits(flat, startIdx, startIdx + 1, verifyBudget, locale);
  }
  let lo = startIdx + 1;
  let hi = hiBound;
  if (hi <= startIdx) return startIdx + 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const slice = flat.slice(startIdx, mid);
    const tm = oddsOfficialTimeMapFromSlice(slice);
    if (historyRaceBodyFitsBudget(slice, tm, packBudget, locale)) lo = mid;
    else hi = mid - 1;
  }
  return shrinkHistoryPageEndUntilFits(flat, startIdx, lo, verifyBudget, locale);
}

/**
 * @param {{ rid: string, bet: object }[]} flat
 * @param {number} bodyBudget
 * @returns {number[]} 各ページの排他的 end インデックス（連続区間で flat を覆う）
 */
function computeHistoryPageExclusiveEnds(flat, summaryRemainingAfterChunks, locale) {
  const ends = [];
  let i = 0;
  while (i < flat.length) {
    const end = exclusiveEndForHistoryPage(flat, i, summaryRemainingAfterChunks, locale);
    ends.push(end);
    i = end;
  }
  return ends;
}

/**
 * サマリー（ページ行除く）＋ V2 上限から買い目本文に使えるバジェットを決め、ページ区切りを付ける。
 * 複数ページになる場合は最長のページ行をサマリーに仮置きしてバジェットを確保し、区切りが安定するまで反復する。
 *
 * @param {{ rid: string, bet: object }[]} flat
 * @param {string[]} summaryLinesWithoutPagination title〜注記まで（ページ行は含めない）
 * @param {string | null} [locale]
 * @returns {{ exclusiveEnds: number[], showPaginationLine: boolean }}
 */
function computeHistoryPagePlan(flat, summaryLinesWithoutPagination, locale) {
  if (!flat.length) {
    return { exclusiveEnds: [0], showPaginationLine: false };
  }
  const summaryText = summaryLinesWithoutPagination.join('\n');
  let usePagLine = false;
  let prevSig = '';
  for (let iter = 0; iter < 24; iter += 1) {
    const fullSummary =
      summaryText + (usePagLine ? `\n\n${worstHistoryPaginationLine(flat.length, locale)}` : '');
    const sim = simulateTextChunksBudget(fullSummary, HISTORY_V2_DISPLAY_TEXT_MAX);
    const ends = computeHistoryPageExclusiveEnds(flat, sim.remaining, locale);
    if (ends.length <= 1) {
      return { exclusiveEnds: [flat.length], showPaginationLine: false };
    }
    const sig = ends.join(',');
    if (!usePagLine) {
      usePagLine = true;
      prevSig = sig;
      continue;
    }
    if (sig === prevSig) {
      return { exclusiveEnds: ends, showPaginationLine: true };
    }
    prevSig = sig;
  }
  const sim = simulateTextChunksBudget(
    summaryText + `\n\n${worstHistoryPaginationLine(flat.length, locale)}`,
    HISTORY_V2_DISPLAY_TEXT_MAX,
  );
  return {
    exclusiveEnds: computeHistoryPageExclusiveEnds(flat, sim.remaining, locale),
    showPaginationLine: true,
  };
}

/**
 * 購入が新しい順（レース単位でまとめる）。
 * 各レースブロックの並びは「そのレースで最も遅い purchasedAt」が新しいほど上。
 * 同一レース内は purchasedAt 降順（新しい買い目が上）。
 */
function flattenBetsByRace(bets) {
  const byRace = new Map();
  for (const b of bets) {
    const rid = String(b.raceId || '');
    if (!byRace.has(rid)) byRace.set(rid, []);
    byRace.get(rid).push(b);
  }
  for (const arr of byRace.values()) {
    arr.sort((a, b) => betPurchasedAtMs(b) - betPurchasedAtMs(a));
  }
  const sortedRids = [...byRace.keys()].sort((ra, rb) => {
    const maxA = Math.max(...byRace.get(ra).map(betPurchasedAtMs));
    const maxB = Math.max(...byRace.get(rb).map(betPurchasedAtMs));
    if (maxB !== maxA) return maxB - maxA;
    return rb.localeCompare(ra);
  });
  const flat = [];
  for (const rid of sortedRids) {
    for (const bet of byRace.get(rid)) {
      flat.push({ rid, bet });
    }
  }
  return flat;
}

/**
 * @param {object} bet
 * @param {Map<string, string>} timeByRaceId
 * @returns {string} 空なら時刻なし
 */
function historyPostTimeCompactHm(bet, timeByRaceId) {
  const rid = String(bet.raceId || '');
  const raw =
    (bet.oddsOfficialTime && String(bet.oddsOfficialTime).trim()) ||
    (rid && timeByRaceId?.get(rid)) ||
    '';
  return formatCompactPostTimeForHistory(raw);
}

/**
 * ページ内レースの時刻表示用（DB の oddsOfficialTime のみ。netkeiba は叩かない＝履歴表示を速く保つ）
 * @param {{ rid: string, bet: object }[]} slice
 */
function oddsOfficialTimeMapFromSlice(slice) {
  const map = new Map();
  for (const { rid, bet } of slice) {
    const r = String(rid || '');
    if (!/^\d{12}$/.test(r) || map.has(r)) continue;
    const dbT = bet.oddsOfficialTime && String(bet.oddsOfficialTime).trim();
    if (dbT) map.set(r, dbT);
  }
  return map;
}

/** 表示順で初出の race_id のみ（セレクト並び用） */
function orderedUniqueRidsFromSlice(slice) {
  const out = [];
  const seen = new Set();
  for (const { rid } of slice) {
    const r = String(rid || '');
    if (!/^\d{12}$/.test(r) || seen.has(r)) continue;
    seen.add(r);
    out.push(r);
  }
  return out;
}

/**
 * @param {{ rid: string, bet: object }[]} slice
 * @param {Map<string, string>} timeByRaceId
 */
function buildHistoryResultPickRow(slice, pickCustomId, timeByRaceId, locale) {
  const rids = orderedUniqueRidsFromSlice(slice);
  if (!rids.length) return null;

  const postLbl = t('race_purchase_history.post_time_label', null, locale);
  const opts = [];
  for (const rid of rids) {
    const row = slice.find((s) => s.rid === rid);
    if (!row) continue;
    const { bet } = row;
    const label = historyRaceHeadingLine(bet).slice(0, DISCORD_SELECT_OPTION_LABEL_MAX);
    const settled = String(bet.status || 'open') === 'settled';
    const hm = historyPostTimeCompactHm(bet, timeByRaceId);
    const desc = hm
      ? `${hm}${postLbl}`.slice(0, DISCORD_SELECT_OPTION_DESCRIPTION_MAX)
      : null;
    const b = new StringSelectMenuOptionBuilder()
      .setLabel(label || rid)
      .setValue(`${rid}|${settled ? 1 : 0}`);
    if (settled) b.setEmoji(botingEmoji('kakutei'));
    if (desc) b.setDescription(desc);
    opts.push(b);
  }
  if (!opts.length) return null;

  const menu = new StringSelectMenuBuilder()
    .setCustomId(pickCustomId)
    .setPlaceholder(t('race_purchase_history.select.result_placeholder', null, locale))
    .addOptions(opts);
  return new ActionRowBuilder().addComponents(menu);
}

/** レース単位のテキストチャンク（チャンクの間に Separator を挟む） */
function buildHistoryRaceTextChunks(slice, timeByRaceId, locale) {
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
      const base = historyRaceHeadingLine(bet);
      const settled = String(bet.status || 'open') === 'settled';
      const hm = historyPostTimeCompactHm(bet, timeByRaceId);
      const postSuffix = t('race_purchase_history.post_time_label', null, locale);
      raceHead = settled
        ? `${botingEmojiMarkdown('kaku')}${botingEmojiMarkdown('tei')} **${base}**`
        : hm
          ? `**${base}**  \`${hm}${postSuffix}\``
          : `**${base}**`;
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
      label = `${o.label.slice(0, Math.max(1, DISCORD_SELECT_OPTION_LABEL_MAX - suffix.length))}${suffix}`;
    }
    return { key: o.key, label: label.slice(0, DISCORD_SELECT_OPTION_LABEL_MAX) };
  });
}

/**
 * 開催日キーに応じた見出し（今日 / 明日 / 日付）
 * @param {string} holdYmd YYYYMMDD
 * @param {string | null} [locale]
 */
function historyTitleLineForHoldYmd(holdYmd, locale) {
  const now = new Date();
  const todayYmd = getJstCalendarYmd(now);
  const tomorrowYmd = addJstCalendarDays(todayYmd, 1);
  const yesterdayYmd = addJstCalendarDays(todayYmd, -1);
  if (holdYmd === todayYmd) {
    return t('race_purchase_history.title.today', null, locale);
  }
  if (holdYmd === tomorrowYmd) {
    return t('race_purchase_history.title.tomorrow', null, locale);
  }
  if (holdYmd === yesterdayYmd) {
    return t('race_purchase_history.title.yesterday', null, locale);
  }
  const y = holdYmd.slice(0, 4);
  const mo = holdYmd.slice(4, 6);
  const da = holdYmd.slice(6, 8);
  return t('race_purchase_history.title.date', { y, m: mo, d: da }, locale);
}

/**
 * @param {{ userId: string, periodKey?: string, page?: number, meetingFilter?: string, extraFlags?: number, bpRankProfileUserId?: string | null, rankLeaderboardReturn?: { limit: number, mode: string } | null, locale?: string | null }} opts
 * periodKey … レース開催日 YYYYMMDD（JST）。省略時は resolveDefaultRaceHistoryHoldYmd。
 * bpRankProfileUserId … 設定時はナビ customId に bpctx が付く。
 * rankLeaderboardReturn … 設定時は戻るがランキング向け（`/boting` のランキングから開いた場合）。
 * locale … `ja` / `en`。未指定は `getDefaultLocale()`（`BOT_LOCALE` または ja）。
 */
export async function buildRacePurchaseHistoryV2Payload({
  userId,
  periodKey: periodKeyOpt,
  page = 0,
  meetingFilter = 'all',
  extraFlags = 0,
  bpRankProfileUserId = null,
  rankLeaderboardReturn = null,
  locale = null,
}) {
  try {
    await runPendingRaceRefundsForUser(userId);
  } catch (e) {
    console.warn('runPendingRaceRefundsForUser', e);
  }

  let periodKey =
    periodKeyOpt != null && /^\d{8}$/.test(String(periodKeyOpt).trim())
      ? String(periodKeyOpt).trim()
      : await resolveDefaultRaceHistoryHoldYmd(userId);

  const adjacentMf = adjacentMeetingFilterForHistory(meetingFilter);
  const [allBets, bpBalance, prevNavYmdRaw, nextNavYmdRaw] = await Promise.all([
    fetchUserRaceBetsForRaceHoldDateYmd(userId, periodKey),
    getBalance(userId),
    findAdjacentHoldYmdWithBets(userId, periodKey, -1, adjacentMf),
    findAdjacentHoldYmdWithBets(userId, periodKey, 1, adjacentMf),
  ]);
  const ymd = `${periodKey.slice(0, 4)}-${periodKey.slice(4, 6)}-${periodKey.slice(6, 8)}`;

  const meetings = meetingFilterOptionsFromBets(allBets);
  const meetingKeys = new Set(meetings.map((m) => m.key));
  let filterKey = String(meetingFilter || 'all').trim();
  if (filterKey !== 'all' && !meetingKeys.has(filterKey)) {
    filterKey = 'all';
  }

  let prevNavYmd = prevNavYmdRaw;
  let nextNavYmd = nextNavYmdRaw;
  if (filterKey !== adjacentMf) {
    [prevNavYmd, nextNavYmd] = await Promise.all([
      findAdjacentHoldYmdWithBets(userId, periodKey, -1, filterKey),
      findAdjacentHoldYmdWithBets(userId, periodKey, 1, filterKey),
    ]);
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

  const summaryLinesWithoutPagination = [
    historyTitleLineForHoldYmd(periodKey, locale),
    t('race_purchase_history.summary.target_line', { ymd }, locale),
    '',
    t('race_purchase_history.summary.bp_balance', { amount: formatBpAmount(bpBalance) }, locale),
    '',
    t('race_purchase_history.summary.hit_counts', { hits, misses, pending }, locale),
    t('race_purchase_history.summary.return_rate', {
      rate: returnRateStr,
      refund: formatBpAmount(totalRefundBp),
      invest: formatBpAmount(totalInvestBp),
    }, locale),
  ];
  if (filterKey !== 'all') {
    const labelHit = bets.find(
      (b) => String(b.raceId || '').slice(0, 10) === filterKey,
    );
    const vn = labelHit
      ? venuePrefixForHistoryBet(labelHit) || meetings.find((m) => m.key === filterKey)?.label
      : meetings.find((m) => m.key === filterKey)?.label;
    if (vn) {
      summaryLinesWithoutPagination.push(
        '',
        t('race_purchase_history.summary.filter_venue_note', { name: vn }, locale),
      );
    }
  }
  const meetingSelectCap = historyMeetingSelectMaxVenues();
  if (meetings.length > meetingSelectCap) {
    summaryLinesWithoutPagination.push(
      '',
      t('race_purchase_history.summary.footnote_meeting_cap', { cap: meetingSelectCap }, locale),
    );
  }

  const pagePlan = bets.length
    ? computeHistoryPagePlan(flat, summaryLinesWithoutPagination, locale)
    : { exclusiveEnds: [0], showPaginationLine: false };
  const pageRanges = [];
  let prev = 0;
  for (const end of pagePlan.exclusiveEnds) {
    pageRanges.push({ start: prev, end });
    prev = end;
  }
  const totalPages = Math.max(1, pageRanges.length);
  const safePage = Math.min(Math.max(0, Number(page) || 0), totalPages - 1);
  const pageRange = pageRanges[safePage] || { start: 0, end: 0 };
  const slice = flat.slice(pageRange.start, pageRange.end);

  let timeByRaceId = new Map();
  let resultPickRow = null;
  if (bets.length && slice.length) {
    timeByRaceId = oddsOfficialTimeMapFromSlice(slice);
    const pickCustomId = buildRaceHistoryResultPickCustomId({
      periodKey,
      page: safePage,
      meetingFilter: filterKey,
      bpRankProfileUserId,
      rankLeaderboardReturn,
    });
    resultPickRow = buildHistoryResultPickRow(slice, pickCustomId, timeByRaceId, locale);
  }

  const summaryLines = [...summaryLinesWithoutPagination];
  if (pagePlan.showPaginationLine && totalPages > 1) {
    summaryLines.push('', formatHistoryPaginationLine(safePage, totalPages, slice.length, locale));
  }

  const container = new ContainerBuilder().setAccentColor(HISTORY_ACCENT);
  const textBudget = { remaining: HISTORY_V2_DISPLAY_TEXT_MAX };
  appendChunkedTextWithinBudget(container, summaryLines.join('\n'), textBudget);
  container.addSeparatorComponents((s) => s);

  if (!allBets.length) {
    appendChunkedTextWithinBudget(
      container,
      t('race_purchase_history.empty.no_bets_on_day', null, locale),
      textBudget,
    );
  } else if (!bets.length) {
    appendChunkedTextWithinBudget(
      container,
      t('race_purchase_history.empty.no_bets_for_filter', null, locale),
      textBudget,
    );
  } else {
    const raceChunks = buildHistoryRaceTextChunks(slice, timeByRaceId, locale);
    for (let i = 0; i < raceChunks.length; i++) {
      if (textBudget.remaining <= 0) break;
      if (i > 0) {
        container.addSeparatorComponents((separator) => separator);
      }
      appendChunkedTextWithinBudget(container, raceChunks[i], textBudget);
    }
  }

  const dayRow = historyDayAndPageNavRow(
    periodKey,
    filterKey,
    prevNavYmd,
    nextNavYmd,
    safePage,
    totalPages,
    bpRankProfileUserId,
    rankLeaderboardReturn,
    locale,
  );
  const meetingRow = historyMeetingFilterRow({
    periodKey,
    meetingFilter: filterKey,
    meetings,
    bpRankProfileUserId,
    rankLeaderboardReturn,
    locale,
  });
  let hubBack;
  if (rankLeaderboardReturn?.limit != null && rankLeaderboardReturn.mode) {
    hubBack = buildBpRankLbHistoryFooterRow(
      rankLeaderboardReturn.limit,
      rankLeaderboardReturn.mode,
      userId,
      locale,
    );
  } else if (bpRankProfileUserId) {
    hubBack = buildBpRankProfileBackButtonRow(bpRankProfileUserId, locale);
  } else {
    hubBack = buildBotingMenuBackRow({ locale });
  }
  const components = [
    container,
    ...(resultPickRow ? [resultPickRow] : []),
    ...(meetingRow ? [meetingRow] : []),
    dayRow,
    hubBack,
  ];

  const flags = MessageFlags.IsComponentsV2 | extraFlags;
  return {
    content: null,
    embeds: [],
    components,
    flags,
  };
}
