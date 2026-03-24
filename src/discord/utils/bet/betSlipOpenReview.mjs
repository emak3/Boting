import { MessageFlags } from 'discord.js';
import { getBetFlow, patchBetFlow } from './betFlowStore.mjs';
import {
  getSlipSavedItems,
  getSlipPendingReview,
  clearSlipSaved,
  clearSlipPending,
  restoreSlipSavedItems,
  setSlipPendingReview,
  SLIP_MAX_ITEMS,
} from './betSlipStore.mjs';
import { netkeibaOriginFromFlow } from '../netkeiba/netkeibaUrls.mjs';
import { deriveRaceHoldYmdFromFlow } from '../race/raceHoldDate.mjs';
import { buildPickCompactOneLine } from './betPurchaseEmbed.mjs';
import { buildSlipReviewV2Payload } from './betSlipReview.mjs';
import { buildTextAndRowsV2Payload } from '../race/raceCardDisplay.mjs';
import { buildRaceHubBackButtonRow } from '../race/raceCommandHub.mjs';
import { jraMultiEligibleLastMenu } from '../race/raceBetTickets.mjs';

/**
 * まとめて購入レビューを閉じ、開く前の購入予定リスト・進行中フローを復元する（メニューへ戻る用）
 */
export function abandonSlipReviewToSavedState(userId) {
  const pending = getSlipPendingReview(userId);
  if (!pending?.restore) {
    clearSlipPending(userId);
    return;
  }
  const { restore } = pending;
  clearSlipPending(userId);
  restoreSlipSavedItems(userId, restore.savedBackup ?? []);
  const rid = restore.raceId;
  if (restore.hadPurchase && restore.flowBackup && rid && /^\d{12}$/.test(String(rid))) {
    patchBetFlow(userId, rid, restore.flowBackup);
  }
}

/** 馬番 → 枠番（買い目表示の絵文字用） */
export function horseNumToFrameFromResult(result) {
  const o = {};
  for (const h of result?.horses || []) {
    const u = String(h.horseNumber ?? '').replace(/\D/g, '');
    if (!u) continue;
    o[u] = String(h.frameNumber ?? '');
  }
  return o;
}

/** 3連複フォーメーションの群（買い目表示用。絵文字のみの selectionLine でも使える） */
export function trifukuFormationSnapshotFromFlow(flow) {
  const formA = flow?.trifukuFormA;
  const formB = flow?.trifukuFormB;
  if (!Array.isArray(formA) || !Array.isArray(formB) || !formA.length || !formB.length) {
    return null;
  }
  const pid = flow?.purchase?.lastMenuCustomId;
  if (!pid || !String(pid).startsWith('race_bet_trifuku_formC|')) return null;
  const formC = flow?.stepSelections?.[pid];
  if (!Array.isArray(formC) || !formC.length) return null;
  return {
    a: formA.map(String),
    b: formB.map(String),
    c: formC.map(String),
  };
}

