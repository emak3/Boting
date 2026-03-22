import { ContainerBuilder } from 'discord.js';
import { fetchFirstLedgerAt } from './userPointsStore.mjs';
import { fetchUserRaceBetAggregates } from './raceBetRecords.mjs';
import {
  fetchAllUsersByBalanceDesc,
  computeBpRank,
} from './bpLeaderboard.mjs';
import { runPendingRaceRefundsForUser } from './raceBetRefundSweep.mjs';

/** `bp_rank_user_history|{discordUserId}` — 購入履歴ボタン用 */
export const BP_RANK_USER_HISTORY_PREFIX = 'bp_rank_user_history';

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
