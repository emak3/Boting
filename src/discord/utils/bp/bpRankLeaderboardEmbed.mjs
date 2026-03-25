import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { BOTING_HUB_PREFIX } from '../boting/botingHubConstants.mjs';
import { botingEmoji } from '../boting/botingEmojis.mjs';
import {
  BP_RANK_OPEN_LIM_PREFIX,
  BP_RANK_DISPLAY_MAX,
} from './bpRankLimitKeypad.mjs';
import { fetchAllUsersByBalanceDesc } from './bpLeaderboard.mjs';
import {
  fetchAllRaceBetAggregatesByUserId,
  emptyRaceBetAggregates,
} from '../race/raceBetRecords.mjs';
import { runPendingRaceRefundsForUser } from '../race/raceBetRefundSweep.mjs';
import { mapWithConcurrency } from '../../../utils/concurrency/mapWithConcurrency.mjs';
import { formatBpAmount } from './bpFormat.mjs';

/** Discord REST のバーストを抑える（表示名解決の並列度） */
const BP_RANK_NAME_RESOLVE_CONCURRENCY = 5;
/** 表示中ランキング行ごとの未精算処理の並列度（netkeiba 負荷と応答時間のバランス） */
const BP_RANK_SLICE_SETTLE_CONCURRENCY = 3;

/** ランキング Container のアクセント（Embed の黄色に相当） */
const BP_RANK_ACCENT = 0xf1c40f;
const V2_TEXT_TOTAL_MAX = 3900;
const V2_SINGLE_CHUNK = 3500;

/** `bp_rank_sel|{limit}` — セレクトの customId */
export const BP_RANK_SELECT_PREFIX = 'bp_rank_sel';
export { BP_RANK_DISPLAY_MAX };
/** String Select の最大件数（表示件数上限＝Discord の 25 オプション上限） */
export const BP_RANK_SLICE_PICK_MAX = BP_RANK_DISPLAY_MAX;
/** `bp_rank_slice_pick|{limit}|{mode}` — 表示中ランキングの行から選ぶ（年間統計を開く） */
export const BP_RANK_SLICE_PICK_PREFIX = 'bp_rank_slice_pick';

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
 * Container / 太字向けに記号を弱める
 * @param {string} name
 */