export function slipItemFromLiveFlow(flow, raceId) {
  const origin = netkeibaOriginFromFlow(flow);
  const rid = flow.result?.raceId || raceId;
  const lastMenuId = flow?.purchase?.lastMenuCustomId;
  const jraMultiOffered = !!(lastMenuId && jraMultiEligibleLastMenu(lastMenuId));
  return {
    id: `live_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    raceId: rid,
    unitYen: flow.unitYen ?? 100,
    points: flow.purchase.points,
    selectionLine: flow.purchase.selectionLine,
    raceTitle: flow.result?.raceInfo?.title,
    venueTitle: flow.venueTitle != null ? String(flow.venueTitle) : '',
    oddsOfficialTime: flow.result?.oddsOfficialTime,
    isResult: !!flow.result?.isResult,
    netkeibaOrigin: origin,
    raceInfoDate: flow.result?.raceInfo?.date ?? '',
    raceHoldYmd: deriveRaceHoldYmdFromFlow(flow, rid),
    betType: flow.betType ?? '',
    tickets: Array.isArray(flow.purchase?.tickets) ? flow.purchase.tickets : [],
    horseNumToFrame: horseNumToFrameFromResult(flow.result),
    trifukuFormation: trifukuFormationSnapshotFromFlow(flow),
    jraMulti: flow.jraMulti === true,
    jraMultiOffered,
    pickCompact: jraMultiOffered
      ? buildPickCompactOneLine(flow.purchase.selectionLine)
      : '',
  };
}

export function buildSlipReviewRestoreSnapshot({ flowOpt, saved, raceId }) {
  const savedBackup = saved.map((it) => ({ ...it }));
  const ridOk = raceId && /^\d{12}$/.test(String(raceId));
  const hadPurchase = !!(flowOpt?.purchase && ridOk);
  let flowBackup = null;
  if (hadPurchase) {
    flowBackup = {
      purchase: flowOpt.purchase ? { ...flowOpt.purchase } : null,
      purchaseSnapshot: flowOpt.purchaseSnapshot ? { ...flowOpt.purchaseSnapshot } : null,
      lastSelectionLine: flowOpt.lastSelectionLine ?? '',
      backMenuIds: [...(flowOpt.backMenuIds || [])],
      backMenuIndex: flowOpt.backMenuIndex,
      navViewMenuIndex: flowOpt.navViewMenuIndex,
      resumeBackFromSummary: flowOpt.resumeBackFromSummary,
      betType: flowOpt.betType,
      pairMode: flowOpt.pairMode,
      umatanMode: flowOpt.umatanMode,
      trifukuMode: flowOpt.trifukuMode,
      tritanMode: flowOpt.tritanMode,
      stepSelections: JSON.parse(JSON.stringify(flowOpt.stepSelections || {})),
      unitYen: flowOpt.unitYen,
      jraMulti: flowOpt.jraMulti === true,
    };
  }
  return {
    raceId: ridOk ? String(raceId) : null,
    savedBackup,
    hadPurchase,
    flowBackup,
  };
}

export function resetFlowAfterSlipAction(userId, raceId) {
  patchBetFlow(userId, raceId, {
    purchase: null,
    purchaseSnapshot: null,
    lastSelectionLine: '',
    backMenuIds: [],
    backMenuIndex: -1,
    navViewMenuIndex: null,
    resumeBackFromSummary: false,
    betType: null,
    pairMode: null,
    umatanMode: null,
    trifukuMode: null,
    tritanMode: null,
    stepSelections: {},
    jraMulti: false,
  });
}

/**
 * 追加済み + 今のサマリーがあればマージし、まとめて購入（仮）確認画面へ。
 * @returns {Promise<boolean>} 画面を開いたら true
 */
export async function runOpenBetSlipReviewScreen(interaction, { userId, raceId, extraFlags = 0 }) {
  const flowOpt =
    raceId && /^\d{12}$/.test(String(raceId)) ? getBetFlow(userId, raceId) : null;
  const saved = getSlipSavedItems(userId);
  const merged = [...saved];
  if (flowOpt?.purchase && raceId && /^\d{12}$/.test(String(raceId))) {
    merged.push(slipItemFromLiveFlow(flowOpt, raceId));
  }
  if (!merged.length) {
    await interaction.reply({
      content:
        '❌ 購入予定がありません。「購入予定に追加」で溜めるか、サマリーまで進めてください。',
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  if (merged.length > SLIP_MAX_ITEMS) {
    await interaction.reply({
      content: `❌ 一度にまとめられる購入予定は最大${SLIP_MAX_ITEMS}件です。`,
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  const restore = buildSlipReviewRestoreSnapshot({ flowOpt, saved, raceId });

  await interaction.deferUpdate();
  clearSlipSaved(userId);
  clearSlipPending(userId);
  const anchor =
    raceId && /^\d{12}$/.test(String(raceId))
      ? raceId
      : merged[0].raceId && /^\d{12}$/.test(String(merged[0].raceId))
        ? merged[0].raceId
        : '000000000000';
  if (!restore.raceId && /^\d{12}$/.test(String(anchor))) {
    restore.raceId = String(anchor);
  }
  setSlipPendingReview(userId, {
    items: merged,
    anchorRaceId: anchor,
    restore,
  });
  if (flowOpt?.purchase && raceId && /^\d{12}$/.test(String(raceId))) {
    resetFlowAfterSlipAction(userId, raceId);
  }

  await interaction.editReply(
    await buildSlipReviewV2Payload({ userId, extraFlags }),
  );
  return true;
}

/**
 * 既に deferReply 済みの interaction 用（/boting の「購入予定」など）。deferUpdate は呼ばない。
 * @returns {Promise<boolean>} 画面を開いたら true
 */
export async function editReplyOpenBetSlipReview(interaction, { userId, raceId, extraFlags = 0 }) {
  const flowOpt =
    raceId && /^\d{12}$/.test(String(raceId)) ? getBetFlow(userId, raceId) : null;
  const saved = getSlipSavedItems(userId);
  const merged = [...saved];
  if (flowOpt?.purchase && raceId && /^\d{12}$/.test(String(raceId))) {
    merged.push(slipItemFromLiveFlow(flowOpt, raceId));
  }
  if (!merged.length) {
    await interaction.editReply(
      buildTextAndRowsV2Payload({
        headline:
          '❌ 購入予定がありません。「購入予定に追加」で溜めるか、サマリーまで進めてください。',
        actionRows: [buildRaceHubBackButtonRow()],
        extraFlags,
      }),
    );
    return false;
  }
  if (merged.length > SLIP_MAX_ITEMS) {
    await interaction.editReply(
      buildTextAndRowsV2Payload({
        headline: `❌ 一度にまとめられる購入予定は最大${SLIP_MAX_ITEMS}件です。`,
        actionRows: [buildRaceHubBackButtonRow()],
        extraFlags,
      }),
    );
    return false;
  }

  const restore = buildSlipReviewRestoreSnapshot({ flowOpt, saved, raceId });

  clearSlipSaved(userId);
  clearSlipPending(userId);
  const anchor =
    raceId && /^\d{12}$/.test(String(raceId))
      ? raceId
      : merged[0].raceId && /^\d{12}$/.test(String(merged[0].raceId))
        ? merged[0].raceId
        : '000000000000';
  if (!restore.raceId && /^\d{12}$/.test(String(anchor))) {
    restore.raceId = String(anchor);
  }
  setSlipPendingReview(userId, {
    items: merged,
    anchorRaceId: anchor,
    restore,
  });
  if (flowOpt?.purchase && raceId && /^\d{12}$/.test(String(raceId))) {
    resetFlowAfterSlipAction(userId, raceId);
  }

  await interaction.editReply(
    await buildSlipReviewV2Payload({ userId, extraFlags }),
  );
  return true;
}
