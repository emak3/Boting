import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
} from 'discord.js';
import { getBetFlow, clearBetFlow, patchBetFlow } from '../../utils/betFlowStore.mjs';
import {
  addSlipSavedItem,
  clearSlipSaved,
  getSlipPendingReview,
  clearSlipPending,
  replaceSlipPendingItems,
  restoreSlipSavedItems,
  setSlipPendingReviewPage,
  SLIP_MAX_ITEMS,
} from '../../utils/betSlipStore.mjs';
import { canBypassSalesClosed } from '../../utils/raceDebugBypass.mjs';
import { partitionPendingItemsBySalesClosed } from '../../utils/betSlipSalesPartition.mjs';
import { buildSlipReviewV2Payload } from '../../utils/betSlipReview.mjs';
import { netkeibaOriginFromFlow } from '../../utils/netkeibaUrls.mjs';
import { buildBetSlipBatchV2Headline } from '../../utils/betPurchaseEmbed.mjs';
import {
  horseNumToFrameFromResult,
  trifukuFormationSnapshotFromFlow,
  resetFlowAfterSlipAction,
  runOpenBetSlipReviewScreen,
} from '../../utils/betSlipOpenReview.mjs';
import { buildRaceCardV2Payload, buildTextAndRowsV2Payload } from '../../utils/raceCardDisplay.mjs';
import {
  buildRacePurchaseHistoryV2Payload,
  RACE_HISTORY_DAY_PREFIX,
  RACE_HISTORY_PAGE_PREFIX,
  stripRaceHistoryBpCtx,
} from '../../utils/racePurchaseHistoryUi.mjs';
import { RACE_PURCHASE_HISTORY_CUSTOM_ID } from '../../utils/betSlipViewUi.mjs';
import {
  selectHorseLabel,
  selectFrameLabel,
  wakuUmaEmojiResolvable,
} from '../../utils/raceNumberEmoji.mjs';
import {
  filterBetTypesForJraSale,
  frameAllowsWakurenSamePair,
} from '../../utils/jraBetAvailability.mjs';
import { tryConfirmRacePurchase } from '../../utils/raceBetRecords.mjs';
import { deriveRaceHoldYmdFromFlow } from '../../utils/raceHoldDate.mjs';
import { getBalance } from '../../utils/userPointsStore.mjs';
import { ticketCountForValidation } from '../../utils/raceBetTickets.mjs';
import {
  buildUnitKeypadPayload,
  initBufferFromUnitYen,
  normalizeUnitYen100,
} from '../../utils/unitYenKeypad.mjs';
import { setUnitKeypadDraft } from '../../utils/unitYenKeypadStore.mjs';
import { buildRaceHubBackButtonRow } from '../../utils/raceCommandHub.mjs';
import { buildEphemeralWithBotingBackPayload } from '../../utils/botingBackButton.mjs';
import { botingEmoji } from '../../utils/botingEmojis.mjs';

const BET_TYPES = [
  { id: 'win', label: '単勝' },
  { id: 'place', label: '複勝' },
  { id: 'win_place', label: '単勝+複勝' },
  { id: 'frame_pair', label: '枠連' },
  { id: 'horse_pair', label: '馬連' },
  { id: 'wide', label: 'ワイド' },
  { id: 'umatan', label: '馬単' },
  { id: 'trifuku', label: '3連複' },
  { id: 'tritan', label: '3連単' },
];

const PAIR_MODE_OPTIONS = [
  { id: 'normal', label: '通常' },
  { id: 'nagashi', label: 'ながし' },
  { id: 'box', label: 'ボックス' },
  { id: 'formation', label: 'フォーメーション' },
];

const UMATAN_MODE_OPTIONS = [
  { id: 'normal', label: '通常' },
  { id: 'nagashi1', label: '1着ながし' },
  { id: 'nagashi2', label: '2着ながし' },
  { id: 'box', label: 'ボックス' },
  { id: 'formation', label: 'フォーメーション' },
];

