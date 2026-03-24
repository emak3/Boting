import { SLIP_MAX_ITEMS } from './betSlipStore.mjs';

/** pending 期限切れ・別端末操作など */
export const MSG_SLIP_BATCH_REVIEW_SESSION_INVALID =
  '❌ 購入予定の確認セッションが無効です。**まとめて購入（仮）**の画面から開き直してください。';

/** アンカー raceId などが食い違ったとき */
export const MSG_SLIP_BATCH_REVIEW_SESSION_MISMATCH =
  '❌ **まとめて購入（仮）** のセッションが一致しません。画面を開き直してください。';

/** まとめて購入（仮）を開こうとしたが中身がない */
export const MSG_SLIP_BATCH_REVIEW_OPEN_EMPTY =
  '❌ 購入予定がありません。**購入予定に追加**で溜めるか、購入サマリーまで進めてください。';

/** buildSlipReviewV2Payload 時に pending が空（TTL・不整合など） */
export const MSG_SLIP_BATCH_REVIEW_PENDING_MISSING =
  '❌ 購入予定の確認データがありません。**/boting** から **まとめて購入（仮）** を開き直してください。';

/** customId 不正などモーダル経路のフォーム */
export const MSG_SLIP_MODAL_CUSTOM_ID_INVALID =
  '❌ この入力は使えません。**まとめて購入（仮）** を開き直し、メニューから金額を変更してください。';

export function msgSlipSavedMaxItemsExceeded() {
  return `❌ 購入予定は **最大 ${SLIP_MAX_ITEMS} 件** までです。**購入予定** で整理するか、**まとめて購入（仮）** を開き直してください。`;
}

/** /bp_rank など他ユーザーの購入予定プレビュー */
export function msgSlipTooManyForOtherUser(username) {
  const u = username || 'ユーザー';
  return `❌ **${u}** の購入予定が **最大 ${SLIP_MAX_ITEMS} 件** を超えているため表示できません。`;
}
