import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
} from 'discord.js';
import { getBetFlow, clearBetFlow, patchBetFlow } from '../../utils/bet/betFlowStore.mjs';
import { msgRaceBetFlowSessionInvalid } from '../../utils/bet/betFlowSessionCopy.mjs';
import {
  msgSlipBatchReviewSessionInvalid,
  msgSlipSavedMaxItemsExceeded,
} from '../../utils/bet/betSlipCopy.mjs';
import {
  addSlipSavedItem,
  clearSlipSaved,
  getSlipPendingReview,
  clearSlipPending,
  replaceSlipPendingItems,
  restoreSlipSavedItems,
  setSlipPendingReviewPage,
} from '../../utils/bet/betSlipStore.mjs';
import { canBypassSalesClosed } from '../../utils/debug/raceDebugBypass.mjs';
import { partitionPendingItemsBySalesClosed } from '../../utils/bet/betSlipSalesPartition.mjs';
import { buildSlipReviewV2Payload } from '../../utils/bet/betSlipReview.mjs';
import { netkeibaOriginFromFlow } from '../../utils/netkeiba/netkeibaUrls.mjs';
import {
  applyJraMultiMarkerToSelectionLine,
  buildBetSlipBatchV2Headline,
  buildPickCompactOneLine,
  stripJraMultiMarkerFromSelectionLine,
} from '../../utils/bet/betPurchaseEmbed.mjs';
import {
  horseNumToFrameFromResult,
  trifukuFormationSnapshotFromFlow,
  resetFlowAfterSlipAction,
  runOpenBetSlipReviewScreen,
} from '../../utils/bet/betSlipOpenReview.mjs';
import { buildRaceCardV2Payload, buildTextAndRowsV2Payload } from '../../utils/race/raceCardDisplay.mjs';
import { resolveLocaleFromInteraction, t } from '../../../i18n/index.mjs';
import { buildRacePurchaseHistoryV2Payload } from '../../utils/race/racePurchaseHistoryUi.mjs';
import {
  RACE_HISTORY_DAY_PREFIX,
  RACE_HISTORY_PAGE_PREFIX,
  stripRaceHistoryBpCtx,
} from '../../components/racePurchaseHistory/ids.mjs';
import { RACE_PURCHASE_HISTORY_CUSTOM_ID } from '../../utils/bet/betSlipViewUi.mjs';
import {
  selectHorseLabel,
  selectFrameLabel,
  wakuUmaEmojiResolvable,
} from '../../utils/race/raceNumberEmoji.mjs';
import {
  filterBetTypesForJraSale,
  frameAllowsWakurenSamePair,
} from '../../utils/jra/jraBetAvailability.mjs';
import { tryConfirmRacePurchase } from '../../utils/race/raceBetRecords.mjs';
import { deriveRaceHoldYmdFromFlow } from '../../utils/race/raceHoldDate.mjs';
import { getBalance } from '../../utils/user/userPointsStore.mjs';
import { formatBpAmount } from '../../utils/bp/bpFormat.mjs';
import {
  buildPayoutTicketsFromFlow,
  jraMultiEligibleLastMenu,
  ticketCountForValidation,
} from '../../utils/race/raceBetTickets.mjs';
import {
  buildUnitKeypadPayload,
  initBufferFromUnitYen,
  normalizeUnitYen100,
} from '../../utils/unit/unitYenKeypad.mjs';
import { setUnitKeypadDraft } from '../../utils/unit/unitYenKeypadStore.mjs';
import { buildBotingMenuBackRow } from '../../utils/race/raceCommandHub.mjs';
import { buildEphemeralWithBotingBackPayload } from '../../utils/boting/botingBackButton.mjs';
import { botingEmoji } from '../../utils/boting/botingEmojis.mjs';
import {
  betTypesLabeled,
  labeledModes,
  PAIR_MODE_IDS,
  UMATAN_MODE_IDS,
  TRIFUKU_MODE_IDS,
  TRITAN_MODE_IDS,
} from '../../utils/bet/betFlowLabels.mjs';

function safeParseRaceId(customId) {
  // race_bet_*|{raceId}（末尾セグメントが raceId）
  const parts = customId.split('|');
  return parts[parts.length - 1] || null;
}

function scheduleRaceListBackRow(raceId, locale) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`race_sched_back_to_race_list|${raceId}`)
      .setLabel(t('bet_flow.nav.to_race_list', null, locale))
      .setStyle(ButtonStyle.Secondary),
  );
}

function hasScheduleContext(flow) {
  if (!flow?.kaisaiDate || !flow?.kaisaiId) return false;
  if (flow.source === 'nar') return true;
  return !!flow.currentGroup;
}

function shouldShowForwardNav(flow) {
  const ids = flow?.backMenuIds;
  if (!ids?.length) return false;
  const vi = flow.navViewMenuIndex;
  if (vi == null || vi < 0) return false;
  if (vi < ids.length - 1) return true;
  return !!(vi === ids.length - 1 && flow.purchaseSnapshot);
}

/**
 * 戻る導線で1メニューだけ表示するときの UI（戻る・進むは同一行、レース一覧は別行）
 */
export async function renderBetFlowResumeView(interaction, { userId, raceId, flow, viewIndex, headline, locale: localeOpt = null }) {
  const loc = localeOpt ?? resolveLocaleFromInteraction(interaction);
  const backMenuIds = flow.backMenuIds || [];
  const betTypeMenuId = `race_bet_type|${raceId}`;
  const currentMenuCustomId = backMenuIds[viewIndex];
  const menuRow =
    currentMenuCustomId === betTypeMenuId
      ? buildBetTypeMenuRow(raceId, flow, loc)
      : buildMenuRowFromCustomId({
          menuCustomId: currentMenuCustomId,
          flow,
          result: flow.result,
          locale: loc,
        });
  const components = [];
  if (menuRow) components.push(menuRow);
  else components.push(buildBetTypeMenuRow(raceId, flow, loc));

  const nextIndex = viewIndex - 1;
  const showBack = viewIndex === 0 || nextIndex >= 0;
  const backBtn = new ButtonBuilder()
    .setCustomId(`race_bet_back|${raceId}`)
    .setLabel(t('bet_flow.nav.back', null, loc))
    .setEmoji(botingEmoji('modoru'))
    .setStyle(ButtonStyle.Secondary);
  const forwardBtn = shouldShowForwardNav(flow)
    ? new ButtonBuilder()
        .setCustomId(`race_bet_forward|${raceId}`)
        .setLabel(t('bet_flow.nav.forward', null, loc))
        .setEmoji(botingEmoji('susumu'))
        .setStyle(ButtonStyle.Success)
    : null;

  const navRowButtons = [];
  if (showBack) navRowButtons.push(backBtn);
  if (forwardBtn) navRowButtons.push(forwardBtn);
  if (navRowButtons.length) {
    components.push(new ActionRowBuilder().addComponents(...navRowButtons));
  }

  if (hasScheduleContext(flow)) {
    components.push(scheduleRaceListBackRow(raceId, loc));
  }

  const h = headline ?? t('bet_flow.resume_headline', null, loc);
  let extraCard = 0;
  try {
    if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
      extraCard |= MessageFlags.Ephemeral;
    }
  } catch (_) {
    /* ignore */
  }
  await interaction.editReply(
    buildRaceCardV2Payload({
      result: flow.result,
      headline: h,
      actionRows: components.filter(Boolean),
      extraFlags: extraCard,
      utilityContext: { userId, flow },
      locale: loc,
    }),
  );
}