const TRIFUKU_MODE_OPTIONS = [
  { id: 'normal', label: '通常' },
  { id: 'nagashi1', label: '軸1頭ながし' },
  { id: 'nagashi2', label: '軸2頭ながし' },
  { id: 'box', label: 'ボックス' },
  { id: 'formation', label: 'フォーメーション' },
];

const TRITAN_MODE_OPTIONS = [
  { id: 'normal', label: '通常' },
  { id: 'nagashi1', label: '1着ながし' },
  { id: 'nagashi2', label: '2着ながし' },
  { id: 'nagashi3', label: '3着ながし' },
  { id: 'nagashi12', label: '1・2着ながし' },
  { id: 'nagashi13', label: '1・3着ながし' },
  { id: 'nagashi23', label: '2・3着ながし' },
  { id: 'box', label: 'ボックス' },
  { id: 'formation', label: 'フォーメーション' },
];

function safeParseRaceId(customId) {
  // race_bet_*|{raceId}（末尾セグメントが raceId）
  const parts = customId.split('|');
  return parts[parts.length - 1] || null;
}

function scheduleRaceListBackRow(raceId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`race_sched_back_to_race_list|${raceId}`)
      .setLabel('レース一覧へ')
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
export async function renderBetFlowResumeView(interaction, { userId, raceId, flow, viewIndex, headline }) {
  const backMenuIds = flow.backMenuIds || [];
  const betTypeMenuId = `race_bet_type|${raceId}`;
  const currentMenuCustomId = backMenuIds[viewIndex];
  const menuRow =
    currentMenuCustomId === betTypeMenuId
      ? buildBetTypeMenuRow(raceId, flow)
      : buildMenuRowFromCustomId({
          menuCustomId: currentMenuCustomId,
          flow,
          result: flow.result,
        });
  const components = [];
  if (menuRow) components.push(menuRow);
  else components.push(buildBetTypeMenuRow(raceId, flow));

  const nextIndex = viewIndex - 1;
  const showBack = viewIndex === 0 || nextIndex >= 0;
  const backBtn = new ButtonBuilder()
    .setCustomId(`race_bet_back|${raceId}`)
    .setLabel('戻る')
    .setEmoji(botingEmoji('modoru'))
    .setStyle(ButtonStyle.Secondary);
  const forwardBtn = shouldShowForwardNav(flow)
    ? new ButtonBuilder()
        .setCustomId(`race_bet_forward|${raceId}`)
        .setLabel('進む')
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
    components.push(scheduleRaceListBackRow(raceId));
  }

  const h = headline ?? '購入前（戻り）';
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
    }),
  );
}

