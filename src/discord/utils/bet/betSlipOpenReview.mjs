import { MessageFlags } from 'discord.js';
import { getBetFlow, patchBetFlow } from './betFlowStore.mjs';
import {
  MSG_SLIP_BATCH_REVIEW_OPEN_EMPTY,
  msgSlipSavedMaxItemsExceeded,
} from './betSlipCopy.mjs';
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

function raceId12(rid) {
  return rid && /^\d{12}$/.test(String(rid));
}

/**
 * 保存済み + 進行中フローをマージし、まとめて購入（仮）用の状態を組み立てる。
 * @returns {{ ok: true, merged: object[], restore: object, anchor: string, resetRaceId: string | null } | { ok: false, error: 'empty' | 'over_limit' }}
 */
function prepareBetSlipReviewMerge(userId, raceId) {
  const flowOpt = raceId12(raceId) ? getBetFlow(userId, raceId) : null;
  const saved = getSlipSavedItems(userId);
  const merged = [...saved];
  if (flowOpt?.purchase && raceId12(raceId)) {
    merged.push(slipItemFromLiveFlow(flowOpt, raceId));
  }
  if (!merged.length) return { ok: false, error: 'empty' };
  if (merged.length > SLIP_MAX_ITEMS) return { ok: false, error: 'over_limit' };
  const restore = buildSlipReviewRestoreSnapshot({ flowOpt, saved, raceId });
  const anchor = raceId12(raceId)
    ? raceId
    : merged[0].raceId && raceId12(merged[0].raceId)
      ? merged[0].raceId
      : '000000000000';
  if (!restore.raceId && raceId12(anchor)) {
    restore.raceId = String(anchor);
  }
  const resetRaceId =
    flowOpt?.purchase && raceId12(raceId) ? String(raceId) : null;
  return {
    ok: true,
    merged,
    restore,
    anchor,
    resetRaceId,
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
  const prep = prepareBetSlipReviewMerge(userId, raceId);
  if (!prep.ok) {
    await interaction.reply({
      content:
        prep.error === 'empty'
          ? MSG_SLIP_BATCH_REVIEW_OPEN_EMPTY
          : msgSlipSavedMaxItemsExceeded(),
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  await interaction.deferUpdate();
  clearSlipSaved(userId);
  clearSlipPending(userId);
  setSlipPendingReview(userId, {
    items: prep.merged,
    anchorRaceId: prep.anchor,
    restore: prep.restore,
  });
  if (prep.resetRaceId) {
    resetFlowAfterSlipAction(userId, prep.resetRaceId);
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
  const prep = prepareBetSlipReviewMerge(userId, raceId);
  if (!prep.ok) {
    await interaction.editReply(
      buildTextAndRowsV2Payload({
        headline:
          prep.error === 'empty'
            ? MSG_SLIP_BATCH_REVIEW_OPEN_EMPTY
            : msgSlipSavedMaxItemsExceeded(),
        actionRows: [buildRaceHubBackButtonRow()],
        extraFlags,
      }),
    );
    return false;
  }

  clearSlipSaved(userId);
  clearSlipPending(userId);
  setSlipPendingReview(userId, {
    items: prep.merged,
    anchorRaceId: prep.anchor,
    restore: prep.restore,
  });
  if (prep.resetRaceId) {
    resetFlowAfterSlipAction(userId, prep.resetRaceId);
  }

  await interaction.editReply(
    await buildSlipReviewV2Payload({ userId, extraFlags }),
  );
  return true;
}
