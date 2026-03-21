import { netkeibaResultUrl, netkeibaOriginFromFlow } from './netkeibaUrls.mjs';
import {
  formatHorseNumsCommaEmoji,
  formatNumsWithWakuUmaEmoji,
  formatWakurenNumsCommaEmoji,
  formatWakurenNumsWithEmoji,
} from './raceNumberEmoji.mjs';

const BET_TYPE_LABEL = {
  win: '単勝',
  place: '複勝',
  win_place: '単勝+複勝',
  frame_pair: '枠連',
  horse_pair: '馬連',
  wide: 'ワイド',
  umatan: '馬単',
  trifuku: '3連複',
  tritan: '3連単',
};

/** Components V2 用（Text Display 1 ブロック） */
export function buildBetPurchaseV2Headline({ flow }) {
  const unitYen = flow?.unitYen ?? 100;
  const points = flow?.purchase?.points ?? 0;
  const selectionLine = flow?.purchase?.selectionLine ?? '（選択なし）';
  const totalYen = points * unitYen;

  const raceTitle = flow?.result?.raceInfo?.title || 'レース';
  const oddsTime = flow?.result?.oddsOfficialTime;
  const raceId = flow?.result?.raceId;
  const isResult = !!flow?.result?.isResult;
  const origin = netkeibaOriginFromFlow(flow);
  const resultUrl = raceId ? netkeibaResultUrl(raceId, origin) : null;

  return [
    '**購入内容（確認）**',
    '',
    `レース: ${raceTitle}`,
    oddsTime ? `オッズ時刻: ${oddsTime}` : null,
    isResult && resultUrl ? `結果: ${resultUrl}` : null,
    '',
    selectionLine,
    `点数: ${points}点`,
    `1点あたり: ${unitYen} bp`,
    `合計消費: ${totalYen} bp（${unitYen} bp/点）`,
    '',
    '*まとめて確定時に上記の bp が差し引かれます*',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 複数買い目をまとめた確認文（Components V2 用）
 * @param {{ items: Array<{ raceId: string, unitYen: number, points: number, selectionLine: string, raceTitle?: string, oddsOfficialTime?: string, isResult?: boolean, netkeibaOrigin?: string }> }} opts
 */
export function buildBetSlipBatchV2Headline({ items }) {
  const lines = ['**まとめて購入内容（仮）**', ''];
  let grandPoints = 0;
  let grandYen = 0;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const unitYen = it.unitYen ?? 100;
    const points = it.points ?? 0;
    const selectionLine = it.selectionLine ?? '（選択なし）';
    const raceTitle = it.raceTitle || 'レース';
    const raceId = it.raceId;
    const origin = it.netkeibaOrigin === 'nar' ? 'nar' : 'jra';
    const resultUrl =
      raceId && it.isResult ? netkeibaResultUrl(raceId, origin) : null;
    const subtotal = points * unitYen;
    grandPoints += points;
    grandYen += subtotal;

    lines.push(`**${i + 1}.** ${raceTitle}`);
    if (it.oddsOfficialTime) lines.push(`オッズ時刻: ${it.oddsOfficialTime}`);
    if (resultUrl) lines.push(`結果: ${resultUrl}`);
    lines.push(selectionLine);
    lines.push(`点数: ${points}点 | 1点: ${unitYen} bp | 小計: ${subtotal} bp`);
    lines.push('');
  }

  lines.push(
    `—`,
    `**合計** 点数: ${grandPoints}点 | 合計消費: ${grandYen} bp`,
    '',
    '*「この内容で確定」で上記の bp が一括で差し引かれます*',
  );

  return lines.join('\n');
}

/** `選択: 3連単（通常） => …` から式別ラベル部分だけ取り出す */
export function parseSelectionBetKindLabel(selectionLine) {
  const m = String(selectionLine || '').match(/^選択:\s*(.+?)\s*=>\s*/);
  return m ? m[1].trim() : null;
}

/** 見出し用（例: `11R 3歳未勝利`）。タイトル先頭に R が無ければ raceId 下2桁で補う */
export function slipRaceTitleLine(it) {
  const title = (it.raceTitle || 'レース').replace(/\s+/g, ' ').trim();
  if (/^\d+\s*R\b/i.test(title) || /^第\d+レース/i.test(title)) {
    return title;
  }
  const rid = String(it.raceId || '');
  if (/^\d{12}$/.test(rid)) {
    const n = parseInt(rid.slice(-2), 10);
    if (Number.isFinite(n) && n > 0) {
      return `${n}R ${title}`;
    }
  }
  return title;
}

function isWakurenSlip(it) {
  return (
    it.betType === 'frame_pair' ||
    (parseSelectionBetKindLabel(it.selectionLine) || '').startsWith('枠連')
  );
}

function horseMap(it) {
  return new Map(Object.entries(it.horseNumToFrame || {}));
}

function fmtC(it, nums) {
  if (!nums?.length) return '—';
  return isWakurenSlip(it)
    ? formatWakurenNumsCommaEmoji(nums)
    : formatHorseNumsCommaEmoji(nums, it.horseNumToFrame || {});
}

function fmtGT(it, nums) {
  if (!nums?.length) return '—';
  return isWakurenSlip(it)
    ? formatWakurenNumsWithEmoji(nums, '>')
    : formatNumsWithWakuUmaEmoji(nums, '>', horseMap(it));
}

function fmtDash(it, nums) {
  if (!nums?.length) return '—';
  return isWakurenSlip(it)
    ? formatWakurenNumsWithEmoji(nums, '-')
    : formatNumsWithWakuUmaEmoji(nums, '-', horseMap(it));
}

function parseSelectionDetail(selectionLine) {
  return String(selectionLine || '')
    .replace(/^選択:\s*.+?\s*=>\s*/s, '')
    .trim();
}

function extractBanNumsFromText(text) {
  return [...String(text || '').matchAll(/(\d+)番/g)].map((m) => m[1]);
}

/** emoji.txt の <:g3_n6:id> 形式から馬番を取る（g=枠, n=馬） */
function extractHorseNumsFromSlipEmojiSegment(text) {
  const out = [];
  const re = /<a?:([^:>]+):(\d+)>/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const name = m[1];
    const gn = name.match(/^g(\d+)_n(\d+)$/i);
    if (gn) {
      out.push(gn[2]);
      continue;
    }
    const wu = name.match(/^w(\d+)u(\d+)$/i);
    if (wu) out.push(wu[2]);
  }
  return out;
}

