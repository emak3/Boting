import { ContainerBuilder, MessageFlags, SeparatorSpacingSize } from 'discord.js';
import { fetchFirstLedgerAt } from '../user/userPointsStore.mjs';
import { fetchUserRaceBetAggregates } from '../race/raceBetRecords.mjs';
import {
  fetchAllUsersByBalanceDesc,
  computeBpRank,
} from './bpLeaderboard.mjs';
import {
  getBalanceAfterPendingRaceRefunds,
  runPendingRaceRefundsForUser,
} from '../race/raceBetRefundSweep.mjs';
import { getBetFlow } from '../bet/betFlowStore.mjs';
import { msgSlipTooManyForOtherUser } from '../bet/betSlipCopy.mjs';
import { getSlipSavedItems, SLIP_MAX_ITEMS } from '../bet/betSlipStore.mjs';
import { slipItemFromLiveFlow } from '../bet/betSlipOpenReview.mjs';
import { formatBetSlipItemBlock } from '../bet/betPurchaseEmbed.mjs';
import { buildTextAndRowsV2Payload, V2_TEXT_TOTAL_MAX } from '../race/raceCardDisplay.mjs';
import {
  BP_RANK_USER_HISTORY_PREFIX,
  BP_RANK_USER_SLIP_PREFIX,
  BP_RANK_BACK_PROFILE_PREFIX,
  buildBpRankProfileBackButtonRow,
  buildBpRankProfileButtonsRow,
} from './bpRankUiButtons.mjs';
import { formatBpAmount } from './bpFormat.mjs';
import { normalizeLocale, t } from '../../../i18n/index.mjs';

export {
  BP_RANK_USER_HISTORY_PREFIX,
  BP_RANK_USER_SLIP_PREFIX,
  BP_RANK_BACK_PROFILE_PREFIX,
  buildBpRankProfileBackButtonRow,
  buildBpRankProfileButtonsRow,
};

const DETAIL_ACCENT = 0x5865f2;

