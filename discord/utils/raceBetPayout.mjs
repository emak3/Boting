/**
 * netkeiba 結果ページの払戻（100円あたり）と買い目チケットから bp 払戻を計算する
 *
 * 除外・取消となった馬を含む組は、払戻は当たらないが購入額相当が返還される（JRA 馬券の扱いに準ずる）。
 * 枠連のみ: 同枠に出走する馬が1頭でもいれば返還しない。同枠が除外馬のみ（その枠に出走可能な馬がいなくなった枠）を選んだときだけ返還する。
 */

/** @param {string} s */
export function parsePayoutYenPer100(s) {
  if (s == null) return 0;
  const t = String(s).replace(/[,\s]/g, '').replace(/円/g, '');
  const m = t.match(/\d+/);
  if (!m) return 0;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) ? n : 0;
}

function normNum(x) {
  const n = parseInt(String(x).replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? String(n) : String(x);
}

function horsesByFrameFromH2f(horseNumToFrame) {
  const m = new Map();
  if (!horseNumToFrame || typeof horseNumToFrame !== 'object') return m;
  for (const [hn, fr] of Object.entries(horseNumToFrame)) {
    const f = normNum(String(fr));
    if (!m.has(f)) m.set(f, []);
    m.get(f).push(normNum(hn));
  }
  return m;
}

/**
 * 枠連返還: 「その枠の全頭が除外」の枠だけ（同枠に1頭でも出走がいれば含めない）
 * @param {{ raceHorses?: object[], horseNumToFrame?: Record<string, string>, excludedHorseNumbers?: string[] }} opts
 * @returns {Set<string>} 枠番（正規化文字列）
 */
function deadFramesForWakuren(opts = {}) {
  const raceHorses = opts.raceHorses || [];
  const ex = new Set((opts.excludedHorseNumbers || []).map(normNum));
  const dead = new Set();

  if (raceHorses.length > 0) {
    const byFrame = new Map();
    for (const h of raceHorses) {
      const f = normNum(String(h.frameNumber ?? '').replace(/\D/g, ''));
      if (!f) continue;
      if (!byFrame.has(f)) byFrame.set(f, []);
      byFrame.get(f).push(h);
    }
    for (const [f, list] of byFrame) {
      if (list.length && list.every((h) => h.excluded === true)) dead.add(f);
    }
    return dead;
  }

  const byFrame = horsesByFrameFromH2f(opts.horseNumToFrame);
  for (const [f, list] of byFrame) {
    if (list.length && list.every((h) => ex.has(h))) dead.add(f);
  }
  return dead;
}

/**
 * 除外による全額返還が必要か（1点＝1チケット＝unitYen 相当）
 * @param {{ kind: string, nums: string[] }} ticket
 * @param {{ excludedHorseNumbers?: string[], horseNumToFrame?: Record<string, string>, raceHorses?: object[] }} opts
 */
export function ticketInvolvesExcludedHorse(ticket, opts = {}) {
  const excludedHorseNumbers = opts.excludedHorseNumbers || [];
  const ex = new Set(excludedHorseNumbers.map(normNum));
  if (!ticket?.nums?.length) return false;
  const kind = String(ticket.kind || '');

  if (kind === 'Wakuren') {
    if (!ex.size) return false;
    const dead = deadFramesForWakuren(opts);
    for (const f of ticket.nums) {
      if (dead.has(normNum(f))) return true;
    }
    return false;
  }

  if (!ex.size) return false;
  for (const n of ticket.nums) {
    if (ex.has(normNum(n))) return true;
  }
  return false;
}

/**
 * @param {string[]} a
 * @param {string[]} b
 */
function sameNumsUnordered(a, b) {
  const pa = [...a].map(normNum).sort((x, y) => Number(x) - Number(y));
  const pb = [...b].map(normNum).sort((x, y) => Number(x) - Number(y));
  if (pa.length !== pb.length) return false;
  return pa.every((v, i) => v === pb[i]);
}

/**
 * @param {string[]} a
 * @param {string[]} b
 */
function sameNumsOrdered(a, b) {
  const pa = a.map(normNum);
  const pb = b.map(normNum);
  if (pa.length !== pb.length) return false;
  return pa.every((v, i) => v === pb[i]);
}

/**
 * 複勝で1セルに「2 16 1」「110円800円190円」のように複数頭ぶんが入る場合の払戻テキスト分割
 * @param {string|undefined|null} raw
 * @returns {string[]}
 */
function splitFukushoPayoutParts(raw) {
  if (raw == null) return [];
  const s = String(raw).replace(/\s+/g, ' ').trim();
  if (!s || s === '—') return [];
  if (s.includes('/')) {
    return s.split(/\s*\/\s*/).map((x) => x.trim()).filter(Boolean);
  }
  const m = s.match(/\d{1,4}\s*円/g);
  if (m && m.length > 1) return m.map((x) => x.replace(/\s/g, ''));
  return [s];
}

/**
 * 複勝1行に複数馬番があるとき、チケットの馬番に対応する100円あたり払戻
 * @param {{ nums?: string[], payout?: string }} row
 * @param {{ nums: string[] }} ticket
 */
function fukushoPayoutYenPer100ForTicket(row, ticket) {
  const t = normNum(ticket.nums[0]);
  const rnums = row.nums || [];
  const idx = rnums.findIndex((r) => normNum(r) === t);
  if (idx < 0) return 0;
  const parts = splitFukushoPayoutParts(row.payout);
  if (parts.length === rnums.length && parts[idx] != null) {
    return parsePayoutYenPer100(parts[idx]);
  }
  return parsePayoutYenPer100(row.payout);
}

/**
 * @param {{ kind?: string|null, nums?: string[], payout?: string }} row
 * @param {{ kind: string, nums: string[] }} ticket
 */
export function payoutRowMatchesTicket(row, ticket) {
  if (!row || !ticket) return false;
  if (String(row.kind || '') !== String(ticket.kind)) return false;
  const rk = ticket.kind;
  const rnums = row.nums || [];
  const tnums = ticket.nums || [];
  if (rk === 'Umatan' || rk === 'Tan3') {
    return sameNumsOrdered(rnums, tnums);
  }
  if (rk === 'Tansho') {
    return rnums.length >= 1 && tnums.length >= 1 && normNum(rnums[0]) === normNum(tnums[0]);
  }
  if (rk === 'Fukusho') {
    if (tnums.length < 1) return false;
    const tn = normNum(tnums[0]);
    return rnums.some((r) => normNum(r) === tn);
  }
  if (
    rk === 'Fuku3' &&
    rnums.length === 6 &&
    tnums.length === 3
  ) {
    return (
      sameNumsUnordered(rnums.slice(0, 3), tnums) ||
      sameNumsUnordered(rnums.slice(3, 6), tnums)
    );
  }
  return sameNumsUnordered(rnums, tnums);
}

/**
 * @param {Array<{ kind: string, nums: string[] }>} tickets
 * @param {Array<{ kind?: string|null, nums?: string[], payout?: string }>} payouts
 * @param {number} unitYen 1点あたり（=100円馬券の倍率の基準）
 * @param {{ excludedHorseNumbers?: string[], horseNumToFrame?: Record<string, string>, raceHorses?: object[] }} [opts]
 */
export function sumRefundBpForTickets(tickets, payouts, unitYen = 100, opts = {}) {
  const u = Math.max(1, Math.round(Number(unitYen) || 100));
  const passOpts = {
    excludedHorseNumbers: opts.excludedHorseNumbers || [],
    horseNumToFrame: opts.horseNumToFrame,
    raceHorses: opts.raceHorses || [],
  };
  let sum = 0;
  for (const t of tickets || []) {
    if (ticketInvolvesExcludedHorse(t, passOpts)) {
      sum += u;
      continue;
    }
    const row = (payouts || []).find((p) => payoutRowMatchesTicket(p, t));
    if (!row) continue;
    const per100 =
      String(t.kind) === 'Fukusho'
        ? fukushoPayoutYenPer100ForTicket(row, t)
        : parsePayoutYenPer100(row.payout);
    if (per100 <= 0) continue;
    sum += Math.floor((per100 * u) / 100);
  }
  return sum;
}
