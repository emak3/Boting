import { sequelize, UserPoint, LedgerEntry } from '../db/models.mjs';

const LEDGER_PREVIEW_LIMIT = 15;
/** 直近の収支ページング用 1 クエリあたりの取得上限 */
export const LEDGER_PAGE_MAX_FETCH = 500;

/** JSTはDSTなし。UTC+9のオフセットでJSTの暦・時刻成分を得る */
function getJstYmdH(date) {
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
  };
}

/** JST の時・分（21:30 境界など） */
function getJstYmdHm(date) {
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    min: shifted.getUTCMinutes(),
  };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 暦の JST 日付 YYYYMMDD（深夜帯もその日のまま） */
export function getJstCalendarYmd(now = new Date()) {
  const { y, m, d } = getJstYmdHm(now);
  return `${y}${pad2(m)}${pad2(d)}`;
}

/**
 * JST 暦の YYYYMMDD から n 日加算（負も可）
 * @param {string} ymd
 * @param {number} days
 */
export function addJstCalendarDays(ymd, days) {
  const y = parseInt(ymd.slice(0, 4), 10);
  const mo = parseInt(ymd.slice(4, 6), 10);
  const da = parseInt(ymd.slice(6, 8), 10);
  const anchor = new Date(`${y}-${pad2(mo)}-${pad2(da)}T12:00:00+09:00`);
  const n = new Date(anchor.getTime() + days * 86400000);
  const shifted = new Date(n.getTime() + 9 * 60 * 60 * 1000);
  const yy = shifted.getUTCFullYear();
  const mm = shifted.getUTCMonth() + 1;
  const dd = shifted.getUTCDate();
  return `${yy}${pad2(mm)}${pad2(dd)}`;
}

/** JST 21:30 以降（購入履歴の「明日」切替用） */
export function isJstAtOrAfter2130(now = new Date()) {
  const { h, min } = getJstYmdHm(now);
  return h > 21 || (h === 21 && min >= 30);
}

/**
 * 日次リセット境界: 毎日 JST 08:00。
 * 返すキーは「その帯が始まった日」の YYYYMMDD（JST）。
 */
