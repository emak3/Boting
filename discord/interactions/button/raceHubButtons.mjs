import { MessageFlags } from 'discord.js';
import {
  BOTING_HUB_PREFIX,
  buildRaceHubBackButtonRow,
  buildBotingPanelPayload,
  buildRaceScheduleIntroV2Payload,
} from '../../utils/raceCommandHub.mjs';
import {
  BP_RANK_DISPLAY_MAX,
  BP_RANK_MODE,
  buildBpRankLeaderboardFullPayload,
} from '../../utils/bpRankLeaderboardEmbed.mjs';
import {
  BP_RANK_OPEN_LIM_PREFIX,
  buildBpRankLimitKeypadPayload,
} from '../../utils/bpRankLimitKeypad.mjs';
import { setBpRankLimitDraft } from '../../utils/bpRankLimitKeypadStore.mjs';
import {
  buildBotingLedgerViewPayload,
  BOTING_LEDGER_NAV_PREFIX,
  BOTING_LEDGER_OPEN_LIM_PREFIX,
} from '../../utils/botingLedgerView.mjs';
import { buildBotingLedgerLimitKeypadPayload } from '../../utils/botingLedgerKeypad.mjs';
import { setBotingLedgerLimitDraft } from '../../utils/botingLedgerKeypadStore.mjs';
import { canBypassDailyCooldown } from '../../utils/raceDebugBypass.mjs';
import { kindLabelJa, tryClaimDaily } from '../../utils/userPointsStore.mjs';
import { runPendingRaceRefundsForUser } from '../../utils/raceBetRefundSweep.mjs';
import {
  buildBpRankUserDetailV2Container,
  buildBpRankUserSlipReadonlyV2Payload,
} from '../../utils/bpRankUserDetailEmbed.mjs';
import {
  BP_RANK_USER_HISTORY_PREFIX,
  BP_RANK_USER_SLIP_PREFIX,
  BP_RANK_BACK_PROFILE_PREFIX,
  BP_RANK_BACK_LB_PREFIX,
  BP_RANK_LB_HIST_PREFIX,
  BP_RANK_LB_LEDG_PREFIX,
  buildBpRankProfileButtonsRow,
  buildBpRankProfileBackButtonRow,
} from '../../utils/bpRankUiButtons.mjs';
import { buildRacePurchaseHistoryV2Payload } from '../../utils/racePurchaseHistoryUi.mjs';
import {
  abandonSlipReviewToSavedState,
  editReplyOpenBetSlipReview,
} from '../../utils/betSlipOpenReview.mjs';
import { buildTextAndRowsV2Payload } from '../../utils/raceCardDisplay.mjs';

function normalizeBpRankMode(mode) {
  const m = String(mode || '');
  if (
    m === BP_RANK_MODE.RECOVERY ||
    m === BP_RANK_MODE.HIT_RATE ||
    m === BP_RANK_MODE.PURCHASE
  ) {
    return m;
  }
  return BP_RANK_MODE.BALANCE;
}

/**
 * 二重クリック・既に応答済み・期限切れ (10062) で落ちないようにする。
 * @param {import('discord.js').ButtonInteraction} interaction
 * @returns {Promise<boolean>} この後 editReply / update してよいとき true
 */
async function safeDeferUpdate(interaction) {
  if (interaction.deferred || interaction.replied) return false;
  try {
    await interaction.deferUpdate();
    return true;
  } catch (e) {
    const code = e?.code ?? e?.rawError?.code;
    if (code === 10062) return false;
    throw e;
  }
}