export default async function betFlowButtons(interaction) {
  if (!interaction.isButton()) return;
  const customId = interaction.customId;
  const userId = interaction.user.id;

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

  if (customId.startsWith('race_bet_slip_back|')) {
    const parsedRaceId = safeParseRaceId(customId);
    const pending = getSlipPendingReview(userId);
    if (!pending?.restore) {
      await interaction.reply(
        buildEphemeralWithBotingBackPayload(
          '❌ 戻れません。もう一度 /boting から開き直してください。',
        ),
      );
      return;
    }
    if (String(pending.anchorRaceId) !== String(parsedRaceId)) {
      await interaction.reply(
        buildEphemeralWithBotingBackPayload(
          '❌ このメッセージは古いです。もう一度開き直してください。',
        ),
      );
      return;
    }
    const rid = pending.restore.raceId || parsedRaceId;
    if (!rid || !/^\d{12}$/.test(String(rid))) {
      await interaction.reply(
        buildEphemeralWithBotingBackPayload('❌ 戻れません。'),
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
          headline: '❌ セッションが切れています。もう一度 /boting から開き直してください。',
          actionRows: [],
          extraFlags,
          withBotingMenuBack: true,
        }),
      );
      return;
    }

    const components = [buildBetTypeMenuRow(rid, flow)];
    if (hasScheduleContext(flow)) {
      components.push(scheduleRaceListBackRow(rid));
    }
    await interaction.editReply(
      buildRaceCardV2Payload({
        result: flow.result,
        headline: '',
        actionRows: components.filter(Boolean),
        extraFlags,
        utilityContext: { userId, flow },
      }),
    );
    return;
  }

  if (customId.startsWith(`${RACE_PURCHASE_HISTORY_CUSTOM_ID}|`)) {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });
    try {
      const payload = await buildRacePurchaseHistoryV2Payload({
        userId,
        page: 0,
        extraFlags: MessageFlags.Ephemeral,
      });
      await interaction.editReply(payload);
    } catch (e) {
      console.error('race_bet_purchase_history', e);
      await interaction.editReply({
        content: `❌ 購入履歴の取得に失敗しました: ${e.message}`,
      });
    }
    return;
  }

  if (customId.startsWith(`${RACE_HISTORY_DAY_PREFIX}|`)) {
    const { withoutCtx, bpctxUserId } = stripRaceHistoryBpCtx(customId);
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
        content: '❌ 開催の指定が無効です。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!/^\d{8}$/.test(String(pk || '')) || !Number.isFinite(pg) || pg < 0) {
      await interaction.reply({
        content: '❌ 日付の指定が無効です。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferUpdate();
    try {
      const payload = await buildRacePurchaseHistoryV2Payload({
        userId: subjectUserId,
        periodKey: pk,
        page: pg,
        meetingFilter,
        extraFlags: extraFlagsFromMessage(),
        bpRankProfileUserId: bpctxUserId || null,
      });
      await interaction.editReply(payload);
    } catch (e) {
      console.error('race_bet_history_day', e);
      await interaction.editReply({
        content: `❌ 表示の更新に失敗しました: ${e.message}`,
      }).catch(() => {});
    }
    return;
  }

  if (customId.startsWith(`${RACE_HISTORY_PAGE_PREFIX}|`)) {
    const { withoutCtx, bpctxUserId } = stripRaceHistoryBpCtx(customId);
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
        content: '❌ 開催の指定が無効です。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!/^\d{8}$/.test(String(pk || '')) || !Number.isFinite(pg) || pg < 0) {
      await interaction.reply({
        content: '❌ ページ指定が無効です。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferUpdate();
    try {
      const payload = await buildRacePurchaseHistoryV2Payload({
        userId: subjectUserId,
        periodKey: pk,
        page: pg,
        meetingFilter,
        extraFlags: extraFlagsFromMessage(),
        bpRankProfileUserId: bpctxUserId || null,
      });
      await interaction.editReply(payload);
    } catch (e) {
      console.error('race_bet_history_pg', e);
      await interaction.editReply({
        content: `❌ 表示の更新に失敗しました: ${e.message}`,
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
          '❌ 購入予定の確認セッションが無効です。',
        ),
      );
      return;
    }
    if (!anchor || String(pending.anchorRaceId) !== String(anchor)) {
      await interaction.reply(
        buildEphemeralWithBotingBackPayload(
          '❌ このメッセージは古いです。もう一度開き直してください。',
        ),
      );
      return;
    }
    if (dir !== 'prev' && dir !== 'next') {
      await interaction.reply({
        content: '❌ 操作が無効です。',
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
      await buildSlipReviewV2Payload({ userId, extraFlags: slipReviewExtraFlags() }),
    );
    return;
  }

  if (customId.startsWith('race_bet_slip_remove_closed|')) {
    const anchor = safeParseRaceId(customId);
    const pending = getSlipPendingReview(userId);
    if (!pending?.items?.length) {
      await interaction.reply(
        buildEphemeralWithBotingBackPayload(
          '❌ 購入予定の確認セッションが無効です。',
        ),
      );
      return;
    }
    if (String(pending.anchorRaceId) !== String(anchor)) {
      await interaction.reply(
        buildEphemeralWithBotingBackPayload(
          '❌ このメッセージは古いです。もう一度開き直してください。',
        ),
      );
      return;
    }
    await interaction.deferUpdate();
    const extraFlags = slipReviewExtraFlags();
    const { closed, open } = await partitionPendingItemsBySalesClosed(userId, pending.items);
    if (!closed.length) {
      await interaction.editReply(await buildSlipReviewV2Payload({ userId, extraFlags }));
      return;
    }
    if (!open.length) {
      clearSlipPending(userId);
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline:
            '✅ 表示されていた購入予定はすべて発売締切のため一覧から外しました。/boting から購入予定を追加し直せます。',
          actionRows: [],
          extraFlags,
          withBotingMenuBack: true,
        }),
      );
      return;
    }
    replaceSlipPendingItems(userId, open);
    await interaction.editReply(await buildSlipReviewV2Payload({ userId, extraFlags }));
    return;
  }

  if (customId.startsWith('race_bet_slip_dismiss_closed_warn|')) {
    const anchor = safeParseRaceId(customId);
    const pending = getSlipPendingReview(userId);
    if (!pending?.items?.length) {
      await interaction.reply(
        buildEphemeralWithBotingBackPayload(
          '❌ 購入予定の確認セッションが無効です。',
        ),
      );
      return;
    }
    if (String(pending.anchorRaceId) !== String(anchor)) {
      await interaction.reply(
        buildEphemeralWithBotingBackPayload(
          '❌ このメッセージは古いです。もう一度開き直してください。',
        ),
      );
      return;
    }
    await interaction.deferUpdate();
    await interaction.editReply(
      await buildSlipReviewV2Payload({ userId, extraFlags: slipReviewExtraFlags() }),
    );
    return;
  }

  if (customId.startsWith('race_bet_slip_confirm|')) {
    const raceId = safeParseRaceId(customId);
    const pending = getSlipPendingReview(userId);
    if (!pending?.items?.length) {
      await interaction.reply(
        buildEphemeralWithBotingBackPayload(
          '❌ 購入予定の確認セッションが無効です。',
        ),
      );
      return;
    }
    if (String(pending.anchorRaceId) !== String(raceId)) {
      await interaction.reply(
        buildEphemeralWithBotingBackPayload(
          '❌ このメッセージは古いです。もう一度開き直してください。',
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
          const title = String(it.raceTitle || it.raceId || 'レース').slice(0, 120);
          const sel = String(it.selectionLine || '(内容不明)').slice(0, 240);
          return `${i + 1}. **${title}**\n└ ${sel}`;
        });
        const headline = [
          '⚠️ **発売が締め切られている購入予定があるため、この内容では確定できません。**',
          '',
          '次の行は、発売終了・発走済み、または結果確定と判定されています。',
          '',
          ...lines,
          '',
          '**締切分のみ削除**でこれらだけを一覧から外します。残りがあれば、もう一度 **この内容で確定** を押してください。',
        ]
          .join('\n')
          .slice(0, 3900);

        const anchor = pending.anchorRaceId || raceId;
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`race_bet_slip_remove_closed|${anchor}`)
            .setLabel('締切分のみ削除')
            .setEmoji(botingEmoji('delete'))
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`race_bet_slip_dismiss_closed_warn|${anchor}`)
            .setLabel('確認画面に戻る')
            .setEmoji(botingEmoji('kakunin'))
            .setStyle(ButtonStyle.Secondary),
        );
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline,
            actionRows: [row],
            extraFlags,
          }),
        );
        return;
      }
    }

    for (const it of pending.items) {
      const p = Math.round(Number(it.points) || 0);
      const t = it.tickets;
      if (!Array.isArray(t) || ticketCountForValidation(t) !== p || p <= 0) {
        const extraFlags = slipReviewExtraFlags();
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline:
              '❌ 購入予定に **払戻用データ** がありません。出馬表から該当レースを開き直し、式別を選び直して **購入予定に追加** し直してください。',
            actionRows: [],
            extraFlags,
            withBotingMenuBack: true,
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
          headline: `❌ **bp が不足**しています（必要 **${totalBp}** bp / 残高 **${bal}** bp）。\n\`/boting\` の **Dailyをもらう** で受け取るか、購入予定を減らす・1点あたりの金額を下げてください。`,
          actionRows: [],
          extraFlags,
          withBotingMenuBack: true,
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
          headline: `❌ **データベースへの保存に失敗しました**（bp の減算・購入記録は行われていません）。ネットワークや Firebase の状態を確認し、しばらくしてから再度お試しください。\n\`${detail}\``,
          actionRows: [],
          extraFlags,
          withBotingMenuBack: true,
        }),
      );
      return;
    }
    if (!purchase.ok) {
      const extraFlags = slipReviewExtraFlags();
      let msg = '❌ 購入を完了できませんでした。';
      if (purchase.reason === 'insufficient') {
        msg = `❌ **bp が不足**しています（必要 **${purchase.need}** bp / 残高 **${purchase.balance}** bp）。`;
      } else if (purchase.reason === 'bad_tickets') {
        msg =
          '❌ 購入予定データが不正です。出馬表からやり直し、**購入予定に追加** し直してください。';
      } else if (purchase.reason === 'bad_race') {
        msg =
          '❌ レースIDの形式が不正です。出馬表から開き直し、**購入予定に追加** し直してください。';
      } else if (purchase.reason === 'bad_points') {
        msg = '❌ 点数が不正です。出馬表からやり直してください。';
      } else if (purchase.reason === 'empty') {
        msg = '❌ 購入対象がありません。';
      }
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline: msg,
          actionRows: [],
          extraFlags,
          withBotingMenuBack: true,
        }),
      );
      return;
    }

    const headline = [
      buildBetSlipBatchV2Headline({ items: pending.items }),
      '',
      `**購入完了** −**${purchase.spent}** bp（残高 **${purchase.balance}** bp）`,
      'レース結果が出たら `/boting` の馬券購入メニューや開催メニューで結果を表示すると、netkeiba の払戻に基づき bp が自動加算されます。',
    ].join('\n');
    const anchor = pending.anchorRaceId || raceId;
    clearSlipPending(userId);
    clearBetFlow(userId, anchor);
    const extraFlags = slipReviewExtraFlags();
    await interaction.editReply(
      buildTextAndRowsV2Payload({
        headline,
        actionRows: [buildRaceHubBackButtonRow()],
        extraFlags,
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
        '❌ セッションが無効です。もう一度 /boting から開始してください。',
      ),
    );
    return;
  }

  if (customId.startsWith('race_bet_add_to_cart|')) {
    if (!flow.purchase) {
      await interaction.reply({
        content: '❌ 追加できません（選択が完了していません）。',
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
        content:
          '❌ 購入予定データが古いか不完全です。出馬表から式別を選び直してから **購入予定に追加** してください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
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
    });
    if (!added.ok && added.reason === 'full') {
      await interaction.reply({
        content: `❌ 購入予定は最大${SLIP_MAX_ITEMS}件までです。**購入予定**で確認するか、追加済みを空にしてください。`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferUpdate();
    resetFlowAfterSlipAction(userId, raceId);

    const flowNext = getBetFlow(userId, raceId);
    const components = [buildBetTypeMenuRow(raceId, flowNext)];
    if (hasScheduleContext(flowNext)) {
      components.push(scheduleRaceListBackRow(raceId));
    }

    let extraFlags = 0;
    try {
      if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
        extraFlags |= MessageFlags.Ephemeral;
      }
    } catch (_) {
      /* ignore */
    }

    const head = `✅ 購入予定に追加しました（保存: **${added.count}**件）\n\n同じレースで別の式別を選ぶか、他レースから追加できます。**購入予定** ボタンで一覧・まとめて確認できます。`;
    await interaction.editReply(
      buildRaceCardV2Payload({
        result: flowNext.result,
        headline: head,
        actionRows: components.filter(Boolean),
        extraFlags,
        utilityContext: { userId, flow: flowNext },
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
          '❌ セッションが無効です。もう一度 /boting から試してください。',
        ),
      );
      return;
    }
    const backMenuIds = flowFwd.backMenuIds || [];
    const vi = flowFwd.navViewMenuIndex;
    if (vi == null || !backMenuIds.length) {
      await interaction.reply({
        content: '❌ ここからは進めません。',
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
        headline: lastLine ? `購入前（戻り）\n${lastLine}` : '購入前（戻り）',
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
      headline: lastLine ? `購入前（戻り）\n${lastLine}` : '購入前（戻り）',
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
      const components = [buildBetTypeMenuRow(raceId, flowRoot)];
      if (hasScheduleContext(flowRoot)) {
        components.push(scheduleRaceListBackRow(raceId));
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
          headline: lastLine ? `購入前（戻り）\n${lastLine}` : '購入前（戻り）',
          actionRows: components.filter(Boolean),
          extraFlags: extraRoot,
          utilityContext: { userId, flow: flowRoot },
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
      headline: lastLine ? `購入前（戻り）\n${lastLine}` : '購入前（戻り）',
    });
    return;
  }

  // 単価編集（100 bp 単位テンキー）
  if (customId.startsWith('race_bet_unit_edit|')) {
    if (!flow.purchase) {
      await interaction.reply({
        content: '❌ いまは金額を変えられません。式別と馬番の選択を完了してください。',
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

    await interaction.editReply(
      buildUnitKeypadPayload({
        raceId,
        kind: 'flow',
        slipIdx: null,
        buffer: buf,
        subtitle: null,
        extraFlags,
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

export function buildBetTypeMenuRow(raceId, flow = null) {
  const selRaw = defaultBetTypeIdFromFlow(raceId, flow);
  const types = filterBetTypesForJraSale(BET_TYPES, {
    source: flow?.source,
    result: flow?.result,
  });
  const sel =
    selRaw != null && types.some((t) => t.id === String(selRaw))
      ? String(selRaw)
      : null;
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`race_bet_type|${raceId}`)
      .setPlaceholder('賭ける方式を選択')
      .addOptions(
        types.map((t) => {
          const o = new StringSelectMenuOptionBuilder()
            .setLabel(t.label)
            .setValue(t.id)
            .setDescription('選択後に馬番/枠番を指定します');
          if (sel && t.id === sel) o.setDefault(true);
          return o;
        }),
      ),
  );
}

function modeOptionsList(modeDefs, selectedId) {
  const sel = selectedId != null && selectedId !== '' ? String(selectedId) : null;
  return modeDefs.map((m) => {
    const o = new StringSelectMenuOptionBuilder()
      .setLabel(m.label)
      .setValue(m.id)
      .setDescription('次で馬番/枠番を選びます');
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

function frameOptionsFromResult(result, selectedValues = [], cap = 25, opts = {}) {
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
    const opt = new StringSelectMenuOptionBuilder()
      .setLabel(selectFrameLabel(frame, ''))
      .setValue(String(frame))
      .setDescription(`${count}頭${ex ? `（例: ${ex}）` : ''}`.slice(0, 70));
    const em = Number.isFinite(f) ? wakuUmaEmojiResolvable(f, f) : null;
    if (em) opt.setEmoji({ id: em.id, name: em.name });
    if (selectedSet.has(String(frame))) opt.setDefault(true);
    return opt;
  });
}

export function buildMenuRowFromCustomId({ menuCustomId, flow, result }) {
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
    const options = frameOptionsFromResult(result, selectedValues, 25, frameOpts);
    const placeholder = kind.endsWith('first')
      ? '第1枠を選択'
      : '第2枠を選択';
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
        .setPlaceholder('馬番を1頭選択')
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
        .setPlaceholder('投票形式を選択')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(modeOptionsList(PAIR_MODE_OPTIONS, modeSel)),
    );
  }

  if (kind === 'race_bet_pair_normal') {
    const options = isFrame ? frameOptionsFromResult(result, selectedValues) : horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(isFrame ? '枠を選択（最大2）' : '馬番を選択（最大2）')
        .setMinValues(1)
        .setMaxValues(2)
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_pair_nagashi_axis') {
    const options = isFrame ? frameOptionsFromResult(result, selectedValues) : horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(isFrame ? '軸の枠を選択' : '軸の馬番を選択')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_pair_nagashi_opponent') {
    const options = isFrame ? frameOptionsFromResult(result, selectedValues) : horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder('相手を選択（複数可）')
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_pair_box') {
    const options = isFrame ? frameOptionsFromResult(result, selectedValues) : horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(isFrame ? '枠を選択' : '馬番を選択')
        .setMinValues(2)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_pair_formA') {
    const options = isFrame ? frameOptionsFromResult(result, selectedValues) : horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(isFrame ? '第1群枠を選択' : '第1群馬番を選択')
        .setMinValues(1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_pair_formB') {
    const options = isFrame ? frameOptionsFromResult(result, selectedValues) : horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(isFrame ? '第2群枠を選択' : '第2群馬番を選択')
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
        .setPlaceholder('投票形式を選択')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(modeOptionsList(UMATAN_MODE_OPTIONS, modeSel)),
    );
  }

  // 馬単の pick 系は全て馬番（フレーム基準ではない）
  if (kind === 'race_bet_umatan_normal_1' || kind === 'race_bet_umatan_normal_2') {
    const options = horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder(kind.endsWith('_1') ? '1着（1頭）' : '2着（1頭）')
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
        .setPlaceholder('軸（1頭）')
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
        .setPlaceholder('相手（複数可）')
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
        .setPlaceholder('馬番を選択（複数可）')
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
        .setPlaceholder(isA ? '第1群（1着）' : '第2群（2着）')
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
        .setPlaceholder('投票形式を選択')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(modeOptionsList(TRIFUKU_MODE_OPTIONS, modeSel)),
    );
  }

  if (kind === 'race_bet_trifuku_normal') {
    const options = horseOptionsFromResult(result, selectedValues);
    return new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(menuCustomId)
        .setPlaceholder('3頭を選択')
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
        .setPlaceholder('軸（1頭）')
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
        .setPlaceholder('相手（複数可）')
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
        .setPlaceholder('軸（2頭）')
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
        .setPlaceholder('相手（複数可）')
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
        .setPlaceholder('馬番（複数可）')
        .setMinValues(3)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_trifuku_formA' || kind === 'race_bet_trifuku_formB' || kind === 'race_bet_trifuku_formC') {
    const options = horseOptionsFromResult(result, selectedValues);
    const idx = kind.endsWith('formA') ? '第1群' : kind.endsWith('formB') ? '第2群' : '第3群';
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
        .setPlaceholder('投票形式を選択')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(modeOptionsList(TRITAN_MODE_OPTIONS, modeSel)),
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
    let placeholder = '軸（1頭）';
    if (kind === 'race_bet_tritan_normal_1') placeholder = '1着（1頭）';
    else if (kind === 'race_bet_tritan_normal_2') placeholder = '2着（1頭）';
    else if (kind === 'race_bet_tritan_normal_3') placeholder = '3着（1頭）';
    else if (kind === 'race_bet_tritan_n12_a1') placeholder = '1着（1頭）';
    else if (kind === 'race_bet_tritan_n12_a2') placeholder = '2着（1頭）';
    else if (kind === 'race_bet_tritan_n13_a1') placeholder = '1着（1頭）';
    else if (kind === 'race_bet_tritan_n13_a3') placeholder = '3着（1頭）';
    else if (kind === 'race_bet_tritan_n23_a2') placeholder = '2着（1頭）';
    else if (kind === 'race_bet_tritan_n23_a3') placeholder = '3着（1頭）';
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
        .setPlaceholder(isBox ? '馬番（複数可）' : '相手（複数可）')
        .setMinValues(isBox ? 3 : 1)
        .setMaxValues(Math.min(options.length, 25))
        .addOptions(options),
    );
  }

  if (kind === 'race_bet_tritan_formA' || kind === 'race_bet_tritan_formB' || kind === 'race_bet_tritan_formC') {
    const options = horseOptionsFromResult(result, selectedValues);
    const idx = kind.endsWith('formA') ? '第1群（1着候補）' : kind.endsWith('formB') ? '第2群（2着候補）' : '第3群（3着候補）';
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

