import { getBetFlow, patchBetFlow } from './betFlowStore.mjs';
import {
  getSlipSavedItems,
  clearSlipSaved,
  clearSlipPending,
  setSlipPendingReview,
  SLIP_MAX_ITEMS,
} from './betSlipStore.mjs';
import { netkeibaOriginFromFlow } from './netkeibaUrls.mjs';
import { buildSlipReviewV2Payload } from './betSlipReview.mjs';

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
  return {
    id: `live_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    raceId: flow.result?.raceId || raceId,
    unitYen: flow.unitYen ?? 100,
    points: flow.purchase.points,
    selectionLine: flow.purchase.selectionLine,
    raceTitle: flow.result?.raceInfo?.title,
    oddsOfficialTime: flow.result?.oddsOfficialTime,
    isResult: !!flow.result?.isResult,
    netkeibaOrigin: origin,
    betType: flow.betType ?? '',
    tickets: Array.isArray(flow.purchase?.tickets) ? flow.purchase.tickets : [],
    horseNumToFrame: horseNumToFrameFromResult(flow.result),
    trifukuFormation: trifukuFormationSnapshotFromFlow(flow),
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
        '❌ 買い目がありません。「買い目に追加」で溜めるか、サマリーまで進めてください。',
      ephemeral: true,
    });
    return false;
  }
  if (merged.length > SLIP_MAX_ITEMS) {
    await interaction.reply({
      content: `❌ 一度にまとめられる買い目は最大${SLIP_MAX_ITEMS}件です。`,
      ephemeral: true,
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
