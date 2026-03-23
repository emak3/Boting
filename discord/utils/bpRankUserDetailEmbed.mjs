import { ContainerBuilder, MessageFlags, SeparatorSpacingSize } from 'discord.js';
import { fetchFirstLedgerAt, getBalance } from './userPointsStore.mjs';
import { fetchUserRaceBetAggregates } from './raceBetRecords.mjs';
import {
  fetchAllUsersByBalanceDesc,
  computeBpRank,
} from './bpLeaderboard.mjs';
import { runPendingRaceRefundsForUser } from './raceBetRefundSweep.mjs';
import { getBetFlow } from './betFlowStore.mjs';
import { getSlipSavedItems, SLIP_MAX_ITEMS } from './betSlipStore.mjs';
import { slipItemFromLiveFlow } from './betSlipOpenReview.mjs';
import { formatBetSlipItemBlock } from './betPurchaseEmbed.mjs';
import { buildTextAndRowsV2Payload, V2_TEXT_TOTAL_MAX } from './raceCardDisplay.mjs';
import {
  BP_RANK_USER_HISTORY_PREFIX,
  BP_RANK_USER_SLIP_PREFIX,
  BP_RANK_BACK_PROFILE_PREFIX,
  buildBpRankProfileBackButtonRow,
  buildBpRankProfileButtonsRow,
} from './bpRankUiButtons.mjs';

export {
  BP_RANK_USER_HISTORY_PREFIX,
  BP_RANK_USER_SLIP_PREFIX,
  BP_RANK_BACK_PROFILE_PREFIX,
  buildBpRankProfileBackButtonRow,
  buildBpRankProfileButtonsRow,
};

const DETAIL_ACCENT = 0x5865f2;

function formatJst(d) {
  return d.toLocaleString('ja-JP', {
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
 */
export async function fetchBpRankUserDetailData(
  targetUser,
  guild,
  refundForUserId,
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
        guildJoinedLine = formatJst(member.joinedAt);
      }
    } catch {
      /* ignore */
    }
  }

  const rankLine =
    rank != null && totalUsers > 0
      ? `**${rank}** / ${totalUsers} 位（同率は同順位）`
      : '（ランキング対象外・データなし）';

  return {
    balance,
    rankLine,
    guildJoinedLine,
    firstUseText: firstUse ? formatJst(firstUse) : '—',
    agg,
  };
}

function formatBpRankUserDetailMarkdown(targetUser, d) {
  const { balance, rankLine, guildJoinedLine, firstUseText, agg } = d;
  return [
    `**BP 詳細 — ${targetUser.username}**`,
    '',
    `**現在の BP**　**${balance}** bp`,
    `**順位**　${rankLine}`,
    '',
    '**サーバー参加日**',
    guildJoinedLine,
    '',
    '**初回利用（台帳・購入の早い方）**',
    firstUseText,
    '',
    '**競馬購入**',
    `的中件数: **${agg.hitCount}** 件`,
    `購入件数: **${agg.purchaseCount}** 件`,
    `購入金額合計: **${agg.totalCostBp}** bp`,
    `1点あたり最大金額: **${agg.maxCostBp}** bp`,
    `精算済み件数: **${agg.settledCount}** 件`,
    `トータル回収率（精算済み合計）: **${pct(agg.totalRecoveryRate)}**（払戻 **${agg.totalRefundBpSettled}** bp / 購入 **${agg.totalCostBpSettled}** bp）`,
    `最大回収率（精算済み1件あたり）: **${pct(agg.maxRecoveryRate)}**`,
    `最低回収率（精算済み1件あたり）: **${pct(agg.minRecoveryRate)}**`,
    '',
    '*回収率 = 払戻 bp ÷ 購入 bp（未確定は集計に含めません）*',
  ].join('\n');
}

/**
 * 購入履歴など V2 画面から「メニューに戻る」で編集するため、IS_COMPONENTS_V2 を維持する。
 */
export async function buildBpRankUserDetailV2Container(
  targetUser,
  guild,
  refundForUserId,
) {
  const d = await fetchBpRankUserDetailData(targetUser, guild, refundForUserId);
  const container = new ContainerBuilder().setAccentColor(DETAIL_ACCENT);
  container.addTextDisplayComponents((td) =>
    td.setContent(formatBpRankUserDetailMarkdown(targetUser, d)),
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
}) {
  const uid = targetUserId || targetUser?.id;
  if (!uid || !/^\d{17,20}$/.test(String(uid))) {
    return buildTextAndRowsV2Payload({
      headline: '❌ ユーザーの指定が無効です。',
      actionRows: [],
      extraFlags,
    });
  }

  const { merged } = collectMergedSlipPreviewItems(uid);
  if (!merged.length) {
    return buildTextAndRowsV2Payload({
      headline: `❌ **${targetUser?.username ?? 'ユーザー'}** の購入予定はありません。`,
      actionRows: [buildBpRankProfileBackButtonRow(uid)],
      extraFlags,
    });
  }
  if (merged.length > SLIP_MAX_ITEMS) {
    return buildTextAndRowsV2Payload({
      headline: `❌ 購入予定が多すぎます（最大${SLIP_MAX_ITEMS}件）。`,
      actionRows: [buildBpRankProfileBackButtonRow(uid)],
      extraFlags,
    });
  }

  const balance = await getBalance(uid);
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
    `**${targetUser?.username ?? 'ユーザー'} の購入予定（閲覧のみ）**`,
    '',
    `対象の bp 残高 **${balance.toLocaleString('ja-JP')}** bp`,
    `合計 **${grandPoints.toLocaleString('ja-JP')}** 点　合計 **${grandYen.toLocaleString('ja-JP')}** bp（確定時の目安）`,
    '',
    '*他のユーザーの購入予定は閲覧のみです。編集・購入は /race から行えます。*',
  ].join('\n');

  const itemBlocks = merged.map((it, idx) => formatBetSlipItemBlock(it, idx));
  const body = itemBlocks.join('\n\n');
  const fullText = `${head}\n\n${body}`.slice(0, V2_TEXT_TOTAL_MAX);

  const container = new ContainerBuilder().setAccentColor(SLIP_VIEW_ACCENT);
  appendTextWithOverflowSplits(container, fullText);

  return {
    content: null,
    embeds: [],
    components: [container, buildBpRankProfileBackButtonRow(uid)],
    flags: MessageFlags.IsComponentsV2 | extraFlags,
  };
}
