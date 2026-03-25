import { MessageFlags } from 'discord.js';
import {
  BOTING_HUB_PREFIX,
  buildBotingMenuBackRow,
  buildBotingPanelPayload,
  buildRaceScheduleIntroV2Payload,
} from '../../utils/race/raceCommandHub.mjs';
import {
  BP_RANK_DISPLAY_MAX,
  BP_RANK_MODE,
  buildBpRankLeaderboardFullPayload,
} from '../../utils/bp/bpRankLeaderboardEmbed.mjs';
import {
  BP_RANK_OPEN_LIM_PREFIX,
  buildBpRankLimitKeypadPayload,
} from '../../utils/bp/bpRankLimitKeypad.mjs';
import { setBpRankLimitDraft } from '../../utils/bp/bpRankLimitKeypadStore.mjs';
import {
  buildBotingLedgerViewPayload,
  BOTING_LEDGER_NAV_PREFIX,
  BOTING_LEDGER_OPEN_LIM_PREFIX,
} from '../../utils/boting/botingLedgerView.mjs';
import { buildBotingLedgerLimitKeypadPayload } from '../../utils/boting/botingLedgerKeypad.mjs';
import { setBotingLedgerLimitDraft } from '../../utils/boting/botingLedgerKeypadStore.mjs';
import { canBypassDailyCooldown } from '../../utils/debug/raceDebugBypass.mjs';
import { tryClaimDaily } from '../../utils/user/userPointsStore.mjs';
import { formatBpAmount } from '../../utils/bp/bpFormat.mjs';
import { runPendingRaceRefundsForUser } from '../../utils/race/raceBetRefundSweep.mjs';
import {
  buildBpRankUserDetailV2Container,
  buildBpRankUserSlipReadonlyV2Payload,
} from '../../utils/bp/bpRankUserDetailEmbed.mjs';
import {
  BP_RANK_USER_HISTORY_PREFIX,
  BP_RANK_USER_SLIP_PREFIX,
  BP_RANK_BACK_PROFILE_PREFIX,
  BP_RANK_BACK_LB_PREFIX,
  BP_RANK_LB_HIST_PREFIX,
  BP_RANK_LB_LEDG_PREFIX,
  BP_RANK_LB_ANNUAL_PREFIX,
  buildBpRankProfileButtonsRow,
  buildBpRankProfileBackButtonRow,
} from '../../utils/bp/bpRankUiButtons.mjs';
import { resolveLocaleFromInteraction, t } from '../../../i18n/index.mjs';
import { ledgerKindLabel } from '../../utils/boting/ledgerKindLabel.mjs';
import { buildRacePurchaseHistoryV2Payload } from '../../utils/race/racePurchaseHistoryUi.mjs';
import {
  abandonSlipReviewToSavedState,
  editReplyOpenBetSlipReview,
} from '../../utils/bet/betSlipOpenReview.mjs';
import { buildTextAndRowsV2Payload } from '../../utils/race/raceCardDisplay.mjs';
import { buildBotingHelpPanelPayload } from '../../utils/boting/botingHelpPanel.mjs';
import {
  buildAnnualStatsPanelPayload,
  buildWeeklyChallengePanelPayload,
} from '../../utils/boting/botingStatsPanels.mjs';
import { settleWeeklyChallengesForUser } from '../../utils/challenge/weeklyChallengeSettle.mjs';

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
    const locHist = resolveLocaleFromInteraction(interaction);
    if (!(await safeDeferUpdate(interaction))) return;
    try {
      const payload = await buildRacePurchaseHistoryV2Payload({
        userId: targetUserId,
        page: 0,
        extraFlags,
        bpRankProfileUserId: targetUserId,
        locale: locHist,
      });
      await interaction.editReply(payload);
    } catch (e) {
      console.error('raceHubButtons bp_rank history', e);
      await interaction
        .editReply(
          buildTextAndRowsV2Payload({
            headline: t('bp_rank.errors.profile_history_failed', { message: e.message }, locHist),
            actionRows: [buildBpRankProfileBackButtonRow(targetUserId, locHist)],
            extraFlags,
            locale: locHist,
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
    const locSlip = resolveLocaleFromInteraction(interaction);
    if (!(await safeDeferUpdate(interaction))) return;
    try {
      const targetUser = await interaction.client.users.fetch(targetUserId).catch(() => null);
      if (!targetUser) {
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline: t('bp_rank.errors.user_fetch_failed', null, locSlip),
            actionRows: [buildBpRankProfileBackButtonRow(targetUserId, locSlip)],
            extraFlags,
            locale: locSlip,
          }),
        );
        return;
      }
      const payload = await buildBpRankUserSlipReadonlyV2Payload({
        targetUser,
        targetUserId,
        extraFlags,
        locale: locSlip,
      });
      await interaction.editReply(payload);
    } catch (e) {
      console.error('raceHubButtons bp_rank slip', e);
      await interaction
        .editReply(
          buildTextAndRowsV2Payload({
            headline: t('bp_rank.errors.profile_slip_failed', { message: e.message }, locSlip),
            actionRows: [buildBpRankProfileBackButtonRow(targetUserId, locSlip)],
            extraFlags,
            locale: locSlip,
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
    const locProf = resolveLocaleFromInteraction(interaction);
    if (!(await safeDeferUpdate(interaction))) return;
    try {
      const targetUser = await interaction.client.users.fetch(targetUserId).catch(() => null);
      if (!targetUser) {
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline: t('bp_rank.errors.user_fetch_failed', null, locProf),
            actionRows: [],
            extraFlags,
            withBotingMenuBack: true,
            locale: locProf,
          }),
        );
        return;
      }
      const container = await buildBpRankUserDetailV2Container(
        targetUser,
        interaction.guild,
        interaction.user.id,
        locProf,
      );
      const row = buildBpRankProfileButtonsRow(targetUserId, locProf);
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
            headline: t('bp_rank.errors.profile_display_failed', { message: e.message }, locProf),
            actionRows: [buildBpRankProfileBackButtonRow(targetUserId, locProf)],
            extraFlags,
            locale: locProf,
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
    const locLb = resolveLocaleFromInteraction(interaction);
    if (!(await safeDeferUpdate(interaction))) return;
    try {
      await interaction.editReply(
        await buildBpRankLeaderboardFullPayload(lim, mode, extraFlags, {
          client: interaction.client,
          guild: interaction.guild,
          refundForUserId: interaction.user.id,
          locale: locLb,
        }),
      );
    } catch (e) {
      console.error('raceHubButtons bp_rank_back_lb', e);
      await interaction
        .editReply(
          buildTextAndRowsV2Payload({
            headline: t('bp_rank.errors.back_to_ranking_failed', { message: e.message }, locLb),
            actionRows: [],
            extraFlags,
            withBotingMenuBack: true,
            locale: locLb,
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
        locale: resolveLocaleFromInteraction(interaction),
      });
      await interaction.editReply(payload);
    } catch (e) {
      console.error('raceHubButtons bp_rank_lb_hist', e);
      const locH = resolveLocaleFromInteraction(interaction);
      await interaction
        .editReply(
          buildTextAndRowsV2Payload({
            headline: t('race_purchase_history.errors.fetch_failed', { message: e.message }, locH),
            actionRows: [],
            extraFlags,
            withBotingMenuBack: true,
            locale: locH,
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
    const locLedg = resolveLocaleFromInteraction(interaction);
    try {
      await runPendingRaceRefundsForUser(targetUserId);
      await interaction.editReply(
        await buildBotingLedgerViewPayload({
          userId: targetUserId,
          pageSize: 10,
          pageIndex: 0,
          extraFlags,
          rankLeaderboardReturn: { limit: lim, mode },
          locale: locLedg,
        }),
      );
    } catch (e) {
      console.error('raceHubButtons bp_rank_lb_ledg', e);
      await interaction
        .editReply(
          buildTextAndRowsV2Payload({
            headline: t('bp_rank.errors.ledger_display_failed', { message: e.message }, locLedg),
            actionRows: [],
            extraFlags,
            withBotingMenuBack: true,
            locale: locLedg,
          }),
        )
        .catch(() => {});
    }
    return;
  }

  if (id.startsWith(`${BP_RANK_LB_ANNUAL_PREFIX}|`)) {
    const parts = id.split('|');
    if (parts.length < 4) return;
    const lim = Math.min(BP_RANK_DISPLAY_MAX, Math.max(1, parseInt(parts[1], 10) || 20));
    const mode = normalizeBpRankMode(parts[2]);
    const targetUserId = parts[3];
    if (!/^\d{17,20}$/.test(String(targetUserId || ''))) return;
    const extraFlags = ephemeralExtraFromMessage(interaction.message);
    const locAnnual = resolveLocaleFromInteraction(interaction);
    if (!(await safeDeferUpdate(interaction))) return;
    try {
      await runPendingRaceRefundsForUser(targetUserId);
      await interaction.editReply(
        await buildAnnualStatsPanelPayload({
          userId: targetUserId,
          extraFlags,
          rankLeaderboardReturn: { limit: lim, mode },
          locale: locAnnual,
        }),
      );
    } catch (e) {
      console.error('raceHubButtons bp_rank_lb_annual', e);
      await interaction
        .editReply(
          buildTextAndRowsV2Payload({
            headline: t('bp_rank.errors.annual_stats_failed', { message: e.message }, locAnnual),
            actionRows: [],
            extraFlags,
            withBotingMenuBack: true,
            locale: locAnnual,
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
    const locKpad = resolveLocaleFromInteraction(interaction);
    if (!(await safeDeferUpdate(interaction))) return;
    setBpRankLimitDraft(interaction.user.id, {
      mode,
      savedLimit: lim,
      buffer: String(lim),
    });
    const kpad = buildBpRankLimitKeypadPayload({
      buffer: String(lim),
      extraFlags,
      locale: locKpad,
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
    const locNav = resolveLocaleFromInteraction(interaction);
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
        locale: locNav,
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

  const loc = resolveLocaleFromInteraction(interaction);

  try {
    if (part === 'back') {
      abandonSlipReviewToSavedState(userId);
      await interaction.editReply(
        await buildBotingPanelPayload({
          user: interaction.user,
          guild: interaction.guild,
          extraFlags,
          locale: loc,
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
            headline: t('boting_hub.errors.points_save_failed', { message: e.message }, loc),
            actionRows: [],
            extraFlags,
            withBotingMenuBack: true,
            locale: loc,
          }),
        );
        return;
      }
      if (!result.ok && result.reason === 'already_claimed') {
        const payload = await buildBotingPanelPayload({
          user: interaction.user,
          guild: interaction.guild,
          extraFlags,
          locale: loc,
        });
        await interaction.editReply(payload);
        return;
      }
      if (!result.ok) {
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline: t('boting_hub.errors.daily_claim_failed', null, loc),
            actionRows: [],
            extraFlags,
            withBotingMenuBack: true,
            locale: loc,
          }),
        );
        return;
      }
      const kindLine = ledgerKindLabel(result.kind, result.streakDay, loc);
      await interaction.editReply(
        await buildBotingPanelPayload({
          user: interaction.user,
          guild: interaction.guild,
          extraFlags,
          locale: loc,
          dailySuccessBanner: t(
            'boting_hub.daily_success_banner',
            {
              granted: formatBpAmount(result.granted),
              kind: kindLine,
              balance: formatBpAmount(result.balance),
            },
            loc,
          ),
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
            locale: loc,
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
          locale: loc,
        }),
      );
      return;
    }
    if (part === 'purchase') {
      await interaction.editReply(
        await buildRaceScheduleIntroV2Payload({ userId, extraFlags, locale: loc }),
      );
      return;
    }
    if (part === 'history') {
      const payload = await buildRacePurchaseHistoryV2Payload({
        userId,
        page: 0,
        extraFlags,
        locale: loc,
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
    if (part === 'help') {
      await interaction.editReply(
        buildBotingHelpPanelPayload({ extraFlags, region: 'overview', locale: loc }),
      );
      return;
    }
    if (part === 'annual_stats') {
      await runPendingRaceRefundsForUser(userId);
      await interaction.editReply(
        await buildAnnualStatsPanelPayload({ userId, extraFlags, locale: loc }),
      );
      return;
    }
    if (part === 'weekly_challenge') {
      await runPendingRaceRefundsForUser(userId);
      await interaction.editReply(
        await buildWeeklyChallengePanelPayload({ userId, extraFlags, locale: loc }),
      );
      return;
    }
    if (part === 'weekly_claim') {
      await runPendingRaceRefundsForUser(userId);
      const { grants } = await settleWeeklyChallengesForUser(userId);
      await interaction.editReply(
        await buildWeeklyChallengePanelPayload({
          userId,
          extraFlags,
          claimGrants: grants,
          locale: loc,
        }),
      );
      return;
    }
  } catch (e) {
    console.error('raceHubButtons', e);
    await interaction
      .editReply(
        buildTextAndRowsV2Payload({
          headline: t('bp_rank.errors.hub_display_failed', { message: e.message }, loc),
          actionRows: [buildBotingMenuBackRow({ locale: loc })],
          extraFlags,
          locale: loc,
        }),
      )
      .catch(() => {});
  }
}
