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
  WEEKLY_CHALLENGE_LABEL_JA,
} from '../challenge/weeklyChallengeSettle.mjs';
import { betTypeDisplayLabelJa } from '../bet/betTypeLabels.mjs';
import { formatBpAmount } from '../bp/bpFormat.mjs';
import { buildBpRankLbAnnualViewFooterRow } from '../bp/bpRankUiButtons.mjs';

function pct1(x) {
  if (x == null || !Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(1)}%`;
}

function fmtTop3(top) {
  if (!top?.length) return '—（購入なし）';
  return top
    .map(
      ([key, c], i) =>
        `${i + 1}. ${betTypeDisplayLabelJa(key)}（${c}件）`,
    )
    .join('\n');
}

/**
 * @param {{ key: string, label: string, status: string, bp: number }} it
 */
function formatPrevWeekChallengeLine(it) {
  if (it.status === 'off') {
    return `・${it.label}: —（設定で報酬0のため対象外）`;
  }
  if (it.status === 'not_met') {
    return `・${it.label}: 未達成`;
  }
  if (it.status === 'claimed') {
    return `・${it.label}: 達成（**+${formatBpAmount(it.bp)}** bp 受取済み）`;
  }
  if (it.status === 'blocked') {
    return `・${it.label}: 達成（**+${formatBpAmount(it.bp)}** bp・週間CH停止中）`;
  }
  return `・${it.label}: 達成（**+${formatBpAmount(it.bp)}** bp 未受取）`;
}

/**
 * @param {{
 *   userId: string,
 *   year?: number,
 *   extraFlags?: number,
 *   rankLeaderboardReturn?: { limit: number, mode: string } | null,
 * }} opts
 */
export async function buildAnnualStatsPanelPayload(opts) {
  const extraFlags = opts.extraFlags ?? 0;
  const uid = String(opts.userId || '');
  const s = await fetchUserAnnualRaceStats(uid, opts.year);
  const rk = opts.rankLeaderboardReturn ?? null;
  const fromRankLb =
    rk?.limit != null &&
    rk.mode &&
    uid &&
    /^\d{17,20}$/.test(uid);

  const head = fromRankLb ? [`対象: <@${uid}>`, ''] : [];
  const lines = [
    ...head,
    `**年間スタッツ（JST ${s.year}年・購入時刻ベース）**`,
    '',
    `・購入件数: **${s.purchaseCount.toLocaleString('ja-JP')}** 件`,
    `・購入総額: **${formatBpAmount(s.totalCostBp)}** bp`,
    `・払戻総額（精算済）: **${formatBpAmount(s.totalRefundSettled)}** bp`,
    `・回収率（精算済）: **${pct1(s.recoveryRate)}**`,
    `・的中率（精算済）: **${pct1(s.hitRate)}**（的中 ${s.hitCount} / 精算 ${s.settledCount}）`,
    '',
    '**最多購入券種（上位3）**',
    fmtTop3(s.topBetTypes),
    '',
    `**連続不的中（精算済の連続で払戻0）最大**: **${s.maxConsecutiveMisses}** 回`,
  ];

  const footer = fromRankLb
    ? buildBpRankLbAnnualViewFooterRow(rk.limit, rk.mode, uid)
    : buildBotingMenuBackRow();

  return buildTextAndRowsV2Payload({
    headline: lines.join('\n'),
    actionRows: [footer],
    extraFlags,
  });
}

/**
 * @param {{ userId: string, extraFlags?: number, claimGrants?: Array<{ weekMondayYmd: string, challengeKey: string, bp: number }> | null }} opts
 */
export async function buildWeeklyChallengePanelPayload(opts) {
  const extraFlags = opts.extraFlags ?? 0;
  const userId = opts.userId;
  const claimGrants = opts.claimGrants;

  const [snap, hasClaimable, rows] = await Promise.all([
    getPreviousWeekChallengeSnapshot(userId),
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
      claimBanner = '**今回受け取れる報酬はありませんでした。**\n\n';
    } else {
      const sum = claimGrants.reduce((a, g) => a + g.bp, 0);
      const lines = [
        '**今回受け取った報酬**',
        ...claimGrants.map(
          (g) =>
            `・${WEEKLY_CHALLENGE_LABEL_JA[g.challengeKey] ?? g.challengeKey}（週始 ${g.weekMondayYmd}）: **+${formatBpAmount(g.bp)}** bp`,
        ),
        `**合計 +${formatBpAmount(sum)}** bp`,
        '',
      ];
      claimBanner = `${lines.join('\n')}\n`;
    }
  }

  const prevBlock =
    snap.prevMondayYmd && snap.rangeLabel
      ? [
          '**前週の達成状況**',
          snap.rangeLabel,
          '',
          ...snap.items.map((it) => formatPrevWeekChallengeLine(it)),
          '',
        ]
      : ['**前週の達成状況**', '（まだ締まった週がありません）', ''];

  const cfgBlock = [
    '**今週の週間チャレンジ（月曜0:00〜日曜24:00 JST）**',
    config.enabled ? '' : '⚠️ **現在 OFF**',
    '',
    '**目標と報酬**',
    formatWeeklyChallengeConfigSummary(config),
    '',
  ].filter((x) => x !== '');

  const prog = [
    '**今週の進捗**',
    `・的中回数（精算済）: **${st.hitCount}** / 条件 ≥ ${config.hitsMin}`,
    `・回収率（精算済）: **${pct1(st.recoveryRate)}** / 条件 ≥ ${config.recoveryMinPct}%`,
    `・的中率（精算済）: **${pct1(st.hitRate)}** / 条件 ≥ ${config.hitRateMinPct}%`,
    `・購入件数: **${st.purchaseCount}** / 条件 ≥ ${config.purchasesMin}`,
    '',
    '※ 過去週の未受取がある場合も、下のボタンでまとめて反映されます（種類ごとに一度だけ）。',
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
      .setLabel('チャレンジ報酬を受け取る')
      .setEmoji(BOTING_HUB_BUTTON_EMOJI.weeklyClaim)
      .setStyle(ButtonStyle.Success)
      .setDisabled(!hasClaimable || !config.enabled),
  );

  return buildTextAndRowsV2Payload({
    headline,
    actionRows: [claimRow, buildBotingMenuBackRow()],
    extraFlags,
  });
}