function sanitizeBpRankDisplayName(name) {
  return String(name || '')
    .replace(/[\n\r`*_]/g, '')
    .trim()
    .slice(0, 80);
}

/**
 * サーバー表示名（ニックネーム）優先、なければユーザーの表示名
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Guild | null} guild
 * @param {string[]} userIds
 * @returns {Promise<Map<string, string>>}
 */
export async function resolveBpRankDisplayNames(client, guild, userIds) {
  const map = new Map();
  const uniq = [...new Set(userIds)].filter(
    (id) => id && /^\d{17,20}$/.test(String(id)),
  );
  await mapWithConcurrency(
    uniq,
    BP_RANK_NAME_RESOLVE_CONCURRENCY,
    async (id) => {
      try {
        if (guild) {
          const mem = await guild.members.fetch(id).catch(() => null);
          if (mem?.displayName) {
            map.set(id, mem.displayName);
            return;
          }
        }
        const u = await client.users.fetch(id).catch(() => null);
        if (u) {
          map.set(
            id,
            u.displayName ||
              u.globalName ||
              u.username ||
              `…${String(id).slice(-4)}`,
          );
          return;
        }
        map.set(id, `…${String(id).slice(-4)}`);
      } catch {
        map.set(id, `…${String(id).slice(-4)}`);
      }
    },
  );
  return map;
}

/**
 * @param {string} mode
 * @param {object} row
 * @param {Map<string, string>} [nameMap]
 */
function formatLeaderboardLine(mode, row, nameMap) {
  const dnRaw =
    nameMap instanceof Map ? nameMap.get(row.userId) : null;
  const dn = dnRaw ? sanitizeBpRankDisplayName(dnRaw) : null;
  const who = dn ? `**${dn}**` : `<@${row.userId}>`;
  if (mode === BP_RANK_MODE.BALANCE) {
    return `${who} — **${formatBpAmount(row.balance)}** bp`;
  }
  if (mode === BP_RANK_MODE.RECOVERY) {
    const rate =
      row.agg.totalRecoveryRate != null &&
      Number.isFinite(row.agg.totalRecoveryRate)
        ? pct(row.agg.totalRecoveryRate)
        : '精算なし';
    return `${who} — **${rate}** ・ 購入 **${row.agg.purchaseCount}** 件`;
  }
  if (mode === BP_RANK_MODE.HIT_RATE) {
    const hr =
      row.agg.purchaseCount > 0
        ? pct(row.agg.hitCount / row.agg.purchaseCount)
        : '—';
    return `${who} — **${hr}** ・ 購入 **${row.agg.purchaseCount}** 件`;
  }
  if (mode === BP_RANK_MODE.PURCHASE) {
    return `${who} — **${row.agg.purchaseCount}** 件`;
  }
  return `${who}`;
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
    return '購入件数 = 馬券購入件数';
  }
  return '';
}

/** @returns {string[]} */
function splitForTextDisplays(fullText) {
  const capped = fullText.slice(0, V2_TEXT_TOTAL_MAX);
  if (capped.length <= V2_SINGLE_CHUNK) return [capped];
  const out = [];
  let rest = capped;
  while (rest.length > 0) {
    if (rest.length <= V2_SINGLE_CHUNK) {
      out.push(rest);
      break;
    }
    let cut = rest.lastIndexOf('\n\n', V2_SINGLE_CHUNK);
    if (cut < V2_SINGLE_CHUNK / 2) cut = V2_SINGLE_CHUNK;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  return out;
}

/** @param {ContainerBuilder} container */
function appendChunkedToContainer(container, text) {
  const chunks = splitForTextDisplays(String(text || '').trimEnd()).filter((c) =>
    String(c).trim(),
  );
  for (let i = 0; i < chunks.length; i++) {
    container.addTextDisplayComponents((td) => td.setContent(chunks[i]));
    if (i < chunks.length - 1) {
      container.addSeparatorComponents((sep) =>
        sep.setSpacing(SeparatorSpacingSize.Small).setDivider(true),
      );
    }
  }
}

/**
 * ランキング集計を取り、本文・セレクトで共有する。
 * 表示件数ぶんの暫定上位ユーザーの未精算馬券を精算したあと、BP・集計を再取得してからスライスを確定する。
 * @param {number} limit
 * @param {string} mode BP_RANK_MODE
 * @param {{ refundForUserId?: string }} [opts] 操作者（上位にいなくても精算する）
 */
export async function loadBpRankLeaderboardState(limit, mode, opts = {}) {
  const lim = Math.min(BP_RANK_DISPLAY_MAX, Math.max(1, limit));
  const m =
    mode === BP_RANK_MODE.RECOVERY ||
    mode === BP_RANK_MODE.HIT_RATE ||
    mode === BP_RANK_MODE.PURCHASE
      ? mode
      : BP_RANK_MODE.BALANCE;

  const fetchMergedSlice = async () => {
    const [balanceRows, aggMap] = await Promise.all([
      fetchAllUsersByBalanceDesc(),
      fetchAllRaceBetAggregatesByUserId(),
    ]);
    const merged = mergeLeaderboardRows(balanceRows, aggMap);
    sortMergedForMode(m, merged);
    const slice = merged.slice(0, lim);
    return { merged, slice };
  };

  let { merged, slice } = await fetchMergedSlice();

  const toSettle = new Set(slice.map((r) => r.userId));
  const uid = opts.refundForUserId;
  if (uid && /^\d{17,20}$/.test(String(uid))) {
    toSettle.add(uid);
  }

  if (toSettle.size > 0) {
    await mapWithConcurrency(
      [...toSettle],
      BP_RANK_SLICE_SETTLE_CONCURRENCY,
      async (userId) => {
        await runPendingRaceRefundsForUser(userId);
      },
    );
    ({ merged, slice } = await fetchMergedSlice());
  }

  return { lim, m, merged, slice };
}

/**
 * @param {object[]} slice
 * @param {string} m BP_RANK_MODE
 * @param {object[]} merged
 * @param {number} lim
 * @param {Map<string, string>} [nameMap]
 */
function buildBpRankLeaderboardContainerFromSlice(
  slice,
  m,
  merged,
  lim,
  nameMap = new Map(),
) {
  const lines = slice.map((row, i) => {
    const medal =
      i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    return `${medal} ${formatLeaderboardLine(m, row, nameMap)}`;
  });

  const body =
    lines.length > 0
      ? lines.join('\n')
      : 'まだ誰も BP データがありません。';

  const heading = `## ${titleForMode(m)}ランキング（上位 ${slice.length} / 全 ${merged.length} 名）`;
  const note = footerNoteForMode(m);
  const fullText = note
    ? `${heading}\n\n${body}\n\n*${note}*`
    : `${heading}\n\n${body}`;

  const container = new ContainerBuilder().setAccentColor(BP_RANK_ACCENT);
  appendChunkedToContainer(container, fullText);
  return container;
}

/**
 * BP ランキング本文を Container（Display Components）で組み立てる
 * @param {number} limit
 * @param {string} mode BP_RANK_MODE
 * @param {{ client?: import('discord.js').Client, guild?: import('discord.js').Guild | null, refundForUserId?: string }} [rankContext]
 * @returns {Promise<import('discord.js').ContainerBuilder>}
 */
export async function buildBpRankLeaderboardContainer(limit, mode, rankContext) {
  const state = await loadBpRankLeaderboardState(limit, mode, {
    refundForUserId: rankContext?.refundForUserId,
  });
  let nameMap = new Map();
  if (rankContext?.client && state.slice.length) {
    nameMap = await resolveBpRankDisplayNames(
      rankContext.client,
      rankContext.guild ?? null,
      state.slice.map((r) => r.userId),
    );
  }
  return buildBpRankLeaderboardContainerFromSlice(
    state.slice,
    state.m,
    state.merged,
    state.lim,
    nameMap,
  );
}

/**
 * String Select 用（メンションなし・100文字以内）
 * @param {string} mode BP_RANK_MODE
 * @param {object} row
 * @param {number} rankIndex 0-based
 * @param {Map<string, string>} [nameMap]
 */
function formatLeaderboardPickLabel(mode, row, rankIndex, nameMap) {
  const medal =
    rankIndex === 0
      ? '🥇'
      : rankIndex === 1
        ? '🥈'
        : rankIndex === 2
          ? '🥉'
          : `${rankIndex + 1}.`;
  const dnRaw =
    nameMap instanceof Map ? nameMap.get(row.userId) : null;
  const dn = dnRaw
    ? sanitizeBpRankDisplayName(dnRaw).slice(0, 36)
    : `ID…${String(row.userId).slice(-4)}`;
  let core;
  if (mode === BP_RANK_MODE.BALANCE) {
    core = `${formatBpAmount(row.balance)} bp`;
  } else if (mode === BP_RANK_MODE.RECOVERY) {
    const rate =
      row.agg.totalRecoveryRate != null &&
      Number.isFinite(row.agg.totalRecoveryRate)
        ? pct(row.agg.totalRecoveryRate)
        : '精算なし';
    core = `${rate} ・${row.agg.purchaseCount}件`;
  } else if (mode === BP_RANK_MODE.HIT_RATE) {
    const hr =
      row.agg.purchaseCount > 0
        ? pct(row.agg.hitCount / row.agg.purchaseCount)
        : '—';
    core = `${hr} ・${row.agg.purchaseCount}件`;
  } else if (mode === BP_RANK_MODE.PURCHASE) {
    core = `${row.agg.purchaseCount}件`;
  } else {
    core = String(row.userId).slice(-8);
  }
  let label = `${medal} ${dn} · ${core}`;
  if (label.length > 100) label = `${label.slice(0, 97)}…`;
  return label;
}

/**
 * 表示中ランキングの行だけを候補にした String Select（最大 {@link BP_RANK_SLICE_PICK_MAX} 件）
 * @param {number} lim
 * @param {string} m BP_RANK_MODE
 * @param {object[]} slice
 * @param {Map<string, string>} [nameMap]
 * @returns {import('discord.js').ActionRowBuilder | null}
 */
export function buildBpRankSlicePickRow(lim, m, slice, nameMap = new Map()) {
  if (!slice.length) return null;
  const capped = slice.slice(0, BP_RANK_SLICE_PICK_MAX);
  const placeholder = '表示中ランキングから選ぶ';

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${BP_RANK_SLICE_PICK_PREFIX}|${lim}|${m}`)
    .setPlaceholder(placeholder.slice(0, 150))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      capped.map((row, i) => {
        const dn =
          nameMap instanceof Map && nameMap.get(row.userId)
            ? sanitizeBpRankDisplayName(nameMap.get(row.userId)).slice(0, 40)
            : null;
        return new StringSelectMenuOptionBuilder()
          .setLabel(formatLeaderboardPickLabel(m, row, i, nameMap))
          .setValue(row.userId)
          .setDescription(
            (dn ? `${dn} · ` : '') +
              `ID …${String(row.userId).slice(-6)}`.slice(0, 100),
          );
      }),
    );

  return new ActionRowBuilder().addComponents(menu);
}

/**
 * ランキング表示の完全ペイロード（Container + 種類セレクト + 表示中行の String Select + ボタン行、Embed なし）
 * @param {number} limit
 * @param {string} mode BP_RANK_MODE
 * @param {number} [extraFlags=0]
 * @param {{ client?: import('discord.js').Client, guild?: import('discord.js').Guild | null, refundForUserId?: string }} [rankContext]
 */
export async function buildBpRankLeaderboardFullPayload(
  limit,
  mode,
  extraFlags = 0,
  rankContext,
) {
  const { lim, m, merged, slice } = await loadBpRankLeaderboardState(
    limit,
    mode,
    { refundForUserId: rankContext?.refundForUserId },
  );
  let nameMap = new Map();
  if (rankContext?.client && slice.length) {
    nameMap = await resolveBpRankDisplayNames(
      rankContext.client,
      rankContext.guild ?? null,
      slice.map((r) => r.userId),
    );
  }
  const container = buildBpRankLeaderboardContainerFromSlice(
    slice,
    m,
    merged,
    lim,
    nameMap,
  );
  const pickRow = buildBpRankSlicePickRow(lim, m, slice, nameMap);
  return {
    content: null,
    embeds: [],
    components: [
      container,
      buildBpRankSelectRow(limit, mode),
      ...(pickRow ? [pickRow] : []),
      buildBpRankLeaderboardExtraRow(limit, mode),
    ],
    flags: MessageFlags.IsComponentsV2 | extraFlags,
  };
}

/**
 * @param {number} limit
 * @param {string} mode 現在選択中（default 表示用）
 */
export function buildBpRankSelectRow(limit, mode) {
  const lim = Math.min(BP_RANK_DISPLAY_MAX, Math.max(1, limit));
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

/**
 * ユーザー選択の下に並べる（表示件数テンキー・メニューへ戻る）
 * @param {number} limit
 * @param {string} mode BP_RANK_MODE
 */
export function buildBpRankLeaderboardExtraRow(limit, mode) {
  const lim = Math.min(BP_RANK_DISPLAY_MAX, Math.max(1, limit));
  const m =
    mode === BP_RANK_MODE.RECOVERY ||
    mode === BP_RANK_MODE.HIT_RATE ||
    mode === BP_RANK_MODE.PURCHASE ||
    mode === BP_RANK_MODE.BALANCE
      ? mode
      : BP_RANK_MODE.BALANCE;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BP_RANK_OPEN_LIM_PREFIX}|${lim}|${m}`)
      .setLabel('表示数を変える')
      .setEmoji(botingEmoji('hyouji'))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${BOTING_HUB_PREFIX}|back`)
      .setLabel('メニューに戻る')
      .setEmoji(botingEmoji('home'))
      .setStyle(ButtonStyle.Secondary),
  );
}

/**
 * @param {number} limit
 * @param {string} mode BP_RANK_MODE
 * @returns {import('discord.js').ActionRowBuilder[]}
 */
export function buildBpRankLeaderboardRows(limit, mode) {
  return [
    buildBpRankSelectRow(limit, mode),
    buildBpRankLeaderboardExtraRow(limit, mode),
  ];
}
