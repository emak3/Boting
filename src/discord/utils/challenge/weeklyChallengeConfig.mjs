import { AppKv } from '../db/models.mjs';

export const WEEKLY_CHALLENGE_CONFIG_KEY = 'weekly_challenge_config_v1';

const DEFAULT = {
  enabled: true,
  hitsMin: 3,
  hitsRewardBp: 100,
  recoveryMinPct: 100,
  recoveryRewardBp: 200,
  hitRateMinPct: 25,
  hitRateRewardBp: 150,
  purchasesMin: 5,
  purchasesRewardBp: 50,
};

function clampInt(n, lo, hi) {
  const x = Math.trunc(Number(n));
  if (!Number.isFinite(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

/**
 * @param {object} raw
 */
export function normalizeWeeklyChallengeConfig(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: o.enabled !== false,
    hitsMin: clampInt(o.hitsMin ?? DEFAULT.hitsMin, 0, 9999),
    hitsRewardBp: clampInt(o.hitsRewardBp ?? DEFAULT.hitsRewardBp, 0, 1_000_000),
    recoveryMinPct: clampInt(
      o.recoveryMinPct ?? DEFAULT.recoveryMinPct,
      0,
      1_000_000,
    ),
    recoveryRewardBp: clampInt(
      o.recoveryRewardBp ?? DEFAULT.recoveryRewardBp,
      0,
      1_000_000,
    ),
    hitRateMinPct: clampInt(o.hitRateMinPct ?? DEFAULT.hitRateMinPct, 0, 1000),
    hitRateRewardBp: clampInt(
      o.hitRateRewardBp ?? DEFAULT.hitRateRewardBp,
      0,
      1_000_000,
    ),
    purchasesMin: clampInt(o.purchasesMin ?? DEFAULT.purchasesMin, 0, 99999),
    purchasesRewardBp: clampInt(
      o.purchasesRewardBp ?? DEFAULT.purchasesRewardBp,
      0,
      1_000_000,
    ),
  };
}

export async function getWeeklyChallengeConfig() {
  const row = await AppKv.findByPk(WEEKLY_CHALLENGE_CONFIG_KEY);
  if (!row) {
    return { ...normalizeWeeklyChallengeConfig({}) };
  }
  try {
    const j = JSON.parse(row.get('value') || '{}');
    return normalizeWeeklyChallengeConfig(j);
  } catch {
    return { ...normalizeWeeklyChallengeConfig({}) };
  }
}

/**
 * @param {object} config
 */
export async function setWeeklyChallengeConfig(config) {
  const n = normalizeWeeklyChallengeConfig(config);
  await AppKv.upsert({
    key: WEEKLY_CHALLENGE_CONFIG_KEY,
    value: JSON.stringify(n),
  });
  return n;
}

/**
 * @param {Awaited<ReturnType<typeof getWeeklyChallengeConfig>>} cfg
 */
export function formatWeeklyChallengeConfigSummary(cfg) {
  return [
    `有効: **${cfg.enabled ? 'ON' : 'OFF'}**`,
    `> 的中回数 ≥ **${cfg.hitsMin}** → **+${cfg.hitsRewardBp.toLocaleString('ja-JP')}** bp`,
    `> 回収率 ≥ **${cfg.recoveryMinPct}%** → **+${cfg.recoveryRewardBp.toLocaleString('ja-JP')}** bp`,
    `> 的中率 ≥ **${cfg.hitRateMinPct}%** → **+${cfg.hitRateRewardBp.toLocaleString('ja-JP')}** bp`,
    `> 購入件数 ≥ **${cfg.purchasesMin}** → **+${cfg.purchasesRewardBp.toLocaleString('ja-JP')}** bp`,
  ].join('\n');
}