function extractHorseNumsFromSlipDetailSegment(text) {
  const fromEmoji = extractHorseNumsFromSlipEmojiSegment(text);
  const fromBan = extractBanNumsFromText(text);
  const seen = new Set(fromEmoji);
  for (const b of fromBan) {
    if (!seen.has(b)) {
      fromEmoji.push(b);
      seen.add(b);
    }
  }
  return fromEmoji;
}

/** `A: … / B: … / C: …` を分割（`N番` 無し・絵文字のみでも可） */
function parseTrifukuFormationGroupsFromDetail(detail) {
  const segs = String(detail || '')
    .split(/\s*\/\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  let a = [];
  let b = [];
  let c = [];
  for (const seg of segs) {
    if (/^A:\s*/i.test(seg)) {
      a = extractHorseNumsFromSlipDetailSegment(seg.replace(/^A:\s*/i, ''));
    } else if (/^B:\s*/i.test(seg)) {
      b = extractHorseNumsFromSlipDetailSegment(seg.replace(/^B:\s*/i, ''));
    } else if (/^C:\s*/i.test(seg)) {
      c = extractHorseNumsFromSlipDetailSegment(seg.replace(/^C:\s*/i, ''));
    }
  }
  if (a.length && b.length && c.length) return { a, b, c };
  return null;
}

function uniqueSortedNumsFromTickets(tickets) {
  const s = new Set();
  for (const t of tickets || []) {
    for (const n of t.nums || []) s.add(String(n));
  }
  return [...s].sort((a, b) => Number(a) - Number(b));
}

function pairKindsForSlip(it) {
  return isWakurenSlip(it) ? ['Wakuren'] : ['Umaren', 'Wide'];
}

function isPairBet(bt) {
  return bt === 'horse_pair' || bt === 'wide' || bt === 'frame_pair';
}

/** @returns {{ axis: string, opps: string[] } | null} */
function pairNagashiAxisAndOpps(tickets, it) {
  const kinds = pairKindsForSlip(it);
  const pts = (tickets || []).filter((t) => kinds.includes(t.kind));
  if (!pts.length) return null;
  const nT = pts.length;
  const freq = new Map();
  for (const t of pts) {
    for (const x of t.nums) {
      const k = String(x);
      freq.set(k, (freq.get(k) || 0) + 1);
    }
  }
  const axisCandidates = [...freq.entries()].filter(([, c]) => c === nT).map(([k]) => k);
  if (axisCandidates.length !== 1) return null;
  const axis = axisCandidates[0];
  const opps = new Set();
  for (const t of pts) {
    for (const x of t.nums) {
      if (String(x) !== axis) opps.add(String(x));
    }
  }
  return { axis, opps: [...opps].sort((a, b) => Number(a) - Number(b)) };
}

function umatanNagashi1Tickets(tickets) {
  const ut = (tickets || []).filter((t) => t.kind === 'Umatan');
  if (!ut.length) return null;
  const firsts = new Set(ut.map((t) => String(t.nums[0])));
  if (firsts.size !== 1) return null;
  const axis = [...firsts][0];
  const opps = [...new Set(ut.map((t) => String(t.nums[1])))].sort(
    (a, b) => Number(a) - Number(b),
  );
  return { axis, opps };
}

function umatanNagashi2Tickets(tickets) {
  const ut = (tickets || []).filter((t) => t.kind === 'Umatan');
  if (!ut.length) return null;
  const seconds = new Set(ut.map((t) => String(t.nums[1])));
  if (seconds.size !== 1) return null;
  const axis = [...seconds][0];
  const opps = [...new Set(ut.map((t) => String(t.nums[0])))].sort(
    (a, b) => Number(a) - Number(b),
  );
  return { axis, opps };
}

function umatanFormationGroups(tickets) {
  const ut = (tickets || []).filter((t) => t.kind === 'Umatan');
  if (!ut.length) return null;
  const A = [...new Set(ut.map((t) => String(t.nums[0])))].sort(
    (a, b) => Number(a) - Number(b),
  );
  const B = [...new Set(ut.map((t) => String(t.nums[1])))].sort(
    (a, b) => Number(a) - Number(b),
  );
  return { A, B };
}

function fuku3Axis1Tickets(tickets) {
  const ts = (tickets || []).filter((t) => t.kind === 'Fuku3');
  if (!ts.length) return null;
  const nT = ts.length;
  const freq = new Map();
  for (const t of ts) {
    for (const x of t.nums) {
      const k = String(x);
      freq.set(k, (freq.get(k) || 0) + 1);
    }
  }
  const axisCandidates = [...freq.entries()].filter(([, c]) => c === nT).map(([k]) => k);
  if (axisCandidates.length !== 1) return null;
  const axis = axisCandidates[0];
  const opps = new Set();
  for (const t of ts) {
    for (const x of t.nums) {
      if (String(x) !== axis) opps.add(String(x));
    }
  }
  return { axis, opps: [...opps].sort((a, b) => Number(a) - Number(b)) };
}

function fuku3Axis2Tickets(tickets) {
  const ts = (tickets || []).filter((t) => t.kind === 'Fuku3');
  if (!ts.length) return null;
  const nT = ts.length;
  const freq = new Map();
  for (const t of ts) {
    for (const x of t.nums) {
      const k = String(x);
      freq.set(k, (freq.get(k) || 0) + 1);
    }
  }
  const inAll = [...freq.entries()].filter(([, c]) => c === nT).map(([k]) => k);
  if (inAll.length !== 2) return null;
  const opps = [...freq.entries()]
    .filter(([, c]) => c < nT)
    .map(([k]) => k)
    .sort((a, b) => Number(a) - Number(b));
  return { axes: inAll.sort((a, b) => Number(a) - Number(b)), opps };
}

function tan3FormationGroups(tickets) {
  const ts = (tickets || []).filter((t) => t.kind === 'Tan3');
  if (!ts.length) return null;
  const A = [...new Set(ts.map((t) => String(t.nums[0])))].sort(
    (a, b) => Number(a) - Number(b),
  );
  const B = [...new Set(ts.map((t) => String(t.nums[1])))].sort(
    (a, b) => Number(a) - Number(b),
  );
  const C = [...new Set(ts.map((t) => String(t.nums[2])))].sort(
    (a, b) => Number(a) - Number(b),
  );
  return { A, B, C };
}

function tan3Nagashi1chaku(tickets) {
  const ts = (tickets || []).filter((t) => t.kind === 'Tan3');
  if (!ts.length) return null;
  const axis = String(ts[0].nums[0]);
  if (!ts.every((t) => String(t.nums[0]) === axis)) return null;
  const op = new Set();
  for (const t of ts) {
    op.add(String(t.nums[1]));
    op.add(String(t.nums[2]));
  }
  op.delete(axis);
  return { axis, opps: [...op].sort((a, b) => Number(a) - Number(b)) };
}

function tan3Nagashi2chaku(tickets) {
  const ts = (tickets || []).filter((t) => t.kind === 'Tan3');
  if (!ts.length) return null;
  const axis = String(ts[0].nums[1]);
  if (!ts.every((t) => String(t.nums[1]) === axis)) return null;
  const op = new Set();
  for (const t of ts) {
    op.add(String(t.nums[0]));
    op.add(String(t.nums[2]));
  }
  op.delete(axis);
  return { axis, opps: [...op].sort((a, b) => Number(a) - Number(b)) };
}

function tan3Nagashi3chaku(tickets) {
  const ts = (tickets || []).filter((t) => t.kind === 'Tan3');
  if (!ts.length) return null;
  const axis = String(ts[0].nums[2]);
  if (!ts.every((t) => String(t.nums[2]) === axis)) return null;
  const op = new Set();
  for (const t of ts) {
    op.add(String(t.nums[0]));
    op.add(String(t.nums[1]));
  }
  op.delete(axis);
  return { axis, opps: [...op].sort((a, b) => Number(a) - Number(b)) };
}

function tritanN12Tickets(tickets) {
  const ts = (tickets || []).filter((t) => t.kind === 'Tan3');
  if (!ts.length) return null;
  const a1 = String(ts[0].nums[0]);
  const a2 = String(ts[0].nums[1]);
  if (!ts.every((t) => String(t.nums[0]) === a1 && String(t.nums[1]) === a2)) {
    return null;
  }
  const opps = [...new Set(ts.map((t) => String(t.nums[2])))].sort(
    (a, b) => Number(a) - Number(b),
  );
  return { a1, a2, opps };
}

function tritanN13Tickets(tickets) {
  const ts = (tickets || []).filter((t) => t.kind === 'Tan3');
  if (!ts.length) return null;
  const a1 = String(ts[0].nums[0]);
  const a3 = String(ts[0].nums[2]);
  if (!ts.every((t) => String(t.nums[0]) === a1 && String(t.nums[2]) === a3)) {
    return null;
  }
  const opps = [...new Set(ts.map((t) => String(t.nums[1])))].sort(
    (a, b) => Number(a) - Number(b),
  );
  return { a1, a3, opps };
}

function tritanN23Tickets(tickets) {
  const ts = (tickets || []).filter((t) => t.kind === 'Tan3');
  if (!ts.length) return null;
  const a2 = String(ts[0].nums[1]);
  const a3 = String(ts[0].nums[2]);
  if (!ts.every((t) => String(t.nums[1]) === a2 && String(t.nums[2]) === a3)) {
    return null;
  }
  const opps = [...new Set(ts.map((t) => String(t.nums[0])))].sort(
    (a, b) => Number(a) - Number(b),
  );
  return { a2, a3, opps };
}

function fallbackEmojiTicketLines(it, label) {
  const tix = it.tickets || [];
  const maxShow = 15;
  const out = [];
  for (let i = 0; i < Math.min(tix.length, maxShow); i++) {
    const t = tix[i];
    let inner = '';
    if (t.kind === 'Tan3') inner = fmtGT(it, t.nums);
    else if (t.kind === 'Fuku3') inner = fmtDash(it, t.nums);
    else if (t.kind === 'Umatan') inner = fmtGT(it, t.nums);
    else if (t.kind === 'Umaren' || t.kind === 'Wide' || t.kind === 'Wakuren') {
      inner = fmtDash(it, t.nums);
    } else if (t.kind === 'Tansho' || t.kind === 'Fukusho') {
      inner = fmtC(it, t.nums);
    } else inner = (t.nums || []).join('-');
    out.push(`${label}：${inner}`);
  }
  if (tix.length > maxShow) out.push(`*…他 ${tix.length - maxShow} 点*`);
  return out.join('\n');
}

/**
 * まとめて購入確認用：軸・相手・記号・絵文字
 * @param {{ selectionLine?: string, betType?: string, tickets?: Array<{ kind: string, nums: string[] }>, horseNumToFrame?: Record<string, string> }} it
 */
export function formatSlipPickDisplayLines(it) {
  const label =
    parseSelectionBetKindLabel(it.selectionLine) ||
    BET_TYPE_LABEL[it.betType] ||
    '購入予定';
  const tickets = it.tickets || [];
  const detail = parseSelectionDetail(it.selectionLine);
  const bt = it.betType || '';

  if (!tickets.length) return '';

  if (label.includes('単勝+複勝')) {
    const a = tickets[0]?.nums?.[0];
    const b = tickets[1]?.nums?.[0];
    if (a != null && a === b) {
      return `${label}：${fmtC(it, [String(a)])}`;
    }
  }

  if (bt === 'win' || bt === 'place') {
    const n = tickets[0]?.nums?.[0];
    return n != null ? `${label}：${fmtC(it, [String(n)])}` : '';
  }

  if (isPairBet(bt) && label.includes('（ながし）')) {
    const px = pairNagashiAxisAndOpps(tickets, it);
    if (px) {
      return [
        `${label}【軸】：${fmtC(it, [px.axis])}`,
        `${label}【相手】：${fmtC(it, px.opps)}`,
      ].join('\n');
    }
  }

  if (isPairBet(bt) && label.includes('（フォーメーション）')) {
    const m1 = detail.match(/第1群:\s*([^/]+)/);
    const m2 = detail.match(/第2群:\s*(.+)/);
    const g1 = extractBanNumsFromText(m1?.[1] || '');
    const g2 = extractBanNumsFromText(m2?.[1] || '');
    if (g1.length && g2.length) {
      return [
        `${label}【第1群】：${fmtC(it, g1)}`,
        `${label}【第2群】：${fmtC(it, g2)}`,
      ].join('\n');
    }
    return `${label}：${fmtC(it, uniqueSortedNumsFromTickets(tickets))}`;
  }

  if (isPairBet(bt) && label.includes('（ボックス）')) {
    return `${label}：${fmtC(it, uniqueSortedNumsFromTickets(tickets))}`;
  }

  if (isPairBet(bt)) {
    const t0 = tickets[0];
    if (t0?.nums?.length === 2) {
      return `${label}：${fmtDash(it, t0.nums)}`;
    }
  }

  if (bt === 'umatan' && label.includes('（ボックス）')) {
    return `${label}：${fmtC(it, uniqueSortedNumsFromTickets(tickets))}`;
  }

  if (bt === 'umatan' && label.includes('（フォーメーション）')) {
    const g = umatanFormationGroups(tickets);
    if (g) {
      return [
        `${label}【1着】：${fmtC(it, g.A)}`,
        `${label}【2着】：${fmtC(it, g.B)}`,
      ].join('\n');
    }
  }

  if (bt === 'umatan' && label.includes('（1着ながし）')) {
    const u = umatanNagashi1Tickets(tickets);
    if (u) {
      return [
        `${label}【1着軸】：${fmtC(it, [u.axis])}`,
        `${label}【相手】：${fmtC(it, u.opps)}`,
      ].join('\n');
    }
  }

  if (bt === 'umatan' && label.includes('（2着ながし）')) {
    const u = umatanNagashi2Tickets(tickets);
    if (u) {
      return [
        `${label}【2着軸】：${fmtC(it, [u.axis])}`,
        `${label}【相手】：${fmtC(it, u.opps)}`,
      ].join('\n');
    }
  }

  if (bt === 'umatan' && tickets.length === 1 && tickets[0].kind === 'Umatan') {
    return `${label}：${fmtGT(it, tickets[0].nums)}`;
  }

  if (bt === 'trifuku' && label.includes('（軸1頭ながし）')) {
    const f = fuku3Axis1Tickets(tickets);
    if (f) {
      return [
        `${label}【軸】：${fmtC(it, [f.axis])}`,
        `${label}【相手】：${fmtC(it, f.opps)}`,
      ].join('\n');
    }
  }

  if (bt === 'trifuku' && label.includes('（軸2頭ながし）')) {
    const f = fuku3Axis2Tickets(tickets);
    if (f) {
      return [
        `${label}【軸】：${fmtC(it, f.axes)}`,
        `${label}【相手】：${fmtC(it, f.opps)}`,
      ].join('\n');
    }
  }

  if (bt === 'trifuku' && label.includes('（フォーメーション）')) {
    const snap = it.trifukuFormation;
    if (snap?.a?.length && snap?.b?.length && snap?.c?.length) {
      return [
        `${label}【1頭目】：${fmtC(it, snap.a)}`,
        `${label}【2頭目】：${fmtC(it, snap.b)}`,
        `${label}【3頭目】：${fmtC(it, snap.c)}`,
      ].join('\n');
    }
    const parsed = parseTrifukuFormationGroupsFromDetail(detail);
    if (parsed) {
      return [
        `${label}【1頭目】：${fmtC(it, parsed.a)}`,
        `${label}【2頭目】：${fmtC(it, parsed.b)}`,
        `${label}【3頭目】：${fmtC(it, parsed.c)}`,
      ].join('\n');
    }
    return `${label}：${fmtC(it, uniqueSortedNumsFromTickets(tickets))}`;
  }

  if (bt === 'trifuku' && label.includes('（ボックス）')) {
    return `${label}：${fmtC(it, uniqueSortedNumsFromTickets(tickets))}`;
  }

  if (bt === 'trifuku' && tickets.length === 1 && tickets[0].kind === 'Fuku3') {
    return `${label}：${fmtDash(it, tickets[0].nums)}`;
  }

  if (bt === 'tritan' && label.includes('（1・2着ながし）')) {
    const x = tritanN12Tickets(tickets);
    if (x) {
      return [
        `${label}【1着軸】：${fmtC(it, [x.a1])}`,
        `${label}【2着軸】：${fmtC(it, [x.a2])}`,
        `${label}【相手】：${fmtC(it, x.opps)}`,
      ].join('\n');
    }
  }

  if (bt === 'tritan' && label.includes('（1・3着ながし）')) {
    const x = tritanN13Tickets(tickets);
    if (x) {
      return [
        `${label}【1着軸】：${fmtC(it, [x.a1])}`,
        `${label}【3着軸】：${fmtC(it, [x.a3])}`,
        `${label}【相手】：${fmtC(it, x.opps)}`,
      ].join('\n');
    }
  }

  if (bt === 'tritan' && label.includes('（2・3着ながし）')) {
    const x = tritanN23Tickets(tickets);
    if (x) {
      return [
        `${label}【2着軸】：${fmtC(it, [x.a2])}`,
        `${label}【3着軸】：${fmtC(it, [x.a3])}`,
        `${label}【相手】：${fmtC(it, x.opps)}`,
      ].join('\n');
    }
  }

  if (bt === 'tritan' && label.includes('（1着ながし）')) {
    const x = tan3Nagashi1chaku(tickets);
    if (x) {
      return [
        `${label}【1着軸】：${fmtC(it, [x.axis])}`,
        `${label}【相手】：${fmtC(it, x.opps)}`,
      ].join('\n');
    }
  }

  if (bt === 'tritan' && label.includes('（2着ながし）')) {
    const x = tan3Nagashi2chaku(tickets);
    if (x) {
      return [
        `${label}【2着軸】：${fmtC(it, [x.axis])}`,
        `${label}【相手】：${fmtC(it, x.opps)}`,
      ].join('\n');
    }
  }

  if (bt === 'tritan' && label.includes('（3着ながし）')) {
    const x = tan3Nagashi3chaku(tickets);
    if (x) {
      return [
        `${label}【3着軸】：${fmtC(it, [x.axis])}`,
        `${label}【相手】：${fmtC(it, x.opps)}`,
      ].join('\n');
    }
  }

  if (bt === 'tritan' && label.includes('（フォーメーション）')) {
    const m1 = detail.match(/1着群:\s*([^/]+)/);
    const m2 = detail.match(/2着群:\s*([^/]+)/);
    const m3 = detail.match(/3着群:\s*(.+)/);
    const a = extractBanNumsFromText(m1?.[1] || '');
    const b = extractBanNumsFromText(m2?.[1] || '');
    const c = extractBanNumsFromText(m3?.[1] || '');
    if (a.length && b.length && c.length) {
      return [
        `${label}【1着】：${fmtC(it, a)}`,
        `${label}【2着】：${fmtC(it, b)}`,
        `${label}【3着】：${fmtC(it, c)}`,
      ].join('\n');
    }
    const g = tan3FormationGroups(tickets);
    if (g) {
      return [
        `${label}【1着】：${fmtC(it, g.A)}`,
        `${label}【2着】：${fmtC(it, g.B)}`,
        `${label}【3着】：${fmtC(it, g.C)}`,
      ].join('\n');
    }
  }

  if (bt === 'tritan' && label.includes('（ボックス）')) {
    return `${label}：${fmtC(it, uniqueSortedNumsFromTickets(tickets))}`;
  }

  if (bt === 'tritan' && tickets.length === 1 && tickets[0].kind === 'Tan3') {
    return `${label}：${fmtGT(it, tickets[0].nums)}`;
  }

  return fallbackEmojiTicketLines(it, label);
}

/** セレクトメニュー用（説明欄は絵文字が出ないため番号のみ1行） */
export function slipItemDescriptionForSelect(it) {
  const label =
    parseSelectionBetKindLabel(it.selectionLine) ||
    BET_TYPE_LABEL[it.betType] ||
    '';
  const nums = uniqueSortedNumsFromTickets(it.tickets || []);
  if (!nums.length) return (label || '（内容不明）').slice(0, 100);
  return `${label} · ${nums.join(',')}`.slice(0, 100);
}

/**
 * 買い目1件分（Container 内 Text Display 用）
 * @param {{ unitYen?: number, points?: number, selectionLine?: string, raceTitle?: string, raceId?: string, oddsOfficialTime?: string, isResult?: boolean, netkeibaOrigin?: string, betType?: string, tickets?: Array<{ kind: string, nums: string[] }>, horseNumToFrame?: Record<string, string> }} it
 * @param {number} i 0 始まりインデックス
 */
export function formatBetSlipItemBlock(it, i) {
  const unitYen = it.unitYen ?? 100;
  const points = it.points ?? 0;
  const raceId = it.raceId;
  const origin = it.netkeibaOrigin === 'nar' ? 'nar' : 'jra';
  const resultUrl =
    raceId && it.isResult ? netkeibaResultUrl(raceId, origin) : null;
  const subtotal = points * unitYen;

  const label =
    parseSelectionBetKindLabel(it.selectionLine) ||
    BET_TYPE_LABEL[it.betType] ||
    '購入予定';
  const pickBlock = formatSlipPickDisplayLines(it);

  const lines = [
    `**${i + 1}.** ${slipRaceTitleLine(it)}`,
    pickBlock || `${label}：（チケット情報がありません）`,
  ];
  if (it.oddsOfficialTime) lines.push(`オッズ時刻: ${it.oddsOfficialTime}`);
  if (resultUrl) lines.push(`結果: ${resultUrl}`);
  lines.push(
    '',
    `点数 **${Number(points).toLocaleString('ja-JP')}** 点　1点 **${Number(unitYen).toLocaleString('ja-JP')}** bp　小計 **${Number(subtotal).toLocaleString('ja-JP')}** bp`,
  );
  return lines.join('\n');
}

export function buildBetPurchaseEmbed({ flow }) {
  const unitYen = flow?.unitYen ?? 100;
  const points = flow?.purchase?.points ?? 0;
  const selectionLine = flow?.purchase?.selectionLine ?? '（選択なし）';
  const totalYen = points * unitYen;

  const raceTitle = flow?.result?.raceInfo?.title || 'レース';
  const oddsTime = flow?.result?.oddsOfficialTime;
  const raceId = flow?.result?.raceId;
  const isResult = !!flow?.result?.isResult;
  const origin = netkeibaOriginFromFlow(flow);
  const resultUrl = raceId ? netkeibaResultUrl(raceId, origin) : null;

  return {
    color: 0x2ecc71,
    title: '購入内容（仮）',
    description: [
      `レース: ${raceTitle}`,
      oddsTime ? `オッズ時刻: ${oddsTime}` : null,
      isResult && resultUrl ? `結果: ${resultUrl}` : null,
      '',
      selectionLine,
      `点数: ${points}点`,
      `1点あたり: ${unitYen} bp`,
      `合計消費: ${totalYen} bp（${unitYen} bp/点）`,
    ]
      .filter(Boolean)
      .join('\n'),
    footer: { text: '確定時に bp が差し引かれます' },
  };
}

export { BET_TYPE_LABEL };

