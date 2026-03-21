import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { getBetFlow } from './betFlowStore.mjs';
import { getSlipSavedCount } from './betSlipStore.mjs';

export const BET_SLIP_OPEN_CUSTOM_ID = 'race_bet_slip_open_review';

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

/**
 * 開催場・レース一覧など「出馬表ではない」画面用。券種メニュー中でも常に表示する。
 */
export function betSlipOpenReviewButtonRowForSchedule(userId, anchorRaceIdOpt) {
  const rid =
    anchorRaceIdOpt && /^\d{12}$/.test(String(anchorRaceIdOpt))
      ? String(anchorRaceIdOpt)
      : SLIP_OPEN_ANCHOR_FALLBACK;
  const flow = getBetFlow(userId, rid);
  const savedN = getSlipSavedCount(userId);
  const hasCurrent = !!(flow?.purchase?.selectionLine);
  const n = savedN + (hasCurrent ? 1 : 0);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BET_SLIP_OPEN_CUSTOM_ID}|${rid}`)
      .setLabel(n ? `買い目(${n})` : '買い目')
      .setStyle(ButtonStyle.Secondary),
  );
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
  if (!raceId || !/^\d{12}$/.test(String(raceId))) return null;
  if (!shouldShowBetSlipViewButton(flow)) return null;
  const savedN = getSlipSavedCount(userId);
  const hasCurrent = !!(flow?.purchase?.selectionLine);
  const n = savedN + (hasCurrent ? 1 : 0);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BET_SLIP_OPEN_CUSTOM_ID}|${raceId}`)
      .setLabel(n ? `買い目(${n})` : '買い目')
      .setStyle(ButtonStyle.Secondary),
  );
}
