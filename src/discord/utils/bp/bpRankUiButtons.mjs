import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  BOTING_HUB_BUTTON_EMOJI,
} from '../boting/botingHubConstants.mjs';
import { botingEmoji } from '../boting/botingEmojis.mjs';
import { BP_RANK_DISPLAY_MAX } from './bpRankLeaderboardEmbed.mjs';
import { t } from '../../../i18n/index.mjs';

function normalizeBpRankMode(mode) {
  const m = String(mode || '');
  if (m === 'recovery' || m === 'hit_rate' || m === 'purchase') return m;
  return 'balance';
}

/** `bp_rank_user_history|{discordUserId}` — 購入履歴ボタン用 */
export const BP_RANK_USER_HISTORY_PREFIX = 'bp_rank_user_history';
/** `bp_rank_user_slip|{discordUserId}` — 対象ユーザーの購入予定（閲覧のみ） */
export const BP_RANK_USER_SLIP_PREFIX = 'bp_rank_user_slip';
/** `bp_rank_back_profile|{discordUserId}` — BP 詳細（プロフィール）へ戻る */
export const BP_RANK_BACK_PROFILE_PREFIX = 'bp_rank_back_profile';
/** `bp_rank_back_lb|{limit}|{mode}` — `/boting` のランキング画面へ戻る */
export const BP_RANK_BACK_LB_PREFIX = 'bp_rank_back_lb';
/** `bp_rank_lb_hist|{limit}|{mode}|{targetUserId}` — ランキングから対象の購入履歴 */
export const BP_RANK_LB_HIST_PREFIX = 'bp_rank_lb_hist';
/** `bp_rank_lb_ledg|{limit}|{mode}|{targetUserId}` — ランキングから対象の直近の収支 */
export const BP_RANK_LB_LEDG_PREFIX = 'bp_rank_lb_ledg';
/** `bp_rank_lb_annual|{limit}|{mode}|{targetUserId}` — ランキングから対象の年間統計 */
export const BP_RANK_LB_ANNUAL_PREFIX = 'bp_rank_lb_annual';

/** 購入予定閲覧・購入履歴の下に並べる（BP 詳細へ戻る） */
export function buildBpRankProfileBackButtonRow(targetUserId, locale = null) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BP_RANK_BACK_PROFILE_PREFIX}|${targetUserId}`)
      .setLabel(t('bp_rank.ui.back_profile', null, locale))
      .setEmoji(botingEmoji('profile'))
      .setStyle(ButtonStyle.Secondary),
  );
}

/** `/bp_rank user:` の BP 詳細の下に並べる（馬券購入・/race の購入予定は出さない） */
export function buildBpRankProfileButtonsRow(targetUserId, locale = null) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BP_RANK_USER_SLIP_PREFIX}|${targetUserId}`)
      .setLabel(t('bp_rank.ui.view_saved_slip', null, locale))
      .setEmoji(botingEmoji('cart'))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${BP_RANK_USER_HISTORY_PREFIX}|${targetUserId}`)
      .setLabel(t('boting_hub.buttons.history', null, locale))
      .setEmoji(botingEmoji('history'))
      .setStyle(ButtonStyle.Secondary),
  );
}

/**
 * @param {number} limit
 * @param {string} mode BP_RANK_MODE
 * @param {string | null} [locale]
 */
export function buildBpRankLeaderboardBackButtonRow(limit, mode, locale = null) {
  const lim = Math.min(BP_RANK_DISPLAY_MAX, Math.max(1, Math.round(Number(limit) || 20)));
  const m = normalizeBpRankMode(mode);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BP_RANK_BACK_LB_PREFIX}|${lim}|${m}`)
      .setLabel(t('bp_rank.ui.back_to_ranking', null, locale))
      .setEmoji(botingEmoji('ranking'))
      .setStyle(ButtonStyle.Secondary),
  );
}

/**
 * ランキング経由の購入履歴の最下行（年間統計・直近の収支・ランキングへ）
 * @param {number} limit
 * @param {string} mode
 * @param {string} targetUserId 表示中のユーザー
 * @param {string | null} [locale]
 */
export function buildBpRankLbHistoryFooterRow(
  limit,
  mode,
  targetUserId,
  locale = null,
) {
  const lim = Math.min(BP_RANK_DISPLAY_MAX, Math.max(1, Math.round(Number(limit) || 20)));
  const m = normalizeBpRankMode(mode);
  const uid = String(targetUserId || '');
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BP_RANK_LB_ANNUAL_PREFIX}|${lim}|${m}|${uid}`)
      .setLabel(t('boting_hub.buttons.annual_stats', null, locale))
      .setEmoji(BOTING_HUB_BUTTON_EMOJI.annualStats)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${BP_RANK_LB_LEDG_PREFIX}|${lim}|${m}|${uid}`)
      .setLabel(t('boting_hub.buttons.ledger', null, locale))
      .setEmoji(botingEmoji('syushi'))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${BP_RANK_BACK_LB_PREFIX}|${lim}|${m}`)
      .setLabel(t('bp_rank.ui.back_to_ranking', null, locale))
      .setEmoji(botingEmoji('ranking'))
      .setStyle(ButtonStyle.Secondary),
  );
}

/**
 * 年間統計（ランキング経由）の下段：購入履歴・直近の収支・ランキングに戻る
 * @param {number} limit
 * @param {string} mode
 * @param {string} targetUserId
 * @param {string | null} [locale]
 */
export function buildBpRankLbAnnualViewFooterRow(
  limit,
  mode,
  targetUserId,
  locale = null,
) {
  const lim = Math.min(BP_RANK_DISPLAY_MAX, Math.max(1, Math.round(Number(limit) || 20)));
  const m = normalizeBpRankMode(mode);
  const uid = String(targetUserId || '');
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BP_RANK_LB_HIST_PREFIX}|${lim}|${m}|${uid}`)
      .setLabel(t('boting_hub.buttons.history', null, locale))
      .setEmoji(botingEmoji('history'))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${BP_RANK_LB_LEDG_PREFIX}|${lim}|${m}|${uid}`)
      .setLabel(t('boting_hub.buttons.ledger', null, locale))
      .setEmoji(botingEmoji('syushi'))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${BP_RANK_BACK_LB_PREFIX}|${lim}|${m}`)
      .setLabel(t('bp_rank.ui.back_to_ranking', null, locale))
      .setEmoji(botingEmoji('ranking'))
      .setStyle(ButtonStyle.Secondary),
  );
}
