import {
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { fetchAllUsersByBalanceDesc } from './bpLeaderboard.mjs';
import {
  fetchAllRaceBetAggregatesByUserId,
  emptyRaceBetAggregates,
} from './raceBetRecords.mjs';

/** `bp_rank_sel|{limit}` — セレクトの customId */
export const BP_RANK_SELECT_PREFIX = 'bp_rank_sel';

export const BP_RANK_MODE = {
  BALANCE: 'balance',
  RECOVERY: 'recovery',
  HIT_RATE: 'hit_rate',
  PURCHASE: 'purchase',
};

function pct(r) {
  if (r == null || !Number.isFinite(r)) return '—';
  return `${(r * 100).toFixed(2)}%`;
}

/**
 * @param {Array<{ userId: string, balance: number }>} balanceRows
 * @param {Map<string, object>} aggMap fetchAllRaceBetAggregatesByUserId の戻り
 */
function mergeLeaderboardRows(balanceRows, aggMap) {
  const balanceById = new Map(balanceRows.map((r) => [r.userId, r.balance]));
  const ids = new Set([...balanceById.keys(), ...aggMap.keys()]);
  const merged = [];
  for (const userId of ids) {
    merged.push({
      userId,
      balance: balanceById.get(userId) ?? 0,
      agg: aggMap.get(userId) ?? emptyRaceBetAggregates(),
    });
  }
  return merged;
}

/**
 * @param {string} mode
 * @param {ReturnType<typeof mergeLeaderboardRows>} merged
 */
function sortMergedForMode(mode, merged) {
  if (mode === BP_RANK_MODE.BALANCE) {
    merged.sort(
      (a, b) => b.balance - a.balance || a.userId.localeCompare(b.userId),
    );
    return;
  }
  if (mode === BP_RANK_MODE.RECOVERY) {
    merged.sort((a, b) => {
      const va =
        a.agg.totalRecoveryRate != null &&
        Number.isFinite(a.agg.totalRecoveryRate)
          ? a.agg.totalRecoveryRate
          : -1;
      const vb =
        b.agg.totalRecoveryRate != null &&
        Number.isFinite(b.agg.totalRecoveryRate)
          ? b.agg.totalRecoveryRate
          : -1;
      if (vb !== va) return vb - va;
      const pc = b.agg.purchaseCount - a.agg.purchaseCount;
      if (pc !== 0) return pc;
      return a.userId.localeCompare(b.userId);
    });
    return;
  }
  if (mode === BP_RANK_MODE.HIT_RATE) {
    merged.sort((a, b) => {
      const va =
        a.agg.purchaseCount > 0
          ? a.agg.hitCount / a.agg.purchaseCount
          : -1;
      const vb =
        b.agg.purchaseCount > 0
          ? b.agg.hitCount / b.agg.purchaseCount
          : -1;
      if (vb !== va) return vb - va;
      const pc = b.agg.purchaseCount - a.agg.purchaseCount;
      if (pc !== 0) return pc;
      return a.userId.localeCompare(b.userId);
    });
    return;
  }
  if (mode === BP_RANK_MODE.PURCHASE) {
    merged.sort((a, b) => {
      const pc = b.agg.purchaseCount - a.agg.purchaseCount;
      if (pc !== 0) return pc;
      const va =
        a.agg.totalRecoveryRate != null &&
        Number.isFinite(a.agg.totalRecoveryRate)
          ? a.agg.totalRecoveryRate
          : -1;
      const vb =
        b.agg.totalRecoveryRate != null &&
        Number.isFinite(b.agg.totalRecoveryRate)
          ? b.agg.totalRecoveryRate
          : -1;
      if (vb !== va) return vb - va;
      return a.userId.localeCompare(b.userId);
    });
  }
}

/**
 * @param {string} mode
 * @param {ReturnType<typeof mergeLeaderboardRows>[number]} row
 */
function formatLeaderboardLine(mode, row) {
  if (mode === BP_RANK_MODE.BALANCE) {
    return `<@${row.userId}> — **${row.balance}** bp`;
  }
  if (mode === BP_RANK_MODE.RECOVERY) {
    const rate =
      row.agg.totalRecoveryRate != null &&
      Number.isFinite(row.agg.totalRecoveryRate)
        ? pct(row.agg.totalRecoveryRate)
        : '精算なし';
    return `<@${row.userId}> — **${rate}** ・ 購入 **${row.agg.purchaseCount}** 件`;
  }
  if (mode === BP_RANK_MODE.HIT_RATE) {
    const hr =
      row.agg.purchaseCount > 0
        ? pct(row.agg.hitCount / row.agg.purchaseCount)
        : '—';
    return `<@${row.userId}> — **${hr}** ・ 購入 **${row.agg.purchaseCount}** 件`;
  }
  if (mode === BP_RANK_MODE.PURCHASE) {
    return `<@${row.userId}> — **${row.agg.purchaseCount}** 件`;
  }
  return `<@${row.userId}>`;
}

function titleForMode(mode) {
  if (mode === BP_RANK_MODE.BALANCE) return 'BP 残高';
  if (mode === BP_RANK_MODE.RECOVERY) return '回収率';
  if (mode === BP_RANK_MODE.HIT_RATE) return '的中率';
  if (mode === BP_RANK_MODE.PURCHASE) return '馬券購入件数';
  return 'ランキング';
}

function footerNoteForMode(mode) {
  if (mode === BP_RANK_MODE.RECOVERY) {
    return '回収率 = 精算済みの払戻 bp 合計 ÷ 購入bpの合計';
  }
  if (mode === BP_RANK_MODE.HIT_RATE) {
    return '的中率 = (的中件数 ÷ 購入件数) × 100';
  }
  if (mode === BP_RANK_MODE.PURCHASE) {
    return '購入件数 = 馬券購入件数数';
  }
  return '';
}

/**
 * @param {number} limit
 * @param {string} mode BP_RANK_MODE
 */
export async function buildBpRankLeaderboardEmbed(limit, mode) {
  const lim = Math.min(50, Math.max(1, limit));
  const m =
    mode === BP_RANK_MODE.RECOVERY ||
    mode === BP_RANK_MODE.HIT_RATE ||
    mode === BP_RANK_MODE.PURCHASE
      ? mode
      : BP_RANK_MODE.BALANCE;

  const [balanceRows, aggMap] = await Promise.all([
    fetchAllUsersByBalanceDesc(),
    fetchAllRaceBetAggregatesByUserId(),
  ]);

  const merged = mergeLeaderboardRows(balanceRows, aggMap);
  sortMergedForMode(m, merged);

  const slice = merged.slice(0, lim);
  const lines = slice.map((row, i) => {
    const medal =
      i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    return `${medal} ${formatLeaderboardLine(m, row)}`;
  });

  const body =
    lines.length > 0
      ? lines.join('\n')
      : 'まだ誰も BP データがありません。';

  const title = `${titleForMode(m)}ランキング（上位 ${slice.length} / 全 ${merged.length} 名）`;
  const note = footerNoteForMode(m);
  const description = note ? `${body}\n\n*${note}*` : body;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(0xf1c40f)
    .setDescription(description);

  return { embed, totalUsers: merged.length };
}

/**
 * @param {number} limit
 * @param {string} mode 現在選択中（default 表示用）
 */
export function buildBpRankSelectRow(limit, mode) {
  const lim = Math.min(50, Math.max(1, limit));
  const m =
    mode === BP_RANK_MODE.RECOVERY ||
    mode === BP_RANK_MODE.HIT_RATE ||
    mode === BP_RANK_MODE.PURCHASE
      ? mode
      : BP_RANK_MODE.BALANCE;

  const opts = [
    {
      value: BP_RANK_MODE.BALANCE,
      label: 'BP 残高',
      description: '現在の BP が多い順',
    },
    {
      value: BP_RANK_MODE.RECOVERY,
      label: '回収率',
      description: '現在の回収率が高い順',
    },
    {
      value: BP_RANK_MODE.HIT_RATE,
      label: '的中率',
      description: '現在の的中率が高い順',
    },
    {
      value: BP_RANK_MODE.PURCHASE,
      label: '購入件数',
      description: '現在の購入件数が多い順',
    },
  ];

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${BP_RANK_SELECT_PREFIX}|${lim}`)
    .setPlaceholder('ランキングの種類を選ぶ')
    .addOptions(
      opts.map((o) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(o.label)
          .setValue(o.value)
          .setDescription(o.description)
          .setDefault(o.value === m),
      ),
    );

  return new ActionRowBuilder().addComponents(menu);
}
