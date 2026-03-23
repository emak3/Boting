import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { botingEmoji } from './botingEmojis.mjs';

/** `bp_rank_user_history|{discordUserId}` — 購入履歴ボタン用 */
export const BP_RANK_USER_HISTORY_PREFIX = 'bp_rank_user_history';
/** `bp_rank_user_slip|{discordUserId}` — 対象ユーザーの購入予定（閲覧のみ） */
export const BP_RANK_USER_SLIP_PREFIX = 'bp_rank_user_slip';
/** `bp_rank_back_profile|{discordUserId}` — BP 詳細（プロフィール）へ戻る */
export const BP_RANK_BACK_PROFILE_PREFIX = 'bp_rank_back_profile';

/** 購入予定閲覧・購入履歴の下に並べる（BP 詳細へ戻る） */
export function buildBpRankProfileBackButtonRow(targetUserId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BP_RANK_BACK_PROFILE_PREFIX}|${targetUserId}`)
      .setLabel('プロフィールに戻る')
      .setEmoji(botingEmoji('profile'))
      .setStyle(ButtonStyle.Secondary),
  );
}

/** `/bp_rank user:` の BP 詳細の下に並べる（馬券購入・/race の購入予定は出さない） */
export function buildBpRankProfileButtonsRow(targetUserId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BP_RANK_USER_SLIP_PREFIX}|${targetUserId}`)
      .setLabel('購入予定を見る')
      .setEmoji(botingEmoji('cart'))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${BP_RANK_USER_HISTORY_PREFIX}|${targetUserId}`)
      .setLabel('購入履歴')
      .setEmoji(botingEmoji('history'))
      .setStyle(ButtonStyle.Secondary),
  );
}
