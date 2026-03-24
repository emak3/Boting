import { Op } from 'sequelize';
import { sequelize, UserPoint, WeeklyChallengeClaim } from '../db/models.mjs';
import { fetchUserRaceBetsPurchasedBetween } from '../race/raceBetRecords.mjs';
import {
  addJstCalendarDays,
  appendLedgerTransaction,
  normBalance,
} from '../user/userPointsStore.mjs';
import { computeRaceBetRangeStats } from './raceBetRangeStats.mjs';
import {
  enumerateCompletedWeekMondaysDescending,
  weekBoundsUtcFromMondayYmd,
} from './jstCalendar.mjs';
import { getWeeklyChallengeConfig } from './weeklyChallengeConfig.mjs';

/** @type {Record<string, string>} */
export const WEEKLY_CHALLENGE_LABEL_JA = {
  hits: '的中回数',
  recovery: '回収率',
  hitRate: '的中率',
  purchases: '購入件数',
};

/**
 * 週次統計と設定から各チャレンジの達成可否（付与はしない）
 * @param {ReturnType<typeof computeRaceBetRangeStats>} st
 * @param {Awaited<ReturnType<typeof getWeeklyChallengeConfig>>} config
 */
export function evaluateWeeklyTries(st, config) {
  return [
    {
      key: 'hits',
      ok: config.hitsRewardBp > 0 && st.hitCount >= config.hitsMin,
      bp: config.hitsRewardBp,
    },
    {
      key: 'recovery',
      ok:
        config.recoveryRewardBp > 0 &&
        st.recoveryRate != null &&
        st.totalCostSettled > 0 &&
        st.recoveryRate * 100 >= config.recoveryMinPct,
      bp: config.recoveryRewardBp,
    },
    {
      key: 'hitRate',
      ok:
        config.hitRateRewardBp > 0 &&
        st.hitRate != null &&
        st.settledCount > 0 &&
        st.hitRate * 100 >= config.hitRateMinPct,
      bp: config.hitRateRewardBp,
    },
    {
      key: 'purchases',
      ok:
        config.purchasesRewardBp > 0 &&
        st.purchaseCount >= config.purchasesMin,
      bp: config.purchasesRewardBp,
    },
  ];
}

function fmtYmdJa(ymd8) {
  const y = ymd8.slice(0, 4);
  const mo = parseInt(ymd8.slice(4, 6), 10);
  const da = parseInt(ymd8.slice(6, 8), 10);
  return `${y}年${mo}月${da}日`;
}

/**
 * 直前に終了した週（月〜日 JST）の達成状況（受取済み含む）
 * @param {string} userId
 * @param {Date} [now]
 */
export async function getPreviousWeekChallengeSnapshot(userId, now = new Date()) {
  const uid = String(userId || '');
  const config = await getWeeklyChallengeConfig();
  const weeks = enumerateCompletedWeekMondaysDescending(now, 1);
  const prevMon = weeks[0] ?? null;
  if (!prevMon) {
    return {
      config,
      prevMondayYmd: null,
      rangeLabel: null,
      items: [],
    };
  }
  const sunYmd = addJstCalendarDays(prevMon, 6);
  const rangeLabel = `${fmtYmdJa(prevMon)}（月）〜${fmtYmdJa(sunYmd)}（日）`;
  const { start, end } = weekBoundsUtcFromMondayYmd(prevMon);
  const rows = await fetchUserRaceBetsPurchasedBetween(uid, start, end);
  const st = computeRaceBetRangeStats(rows.map((r) => r.get({ plain: true })));
  const tries = evaluateWeeklyTries(st, config);

  const claimedRows = await WeeklyChallengeClaim.findAll({
    where: { userId: uid, weekMondayYmd: prevMon },
  });
  const claimedSet = new Set(
    claimedRows.map((r) => String(r.get('challengeKey') || '')),
  );

  /** @type {Array<{ key: string, label: string, met: boolean, bp: number, status: 'pending' | 'claimed' | 'not_met' | 'off' }>} */
  const items = tries.map((t) => {
    const label = WEEKLY_CHALLENGE_LABEL_JA[t.key] ?? t.key;
    if (t.bp <= 0) {
      return {
        key: t.key,
        label,
        met: false,
        bp: 0,
        status: /** @type {const} */ ('off'),
      };
    }
    if (!t.ok) {
      return {
        key: t.key,
        label,
        met: false,
        bp: t.bp,
        status: /** @type {const} */ ('not_met'),
      };
    }
    if (claimedSet.has(t.key)) {
      return {
        key: t.key,
        label,
        met: true,
        bp: t.bp,
        status: /** @type {const} */ ('claimed'),
      };
    }
    return {
      key: t.key,
      label,
      met: true,
      bp: t.bp,
      status: /** @type {const} */ ('pending'),
    };
  });

  const itemsAdjusted = !config.enabled
    ? items.map((it) =>
        it.status === 'pending'
          ? { ...it, status: /** @type {const} */ ('blocked') }
          : it,
      )
    : items;

  return {
    config,
    prevMondayYmd: prevMon,
    rangeLabel,
    items: itemsAdjusted,
  };
}

