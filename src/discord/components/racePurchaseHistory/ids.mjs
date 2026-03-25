import { BP_RANK_DISPLAY_MAX } from '../../utils/bp/bpRankLeaderboardEmbed.mjs';

/** `|bpctx|{discordUserId}`（任意で `|rklb|{limit}|{mode}`）— 他人の履歴ナビ・ランキング戻り用 */
export function stripRaceHistoryBpCtx(customId) {
  const s = String(customId || '');
  const idx = s.indexOf('|bpctx|');
  if (idx < 0) {
    return {
      withoutCtx: s,
      bpctxUserId: null,
      rankLeaderboardReturn: null,
    };
  }
  const withoutCtx = s.slice(0, idx);
  const rest = s.slice(idx + '|bpctx|'.length);
  const parts = rest.split('|');
  const bpctxUserId = /^\d{17,20}$/.test(parts[0] || '') ? parts[0] : null;
  let rankLeaderboardReturn = null;
  const rklb = parts.indexOf('rklb');
  if (rklb >= 0 && parts[rklb + 1] != null && parts[rklb + 2] != null) {
    const lim = Math.min(
      BP_RANK_DISPLAY_MAX,
      Math.max(1, parseInt(String(parts[rklb + 1]), 10) || 20),
    );
    const modeRaw = String(parts[rklb + 2] || '');
    if (
      modeRaw === 'balance' ||
      modeRaw === 'recovery' ||
      modeRaw === 'hit_rate' ||
      modeRaw === 'purchase'
    ) {
      rankLeaderboardReturn = { limit: lim, mode: modeRaw };
    }
  }
  return { withoutCtx, bpctxUserId, rankLeaderboardReturn };
}

/**
 * @param {string | null | undefined} bpRankProfileUserId
 * @param {{ limit: number, mode: string } | null | undefined} rankLeaderboardReturn
 */
export function historyCtxSuffix(bpRankProfileUserId, rankLeaderboardReturn) {
  if (!bpRankProfileUserId || !/^\d{17,20}$/.test(String(bpRankProfileUserId))) {
    return '';
  }
  let s = `|bpctx|${bpRankProfileUserId}`;
  if (rankLeaderboardReturn?.limit != null && rankLeaderboardReturn.mode) {
    const lim = Math.min(
      BP_RANK_DISPLAY_MAX,
      Math.max(1, Math.round(Number(rankLeaderboardReturn.limit) || 20)),
    );
    const m = String(rankLeaderboardReturn.mode);
    if (
      m === 'balance' ||
      m === 'recovery' ||
      m === 'hit_rate' ||
      m === 'purchase'
    ) {
      s += `|rklb|${lim}|${m}`;
    }
  }
  return s;
}

export const RACE_HISTORY_PAGE_PREFIX = 'race_bet_history_pg';
/** 開催日を前後にずらす（customId: day|対象YYYYMMDD|page|meetingFilter） */
export const RACE_HISTORY_DAY_PREFIX = 'race_bet_history_day';
/** 購入履歴ページからレース結果へ（String Select の customId） */
export const RACE_HISTORY_RESULT_PICK_PREFIX = 'race_hist_result';
/** 開催場で絞り込み（String Select の customId: meeting|YYYYMMDD|…） */
export const RACE_HISTORY_MEETING_PREFIX = 'race_hist_meeting';

/**
 * 購入履歴のページング・開催フィルタと同じ customId（戻るボタン兼用）
 * @param {{ periodKey: string, page: number, meetingFilter?: string, bpRankProfileUserId?: string | null, rankLeaderboardReturn?: { limit: number, mode: string } | null }} opts
 */
export function buildRaceHistoryNavCustomId(opts) {
  const mf = String(opts.meetingFilter || 'all').trim() || 'all';
  const pg = Math.max(0, Math.floor(Number(opts.page) || 0));
  const sfx = historyCtxSuffix(opts.bpRankProfileUserId, opts.rankLeaderboardReturn);
  return `${RACE_HISTORY_PAGE_PREFIX}|${opts.periodKey}|${pg}|${mf}${sfx}`;
}

/**
 * @param {{ periodKey: string, page: number, meetingFilter?: string, bpRankProfileUserId?: string | null, rankLeaderboardReturn?: { limit: number, mode: string } | null }} opts
 */
export function buildRaceHistoryResultPickCustomId(opts) {
  const mf = String(opts.meetingFilter || 'all').trim() || 'all';
  const pg = Math.max(0, Math.floor(Number(opts.page) || 0));
  const sfx = historyCtxSuffix(opts.bpRankProfileUserId, opts.rankLeaderboardReturn);
  return `${RACE_HISTORY_RESULT_PICK_PREFIX}|${opts.periodKey}|${pg}|${mf}${sfx}`;
}
