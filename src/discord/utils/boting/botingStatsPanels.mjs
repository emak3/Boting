import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { buildTextAndRowsV2Payload } from '../race/raceCardDisplay.mjs';
import { buildBotingMenuBackRow } from './botingBackButton.mjs';
import {
  BOTING_HUB_BUTTON_EMOJI,
  BOTING_HUB_PREFIX,
} from './botingHubConstants.mjs';
import { fetchUserAnnualRaceStats } from '../challenge/annualStatsSummary.mjs';
import {
  getJstMondayYmdForInstant,
  weekBoundsUtcFromMondayYmd,
} from '../challenge/jstCalendar.mjs';
import { fetchUserRaceBetsPurchasedBetween } from '../race/raceBetRecords.mjs';
import { computeRaceBetRangeStats } from '../challenge/raceBetRangeStats.mjs';
import { formatWeeklyChallengeConfigSummary } from '../challenge/weeklyChallengeConfig.mjs';
import {
  getPreviousWeekChallengeSnapshot,
  hasAnyClaimableWeeklyChallenge,
  weeklyChallengeKeyLabel,
} from '../challenge/weeklyChallengeSettle.mjs';
import { betTypeDisplayLabel } from '../bet/betTypeLabels.mjs';
import { formatBpAmount } from '../bp/bpFormat.mjs';
import { buildBpRankLbAnnualViewFooterRow } from '../bp/bpRankUiButtons.mjs';
import { t, normalizeLocale } from '../../../i18n/index.mjs';