export default async function betFlowButtons(interaction) {
  if (!interaction.isButton()) return;
  const customId = interaction.customId;
  const userId = interaction.user.id;
  const loc = resolveLocaleFromInteraction(interaction);

  function extraFlagsFromMessage() {
    let extra = 0;
    try {
      if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
        extra |= MessageFlags.Ephemeral;
      }
    } catch (_) {
      /* ignore */
    }
    return extra;
  }

  if (customId.startsWith('race_bet_jra_multi_toggle|')) {
    const raceId = customId.split('|')[1];
    if (!raceId || !/^\d{12}$/.test(String(raceId))) {
      await interaction.reply({
        content: t('bet_flow.errors.invalid_op', null, loc),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const flow = getBetFlow(userId, raceId);
    const lastId = flow?.purchase?.lastMenuCustomId;
    if (!flow?.purchase || !lastId || !jraMultiEligibleLastMenu(lastId)) {
      await interaction.reply({
        content: t('bet_flow.errors.jra_multi_here', null, loc),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferUpdate();
    const nextMulti = !(flow.jraMulti === true);
    const selNext = flow.purchase
      ? applyJraMultiMarkerToSelectionLine(
          stripJraMultiMarkerFromSelectionLine(flow.purchase.selectionLine),
          nextMulti,
        )
      : null;
    patchBetFlow(userId, raceId, {
      jraMulti: nextMulti,
      purchase: flow.purchase
        ? { ...flow.purchase, selectionLine: selNext }
        : null,
    });
    const flow2 = getBetFlow(userId, raceId);
    const tickets = buildPayoutTicketsFromFlow(flow2, raceId);
    patchBetFlow(userId, raceId, {
      purchase: flow2.purchase
        ? { ...flow2.purchase, points: tickets.length, tickets }
        : null,
    });
    const { editReplyPurchaseSummaryFromFlow } = await import('../menu/raceSchedule.mjs');
    await editReplyPurchaseSummaryFromFlow(interaction, userId, raceId);
    return;
  }

  if (customId.startsWith('race_bet_slip_back|')) {
    const parsedRaceId = safeParseRaceId(customId);
    const pending = getSlipPendingReview(userId);
    if (!pending?.restore) {
      await interaction.reply(
        buildEphemeralWithBotingBackPayload(
          t('bet_flow.errors.slip_back_invalid', null, loc),
          { locale: loc },
        ),
      );
      return;
    }
    if (String(pending.anchorRaceId) !== String(parsedRaceId)) {
      await interaction.reply(
        buildEphemeralWithBotingBackPayload(
          t('bet_flow.errors.slip_back_stale', null, loc),
          { locale: loc },
        ),
      );
      return;
    }
    const rid = pending.restore.raceId || parsedRaceId;
    if (!rid || !/^\d{12}$/.test(String(rid))) {
      await interaction.reply(
        buildEphemeralWithBotingBackPayload(
          t('bet_flow.errors.slip_back_failed', null, loc),
          { locale: loc },
        ),
      );
      return;
    }

    await interaction.deferUpdate();
    const { restore } = pending;
    clearSlipPending(userId);
    restoreSlipSavedItems(userId, restore.savedBackup ?? []);

    let extraFlags = 0;
    try {
      if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
        extraFlags |= MessageFlags.Ephemeral;
      }
    } catch (_) {
      /* ignore */
    }

    if (restore.hadPurchase && restore.flowBackup) {
      patchBetFlow(userId, rid, restore.flowBackup);
      const { editReplyPurchaseSummaryFromFlow } = await import('../menu/raceSchedule.mjs');
      await editReplyPurchaseSummaryFromFlow(interaction, userId, rid);
      return;
    }

    const flow = getBetFlow(userId, rid);
    if (!flow?.result) {
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline: msgRaceBetFlowSessionInvalid(loc),
          actionRows: [],
          extraFlags,
          withBotingMenuBack: true,
          locale: loc,
        }),
      );
      return;
    }

    const components = [buildBetTypeMenuRow(rid, flow, loc)];
    if (hasScheduleContext(flow)) {
      components.push(scheduleRaceListBackRow(rid, loc));
    }
    await interaction.editReply(
      buildRaceCardV2Payload({
        result: flow.result,
        headline: '',
        actionRows: components.filter(Boolean),
        extraFlags,
        utilityContext: { userId, flow },
        locale: loc,
      }),
    );
    return;
  }

  if (customId.startsWith(`${RACE_PURCHASE_HISTORY_CUSTOM_ID}|`)) {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });
    try {
      const loc = resolveLocaleFromInteraction(interaction);
      const payload = await buildRacePurchaseHistoryV2Payload({
        userId,
        page: 0,
        extraFlags: MessageFlags.Ephemeral,
        locale: loc,
      });
      await interaction.editReply(payload);
    } catch (e) {
      console.error('race_bet_purchase_history', e);
      const loc = resolveLocaleFromInteraction(interaction);
      await interaction.editReply({
        content: t('race_purchase_history.errors.fetch_failed', { message: e.message }, loc),
      });
    }
    return;
  }

  if (customId.startsWith(`${RACE_HISTORY_DAY_PREFIX}|`)) {
    const { withoutCtx, bpctxUserId, rankLeaderboardReturn } =
      stripRaceHistoryBpCtx(customId);
    const parts = withoutCtx.split('|');
    const pk = parts[1];
    const pg = parseInt(parts[2], 10);
    let meetingFilter = 'all';
    if (parts.length >= 4 && parts[3] !== undefined && parts[3] !== '') {
      meetingFilter = parts[3];
    }
    const subjectUserId = bpctxUserId || userId;
    if (
      meetingFilter !== 'all' &&
      !/^\d{10}$/.test(String(meetingFilter))
    ) {
      await interaction.reply({
        content: t(
          'race_purchase_history.errors.invalid_meeting',
          null,
          resolveLocaleFromInteraction(interaction),
        ),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!/^\d{8}$/.test(String(pk || '')) || !Number.isFinite(pg) || pg < 0) {
      await interaction.reply({
        content: t(
          'race_purchase_history.errors.invalid_date',
          null,
          resolveLocaleFromInteraction(interaction),
        ),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferUpdate();
    try {
      const loc = resolveLocaleFromInteraction(interaction);
      const payload = await buildRacePurchaseHistoryV2Payload({
        userId: subjectUserId,
        periodKey: pk,
        page: pg,
        meetingFilter,
        extraFlags: extraFlagsFromMessage(),
        bpRankProfileUserId: bpctxUserId || null,
        rankLeaderboardReturn: rankLeaderboardReturn || null,
        locale: loc,
      });
      await interaction.editReply(payload);
    } catch (e) {
      console.error('race_bet_history_day', e);
      await interaction.editReply({
        content: t(
          'race_purchase_history.errors.update_failed',
          { message: e.message },
          resolveLocaleFromInteraction(interaction),
        ),
      }).catch(() => {});
    }
    return;
  }

  if (customId.startsWith(`${RACE_HISTORY_PAGE_PREFIX}|`)) {
    const { withoutCtx, bpctxUserId, rankLeaderboardReturn } =
      stripRaceHistoryBpCtx(customId);
    const parts = withoutCtx.split('|');
    const pk = parts[1];
    const pg = parseInt(parts[2], 10);
    let meetingFilter = 'all';
    if (parts.length >= 4 && parts[3] !== undefined && parts[3] !== '') {
      meetingFilter = parts[3];
    }
    const subjectUserId = bpctxUserId || userId;
    if (
      meetingFilter !== 'all' &&
      !/^\d{10}$/.test(String(meetingFilter))
    ) {
      await interaction.reply({
        content: t(
          'race_purchase_history.errors.invalid_meeting',
          null,
          resolveLocaleFromInteraction(interaction),
        ),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!/^\d{8}$/.test(String(pk || '')) || !Number.isFinite(pg) || pg < 0) {
      await interaction.reply({
        content: t(
          'race_purchase_history.errors.invalid_page',
          null,
          resolveLocaleFromInteraction(interaction),
        ),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferUpdate();
    try {
      const loc = resolveLocaleFromInteraction(interaction);
      const payload = await buildRacePurchaseHistoryV2Payload({
        userId: subjectUserId,
        periodKey: pk,
        page: pg,
        meetingFilter,
        extraFlags: extraFlagsFromMessage(),
        bpRankProfileUserId: bpctxUserId || null,
        rankLeaderboardReturn: rankLeaderboardReturn || null,
        locale: loc,
      });
      await interaction.editReply(payload);
    } catch (e) {
      console.error('race_bet_history_pg', e);
      await interaction.editReply({
        content: t(
          'race_purchase_history.errors.update_failed',
          { message: e.message },
          resolveLocaleFromInteraction(interaction),
        ),
      }).catch(() => {});
    }
    return;
  }

  function slipReviewExtraFlags() {
    let extraFlags = 0;
    try {
      if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
        extraFlags |= MessageFlags.Ephemeral;
      }
    } catch (_) {
      /* ignore */
    }
    return extraFlags;
  }

  if (customId.startsWith('race_bet_slip_pg|')) {
    const parts = customId.split('|');
    const anchor = parts[1];
    const dir = parts[2];
    const pending = getSlipPendingReview(userId);
    if (!pending?.items?.length) {
      await interaction.reply(
        buildEphemeralWithBotingBackPayload(
          msgSlipBatchReviewSessionInvalid(loc),
          { locale: loc },
        ),
      );
      return;
    }
    if (!anchor || String(pending.anchorRaceId) !== String(anchor)) {
      await interaction.reply(
        buildEphemeralWithBotingBackPayload(
          t('bet_flow.errors.slip_back_stale', null, loc),
          { locale: loc },
        ),
      );
      return;
    }
    if (dir !== 'prev' && dir !== 'next') {
      await interaction.reply({
        content: t('bet_flow.errors.invalid_op', null, loc),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferUpdate();
    const cur = pending.reviewPage ?? 0;
    const next =
      dir === 'prev' ? Math.max(0, cur - 1) : cur + 1;
    setSlipPendingReviewPage(userId, next);
    await interaction.editReply(
      await buildSlipReviewV2Payload({
        userId,
        extraFlags: slipReviewExtraFlags(),
        locale: loc,
      }),
    );
    return;
  }

  if (customId.startsWith('race_bet_slip_remove_closed|')) {
    const anchor = safeParseRaceId(customId);
    const pending = getSlipPendingReview(userId);
    if (!pending?.items?.length) {
      await interaction.reply(
        buildEphemeralWithBotingBackPayload(
          msgSlipBatchReviewSessionInvalid(loc),
          { locale: loc },
        ),
      );
      return;
    }
    if (String(pending.anchorRaceId) !== String(anchor)) {
      await interaction.reply(
        buildEphemeralWithBotingBackPayload(
          t('bet_flow.errors.slip_back_stale', null, loc),
          { locale: loc },
        ),
      );
      return;
    }
    await interaction.deferUpdate();
    const extraFlags = slipReviewExtraFlags();
    const { closed, open } = await partitionPendingItemsBySalesClosed(userId, pending.items);
    if (!closed.length) {
      await interaction.editReply(
        await buildSlipReviewV2Payload({ userId, extraFlags, locale: loc }),
      );
      return;
    }
    if (!open.length) {
      clearSlipPending(userId);
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline: t('bet_flow.slip_confirm.all_closed_removed', null, loc),
          actionRows: [],
          extraFlags,
          withBotingMenuBack: true,
          locale: loc,
        }),
      );
      return;
    }
    replaceSlipPendingItems(userId, open);
    await interaction.editReply(
      await buildSlipReviewV2Payload({ userId, extraFlags, locale: loc }),
    );
    return;
  }

  if (customId.startsWith('race_bet_slip_dismiss_closed_warn|')) {
    const anchor = safeParseRaceId(customId);
    const pending = getSlipPendingReview(userId);
    if (!pending?.items?.length) {
      await interaction.reply(
        buildEphemeralWithBotingBackPayload(
          msgSlipBatchReviewSessionInvalid(loc),
          { locale: loc },
        ),
      );
      return;
    }
    if (String(pending.anchorRaceId) !== String(anchor)) {
      await interaction.reply(
        buildEphemeralWithBotingBackPayload(
          t('bet_flow.errors.slip_back_stale', null, loc),
          { locale: loc },
        ),
      );
      return;
    }
    await interaction.deferUpdate();
    await interaction.editReply(
      await buildSlipReviewV2Payload({
        userId,
        extraFlags: slipReviewExtraFlags(),
        locale: loc,
      }),
    );
    return;
  }

  if (customId.startsWith('race_bet_slip_confirm|')) {
    const raceId = safeParseRaceId(customId);
    const pending = getSlipPendingReview(userId);
    if (!pending?.items?.length) {
      await interaction.reply(
        buildEphemeralWithBotingBackPayload(
          msgSlipBatchReviewSessionInvalid(loc),
          { locale: loc },
        ),
      );
      return;
    }
    if (String(pending.anchorRaceId) !== String(raceId)) {
      await interaction.reply(
        buildEphemeralWithBotingBackPayload(
          t('bet_flow.errors.slip_back_stale', null, loc),
          { locale: loc },
        ),
      );
      return;
    }

    await interaction.deferUpdate();

    if (!canBypassSalesClosed(userId)) {
      const { closed } = await partitionPendingItemsBySalesClosed(userId, pending.items);
      if (closed.length > 0) {
        const extraFlags = slipReviewExtraFlags();
        const lines = closed.map((it, i) => {
          const title = String(
            it.raceTitle ||
              it.raceId ||
              t('bet_flow.slip_confirm.race_fallback', null, loc),
          ).slice(0, 120);
          const sel = String(
            it.selectionLine ||
              t('bet_flow.slip_confirm.unknown_pick', null, loc),
          ).slice(0, 240);
          return t(
            'bet_flow.slip_confirm.line_item',
            { i: i + 1, title, sel },
            loc,
          );
        });
        const headline = [
          t('bet_flow.slip_confirm.closed_warn_intro', null, loc),
          '',
          t('bet_flow.slip_confirm.closed_warn_mid', null, loc),
          '',
          ...lines,
          '',
          t('bet_flow.slip_confirm.closed_warn_footer', null, loc),
        ]
          .join('\n')
          .slice(0, 3900);

        const anchor = pending.anchorRaceId || raceId;
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`race_bet_slip_remove_closed|${anchor}`)
            .setLabel(t('bet_flow.slip_confirm.btn_remove_closed', null, loc))
            .setEmoji(botingEmoji('delete'))
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`race_bet_slip_dismiss_closed_warn|${anchor}`)
            .setLabel(t('bet_flow.slip_confirm.btn_back_review', null, loc))
            .setEmoji(botingEmoji('kakunin'))
            .setStyle(ButtonStyle.Secondary),
        );
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline,
            actionRows: [row],
            extraFlags,
            locale: loc,
          }),
        );
        return;
      }
    }

    for (const it of pending.items) {
      const p = Math.round(Number(it.points) || 0);
      const slipTickets = it.tickets;
      if (
        !Array.isArray(slipTickets) ||
        ticketCountForValidation(slipTickets) !== p ||
        p <= 0
      ) {
        const extraFlags = slipReviewExtraFlags();
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline: t('bet_flow.errors.no_tickets_data', null, loc),
            actionRows: [],
            extraFlags,
            withBotingMenuBack: true,
            locale: loc,
          }),
        );
        return;
      }
    }

    const totalBp = pending.items.reduce(
      (s, it) => s + Math.round(Number(it.points) || 0) * Math.max(1, Math.round(Number(it.unitYen) || 100)),
      0,
    );
    const bal = await getBalance(userId);
    if (bal < totalBp) {
      const extraFlags = slipReviewExtraFlags();
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline: t(
            'bet_flow.errors.bp_short_confirm',
            { need: formatBpAmount(totalBp), bal: formatBpAmount(bal) },
            loc,
          ),
          actionRows: [],
          extraFlags,
          withBotingMenuBack: true,
          locale: loc,
        }),
      );
      return;
    }

    let purchase;
    try {
      purchase = await tryConfirmRacePurchase(userId, pending.items);
    } catch (e) {
      console.error('tryConfirmRacePurchase', e);
      const extraFlags = slipReviewExtraFlags();
      const detail = e?.message != null ? String(e.message).slice(0, 400) : String(e);
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline: t('bet_flow.errors.db_save_failed', { detail }, loc),
          actionRows: [],
          extraFlags,
          withBotingMenuBack: true,
          locale: loc,
        }),
      );
      return;
    }
    if (!purchase.ok) {
      const extraFlags = slipReviewExtraFlags();
      let msg = t('bet_flow.errors.purchase_failed_generic', null, loc);
      if (purchase.reason === 'insufficient') {
        msg = t(
          'bet_flow.errors.purchase_bp_short',
          {
            need: formatBpAmount(purchase.need),
            bal: formatBpAmount(purchase.balance),
          },
          loc,
        );
      } else if (purchase.reason === 'bad_tickets') {
        msg = t('bet_flow.errors.purchase_bad_tickets', null, loc);
      } else if (purchase.reason === 'bad_race') {
        msg = t('bet_flow.errors.purchase_bad_race', null, loc);
      } else if (purchase.reason === 'bad_points') {
        msg = t('bet_flow.errors.purchase_bad_points', null, loc);
      } else if (purchase.reason === 'empty') {
        msg = t('bet_flow.errors.purchase_empty', null, loc);
      }
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline: msg,
          actionRows: [],
          extraFlags,
          withBotingMenuBack: true,
          locale: loc,
        }),
      );
      return;
    }

    const headline = [
      buildBetSlipBatchV2Headline({ items: pending.items, locale: loc }),
      '',
      t(
        'bet_flow.purchase_done.line1_suffix',
        {
          spent: formatBpAmount(purchase.spent),
          balance: formatBpAmount(purchase.balance),
        },
        loc,
      ),
      t('bet_flow.purchase_done.line2', null, loc),
    ].join('\n');
    const anchor = pending.anchorRaceId || raceId;
    clearSlipPending(userId);
    clearBetFlow(userId, anchor);
    const extraFlags = slipReviewExtraFlags();
    await interaction.editReply(
      buildTextAndRowsV2Payload({
        headline,
        actionRows: [buildBotingMenuBackRow({ locale: loc })],
        extraFlags,
        locale: loc,
      }),
    );
    return;
  }

  if (
    !customId.startsWith('race_bet_add_to_cart|') &&
    !customId.startsWith('race_bet_cart_checkout|') &&
    !customId.startsWith('race_bet_slip_open_review|') &&
    !customId.startsWith('race_bet_cart_clear|') &&
    !customId.startsWith('race_bet_unit_edit|') &&
    !customId.startsWith('race_bet_back|') &&
    !customId.startsWith('race_bet_forward|')
  )
    return;

  const raceId = safeParseRaceId(customId);

  if (
    customId.startsWith('race_bet_cart_checkout|') ||
    customId.startsWith('race_bet_slip_open_review|')
  ) {
    let extraFlags = 0;
    try {
      if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
        extraFlags |= MessageFlags.Ephemeral;
      }
    } catch (_) {
      /* ignore */
    }
    await runOpenBetSlipReviewScreen(interaction, { userId, raceId, extraFlags });
    return;
  }

  const flow = getBetFlow(userId, raceId);
  if (!flow) {
    await interaction.reply(
      buildEphemeralWithBotingBackPayload(
        msgRaceBetFlowSessionInvalid(loc),
        { locale: loc },
      ),
    );
    return;
  }

  if (customId.startsWith('race_bet_add_to_cart|')) {
    if (!flow.purchase) {
      await interaction.reply({
        content: t('bet_flow.errors.add_incomplete', null, loc),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const origin = netkeibaOriginFromFlow(flow);
    const tickets = flow.purchase?.tickets;
    const pts = flow.purchase?.points ?? 0;
    if (
      !Array.isArray(tickets) ||
      ticketCountForValidation(tickets) !== pts ||
      pts <= 0
    ) {
      await interaction.reply({
        content: t('bet_flow.errors.add_stale_data', null, loc),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const lastMenuId = flow.purchase?.lastMenuCustomId;
    const jraMultiOffered = !!(lastMenuId && jraMultiEligibleLastMenu(lastMenuId));
    const added = addSlipSavedItem(userId, {
      raceId: flow.result?.raceId || raceId,
      unitYen: normalizeUnitYen100(flow.unitYen ?? 100),
      points: flow.purchase.points,
      selectionLine: flow.purchase.selectionLine,
      raceTitle: flow.result?.raceInfo?.title,
      venueTitle: flow.venueTitle != null ? String(flow.venueTitle) : '',
      oddsOfficialTime: flow.result?.oddsOfficialTime,
      isResult: !!flow.result?.isResult,
      netkeibaOrigin: origin,
      raceInfoDate: flow.result?.raceInfo?.date ?? '',
      raceHoldYmd: deriveRaceHoldYmdFromFlow(flow, flow.result?.raceId || raceId),
      betType: flow.betType ?? '',
      tickets: flow.purchase.tickets,
      horseNumToFrame: horseNumToFrameFromResult(flow.result),
      trifukuFormation: trifukuFormationSnapshotFromFlow(flow),
      jraMulti: flow.jraMulti === true,
      jraMultiOffered,
      pickCompact: jraMultiOffered
        ? buildPickCompactOneLine(flow.purchase.selectionLine)
        : '',
    });
    if (!added.ok && added.reason === 'full') {
      await interaction.reply({
        content: msgSlipSavedMaxItemsExceeded(loc),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate();
    resetFlowAfterSlipAction(userId, raceId);

    const flowNext = getBetFlow(userId, raceId);
    const components = [buildBetTypeMenuRow(raceId, flowNext, loc)];
    if (hasScheduleContext(flowNext)) {
      components.push(scheduleRaceListBackRow(raceId, loc));
    }

    let extraFlags = 0;
    try {
      if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
        extraFlags |= MessageFlags.Ephemeral;
      }
    } catch (_) {
      /* ignore */
    }

    const head = t('bet_flow.add_to_cart_done', { count: added.count }, loc);
    await interaction.editReply(
      buildRaceCardV2Payload({
        result: flowNext.result,
        headline: head,
        actionRows: components.filter(Boolean),
        extraFlags,
        utilityContext: { userId, flow: flowNext },
        locale: loc,
      }),
    );
    return;
  }

  if (customId.startsWith('race_bet_cart_clear|')) {
    await interaction.deferUpdate();
    clearSlipSaved(userId);
    const { editReplyPurchaseSummaryFromFlow } = await import('../menu/raceSchedule.mjs');
    await editReplyPurchaseSummaryFromFlow(interaction, userId, raceId);
    return;
  }

  // 進む（戻り中に同じ選択のまま次へ / 最後は購入サマリーへ）
  if (customId.startsWith('race_bet_forward|')) {
    let flowFwd = getBetFlow(userId, raceId);
    if (!flowFwd) {
      await interaction.reply(
        buildEphemeralWithBotingBackPayload(
          msgRaceBetFlowSessionInvalid(loc),
          { locale: loc },
        ),
      );
      return;
    }
    const backMenuIds = flowFwd.backMenuIds || [];
    const vi = flowFwd.navViewMenuIndex;
    if (vi == null || !backMenuIds.length) {
      await interaction.reply({
        content: t('bet_flow.errors.forward_blocked', null, loc),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate();

    const lastLine = flowFwd.lastSelectionLine ?? '';

    if (vi < backMenuIds.length - 1) {
      const newVi = vi + 1;
      patchBetFlow(userId, raceId, {
        navViewMenuIndex: newVi,
        backMenuIndex: newVi - 1,
        resumeBackFromSummary: true,
      });
      flowFwd = getBetFlow(userId, raceId);
      await renderBetFlowResumeView(interaction, {
        userId,
        raceId,
        flow: flowFwd,
        viewIndex: newVi,
        headline: lastLine
          ? t('bet_flow.resume_with_pick', { line: lastLine }, loc)
          : t('bet_flow.resume_headline', null, loc),
        locale: loc,
      });
      return;
    }

    if (flowFwd.purchaseSnapshot) {
      patchBetFlow(userId, raceId, {
        purchase: { ...flowFwd.purchaseSnapshot },
        purchaseSnapshot: null,
        navViewMenuIndex: null,
        backMenuIndex: backMenuIds.length - 1,
        resumeBackFromSummary: false,
      });
      const { editReplyPurchaseSummaryFromFlow } = await import('../menu/raceSchedule.mjs');
      await editReplyPurchaseSummaryFromFlow(interaction, userId, raceId);
      return;
    }

    await renderBetFlowResumeView(interaction, {
      userId,
      raceId,
      flow: flowFwd,
      viewIndex: vi,
      headline: lastLine
        ? t('bet_flow.resume_with_pick', { line: lastLine }, loc)
        : t('bet_flow.resume_headline', null, loc),
      locale: loc,
    });
    return;
  }

  // 戻る（多段）
  if (customId.startsWith('race_bet_back|')) {
    await interaction.deferUpdate();

    const backMenuIds = flow.backMenuIds || [];
    const currentIndex =
      flow.backMenuIndex !== undefined && flow.backMenuIndex !== null
        ? flow.backMenuIndex
        : backMenuIds.length - 1;

    const lastLine = flow.purchase?.selectionLine ?? flow.lastSelectionLine ?? '';

    // 二重クリック・不整合で index がルートより前 — 賭け方へ（エラーにしない）
    if (currentIndex < 0 || !backMenuIds.length) {
      patchBetFlow(userId, raceId, {
        purchase: null,
        purchaseSnapshot: null,
        lastSelectionLine: lastLine,
        backMenuIndex: -1,
        resumeBackFromSummary: false,
        navViewMenuIndex: null,
      });
      const flowRoot = getBetFlow(userId, raceId);
      const components = [buildBetTypeMenuRow(raceId, flowRoot, loc)];
      if (hasScheduleContext(flowRoot)) {
        components.push(scheduleRaceListBackRow(raceId, loc));
      }
      let extraRoot = 0;
      try {
        if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
          extraRoot |= MessageFlags.Ephemeral;
        }
      } catch (_) {
        /* ignore */
      }
      await interaction.editReply(
        buildRaceCardV2Payload({
          result: flowRoot.result,
          headline: lastLine
            ? t('bet_flow.resume_with_pick', { line: lastLine }, loc)
            : t('bet_flow.resume_headline', null, loc),
          actionRows: components.filter(Boolean),
          extraFlags: extraRoot,
          utilityContext: { userId, flow: flowRoot },
          locale: loc,
        }),
      );
      return;
    }

    const atPurchase = !!flow.purchase;
    const resumeBackFromSummary = flow.resumeBackFromSummary === true;
    // 購入サマリーからの1回目、またはその直後の連鎖では「今の index のメニュー」を開く。
    // それ以外（通常にセレクトで進んだ画面）は 1 回の戻るで親（賭け方を含む）へ進む。
    let displayIndex;
    let nextIndex;
    if (atPurchase || resumeBackFromSummary) {
      displayIndex = currentIndex;
      nextIndex = currentIndex - 1;
    } else {
      displayIndex = currentIndex - 1;
      nextIndex = currentIndex - 2;
    }

    if (displayIndex < 0) {
      displayIndex = 0;
      nextIndex = -1;
    }
    if (displayIndex >= backMenuIds.length) {
      displayIndex = backMenuIds.length - 1;
      nextIndex = Math.min(nextIndex, displayIndex - 1);
    }

    let nextResume = resumeBackFromSummary;
    if (atPurchase) {
      nextResume = true;
    } else if (displayIndex === 0 && nextIndex < 0) {
      nextResume = false;
    }

    patchBetFlow(userId, raceId, {
      purchase: null,
      purchaseSnapshot:
        atPurchase && flow.purchase ? { ...flow.purchase } : flow.purchaseSnapshot ?? null,
      lastSelectionLine: lastLine,
      backMenuIndex: nextIndex,
      resumeBackFromSummary: nextResume,
      navViewMenuIndex: displayIndex,
    });

    const flowAfter = getBetFlow(userId, raceId);
    await renderBetFlowResumeView(interaction, {
      userId,
      raceId,
      flow: flowAfter,
      viewIndex: displayIndex,
      headline: lastLine
        ? t('bet_flow.resume_with_pick', { line: lastLine }, loc)
        : t('bet_flow.resume_headline', null, loc),
      locale: loc,
    });
    return;
  }

  // 単価編集（100 bp 単位テンキー）
  if (customId.startsWith('race_bet_unit_edit|')) {
    if (!flow.purchase) {
      await interaction.reply({
        content: t('bet_flow.errors.unit_edit_blocked', null, loc),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate();
    const buf = initBufferFromUnitYen(flow.unitYen ?? 100);
    setUnitKeypadDraft(userId, { raceId, kind: 'flow', buffer: buf });

    let extraFlags = 0;
    try {
      if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
        extraFlags |= MessageFlags.Ephemeral;
      }
    } catch (_) {
      /* ignore */
    }

    const lastMenuId = flow.purchase?.lastMenuCustomId;
    const jraMultiStrip =
      lastMenuId && jraMultiEligibleLastMenu(lastMenuId)
        ? { on: flow.jraMulti === true }
        : null;
    await interaction.editReply(
      buildUnitKeypadPayload({
        raceId,
        kind: 'flow',
        slipIdx: null,
        buffer: buf,
        subtitle: null,
        extraFlags,
        jraMultiStrip,
      }),
    );
  }
}

function defaultBetTypeIdFromFlow(raceId, flow) {
  if (!flow) return null;
  const fromSteps = flow.stepSelections?.[`race_bet_type|${raceId}`]?.[0];
  if (fromSteps) return String(fromSteps);
  if (flow.betType) return String(flow.betType);
  return null;
}

export function buildBetTypeMenuRow(raceId, flow = null, locale = null) {
  const selRaw = defaultBetTypeIdFromFlow(raceId, flow);
  const types = filterBetTypesForJraSale(betTypesLabeled(locale), {
    source: flow?.source,
    result: flow?.result,
  });
  const sel =
    selRaw != null && types.some((row) => row.id === String(selRaw))
      ? String(selRaw)
      : null;
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`race_bet_type|${raceId}`)
      .setPlaceholder(t('bet_flow.placeholders.choose_bet_style', null, locale))
      .addOptions(
        types.map((row) => {
          const o = new StringSelectMenuOptionBuilder()
            .setLabel(row.label)
            .setValue(row.id)
            .setDescription(t('bet_flow.descriptions.after_bet_type', null, locale));
          if (sel && row.id === sel) o.setDefault(true);
          return o;
        }),
      ),
  );
}

function modeOptionsList(modeDefs, selectedId, locale) {
  const sel = selectedId != null && selectedId !== '' ? String(selectedId) : null;
  return modeDefs.map((m) => {
    const o = new StringSelectMenuOptionBuilder()
      .setLabel(m.label)
      .setValue(m.id)
      .setDescription(t('bet_flow.descriptions.next_pick_horses', null, locale));
    if (sel && m.id === sel) o.setDefault(true);
    return o;
  });
}

function horseOptionsFromResult(result, selectedValues = [], cap = 25) {
  const selectedSet = new Set((selectedValues || []).map((v) => String(v)));
  const unique = new Map();
  for (const h of result.horses || []) {
    if (h.excluded) continue;
    unique.set(String(h.horseNumber), h);
  }
  const arr = Array.from(unique.entries())
    .map(([num, horse]) => ({ num, horse }))
    .sort((a, b) => Number(a.num) - Number(b.num))
    .slice(0, cap);
  return arr.map(({ num, horse }) => {
    const opt = new StringSelectMenuOptionBuilder()
      .setLabel(selectHorseLabel(horse, ''))
      .setValue(String(num))
      .setDescription(`${horse.jockey}`.slice(0, 70));
    const em = wakuUmaEmojiResolvable(horse.frameNumber, horse.horseNumber);
    if (em) opt.setEmoji({ id: em.id, name: em.name });
    if (selectedSet.has(String(num))) opt.setDefault(true);
    return opt;
  });
}

function frameOptionsFromResult(
  result,
  selectedValues = [],
  cap = 25,
  opts = {},
  locale = null,
) {
  const selectedSet = new Set((selectedValues || []).map((v) => String(v)));
  const omit = new Set((opts.omitFrames || []).map((x) => String(x)));
  const counts = new Map();
  const frameToHorses = new Map();
  for (const h of result.horses || []) {
    if (h.excluded) continue;
    const f = String(h.frameNumber);
    counts.set(f, (counts.get(f) || 0) + 1);
    if (!frameToHorses.has(f)) frameToHorses.set(f, []);
    frameToHorses.get(f).push(h);
  }
  const arr = Array.from(counts.entries())
    .map(([frame, count]) => ({ frame, count, horses: frameToHorses.get(frame) || [] }))
    .filter(({ frame }) => !omit.has(String(frame)))
    .sort((a, b) => Number(a.frame) - Number(b.frame))
    .slice(0, cap);
  return arr.map(({ frame, count, horses }) => {
    const ex = horses?.[0]?.name || '';
    const f = parseInt(String(frame).replace(/\D/g, ''), 10);
    const descRaw = ex
      ? t('bet_flow.frame_option.with_example', { count, name: ex }, locale)
      : t('bet_flow.frame_option.count_only', { count }, locale);
    const opt = new StringSelectMenuOptionBuilder()
      .setLabel(selectFrameLabel(frame, ''))
      .setValue(String(frame))
      .setDescription(descRaw.slice(0, 70));
    const em = Number.isFinite(f) ? wakuUmaEmojiResolvable(f, f) : null;
    if (em) opt.setEmoji({ id: em.id, name: em.name });
    if (selectedSet.has(String(frame))) opt.setDefault(true);
    return opt;
  });
}

export function buildMenuRowFromCustomId({ menuCustomId, flow, result, locale = null }) {
  const loc = locale;
  const ph = (key) => t(`bet_flow.placeholders.${key}`, null, loc);
  const parts = menuCustomId.split('|');
  const kind = parts[0];
  const raceId = parts[1];
  if (!raceId) return null;

  const stepSelections = flow.stepSelections || {};
  const selectedValues = stepSelections[menuCustomId] || [];

  // Pair / box / pick menus all depend on whether frame based
  const betTypeFromId = parts[2]; // for *_|raceId|betType
  const isFrame = betTypeFromId === 'frame_pair';

  // 枠連（通常）: 第1枠 / 第2枠
  if (
    kind === 'race_bet_frame_pair_normal_first' ||
    kind === 'race_bet_frame_pair_normal_second'
  ) {
    let frameOpts = {};
    if (kind === 'race_bet_frame_pair_normal_second') {
      const firstId = `race_bet_frame_pair_normal_first|${raceId}`;
      const first =
        flow.framePairNormalFirst != null
          ? String(flow.framePairNormalFirst)
          : (stepSelections[firstId]?.[0] ?? null);
      if (
        first != null &&
        !frameAllowsWakurenSamePair(result?.horses, first)
      ) {
        frameOpts = { omitFrames: [first] };
      }
    }
    const options = frameOptionsFromResult(result, selectedValues, 25, frameOpts, loc);
    const placeholder = kind.endsWith('first')
      ? ph('first_frame')
      : ph('second_frame');
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(placeholder)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_single_pick') {
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(ph('pick_one_horse'))
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(horseOptionsFromResult(result, selectedValues)),
    );
  }

  if (kind === 'race_bet_pair_mode') {
    const modeSel = selectedValues[0] ?? flow?.pairMode ?? null;
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(ph('vote_mode'))
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
          modeOptionsList(labeledModes(PAIR_MODE_IDS, 'pair_modes', loc), modeSel, loc),
        ),
    );
  }

  if (kind === 'race_bet_pair_normal') {
    const options = isFrame ? frameOptionsFromResult(result, selectedValues, 25, {}, loc) : horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(isFrame ? ph('frame_pick_two') : ph('horse_pick_two'))
        .setMinValues(1)
        .setMaxValues(2)
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_pair_nagashi_axis') {
    const options = isFrame ? frameOptionsFromResult(result, selectedValues, 25, {}, loc) : horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(isFrame ? ph('axis_frame') : ph('axis_horse'))
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_pair_nagashi_opponent') {
    const options = isFrame ? frameOptionsFromResult(result, selectedValues, 25, {}, loc) : horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(ph('opponents_multi'))
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_pair_box') {
    const options = isFrame ? frameOptionsFromResult(result, selectedValues, 25, {}, loc) : horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(isFrame ? ph('frame_pick') : ph('horse_pick'))
        .setMinValues(2)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_pair_formA') {
    const options = isFrame ? frameOptionsFromResult(result, selectedValues, 25, {}, loc) : horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(isFrame ? ph('form_a_frame') : ph('form_a_horse'))
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_pair_formB') {
    const options = isFrame ? frameOptionsFromResult(result, selectedValues, 25, {}, loc) : horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(isFrame ? ph('form_b_frame') : ph('form_b_horse'))
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_umatan_mode') {
    const modeSel = selectedValues[0] ?? flow?.umatanMode ?? null;
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(ph('vote_mode'))
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
          modeOptionsList(labeledModes(UMATAN_MODE_IDS, 'umatan_modes', loc), modeSel, loc),
        ),
    );
  }

  // 馬単の pick 系は全て馬番（フレーム基準ではない）
  if (kind === 'race_bet_umatan_normal_1' || kind === 'race_bet_umatan_normal_2') {
    const options = horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(kind.endsWith('_1') ? ph('umatan_place_1') : ph('umatan_place_2'))
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_umatan_nagashi1_axis' || kind === 'race_bet_umatan_nagashi2_axis' || kind === 'race_bet_umatan_nagashi3_axis') {
    const options = horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(ph('axis_one'))
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_umatan_nagashi1_opp' || kind === 'race_bet_umatan_nagashi2_opp') {
    const options = horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(ph('opponents_multi_short'))
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_umatan_box') {
    const options = horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(ph('horses_multi'))
        .setMinValues(2)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_umatan_formA' || kind === 'race_bet_umatan_formB') {
    const options = horseOptionsFromResult(result, selectedValues);
    const isA = kind.endsWith('formA');
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(isA ? ph('group_a_umatan') : ph('group_b_umatan'))
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  // 3連複
  if (kind === 'race_bet_trifuku_mode') {
    const modeSel = selectedValues[0] ?? flow?.trifukuMode ?? null;
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(ph('vote_mode'))
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
          modeOptionsList(labeledModes(TRIFUKU_MODE_IDS, 'trifuku_modes', loc), modeSel, loc),
        ),
    );
  }

  if (kind === 'race_bet_trifuku_normal') {
    const options = horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(ph('pick_three'))
        .setMinValues(3)
        .setMaxValues(3)
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_trifuku_n1_axis') {
    const options = horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(ph('axis_one'))
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_trifuku_n1_opp') {
    const options = horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(ph('opponents_multi_short'))
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_trifuku_n2_axis') {
    const options = horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(ph('axis_two'))
        .setMinValues(2)
        .setMaxValues(2)
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_trifuku_n2_opp') {
    const options = horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(ph('opponents_multi_short'))
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_trifuku_box') {
    const options = horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(ph('horses_multi_short'))
        .setMinValues(3)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_trifuku_formA' || kind === 'race_bet_trifuku_formB' || kind === 'race_bet_trifuku_formC') {
    const options = horseOptionsFromResult(result, selectedValues);
    const idx = kind.endsWith('formA')
      ? ph('form_group_1')
      : kind.endsWith('formB')
        ? ph('form_group_2')
        : ph('form_group_3');
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(idx)
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  // 3連単
  if (kind === 'race_bet_tritan_mode') {
    const modeSel = selectedValues[0] ?? flow?.tritanMode ?? null;
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(ph('vote_mode'))
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
          modeOptionsList(labeledModes(TRITAN_MODE_IDS, 'tritan_modes', loc), modeSel, loc),
        ),
    );
  }

  // tritan pick handlers (horses only)
  const tritanSingleKinds = [
    'race_bet_tritan_normal_1',
    'race_bet_tritan_normal_2',
    'race_bet_tritan_normal_3',
    'race_bet_tritan_nagashi1_axis',
    'race_bet_tritan_nagashi2_axis',
    'race_bet_tritan_nagashi3_axis',
    'race_bet_tritan_n12_a1',
    'race_bet_tritan_n12_a2',
    'race_bet_tritan_n13_a1',
    'race_bet_tritan_n13_a3',
    'race_bet_tritan_n23_a2',
    'race_bet_tritan_n23_a3',
  ];
  if (tritanSingleKinds.includes(kind)) {
    const options = horseOptionsFromResult(result, selectedValues);
    let placeholder = ph('axis_one');
    if (kind === 'race_bet_tritan_normal_1') placeholder = ph('tritan_place_1');
    else if (kind === 'race_bet_tritan_normal_2') placeholder = ph('tritan_place_2');
    else if (kind === 'race_bet_tritan_normal_3') placeholder = ph('tritan_place_3');
    else if (kind === 'race_bet_tritan_n12_a1') placeholder = ph('tritan_place_1');
    else if (kind === 'race_bet_tritan_n12_a2') placeholder = ph('tritan_place_2');
    else if (kind === 'race_bet_tritan_n13_a1') placeholder = ph('tritan_place_1');
    else if (kind === 'race_bet_tritan_n13_a3') placeholder = ph('tritan_place_3');
    else if (kind === 'race_bet_tritan_n23_a2') placeholder = ph('tritan_place_2');
    else if (kind === 'race_bet_tritan_n23_a3') placeholder = ph('tritan_place_3');
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(placeholder)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options),
    );
  }

  const tritanMultiKinds = [
    'race_bet_tritan_nagashi1_opp',
    'race_bet_tritan_nagashi2_opp',
    'race_bet_tritan_nagashi3_opp',
    'race_bet_tritan_n12_opp3',
    'race_bet_tritan_n13_opp2',
    'race_bet_tritan_n23_opp1',
    'race_bet_tritan_box',
  ];
  if (tritanMultiKinds.includes(kind)) {
    const options = horseOptionsFromResult(result, selectedValues);
    const isBox = kind === 'race_bet_tritan_box';
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(isBox ? ph('horses_multi_short') : ph('opponents_multi_short'))
        .setMinValues(isBox ? 3 : 1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_tritan_formA' || kind === 'race_bet_tritan_formB' || kind === 'race_bet_tritan_formC') {
    const options = horseOptionsFromResult(result, selectedValues);
    const idx = kind.endsWith('formA')
      ? ph('form_group_1_tritan')
      : kind.endsWith('formB')
        ? ph('form_group_2_tritan')
        : ph('form_group_3_tritan');
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(idx)
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  return null;
}

