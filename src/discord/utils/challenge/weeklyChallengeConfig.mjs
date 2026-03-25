import { AppKv } from '../db/models.mjs';
import { formatBpAmount } from '../bp/bpFormat.mjs';
import { t } from '../../../i18n/index.mjs';

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
 * @param {string | null} [locale]
 */
export function formatWeeklyChallengeConfigSummary(cfg, locale = null) {
  const onOff = cfg.enabled
    ? t('boting_stats.weekly.cfg_on', null, locale)
    : t('boting_stats.weekly.cfg_off', null, locale);
  return [
    t('boting_stats.weekly.cfg_enabled', { on: onOff }, locale),
    t(
      'boting_stats.weekly.cfg_row_hits',
      { min: cfg.hitsMin, bp: formatBpAmount(cfg.hitsRewardBp) },
      locale,
    ),
    t(
      'boting_stats.weekly.cfg_row_recovery',
      { min: cfg.recoveryMinPct, bp: formatBpAmount(cfg.recoveryRewardBp) },
      locale,
    ),
    t(
      'boting_stats.weekly.cfg_row_hit_rate',
      { min: cfg.hitRateMinPct, bp: formatBpAmount(cfg.hitRateRewardBp) },
      locale,
    ),
    t(
      'boting_stats.weekly.cfg_row_purchases',
      { min: cfg.purchasesMin, bp: formatBpAmount(cfg.purchasesRewardBp) },
      locale,
    ),
  ].join('\n');
}