function pct1(x) {
  if (x == null || !Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(1)}%`;
}

function countLocaleTag(locale) {
  return normalizeLocale(locale) === 'en' ? 'en-US' : 'ja-JP';
}

function fmtTop3(top, locale) {
  if (!top?.length) {
    return t('boting_stats.annual.top_bet_types_empty', null, locale);
  }
  return top
    .map(
      ([key, c], i) =>
        t(
          'boting_stats.annual.top_bet_type_line',
          {
            i: i + 1,
            label: betTypeDisplayLabel(key, locale),
            count: c,
          },
          locale,
        ),
    )
    .join('\n');
}

/**
 * @param {{ key: string, label: string, status: string, bp: number }} it
 * @param {string | null} [locale]
 */
function formatPrevWeekChallengeLine(it, locale) {
  if (it.status === 'off') {
    return t('boting_stats.weekly.status_off', { label: it.label }, locale);
  }
  if (it.status === 'not_met') {
    return t('boting_stats.weekly.status_not_met', { label: it.label }, locale);
  }
  if (it.status === 'claimed') {
    return t(
      'boting_stats.weekly.status_claimed',
      { label: it.label, bp: formatBpAmount(it.bp) },
      locale,
    );
  }
  if (it.status === 'blocked') {
    return t(
      'boting_stats.weekly.status_blocked',
      { label: it.label, bp: formatBpAmount(it.bp) },
      locale,
    );
  }
  return t(
    'boting_stats.weekly.status_pending',
    { label: it.label, bp: formatBpAmount(it.bp) },
    locale,
  );
}

/**
 * @param {{
 *   userId: string,
 *   year?: number,
 *   extraFlags?: number,
 *   rankLeaderboardReturn?: { limit: number, mode: string } | null,
 *   locale?: string | null,
 * }} opts
 */
export async function buildAnnualStatsPanelPayload(opts) {
  const extraFlags = opts.extraFlags ?? 0;
  const loc = opts.locale ?? null;
  const uid = String(opts.userId || '');
  const s = await fetchUserAnnualRaceStats(uid, opts.year);
  const rk = opts.rankLeaderboardReturn ?? null;
  const fromRankLb =
    rk?.limit != null &&
    rk.mode &&
    uid &&
    /^\d{17,20}$/.test(uid);

  const nsloc = countLocaleTag(loc);
  const head = fromRankLb
    ? [
        t('boting_stats.annual.target', { mention: `<@${uid}>` }, loc),
        '',
      ]
    : [];
  const lines = [
    ...head,
    t('boting_stats.annual.title', { year: s.year }, loc),
    '',
    t(
      'boting_stats.annual.purchase_count',
      { count: s.purchaseCount.toLocaleString(nsloc) },
      loc,
    ),
    t('boting_stats.annual.total_cost', { amount: formatBpAmount(s.totalCostBp) }, loc),
    t(
      'boting_stats.annual.total_refund',
      { amount: formatBpAmount(s.totalRefundSettled) },
      loc,
    ),
    t('boting_stats.annual.recovery', { pct: pct1(s.recoveryRate) }, loc),
    t(
      'boting_stats.annual.hit_rate',
      {
        pct: pct1(s.hitRate),
        hits: s.hitCount,
        settled: s.settledCount,
      },
      loc,
    ),
    '',
    t('boting_stats.annual.top_bet_types_heading', null, loc),
    fmtTop3(s.topBetTypes, loc),
    '',
    t('boting_stats.annual.max_miss_streak', { n: s.maxConsecutiveMisses }, loc),
  ];

  const footer = fromRankLb
    ? buildBpRankLbAnnualViewFooterRow(rk.limit, rk.mode, uid, loc)
    : buildBotingMenuBackRow({ locale: loc });

  return buildTextAndRowsV2Payload({
    headline: lines.join('\n'),
    actionRows: [footer],
    extraFlags,
    locale: loc,
  });
}

/**
 * @param {{ userId: string, extraFlags?: number, claimGrants?: Array<{ weekMondayYmd: string, challengeKey: string, bp: number }> | null, locale?: string | null }} opts
 */
export async function buildWeeklyChallengePanelPayload(opts) {
  const extraFlags = opts.extraFlags ?? 0;
  const loc = opts.locale ?? null;
  const userId = opts.userId;
  const claimGrants = opts.claimGrants;

  const [snap, hasClaimable, rows] = await Promise.all([
    getPreviousWeekChallengeSnapshot(userId, undefined, loc),
    hasAnyClaimableWeeklyChallenge(userId),
    (async () => {
      const m = getJstMondayYmdForInstant();
      const { start, end } = weekBoundsUtcFromMondayYmd(m);
      return fetchUserRaceBetsPurchasedBetween(userId, start, end);
    })(),
  ]);

  const { config } = snap;
  const st = computeRaceBetRangeStats(
    rows.map((r) => r.get({ plain: true })),
  );

  let claimBanner = '';
  if (claimGrants != null) {
    if (claimGrants.length === 0) {
      claimBanner = t('boting_stats.weekly.claim_none', null, loc);
    } else {
      const sum = claimGrants.reduce((a, g) => a + g.bp, 0);
      const lines = [
        t('boting_stats.weekly.claim_heading', null, loc),
        ...claimGrants.map((g) =>
          t(
            'boting_stats.weekly.claim_line',
            {
              label: weeklyChallengeKeyLabel(g.challengeKey, loc),
              week: g.weekMondayYmd,
              bp: formatBpAmount(g.bp),
            },
            loc,
          ),
        ),
        t('boting_stats.weekly.claim_total', { bp: formatBpAmount(sum) }, loc),
        '',
      ];
      claimBanner = `${lines.join('\n')}\n`;
    }
  }

  const prevBlock =
    snap.prevMondayYmd && snap.rangeLabel
      ? [
          t('boting_stats.weekly.prev_week_heading', null, loc),
          snap.rangeLabel,
          '',
          ...snap.items.map((it) => formatPrevWeekChallengeLine(it, loc)),
          '',
        ]
      : [
          t('boting_stats.weekly.prev_week_heading', null, loc),
          t('boting_stats.weekly.prev_week_empty', null, loc),
          '',
        ];

  const cfgBlock = [
    t('boting_stats.weekly.cfg_heading', null, loc),
    config.enabled ? '' : t('boting_stats.weekly.cfg_off_warning', null, loc),
    '',
    t('boting_stats.weekly.cfg_targets_heading', null, loc),
    formatWeeklyChallengeConfigSummary(config, loc),
    '',
  ].filter((x) => x !== '');

  const prog = [
    t('boting_stats.weekly.prog_heading', null, loc),
    t(
      'boting_stats.weekly.prog_hits',
      { cur: st.hitCount, min: config.hitsMin },
      loc,
    ),
    t(
      'boting_stats.weekly.prog_recovery',
      { cur: pct1(st.recoveryRate), min: config.recoveryMinPct },
      loc,
    ),
    t(
      'boting_stats.weekly.prog_hit_rate',
      { cur: pct1(st.hitRate), min: config.hitRateMinPct },
      loc,
    ),
    t(
      'boting_stats.weekly.prog_purchases',
      { cur: st.purchaseCount, min: config.purchasesMin },
      loc,
    ),
    '',
    t('boting_stats.weekly.prog_footnote', null, loc),
  ];

  const headline = [
    claimBanner,
    ...prevBlock,
    ...cfgBlock,
    ...prog,
  ].join('\n');

  const claimRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BOTING_HUB_PREFIX}|weekly_claim`)
      .setLabel(t('boting_stats.weekly.claim_button', null, loc))
      .setEmoji(BOTING_HUB_BUTTON_EMOJI.weeklyClaim)
      .setStyle(ButtonStyle.Success)
      .setDisabled(!hasClaimable || !config.enabled),
  );

  return buildTextAndRowsV2Payload({
    headline,
    actionRows: [claimRow, buildBotingMenuBackRow({ locale: loc })],
    extraFlags,
    locale: loc,
  });
}
