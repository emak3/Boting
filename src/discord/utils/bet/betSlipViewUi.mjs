import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { getBetFlow } from './betFlowStore.mjs';
import { getSlipSavedCount } from './betSlipStore.mjs';
import { botingEmoji } from '../boting/botingEmojis.mjs';

export const BET_SLIP_OPEN_CUSTOM_ID = 'race_bet_slip_open_review';
export const RACE_PURCHASE_HISTORY_CUSTOM_ID = 'race_bet_purchase_history';

/** 開催場一覧など、レースIDが無いときの customId 用（まとめ確認は保存リスト起点で動く） */
const SLIP_OPEN_ANCHOR_FALLBACK = '000000000000';

export function firstScheduleAnchorRaceIdFromRaces(races) {
  for (const r of races || []) {
    const id = r?.raceId;
    if (id && /^\d{12}$/.test(String(id))) return String(id);
  }
  return null;
}

export function firstScheduleAnchorRaceIdFromVenues(venues) {
  for (const v of venues || []) {
    for (const r of v.races || []) {
      const id = r?.raceId;
      if (id && /^\d{12}$/.test(String(id))) return String(id);
    }
  }
  return null;
}

function rowHasPurchaseHistoryButton(row) {
  for (const c of row.components || []) {
    const id = c.customId ?? c.data?.custom_id;
    if (typeof id === 'string' && id.startsWith(`${RACE_PURCHASE_HISTORY_CUSTOM_ID}|`)) {
      return true;
    }
  }
  return false;
}

function rowHasBetTypeSelect(row) {
  for (const c of row.components || []) {
    const id = c.customId ?? c.data?.custom_id;
    if (typeof id === 'string' && id.startsWith('race_bet_type|')) return true;
  }
  return false;
}

/**
 * 購入履歴（左）＋購入予定（右、券種メニュー中は非表示のときは履歴のみ）
 */
export function raceBetSlipUtilityButtonRow(raceId, userId, flow) {
  if (!raceId || !/^\d{12}$/.test(String(raceId))) return null;
  const hist = new ButtonBuilder()
    .setCustomId(`${RACE_PURCHASE_HISTORY_CUSTOM_ID}|${raceId}`)
    .setLabel('購入履歴')
    .setEmoji(botingEmoji('history'))
    .setStyle(ButtonStyle.Secondary);
  const slipShown = shouldShowBetSlipViewButton(flow);
  const savedN = getSlipSavedCount(userId);
  const hasCurrent = !!(flow?.purchase?.selectionLine);
  const n = savedN + (hasCurrent ? 1 : 0);
  const buttons = [hist];
  if (slipShown) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`${BET_SLIP_OPEN_CUSTOM_ID}|${raceId}`)
        .setLabel(n ? `購入予定(${n})` : '購入予定')
        .setEmoji(botingEmoji('cart'))
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return new ActionRowBuilder().addComponents(...buttons);
}

/**
 * 出馬表用: 券種行の直後にユーティリティ行を挿入（重複防止）
 * @param {import('discord.js').ActionRowBuilder[]} actionRows
 */
export function maybeInsertRaceBetUtilityRow(userId, raceId, actionRows, flow = null) {
  const rows = (actionRows || []).filter(Boolean);
  if (!userId || !raceId || !/^\d{12}$/.test(String(raceId))) return rows;
  if (rows.some(rowHasPurchaseHistoryButton)) return rows;
  const f = flow ?? getBetFlow(userId, raceId);
  const util = raceBetSlipUtilityButtonRow(raceId, userId, f);
  if (!util) return rows;
  const idx = rows.findIndex(rowHasBetTypeSelect);
  const insertAt = idx >= 0 ? idx + 1 : rows.length;
  return [...rows.slice(0, insertAt), util, ...rows.slice(insertAt)];
}

/**
 * 開催場・レース一覧など「出馬表ではない」画面用。券種メニュー中でも常に表示する。
 */
export function betSlipOpenReviewButtonRowForSchedule(userId, anchorRaceIdOpt) {
  const rid =
    anchorRaceIdOpt && /^\d{12}$/.test(String(anchorRaceIdOpt))
      ? String(anchorRaceIdOpt)
      : SLIP_OPEN_ANCHOR_FALLBACK;
  const flow = getBetFlow(userId, rid);
  return raceBetSlipUtilityButtonRow(rid, userId, flow);
}

/**
 * 券種・式別・馬番などの多段メニュー中は非表示。購入サマリー・券種のみの画面では表示。
 */
export function shouldShowBetSlipViewButton(flow) {
  if (!flow) return true;
  if (flow.purchase) return true;
  if (flow.navViewMenuIndex != null && flow.navViewMenuIndex >= 0) return false;
  const ids = flow.backMenuIds || [];
  if (ids.length > 1) return false;
  return true;
}

export function betSlipViewActionRow(raceId, userId, flow) {
  return raceBetSlipUtilityButtonRow(raceId, userId, flow);
}