function formatJst(d, locale = null) {
  const locTag = normalizeLocale(locale) === 'en' ? 'en-US' : 'ja-JP';
  return d.toLocaleString(locTag, {
    timeZone: 'Asia/Tokyo',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function pct(r) {
  if (r == null || !Number.isFinite(r)) return '—';
  return `${(r * 100).toFixed(2)}%`;
}

function earliestDate(a, b) {
  if (a && b) return a < b ? a : b;
  return a || b || null;
}

/**
 * `/bp_rank user:` の統計取得（Embed / Components V2 共通）
 * @param {import('discord.js').User} targetUser
 * @param {import('discord.js').Guild | null} guild
 * @param {string} refundForUserId
 * @param {string | null} [locale]
 */
export async function fetchBpRankUserDetailData(
  targetUser,
  guild,
  refundForUserId,
  locale = null,
) {
  await runPendingRaceRefundsForUser(refundForUserId);

  const sorted = await fetchAllUsersByBalanceDesc();

  const { rank, balance, totalUsers } = computeBpRank(sorted, targetUser.id);

  const [ledgerFirst, agg] = await Promise.all([
    fetchFirstLedgerAt(targetUser.id),
    fetchUserRaceBetAggregates(targetUser.id),
  ]);

  const firstUse = earliestDate(ledgerFirst, agg.firstPurchasedAt);

  let guildJoinedLine = '—';
  if (guild) {
    try {
      const member = await guild.members.fetch(targetUser.id).catch(() => null);
      if (member?.joinedAt) {
        guildJoinedLine = formatJst(member.joinedAt, locale);
      }
    } catch {
      /* ignore */
    }
  }

  const rankLine =
    rank != null && totalUsers > 0
      ? t(
          'bp_rank.profile_detail.rank.line',
          { rank, total: totalUsers },
          locale,
        )
      : t('bp_rank.profile_detail.rank.outside', null, locale);

  return {
    balance,
    rankLine,
    guildJoinedLine,
    firstUseText: firstUse ? formatJst(firstUse, locale) : '—',
    agg,
  };
}

function formatBpRankUserDetailMarkdown(targetUser, d, locale = null) {
  const { balance, rankLine, guildJoinedLine, firstUseText, agg } = d;
  const uname = targetUser.username;
  return [
    t('bp_rank.profile_detail.detail.title', { username: uname }, locale),
    '',
    t(
      'bp_rank.profile_detail.detail.current_bp',
      { amount: formatBpAmount(balance) },
      locale,
    ),
    t('bp_rank.profile_detail.detail.rank_row', { line: rankLine }, locale),
    '',
    t('bp_rank.profile_detail.detail.section_guild', null, locale),
    guildJoinedLine,
    '',
    t('bp_rank.profile_detail.detail.section_first_use', null, locale),
    firstUseText,
    '',
    t('bp_rank.profile_detail.detail.section_racing', null, locale),
    t('bp_rank.profile_detail.detail.hit_count', { n: agg.hitCount }, locale),
    t(
      'bp_rank.profile_detail.detail.purchase_count',
      { n: agg.purchaseCount },
      locale,
    ),
    t(
      'bp_rank.profile_detail.detail.total_cost',
      { amount: formatBpAmount(agg.totalCostBp) },
      locale,
    ),
    t(
      'bp_rank.profile_detail.detail.max_cost_per_bet',
      { amount: formatBpAmount(agg.maxCostBp) },
      locale,
    ),
    t(
      'bp_rank.profile_detail.detail.settled_count',
      { n: agg.settledCount },
      locale,
    ),
    t(
      'bp_rank.profile_detail.detail.total_recovery',
      {
        pct: pct(agg.totalRecoveryRate),
        refund: formatBpAmount(agg.totalRefundBpSettled),
        cost: formatBpAmount(agg.totalCostBpSettled),
      },
      locale,
    ),
    t(
      'bp_rank.profile_detail.detail.max_recovery',
      { pct: pct(agg.maxRecoveryRate) },
      locale,
    ),
    t(
      'bp_rank.profile_detail.detail.min_recovery',
      { pct: pct(agg.minRecoveryRate) },
      locale,
    ),
    '',
    t('bp_rank.profile_detail.detail.recovery_footnote', null, locale),
  ].join('\n');
}

/**
 * 購入履歴など V2 画面から「メニューに戻る」で編集するため、IS_COMPONENTS_V2 を維持する。
 * @param {string | null} [locale]
 */
export async function buildBpRankUserDetailV2Container(
  targetUser,
  guild,
  refundForUserId,
  locale = null,
) {
  const d = await fetchBpRankUserDetailData(
    targetUser,
    guild,
    refundForUserId,
    locale,
  );
  const container = new ContainerBuilder().setAccentColor(DETAIL_ACCENT);
  container.addTextDisplayComponents((td) =>
    td.setContent(formatBpRankUserDetailMarkdown(targetUser, d, locale)),
  );
  return container;
}

const SLIP_VIEW_ACCENT = 0x5865f2;

function collectMergedSlipPreviewItems(targetUserId) {
  const saved = getSlipSavedItems(targetUserId);
  const merged = [...saved];
  const raceId =
    merged[0]?.raceId && /^\d{12}$/.test(String(merged[0].raceId))
      ? String(merged[0].raceId)
      : '000000000000';
  const flowOpt = getBetFlow(targetUserId, raceId);
  if (flowOpt?.purchase && raceId && /^\d{12}$/.test(String(raceId))) {
    merged.push(slipItemFromLiveFlow(flowOpt, raceId));
  }
  return { merged, raceId };
}

function appendTextWithOverflowSplits(container, text) {
  let rest = String(text || '').trimEnd();
  const chunkSize = 3500;
  let first = true;
  while (rest.length > 0) {
    if (!first) {
      container.addSeparatorComponents((sep) =>
        sep.setSpacing(SeparatorSpacingSize.Small).setDivider(true),
      );
    }
    first = false;
    const take =
      rest.length <= chunkSize
        ? rest
        : rest.slice(0, rest.lastIndexOf('\n', chunkSize) + 1 || chunkSize);
    container.addTextDisplayComponents((td) => td.setContent(take.trimEnd()));
    rest = rest.slice(take.length).trimStart();
  }
}

/**
 * 指定ユーザーの購入予定を閲覧のみで表示（編集・確定は不可）
 */
export async function buildBpRankUserSlipReadonlyV2Payload({
  targetUser,
  targetUserId,
  extraFlags = 0,
  locale = null,
}) {
  const uid = targetUserId || targetUser?.id;
  if (!uid || !/^\d{17,20}$/.test(String(uid))) {
    return buildTextAndRowsV2Payload({
      headline: t(
        'bp_rank.profile_detail.slip_readonly.errors.invalid_user',
        null,
        locale,
      ),
      actionRows: [],
      extraFlags,
      locale,
    });
  }

  const displayName =
    targetUser?.username ??
    t('bp_rank.profile_detail.user_fallback', null, locale);

  const { merged } = collectMergedSlipPreviewItems(uid);
  if (!merged.length) {
    return buildTextAndRowsV2Payload({
      headline: t(
        'bp_rank.profile_detail.slip_readonly.empty',
        { username: displayName },
        locale,
      ),
      actionRows: [buildBpRankProfileBackButtonRow(uid, locale)],
      extraFlags,
      locale,
    });
  }
  if (merged.length > SLIP_MAX_ITEMS) {
    return buildTextAndRowsV2Payload({
      headline: msgSlipTooManyForOtherUser(targetUser?.username, locale),
      actionRows: [buildBpRankProfileBackButtonRow(uid, locale)],
      extraFlags,
      locale,
    });
  }

  const balance = await getBalanceAfterPendingRaceRefunds(uid);
  const grandPoints = merged.reduce(
    (s, it) => s + Math.round(Number(it.points) || 0),
    0,
  );
  const grandYen = merged.reduce(
    (s, it) =>
      s +
      Math.round(Number(it.points) || 0) *
        Math.max(1, Math.round(Number(it.unitYen) || 100)),
    0,
  );

  const head = [
    t(
      'bp_rank.profile_detail.slip_readonly.title',
      { username: displayName },
      locale,
    ),
    '',
    t(
      'bp_rank.profile_detail.slip_readonly.balance',
      { amount: formatBpAmount(balance) },
      locale,
    ),
    t(
      'bp_rank.profile_detail.slip_readonly.totals',
      {
        points: formatBpAmount(grandPoints),
        yen: formatBpAmount(grandYen),
      },
      locale,
    ),
    '',
    t('bp_rank.profile_detail.slip_readonly.disclaimer', null, locale),
  ].join('\n');

  const itemBlocks = merged.map((it, idx) =>
    formatBetSlipItemBlock(it, idx, locale),
  );
  const body = itemBlocks.join('\n\n');
  const fullText = `${head}\n\n${body}`.slice(0, V2_TEXT_TOTAL_MAX);

  const container = new ContainerBuilder().setAccentColor(SLIP_VIEW_ACCENT);
  appendTextWithOverflowSplits(container, fullText);

  return {
    content: null,
    embeds: [],
    components: [container, buildBpRankProfileBackButtonRow(uid, locale)],
    flags: MessageFlags.IsComponentsV2 | extraFlags,
  };
}