function ephemeralExtraFromMessage(message) {
  let extra = 0;
  try {
    if (message?.flags?.has(MessageFlags.Ephemeral)) {
      extra |= MessageFlags.Ephemeral;
    }
  } catch (_) {
    /* ignore */
  }
  return extra;
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 */
export default async function raceHubButtons(interaction) {
  if (!interaction.isButton()) return;
  const id = interaction.customId;

  if (id.startsWith(`${BP_RANK_USER_HISTORY_PREFIX}|`)) {
    const targetUserId = id.split('|')[1];
    if (!/^\d{17,20}$/.test(String(targetUserId || ''))) return;
    const extraFlags = ephemeralExtraFromMessage(interaction.message);
    if (!(await safeDeferUpdate(interaction))) return;
    try {
      const payload = await buildRacePurchaseHistoryV2Payload({
        userId: targetUserId,
        page: 0,
        extraFlags,
        bpRankProfileUserId: targetUserId,
      });
      await interaction.editReply(payload);
    } catch (e) {
      console.error('raceHubButtons bp_rank history', e);
      await interaction
        .editReply(
          buildTextAndRowsV2Payload({
            headline: `❌ 購入履歴の表示に失敗しました: ${e.message}`,
            actionRows: [buildBpRankProfileBackButtonRow(targetUserId)],
            extraFlags,
          }),
        )
        .catch(() => {});
    }
    return;
  }

  if (id.startsWith(`${BP_RANK_USER_SLIP_PREFIX}|`)) {
    const targetUserId = id.split('|')[1];
    if (!/^\d{17,20}$/.test(String(targetUserId || ''))) return;
    const extraFlags = ephemeralExtraFromMessage(interaction.message);
    if (!(await safeDeferUpdate(interaction))) return;
    try {
      const targetUser = await interaction.client.users.fetch(targetUserId).catch(() => null);
      if (!targetUser) {
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline: '❌ ユーザーの取得に失敗しました。',
            actionRows: [buildBpRankProfileBackButtonRow(targetUserId)],
            extraFlags,
          }),
        );
        return;
      }
      const payload = await buildBpRankUserSlipReadonlyV2Payload({
        targetUser,
        targetUserId,
        extraFlags,
      });
      await interaction.editReply(payload);
    } catch (e) {
      console.error('raceHubButtons bp_rank slip', e);
      await interaction
        .editReply(
          buildTextAndRowsV2Payload({
            headline: `❌ 購入予定の表示に失敗しました: ${e.message}`,
            actionRows: [buildBpRankProfileBackButtonRow(targetUserId)],
            extraFlags,
          }),
        )
        .catch(() => {});
    }
    return;
  }

  if (id.startsWith(`${BP_RANK_BACK_PROFILE_PREFIX}|`)) {
    const targetUserId = id.split('|')[1];
    if (!/^\d{17,20}$/.test(String(targetUserId || ''))) return;
    const extraFlags = ephemeralExtraFromMessage(interaction.message);
    if (!(await safeDeferUpdate(interaction))) return;
    try {
      const targetUser = await interaction.client.users.fetch(targetUserId).catch(() => null);
      if (!targetUser) {
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline: '❌ ユーザーの取得に失敗しました。',
            actionRows: [],
            extraFlags,
            withBotingMenuBack: true,
          }),
        );
        return;
      }
      const container = await buildBpRankUserDetailV2Container(
        targetUser,
        interaction.guild,
        interaction.user.id,
      );
      const row = buildBpRankProfileButtonsRow(targetUserId);
      await interaction.editReply({
        content: null,
        embeds: [],
        components: [container, row],
        flags: MessageFlags.IsComponentsV2 | extraFlags,
      });
    } catch (e) {
      console.error('raceHubButtons bp_rank back profile', e);
      await interaction
        .editReply(
          buildTextAndRowsV2Payload({
            headline: `❌ 表示の更新に失敗しました: ${e.message}`,
            actionRows: [buildBpRankProfileBackButtonRow(targetUserId)],
            extraFlags,
          }),
        )
        .catch(() => {});
    }
    return;
  }

  if (id.startsWith(`${BP_RANK_BACK_LB_PREFIX}|`)) {
    const parts = id.split('|');
    const lim = Math.min(BP_RANK_DISPLAY_MAX, Math.max(1, parseInt(parts[1], 10) || 20));
    const mode = normalizeBpRankMode(parts[2]);
    const extraFlags = ephemeralExtraFromMessage(interaction.message);
    if (!(await safeDeferUpdate(interaction))) return;
    try {
      await interaction.editReply(
        await buildBpRankLeaderboardFullPayload(lim, mode, extraFlags, {
          client: interaction.client,
          guild: interaction.guild,
          refundForUserId: interaction.user.id,
        }),
      );
    } catch (e) {
      console.error('raceHubButtons bp_rank_back_lb', e);
      await interaction
        .editReply(
          buildTextAndRowsV2Payload({
            headline: `❌ ランキングに戻れませんでした: ${e.message}`,
            actionRows: [],
            extraFlags,
            withBotingMenuBack: true,
          }),
        )
        .catch(() => {});
    }
    return;
  }

  if (id.startsWith(`${BP_RANK_LB_HIST_PREFIX}|`)) {
    const parts = id.split('|');
    if (parts.length < 4) return;
    const lim = Math.min(BP_RANK_DISPLAY_MAX, Math.max(1, parseInt(parts[1], 10) || 20));
    const mode = normalizeBpRankMode(parts[2]);
    const targetUserId = parts[3];
    if (!/^\d{17,20}$/.test(String(targetUserId || ''))) return;
    const extraFlags = ephemeralExtraFromMessage(interaction.message);
    if (!(await safeDeferUpdate(interaction))) return;
    try {
      await runPendingRaceRefundsForUser(targetUserId);
      const payload = await buildRacePurchaseHistoryV2Payload({
        userId: targetUserId,
        page: 0,
        extraFlags,
        bpRankProfileUserId: targetUserId,
        rankLeaderboardReturn: { limit: lim, mode },
      });
      await interaction.editReply(payload);
    } catch (e) {
      console.error('raceHubButtons bp_rank_lb_hist', e);
      await interaction
        .editReply(
          buildTextAndRowsV2Payload({
            headline: `❌ 購入履歴の表示に失敗しました: ${e.message}`,
            actionRows: [],
            extraFlags,
            withBotingMenuBack: true,
          }),
        )
        .catch(() => {});
    }
    return;
  }

  if (id.startsWith(`${BP_RANK_LB_LEDG_PREFIX}|`)) {
    const parts = id.split('|');
    if (parts.length < 4) return;
    const lim = Math.min(BP_RANK_DISPLAY_MAX, Math.max(1, parseInt(parts[1], 10) || 20));
    const mode = normalizeBpRankMode(parts[2]);
    const targetUserId = parts[3];
    if (!/^\d{17,20}$/.test(String(targetUserId || ''))) return;
    const extraFlags = ephemeralExtraFromMessage(interaction.message);
    if (!(await safeDeferUpdate(interaction))) return;
    try {
      await runPendingRaceRefundsForUser(targetUserId);
      await interaction.editReply(
        await buildBotingLedgerViewPayload({
          userId: targetUserId,
          pageSize: 10,
          pageIndex: 0,
          extraFlags,
          rankLeaderboardReturn: { limit: lim, mode },
        }),
      );
    } catch (e) {
      console.error('raceHubButtons bp_rank_lb_ledg', e);
      await interaction
        .editReply(
          buildTextAndRowsV2Payload({
            headline: `❌ 収支の表示に失敗しました: ${e.message}`,
            actionRows: [],
            extraFlags,
            withBotingMenuBack: true,
          }),
        )
        .catch(() => {});
    }
    return;
  }

  if (id.startsWith(`${BP_RANK_OPEN_LIM_PREFIX}|`)) {
    const parts = id.split('|');
    const lim = Math.min(BP_RANK_DISPLAY_MAX, Math.max(1, parseInt(parts[1], 10) || 20));
    const rawMode = parts[2];
    const mode =
      rawMode === BP_RANK_MODE.RECOVERY ||
      rawMode === BP_RANK_MODE.HIT_RATE ||
      rawMode === BP_RANK_MODE.PURCHASE ||
      rawMode === BP_RANK_MODE.BALANCE
        ? rawMode
        : BP_RANK_MODE.BALANCE;
    const extraFlags = ephemeralExtraFromMessage(interaction.message);
    if (!(await safeDeferUpdate(interaction))) return;
    setBpRankLimitDraft(interaction.user.id, {
      mode,
      savedLimit: lim,
      buffer: String(lim),
    });
    const kpad = buildBpRankLimitKeypadPayload({
      buffer: String(lim),
      extraFlags,
    });
    await interaction.editReply({
      content: null,
      embeds: [],
      components: kpad.components,
      flags: kpad.flags,
    });
    return;
  }

  if (id.startsWith(`${BOTING_LEDGER_NAV_PREFIX}|`)) {
    const parts = id.split('|');
    const dir = parts[1];
    const ps = Math.min(50, Math.max(1, parseInt(parts[2], 10) || 10));
    const pi = Math.max(0, parseInt(parts[3], 10) || 0);
    const extraFlags = ephemeralExtraFromMessage(interaction.message);
    if (!(await safeDeferUpdate(interaction))) return;
    let ledgerUserId = interaction.user.id;
    let rankLeaderboardReturn = null;
    if (parts.length >= 8 && parts[5] === 'lb') {
      ledgerUserId = parts[4];
      rankLeaderboardReturn = {
        limit: Math.min(BP_RANK_DISPLAY_MAX, Math.max(1, parseInt(parts[6], 10) || 20)),
        mode: normalizeBpRankMode(parts[7]),
      };
    }
    let nextPi = pi;
    if (dir === 'prev') nextPi = pi - 1;
    else if (dir === 'next') nextPi = pi + 1;
    else return;
    await interaction.editReply(
      await buildBotingLedgerViewPayload({
        userId: ledgerUserId,
        pageSize: ps,
        pageIndex: nextPi,
        extraFlags,
        rankLeaderboardReturn,
      }),
    );
    return;
  }

  if (id.startsWith(`${BOTING_LEDGER_OPEN_LIM_PREFIX}|`)) {
    const parts = id.split('|');
    const ps = Math.min(50, Math.max(1, parseInt(parts[1], 10) || 10));
    const pi = Math.max(0, parseInt(parts[2], 10) || 0);
    const extraFlags = ephemeralExtraFromMessage(interaction.message);
    if (!(await safeDeferUpdate(interaction))) return;
    let ledgerUserId = interaction.user.id;
    let rankLeaderboardReturn = null;
    if (parts.length >= 7 && parts[4] === 'lb') {
      ledgerUserId = parts[3];
      rankLeaderboardReturn = {
        limit: Math.min(BP_RANK_DISPLAY_MAX, Math.max(1, parseInt(parts[5], 10) || 20)),
        mode: normalizeBpRankMode(parts[6]),
      };
    }
    setBotingLedgerLimitDraft(interaction.user.id, {
      savedPageSize: ps,
      savedPageIndex: pi,
      buffer: String(ps),
      ledgerSubjectUserId: ledgerUserId,
      rankLeaderboardReturn,
    });
    const kpad = buildBotingLedgerLimitKeypadPayload({
      buffer: String(ps),
      extraFlags,
    });
    await interaction.editReply({
      content: null,
      embeds: [],
      components: kpad.components,
      flags: kpad.flags,
    });
    return;
  }

  if (!id.startsWith(`${BOTING_HUB_PREFIX}|`)) return;

  const part = id.split('|')[1];
  const userId = interaction.user.id;
  const extraFlags = ephemeralExtraFromMessage(interaction.message);

  if (!(await safeDeferUpdate(interaction))) return;

  try {
    if (part === 'back') {
      abandonSlipReviewToSavedState(userId);
      await interaction.editReply(
        await buildBotingPanelPayload({
          user: interaction.user,
          guild: interaction.guild,
          extraFlags,
        }),
      );
      return;
    }
    if (part === 'daily') {
      await runPendingRaceRefundsForUser(userId);
      const debugBypass = canBypassDailyCooldown(userId);
      let result;
      try {
        result = await tryClaimDaily(userId, { debugBypass });
      } catch (e) {
        console.error('raceHubButtons tryClaimDaily:', e);
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline: `❌ ポイントの保存に失敗しました: ${e.message}`,
            actionRows: [],
            extraFlags,
            withBotingMenuBack: true,
          }),
        );
        return;
      }
      if (!result.ok && result.reason === 'already_claimed') {
        const payload = await buildBotingPanelPayload({
          user: interaction.user,
          guild: interaction.guild,
          extraFlags,
        });
        await interaction.editReply(payload);
        return;
      }
      if (!result.ok) {
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline: '❌ Daily の受け取りに失敗しました。',
            actionRows: [],
            extraFlags,
            withBotingMenuBack: true,
          }),
        );
        return;
      }
      const kindLine = kindLabelJa(result.kind, result.streakDay);
      await interaction.editReply(
        await buildBotingPanelPayload({
          user: interaction.user,
          guild: interaction.guild,
          extraFlags,
          dailySuccessBanner: `✅ **+${result.granted}** bp（${kindLine}）\n残高: **${result.balance}** bp`,
        }),
      );
      return;
    }
    if (part === 'rank') {
      await interaction.editReply(
        await buildBpRankLeaderboardFullPayload(
          20,
          BP_RANK_MODE.BALANCE,
          extraFlags,
          {
            client: interaction.client,
            guild: interaction.guild,
            refundForUserId: userId,
          },
        ),
      );
      return;
    }
    if (part === 'ledger') {
      await runPendingRaceRefundsForUser(userId);
      await interaction.editReply(
        await buildBotingLedgerViewPayload({
          userId,
          pageSize: 10,
          pageIndex: 0,
          extraFlags,
        }),
      );
      return;
    }
    if (part === 'purchase') {
      await interaction.editReply(
        await buildRaceScheduleIntroV2Payload({ userId, extraFlags }),
      );
      return;
    }
    if (part === 'history') {
      const payload = await buildRacePurchaseHistoryV2Payload({
        userId,
        page: 0,
        extraFlags,
      });
      await interaction.editReply(payload);
      return;
    }
    if (part === 'slip') {
      await editReplyOpenBetSlipReview(interaction, {
        userId,
        raceId: '000000000000',
        extraFlags,
      });
      return;
    }
  } catch (e) {
    console.error('raceHubButtons', e);
    await interaction
      .editReply(
        buildTextAndRowsV2Payload({
          headline: `❌ 表示の更新に失敗しました: ${e.message}`,
          actionRows: [buildRaceHubBackButtonRow()],
          extraFlags,
        }),
      )
      .catch(() => {});
  }
}
