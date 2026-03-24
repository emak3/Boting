/**
 * 購入フロー（stepSelections + flow 状態）から払戻照合用チケット配列を生成する。
 * 各チケットは netkeiba parseResultPayouts の kind（Tansho, Fukusho, …）と nums に対応。
 */

import { frameAllowsWakurenSamePair } from '../jra/jraBetAvailability.mjs';

function uniqValues(arr) {
  return Array.from(new Set((arr || []).map((v) => String(v))));
}

function ss(flow, id) {
  const v = flow?.stepSelections?.[id];
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

function pairPayoutKind(betType) {
  if (betType === 'frame_pair') return 'Wakuren';
  if (betType === 'horse_pair') return 'Umaren';
  if (betType === 'wide') return 'Wide';
  return 'Umaren';
}

function sortedPairNums(a, b) {
  const x = String(a);
  const y = String(b);
  return x < y ? [x, y] : [y, x];
}

function sortedTripleNums(a, b, c) {
  return [String(a), String(b), String(c)]
    .sort((p, q) => Number(p) - Number(q));
}

function orderedPairsFromSet(values) {
  const V = uniqValues(values);
  const out = [];
  for (let i = 0; i < V.length; i++) {
    for (let j = 0; j < V.length; j++) {
      if (i === j) continue;
      out.push([V[i], V[j]]);
    }
  }
  return out;
}

function pushUmatanDistinct(a, b, seen, tickets) {
  const x = String(a);
  const y = String(b);
  if (!x || !y || x === y) return;
  const k = `${x}>${y}`;
  if (seen.has(k)) return;
  seen.add(k);
  tickets.push({ kind: 'Umatan', nums: [x, y] });
}

function pushTan3Distinct(a, b, c, seen, tickets) {
  const x = String(a);
  const y = String(b);
  const z = String(c);
  if (!x || !y || !z || x === y || x === z || y === z) return;
  const k = `${x}|${y}|${z}`;
  if (seen.has(k)) return;
  seen.add(k);
  tickets.push({ kind: 'Tan3', nums: [x, y, z] });
}

/**
 * 購入確認・マルチトグル対象か（JRA マルチ投票: 馬単ながし / 3連単軸ながし）
 * @param {string | null | undefined} lastMenuCustomId
 */
export function jraMultiEligibleLastMenu(lastMenuCustomId) {
  const id = String(lastMenuCustomId || '');
  return (
    id.startsWith('race_bet_umatan_normal_2|') ||
    id.startsWith('race_bet_umatan_nagashi1_opp|') ||
    id.startsWith('race_bet_umatan_nagashi2_opp|') ||
    id.startsWith('race_bet_umatan_formB|') ||
    id.startsWith('race_bet_tritan_nagashi1_opp|') ||
    id.startsWith('race_bet_tritan_nagashi2_opp|') ||
    id.startsWith('race_bet_tritan_nagashi3_opp|')
  );
}

/**
 * @param {object} flow betFlow のマージ済みスナップショット
 * @param {string} raceId
 * @returns {Array<{ kind: string, nums: string[] }>}
 */
export function buildPayoutTicketsFromFlow(flow, raceId) {
  const lastId = flow?.purchase?.lastMenuCustomId;
  if (!lastId || !raceId) return [];

  const f = flow;
  const betType = f.betType;

  // --- 単勝 / 複勝 / 単勝+複勝 ---
  if (lastId.startsWith('race_bet_single_pick|')) {
    const parts = lastId.split('|');
    const sub = parts[2] || 'win';
    const horse = ss(f, lastId)[0];
    if (!horse) return [];
    if (sub === 'win') return [{ kind: 'Tansho', nums: [horse] }];
    if (sub === 'place') return [{ kind: 'Fukusho', nums: [horse] }];
    if (sub === 'win_place') {
      return [
        { kind: 'Tansho', nums: [horse] },
        { kind: 'Fukusho', nums: [horse] },
      ];
    }
    return [];
  }

  // --- 枠連（通常・2段） ---
  if (lastId.startsWith('race_bet_frame_pair_normal_second|')) {
    const firstId = `race_bet_frame_pair_normal_first|${raceId}`;
    const first =
      ss(f, firstId)[0] ??
      (f.framePairNormalFirst != null ? String(f.framePairNormalFirst) : null);
    const second = ss(f, lastId)[0];
    if (first == null || second == null) return [];
    return [{ kind: 'Wakuren', nums: sortedPairNums(first, second) }];
  }

  // --- 枠連/馬連/ワイド 通常（1メニュー2頭） ---
  if (lastId.startsWith('race_bet_pair_normal|')) {
    const picks = ss(f, lastId);
    if (picks.length < 2) return [];
    const [, , bt] = lastId.split('|');
    const kind = pairPayoutKind(bt);
    return [{ kind, nums: sortedPairNums(picks[0], picks[1]) }];
  }

  // --- ながし ---
  if (lastId.startsWith('race_bet_pair_nagashi_opponent|')) {
    const [, , bt] = lastId.split('|');
    const kind = pairPayoutKind(bt);
    const axis = f.pairAxis != null ? String(f.pairAxis) : '';
    const opps = ss(f, lastId);
    const horses = f.result?.horses || [];
    const tickets = [];
    for (const o of opps) {
      if (bt === 'frame_pair' && o === axis) {
        if (frameAllowsWakurenSamePair(horses, o)) {
          tickets.push({ kind, nums: sortedPairNums(axis, o) });
        }
        continue;
      }
      if (o === axis) continue;
      tickets.push({ kind, nums: sortedPairNums(axis, o) });
    }
    return tickets;
  }

  // --- ボックス（2頭式） ---
  if (lastId.startsWith('race_bet_pair_box|')) {
    const [, , bt] = lastId.split('|');
    const kind = pairPayoutKind(bt);
    const picks = uniqValues(ss(f, lastId));
    const horses = f.result?.horses || [];
    const tickets = [];
    for (let i = 0; i < picks.length; i++) {
      for (let j = i + 1; j < picks.length; j++) {
        tickets.push({ kind, nums: sortedPairNums(picks[i], picks[j]) });
      }
    }
    if (bt === 'frame_pair') {
      for (const fr of picks) {
        if (frameAllowsWakurenSamePair(horses, fr)) {
          tickets.push({ kind, nums: sortedPairNums(fr, fr) });
        }
      }
    }
    return tickets;
  }

  // --- フォーメーション（2群） ---
  if (lastId.startsWith('race_bet_pair_formB|')) {
    const [, , bt] = lastId.split('|');
    const kind = pairPayoutKind(bt);
    const A = f.pairFormA || [];
    const B = ss(f, lastId);
    const horses = f.result?.horses || [];
    const tickets = [];
    const set = new Set();
    for (const x of uniqValues(A)) {
      for (const y of uniqValues(B)) {
        if (x === y) {
          if (bt === 'frame_pair' && frameAllowsWakurenSamePair(horses, x)) {
            set.add(`${x}|${x}`);
          }
          continue;
        }
        const [m1, m2] = x < y ? [x, y] : [y, x];
        set.add(`${m1}|${m2}`);
      }
    }
    for (const key of set) {
      const [a, b] = key.split('|');
      tickets.push({ kind, nums: sortedPairNums(a, b) });
    }
    if (!tickets.length) return [];
    return tickets;
  }

  // --- 馬単 通常 ---
  if (lastId.startsWith('race_bet_umatan_normal_2|')) {
    const one = f.umatanFirst != null ? String(f.umatanFirst) : '';
    const two = ss(f, lastId)[0];
    if (!one || !two || one === two) return [];
    const seen = new Set();
    const tickets = [];
    pushUmatanDistinct(one, two, seen, tickets);
    if (f.jraMulti === true) {
      pushUmatanDistinct(two, one, seen, tickets);
    }
    return tickets;
  }

  // --- 馬単 1着ながし ---
  if (lastId.startsWith('race_bet_umatan_nagashi1_opp|')) {
    const axis = f.umatanAxis != null ? String(f.umatanAxis) : '';
    const opps = ss(f, lastId);
    const seen = new Set();
    const tickets = [];
    for (const o of opps) {
      pushUmatanDistinct(axis, o, seen, tickets);
    }
    if (f.jraMulti === true) {
      for (const o of opps) {
        pushUmatanDistinct(o, axis, seen, tickets);
      }
    }
    return tickets;
  }

  // --- 馬単 2着ながし（相手が1着） ---
  if (lastId.startsWith('race_bet_umatan_nagashi2_opp|')) {
    const axis2 = f.umatanAxis2 != null ? String(f.umatanAxis2) : '';
    const opps = ss(f, lastId);
    const seen = new Set();
    const tickets = [];
    for (const o of opps) {
      pushUmatanDistinct(o, axis2, seen, tickets);
    }
    if (f.jraMulti === true) {
      for (const o of opps) {
        pushUmatanDistinct(axis2, o, seen, tickets);
      }
    }
    return tickets;
  }

  // --- 馬単 ボックス ---
  if (lastId.startsWith('race_bet_umatan_box|')) {
    const picks = uniqValues(ss(f, lastId));
    const tickets = [];
    for (let i = 0; i < picks.length; i++) {
      for (let j = 0; j < picks.length; j++) {
        if (i === j) continue;
        tickets.push({ kind: 'Umatan', nums: [picks[i], picks[j]] });
      }
    }
    return tickets;
  }

  // --- 馬単 フォーメーション ---
  if (lastId.startsWith('race_bet_umatan_formB|')) {
    const A = uniqValues(f.umatanFormA || []);
    const B = uniqValues(ss(f, lastId));
    const seen = new Set();
    const tickets = [];
    for (const x of A) {
      for (const y of B) {
        pushUmatanDistinct(x, y, seen, tickets);
      }
    }
    if (f.jraMulti === true) {
      for (const x of A) {
        for (const y of B) {
          pushUmatanDistinct(y, x, seen, tickets);
        }
      }
    }
    return tickets;
  }

  // --- 3連複 通常 ---
  if (lastId.startsWith('race_bet_trifuku_normal|')) {
    const picks = ss(f, lastId);
    if (uniqValues(picks).length !== 3) return [];
    return [{ kind: 'Fuku3', nums: sortedTripleNums(picks[0], picks[1], picks[2]) }];
  }

  // --- 3連複 軸1 ---
  if (lastId.startsWith('race_bet_trifuku_n1_opp|')) {
    const axis = f.trifukuAxis1 != null ? String(f.trifukuAxis1) : '';
    const opp = ss(f, lastId);
    const O = uniqValues(opp).filter((x) => x !== axis);
    const tickets = [];
    for (let i = 0; i < O.length; i++) {
      for (let j = i + 1; j < O.length; j++) {
        tickets.push({
          kind: 'Fuku3',
          nums: sortedTripleNums(axis, O[i], O[j]),
        });
      }
    }
    return tickets;
  }

  // --- 3連複 軸2 ---
  if (lastId.startsWith('race_bet_trifuku_n2_opp|')) {
    const axes = (f.trifukuAxis2 || []).map(String);
    if (axes.length !== 2) return [];
    const [a0, a1] = axes;
    const opp = ss(f, lastId);
    const tickets = [];
    for (const o of uniqValues(opp)) {
      if (o === a0 || o === a1) continue;
      tickets.push({ kind: 'Fuku3', nums: sortedTripleNums(a0, a1, o) });
    }
    return tickets;
  }

  // --- 3連複 ボックス ---
  if (lastId.startsWith('race_bet_trifuku_box|')) {
    const picks = uniqValues(ss(f, lastId));
    const tickets = [];
    for (let i = 0; i < picks.length; i++) {
      for (let j = i + 1; j < picks.length; j++) {
        for (let k = j + 1; k < picks.length; k++) {
          tickets.push({
            kind: 'Fuku3',
            nums: sortedTripleNums(picks[i], picks[j], picks[k]),
          });
        }
      }
    }
    return tickets;
  }

  // --- 3連複 フォーメーション ---
  if (lastId.startsWith('race_bet_trifuku_formC|')) {
    const formA = f.trifukuFormA || [];
    const formB = f.trifukuFormB || [];
    const formC = ss(f, lastId);
    const tickets = [];
    const seen = new Set();
    for (const x of uniqValues(formA)) {
      for (const y of uniqValues(formB)) {
        for (const z of uniqValues(formC)) {
          if (x === y || x === z || y === z) continue;
          const nums = sortedTripleNums(x, y, z);
          const key = nums.join('|');
          if (seen.has(key)) continue;
          seen.add(key);
          tickets.push({ kind: 'Fuku3', nums });
        }
      }
    }
    return tickets;
  }

  // --- 3連単 通常 ---
  if (lastId.startsWith('race_bet_tritan_normal_3|')) {
    const a = f.tritanFirst != null ? String(f.tritanFirst) : '';
    const b = f.tritanSecond != null ? String(f.tritanSecond) : '';
    const c = ss(f, lastId)[0];
    if (!a || !b || !c || a === b || a === c || b === c) return [];
    return [{ kind: 'Tan3', nums: [a, b, c] }];
  }

  // --- 3連単 ながし1（軸1着）---
  if (lastId.startsWith('race_bet_tritan_nagashi1_opp|')) {
    const axis = f.tritanAxis != null ? String(f.tritanAxis) : '';
    const O = uniqValues(ss(f, lastId)).filter((x) => x !== axis);
    const seen = new Set();
    const tickets = [];
    for (const [x, y] of orderedPairsFromSet(O)) {
      pushTan3Distinct(axis, x, y, seen, tickets);
    }
    if (f.jraMulti === true) {
      for (let i = 0; i < O.length; i++) {
        for (let j = 0; j < O.length; j++) {
          if (i === j) continue;
          pushTan3Distinct(O[i], axis, O[j], seen, tickets);
        }
      }
      for (let i = 0; i < O.length; i++) {
        for (let j = 0; j < O.length; j++) {
          if (i === j) continue;
          pushTan3Distinct(O[i], O[j], axis, seen, tickets);
        }
      }
    }
    return tickets;
  }

  // --- ながし2（軸2着）---
  if (lastId.startsWith('race_bet_tritan_nagashi2_opp|')) {
    const axis = f.tritanAxis2 != null ? String(f.tritanAxis2) : '';
    const O = uniqValues(ss(f, lastId)).filter((x) => x !== axis);
    const seen = new Set();
    const tickets = [];
    for (const [x, y] of orderedPairsFromSet(O)) {
      pushTan3Distinct(x, axis, y, seen, tickets);
    }
    if (f.jraMulti === true) {
      for (let i = 0; i < O.length; i++) {
        for (let j = 0; j < O.length; j++) {
          if (i === j) continue;
          pushTan3Distinct(axis, O[i], O[j], seen, tickets);
        }
      }
      for (let i = 0; i < O.length; i++) {
        for (let j = 0; j < O.length; j++) {
          if (i === j) continue;
          pushTan3Distinct(O[i], O[j], axis, seen, tickets);
        }
      }
    }
    return tickets;
  }

  // --- ながし3（軸3着）---
  if (lastId.startsWith('race_bet_tritan_nagashi3_opp|')) {
    const axis = f.tritanAxis3 != null ? String(f.tritanAxis3) : '';
    const O = uniqValues(ss(f, lastId)).filter((x) => x !== axis);
    const seen = new Set();
    const tickets = [];
    for (const [x, y] of orderedPairsFromSet(O)) {
      pushTan3Distinct(x, y, axis, seen, tickets);
    }
    if (f.jraMulti === true) {
      for (let i = 0; i < O.length; i++) {
        for (let j = 0; j < O.length; j++) {
          if (i === j) continue;
          pushTan3Distinct(axis, O[i], O[j], seen, tickets);
        }
      }
      for (let i = 0; i < O.length; i++) {
        for (let j = 0; j < O.length; j++) {
          if (i === j) continue;
          pushTan3Distinct(O[i], axis, O[j], seen, tickets);
        }
      }
    }
    return tickets;
  }

  // --- 1・2着ながし ---
  if (lastId.startsWith('race_bet_tritan_n12_opp3|')) {
    const a1 = f.tritanN12A1 != null ? String(f.tritanN12A1) : '';
    const a2 = f.tritanN12A2 != null ? String(f.tritanN12A2) : '';
    if (!a1 || !a2 || a1 === a2) return [];
    const opp3 = ss(f, lastId);
    const tickets = [];
    for (const o of uniqValues(opp3)) {
      if (o === a1 || o === a2) continue;
      tickets.push({ kind: 'Tan3', nums: [a1, a2, o] });
    }
    return tickets;
  }

  // --- 1・3着ながし ---
  if (lastId.startsWith('race_bet_tritan_n13_opp2|')) {
    const a1 = f.tritanN13A1 != null ? String(f.tritanN13A1) : '';
    const a3 = f.tritanN13A3 != null ? String(f.tritanN13A3) : '';
    if (!a1 || !a3 || a1 === a3) return [];
    const opp2 = ss(f, lastId);
    const tickets = [];
    for (const o of uniqValues(opp2)) {
      if (o === a1 || o === a3) continue;
      tickets.push({ kind: 'Tan3', nums: [a1, o, a3] });
    }
    return tickets;
  }

  // --- 2・3着ながし ---
  if (lastId.startsWith('race_bet_tritan_n23_opp1|')) {
    const a2 = f.tritanN23A2 != null ? String(f.tritanN23A2) : '';
    const a3 = f.tritanN23A3 != null ? String(f.tritanN23A3) : '';
    if (!a2 || !a3 || a2 === a3) return [];
    const opp1 = ss(f, lastId);
    const tickets = [];
    for (const o of uniqValues(opp1)) {
      if (o === a2 || o === a3) continue;
      tickets.push({ kind: 'Tan3', nums: [o, a2, a3] });
    }
    return tickets;
  }

  // --- 3連単 ボックス ---
  if (lastId.startsWith('race_bet_tritan_box|')) {
    const picks = uniqValues(ss(f, lastId));
    const tickets = [];
    for (let i = 0; i < picks.length; i++) {
      for (let j = 0; j < picks.length; j++) {
        if (i === j) continue;
        for (let k = 0; k < picks.length; k++) {
          if (k === i || k === j) continue;
          tickets.push({
            kind: 'Tan3',
            nums: [picks[i], picks[j], picks[k]],
          });
        }
      }
    }
    return tickets;
  }

  // --- 3連単 フォーメーション ---
  if (lastId.startsWith('race_bet_tritan_formC|')) {
    const formA = f.tritanFormA || [];
    const formB = f.tritanFormB || [];
    const formC = ss(f, lastId);
    const tickets = [];
    for (const x of uniqValues(formA)) {
      for (const y of uniqValues(formB)) {
        for (const z of uniqValues(formC)) {
          if (x === y || x === z || y === z) continue;
          tickets.push({ kind: 'Tan3', nums: [x, y, z] });
        }
      }
    }
    return tickets;
  }

  return [];
}

/** @param {Array<{ kind: string, nums: string[] }>} tickets */
export function ticketCountForValidation(tickets) {
  return (tickets || []).length;
}