/**
 * いずれかの終了週で、達成済みかつ未受取のチャレンジがあるか
 * @param {string} userId
 * @param {Date} [now]
 */
export async function hasAnyClaimableWeeklyChallenge(userId, now = new Date()) {
  const uid = String(userId || '');
  if (!uid) return false;
  const config = await getWeeklyChallengeConfig();
  if (!config.enabled) return false;

  const weeks = enumerateCompletedWeekMondaysDescending(now, 104);
  if (!weeks.length) return false;

  const keys = ['hits', 'recovery', 'hitRate', 'purchases'];
  for (const monYmd of weeks) {
    const { start, end } = weekBoundsUtcFromMondayYmd(monYmd);
    const rows = await fetchUserRaceBetsPurchasedBetween(uid, start, end);
    const st = computeRaceBetRangeStats(rows.map((r) => r.get({ plain: true })));
    const tries = evaluateWeeklyTries(st, config);
    const metKeys = tries.filter((t) => t.ok && t.bp > 0).map((t) => t.key);
    if (!metKeys.length) continue;

    const existing = await WeeklyChallengeClaim.findAll({
      where: {
        userId: uid,
        weekMondayYmd: monYmd,
        challengeKey: { [Op.in]: metKeys },
      },
    });
    const have = new Set(existing.map((r) => String(r.get('challengeKey'))));
    for (const k of metKeys) {
      if (!have.has(k)) return true;
    }
  }
  return false;
}

/**
 * @param {string} userId
 * @param {string} weekMondayYmd
 * @param {string} challengeKey
 * @param {number} bp
 */
export async function grantWeeklyChallengeOnce(userId, weekMondayYmd, challengeKey, bp) {
  const uid = String(userId);
  const w = String(weekMondayYmd);
  const k = String(challengeKey);
  const grantBp = Math.round(Number(bp));
  if (!/^\d{8}$/.test(w) || grantBp <= 0) {
    return { ok: false, reason: 'bad_args' };
  }

  return sequelize.transaction(async (t) => {
    const existing = await WeeklyChallengeClaim.findOne({
      where: { userId: uid, weekMondayYmd: w, challengeKey: k },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (existing) {
      return { ok: false, reason: 'already_claimed' };
    }

    await WeeklyChallengeClaim.create(
      {
        userId: uid,
        weekMondayYmd: w,
        challengeKey: k,
        grantedBp: grantBp,
        grantedAt: new Date(),
      },
      { transaction: t },
    );

    const userRow = await UserPoint.findByPk(uid, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    const u = userRow ? userRow.get({ plain: true }) : {};
    const balanceBefore = normBalance(u.balance);
    const newBal = balanceBefore + grantBp;
    const period = `W${w}`;

    await UserPoint.upsert(
      {
        userId: uid,
        balance: newBal,
        firstDailyDone: u.firstDailyDone ?? false,
        lastDailyPeriodKey: u.lastDailyPeriodKey ?? null,
        dailyStreakDay: u.dailyStreakDay ?? null,
      },
      { transaction: t },
    );

    await appendLedgerTransaction(t, uid, {
      delta: grantBp,
      balanceAfter: newBal,
      kind: 'weekly_challenge',
      period,
    });

    return { ok: true, balanceAfter: newBal, grantedBp: grantBp };
  });
}

/**
 * 終了済み週について条件を満たしていれば BP 付与（未請求分のみ）。
 * @param {string} userId
 * @param {Date} [now]
 */
export async function settleWeeklyChallengesForUser(userId, now = new Date()) {
  const config = await getWeeklyChallengeConfig();
  /** @type {Array<{ weekMondayYmd: string, challengeKey: string, bp: number }>} */
  const grants = [];
  if (!config.enabled) {
    return { grants, config };
  }

  const weeks = enumerateCompletedWeekMondaysDescending(now, 104);

  for (const monYmd of weeks) {
    const { start, end } = weekBoundsUtcFromMondayYmd(monYmd);
    const rows = await fetchUserRaceBetsPurchasedBetween(userId, start, end);
    const plain = rows.map((r) => r.get({ plain: true }));
    const st = computeRaceBetRangeStats(plain);
    const tries = evaluateWeeklyTries(st, config);

    for (const t of tries) {
      if (!t.ok) continue;
      const r = await grantWeeklyChallengeOnce(userId, monYmd, t.key, t.bp);
      if (r.ok) {
        grants.push({
          weekMondayYmd: monYmd,
          challengeKey: t.key,
          bp: r.grantedBp,
        });
      }
    }
  }

  return { grants, config };
}