export function getCurrentDailyPeriodKey(now = new Date()) {
  let { y, m, d, h } = getJstYmdH(now);
  if (h < 8) {
    const t = Date.UTC(y, m - 1, d) - 24 * 60 * 60 * 1000;
    const prev = new Date(t);
    y = prev.getUTCFullYear();
    m = prev.getUTCMonth() + 1;
    d = prev.getUTCDate();
  }
  return `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
}

export function normBalance(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** period キー YYYYMMDD の「翌日」JST 8:00（次の日次帯の開始） */
export function getNextDailyWindowStartDate(periodKey) {
  const y = periodKey.slice(0, 4);
  const mo = periodKey.slice(4, 6);
  const da = periodKey.slice(6, 8);
  const thisStart = new Date(`${y}-${mo}-${da}T08:00:00+09:00`);
  return new Date(thisStart.getTime() + 24 * 60 * 60 * 1000);
}

/** 日次帯 periodKey（YYYYMMDD）の [start, end) — いずれも JST 8:00 境界 */
export function getJstDailyPeriodWindowBounds(periodKey) {
  const y = periodKey.slice(0, 4);
  const mo = periodKey.slice(4, 6);
  const da = periodKey.slice(6, 8);
  const start = new Date(`${y}-${mo}-${da}T08:00:00+09:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * @param {string} kind
 * @param {number} [streakDay] 連続デイリー（1–7）のときのみ
 */
export function kindLabelJa(kind, streakDay) {
  if (kind === 'first') return '初回ボーナス';
  if (kind === 'debug_extra') return 'デバッグ';
  if (kind === 'debug_bp_adjust') return 'デバッグ（BP調整）';
  if (kind === 'race_bet') return '競馬（購入）';
  if (kind === 'race_refund') return '競馬（払戻）';
  if (kind === 'race_refund_adjust') return '競馬（払戻調整）';
  if (kind === 'weekly_challenge') return '週間チャレンジ';
  if (kind === 'daily') {
    const s = Number(streakDay);
    if (Number.isFinite(s) && s >= 1 && s <= 7) {
      return `（連続${s}日目）`;
    }
    return 'デイリー';
  }
  return 'デイリー';
}

/** 連続日数（1–7）に応じたデイリー合計 bp（10 + ボーナス） */
export function getDailyStreakGrantBp(streakDay) {
  const d = Math.trunc(Number(streakDay));
  const bonuses = [0, 20, 30, 40, 50, 60, 130];
  if (!Number.isFinite(d) || d < 1 || d > 7) return 10;
  return 10 + bonuses[d - 1];
}

function mapLedgerRow(row) {
  const at = row.at instanceof Date ? row.at : null;
  const streakRaw = row.streakDay;
  const streakNum =
    streakRaw != null && streakRaw !== ''
      ? Math.trunc(Number(streakRaw))
      : undefined;
  return {
    delta: normBalance(row.delta),
    balanceAfter: normBalance(row.balanceAfter),
    kind: String(row.kind ?? 'daily'),
    period: row.period != null ? String(row.period) : '',
    at,
    streakDay:
      Number.isFinite(streakNum) && streakNum >= 1 && streakNum <= 7
        ? streakNum
        : undefined,
  };
}

/**
 * @param {import('sequelize').Transaction} transaction
 * @param {string} userId
 * @param {{ delta: number, balanceAfter: number, kind: string, period: string, streakDay?: number }} payload
 */
export async function appendLedgerTransaction(transaction, userId, payload) {
  await LedgerEntry.create(
    {
      userId,
      delta: payload.delta,
      balanceAfter: payload.balanceAfter,
      kind: payload.kind,
      period: payload.period,
      streakDay:
        payload.streakDay != null
          ? Math.trunc(Number(payload.streakDay))
          : null,
      at: new Date(),
    },
    { transaction },
  );
}

/**
 * @param {string} userId
 * @param {{ withLedgerPreview?: boolean }} [opts] withLedgerPreview=false なら台帳クエリを省略（/boting メイン用）
 */
export async function getDailyAccountView(userId, opts = {}) {
  const withLedgerPreview = opts.withLedgerPreview !== false;
  const currentPeriodKey = getCurrentDailyPeriodKey();

  const row = await UserPoint.findByPk(userId);
  const u = row ? row.get({ plain: true }) : {};
  const balance = normBalance(u.balance);
  const lastDailyPeriodKey =
    u.lastDailyPeriodKey != null ? String(u.lastDailyPeriodKey) : null;
  const rawStreak = u.dailyStreakDay;
  const dailyStreakDay =
    rawStreak != null &&
    Number.isFinite(Number(rawStreak)) &&
    Math.trunc(Number(rawStreak)) >= 1 &&
    Math.trunc(Number(rawStreak)) <= 7
      ? Math.trunc(Number(rawStreak))
      : null;

  let nextClaimAt = null;
  if (lastDailyPeriodKey === currentPeriodKey && lastDailyPeriodKey) {
    nextClaimAt = getNextDailyWindowStartDate(lastDailyPeriodKey);
  }

  const entries = [];
  if (withLedgerPreview) {
    const led = await LedgerEntry.findAll({
      where: { userId },
      order: [['at', 'DESC']],
      limit: LEDGER_PREVIEW_LIMIT,
    });
    for (const r of led) {
      entries.push(mapLedgerRow(r.get({ plain: true })));
    }
  }

  return {
    balance,
    currentPeriodKey,
    lastDailyPeriodKey,
    dailyStreakDay,
    nextClaimAt,
    entries,
  };
}

/**
 * 台帳をページ取得（新しい順）。1 件多く取り hasMore を判定。
 */
export async function fetchLedgerPage(userId, pageSize, pageIndex) {
  const ps = Math.min(50, Math.max(1, Math.round(Number(pageSize) || 10)));
  const pi = Math.max(0, Math.floor(Number(pageIndex) || 0));
  const need = (pi + 1) * ps;
  if (pi * ps >= LEDGER_PAGE_MAX_FETCH) {
    return {
      entries: [],
      hasMore: false,
      hasPrev: pi > 0,
      capped: true,
    };
  }

  const fetchLimit = Math.min(need + 1, LEDGER_PAGE_MAX_FETCH);
  const rows = await LedgerEntry.findAll({
    where: { userId },
    order: [['at', 'DESC']],
    limit: fetchLimit,
  });

  const all = rows.map((d) => mapLedgerRow(d.get({ plain: true })));
  const start = pi * ps;
  const page = all.slice(start, start + ps);
  const hasMore = rows.length > (pi + 1) * ps;
  const hasPrev = pi > 0;
  const capped =
    need + 1 > LEDGER_PAGE_MAX_FETCH && rows.length === LEDGER_PAGE_MAX_FETCH;

  return {
    entries: page,
    hasMore,
    hasPrev,
    capped,
  };
}

/**
 * @param {string} userId
 * @returns {Promise<number>}
 */
export async function getBalance(userId) {
  const row = await UserPoint.findByPk(userId);
  if (!row) return 0;
  return normBalance(row.get('balance'));
}

/**
 * 台帳の最古の取引時刻（初回デイリー・購入など）
 */
export async function fetchFirstLedgerAt(userId) {
  const row = await LedgerEntry.findOne({
    where: { userId },
    order: [['at', 'ASC']],
  });
  if (!row) return null;
  const at = row.get('at');
  return at instanceof Date && !Number.isNaN(at.getTime()) ? at : null;
}

/**
 * デバッグ用: 指定ユーザーの bp を増減し台帳に記録する
 */
export async function applyDebugBpAdjustment(targetUserId, delta) {
  const dRaw = Math.trunc(Number(delta));
  if (!Number.isFinite(dRaw) || dRaw === 0) {
    return { ok: false, reason: 'zero_delta' };
  }
  if (Math.abs(dRaw) > Number.MAX_SAFE_INTEGER) {
    return { ok: false, reason: 'delta_too_large' };
  }

  const period = getCurrentDailyPeriodKey();

  return sequelize.transaction(async (t) => {
    const row = await UserPoint.findByPk(targetUserId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    const u = row ? row.get({ plain: true }) : {};
    const balanceBefore = normBalance(u.balance);
    let d = dRaw;
    if (d < 0) {
      d = Math.max(d, -balanceBefore);
    }
    if (d === 0) {
      return { ok: false, reason: 'zero_delta', balance: balanceBefore };
    }
    const balanceAfter = balanceBefore + d;
    await UserPoint.upsert(
      {
        userId: String(targetUserId),
        balance: balanceAfter,
        firstDailyDone: u.firstDailyDone ?? false,
        lastDailyPeriodKey: u.lastDailyPeriodKey ?? null,
        dailyStreakDay: u.dailyStreakDay ?? null,
      },
      { transaction: t },
    );
    await appendLedgerTransaction(t, String(targetUserId), {
      delta: d,
      balanceAfter,
      kind: 'debug_bp_adjust',
      period,
    });
    return { ok: true, balanceBefore, balanceAfter, delta: d };
  });
}

/**
 * @param {string} userId
 * @param {{ debugBypass?: boolean }} [opts]
 */
export async function tryClaimDaily(userId, opts = {}) {
  const debugBypass = !!opts.debugBypass;
  const period = getCurrentDailyPeriodKey();

  return sequelize.transaction(async (t) => {
    const row = await UserPoint.findByPk(userId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    const u = row ? row.get({ plain: true }) : {};
    const balance = normBalance(u.balance);
    const firstDailyDone = !!u.firstDailyDone;
    const lastDailyPeriodKey =
      u.lastDailyPeriodKey != null ? String(u.lastDailyPeriodKey) : null;

    if (!firstDailyDone) {
      const newBal = balance + 10000;
      await UserPoint.upsert(
        {
          userId,
          balance: newBal,
          firstDailyDone: true,
          lastDailyPeriodKey: period,
          dailyStreakDay: u.dailyStreakDay ?? null,
        },
        { transaction: t },
      );
      await appendLedgerTransaction(t, userId, {
        delta: 10000,
        balanceAfter: newBal,
        kind: 'first',
        period,
      });
      return { ok: true, granted: 10000, balance: newBal, kind: 'first' };
    }

    if (lastDailyPeriodKey === period) {
      if (debugBypass) {
        const newBal = balance + 10;
        await UserPoint.upsert(
          {
            userId,
            balance: newBal,
            firstDailyDone: true,
            lastDailyPeriodKey,
            dailyStreakDay: u.dailyStreakDay ?? null,
          },
          { transaction: t },
        );
        await appendLedgerTransaction(t, userId, {
          delta: 10,
          balanceAfter: newBal,
          kind: 'debug_extra',
          period,
        });
        return { ok: true, granted: 10, balance: newBal, kind: 'debug_extra' };
      }
      return {
        ok: false,
        reason: 'already_claimed',
        balance,
      };
    }

    const prevPeriod = addJstCalendarDays(period, -1);
    const prevStreak = u.dailyStreakDay;
    const hadStreak =
      prevStreak != null &&
      Number.isFinite(Number(prevStreak)) &&
      Math.trunc(Number(prevStreak)) >= 1 &&
      Math.trunc(Number(prevStreak)) <= 7;
    const consecutive = lastDailyPeriodKey === prevPeriod && hadStreak;

    let streakDay = 1;
    if (consecutive) {
      const p = Math.trunc(Number(prevStreak));
      streakDay = p >= 7 ? 1 : p + 1;
    }

    const granted = getDailyStreakGrantBp(streakDay);
    const newBal = balance + granted;
    await UserPoint.upsert(
      {
        userId,
        balance: newBal,
        firstDailyDone: true,
        lastDailyPeriodKey: period,
        dailyStreakDay: streakDay,
      },
      { transaction: t },
    );
    await appendLedgerTransaction(t, userId, {
      delta: granted,
      balanceAfter: newBal,
      kind: 'daily',
      period,
      streakDay,
    });
    return {
      ok: true,
      granted,
      balance: newBal,
      kind: 'daily',
      streakDay,
    };
  });
}
