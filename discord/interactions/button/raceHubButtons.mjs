import { MessageFlags } from 'discord.js';
import {
  RACE_CMD_HUB_PREFIX,
  buildRaceHubBackButtonRow,
  buildRaceHubV2Payload,
  buildRaceScheduleIntroV2Payload,
} from '../../utils/raceCommandHub.mjs';
import {
  buildBpRankUserDetailV2Container,
  buildBpRankUserSlipReadonlyV2Payload,
} from '../../utils/bpRankUserDetailEmbed.mjs';
import {
  BP_RANK_USER_HISTORY_PREFIX,
  BP_RANK_USER_SLIP_PREFIX,
  BP_RANK_BACK_PROFILE_PREFIX,
  buildBpRankProfileButtonsRow,
  buildBpRankProfileBackButtonRow,
} from '../../utils/bpRankUiButtons.mjs';
import { buildRacePurchaseHistoryV2Payload } from '../../utils/racePurchaseHistoryUi.mjs';
import {
  abandonSlipReviewToSavedState,
  editReplyOpenBetSlipReview,
} from '../../utils/betSlipOpenReview.mjs';
import { buildTextAndRowsV2Payload } from '../../utils/raceCardDisplay.mjs';

/**
 * 二重クリック・既に応答済み・期限切れ (10062) で落ちないようにする。
 * @param {import('discord.js').ButtonInteraction} interaction
 * @returns {Promise<boolean>} この後 editReply / update してよいとき true
 */
async function safeDeferUpdate(interaction) {
  if (interaction.deferred || interaction.replied) return false;
  try {
    await interaction.deferUpdate();
    return true;
  } catch (e) {
    const code = e?.code ?? e?.rawError?.code;
    if (code === 10062) return false;
    throw e;
  }
}

function ephemeralExtraFromMessage(message) {
  let extra = 0;
  try {
    if (message?.flags?.has(MessageFlags.Ephemeral)) {
      extra |= MessageFlags.Ephemeral;
    }
  } catch (_) {
    /* ignore */
  }
  return extra;
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 */
export default async function raceHubButtons(interaction) {
  if (!interaction.isButton()) return;
  const id = interaction.customId;

  if (id.startsWith(`${BP_RANK_USER_HISTORY_PREFIX}|`)) {
    const targetUserId = id.split('|')[1];
    if (!/^\d{17,20}$/.test(String(targetUserId || ''))) return;
    const extraFlags = ephemeralExtraFromMessage(interaction.message);
    if (!(await safeDeferUpdate(interaction))) return;
    try {
      const payload = await buildRacePurchaseHistoryV2Payload({
        userId: targetUserId,
        page: 0,
        extraFlags,
        bpRankProfileUserId: targetUserId,
      });
      await interaction.editReply(payload);
    } catch (e) {
      console.error('raceHubButtons bp_rank history', e);
      await interaction
        .editReply(
          buildTextAndRowsV2Payload({
            headline: `❌ 購入履歴の表示に失敗しました: ${e.message}`,
            actionRows: [buildBpRankProfileBackButtonRow(targetUserId)],
            extraFlags,
          }),
        )
        .catch(() => {});
    }
    return;
  }

  if (id.startsWith(`${BP_RANK_USER_SLIP_PREFIX}|`)) {
    const targetUserId = id.split('|')[1];
    if (!/^\d{17,20}$/.test(String(targetUserId || ''))) return;
    const extraFlags = ephemeralExtraFromMessage(interaction.message);
    if (!(await safeDeferUpdate(interaction))) return;
    try {
      const targetUser = await interaction.client.users.fetch(targetUserId).catch(() => null);
      if (!targetUser) {
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline: '❌ ユーザーの取得に失敗しました。',
            actionRows: [buildBpRankProfileBackButtonRow(targetUserId)],
            extraFlags,
          }),
        );
        return;
      }
      const payload = await buildBpRankUserSlipReadonlyV2Payload({
        targetUser,
        targetUserId,
        extraFlags,
      });
      await interaction.editReply(payload);
    } catch (e) {
      console.error('raceHubButtons bp_rank slip', e);
      await interaction
        .editReply(
          buildTextAndRowsV2Payload({
            headline: `❌ 購入予定の表示に失敗しました: ${e.message}`,
            actionRows: [buildBpRankProfileBackButtonRow(targetUserId)],
            extraFlags,
          }),
        )
        .catch(() => {});
    }
    return;
  }

  if (id.startsWith(`${BP_RANK_BACK_PROFILE_PREFIX}|`)) {
    const targetUserId = id.split('|')[1];
    if (!/^\d{17,20}$/.test(String(targetUserId || ''))) return;
    const extraFlags = ephemeralExtraFromMessage(interaction.message);
    if (!(await safeDeferUpdate(interaction))) return;
    try {
      const targetUser = await interaction.client.users.fetch(targetUserId).catch(() => null);
      if (!targetUser) {
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline: '❌ ユーザーの取得に失敗しました。',
            actionRows: [],
            extraFlags,
          }),
        );
        return;
      }
      const container = await buildBpRankUserDetailV2Container(
        targetUser,
        interaction.guild,
        interaction.user.id,
      );
      const row = buildBpRankProfileButtonsRow(targetUserId);
      await interaction.editReply({
        content: null,
        embeds: [],
        components: [container, row],
        flags: MessageFlags.IsComponentsV2 | extraFlags,
      });
    } catch (e) {
      console.error('raceHubButtons bp_rank back profile', e);
      await interaction
        .editReply(
          buildTextAndRowsV2Payload({
            headline: `❌ 表示の更新に失敗しました: ${e.message}`,
            actionRows: [buildBpRankProfileBackButtonRow(targetUserId)],
            extraFlags,
          }),
        )
        .catch(() => {});
    }
    return;
  }

  if (!id.startsWith(`${RACE_CMD_HUB_PREFIX}|`)) return;

  const part = id.split('|')[1];
  const userId = interaction.user.id;
  const extraFlags = ephemeralExtraFromMessage(interaction.message);

  if (!(await safeDeferUpdate(interaction))) return;

  try {
    if (part === 'back') {
      abandonSlipReviewToSavedState(userId);
      await interaction.editReply(
        await buildRaceHubV2Payload({
          user: interaction.user,
          guild: interaction.guild,
          extraFlags,
        }),
      );
      return;
    }
    if (part === 'purchase') {
      await interaction.editReply(
        await buildRaceScheduleIntroV2Payload({ userId, extraFlags }),
      );
      return;
    }
    if (part === 'history') {
      const payload = await buildRacePurchaseHistoryV2Payload({
        userId,
        page: 0,
        extraFlags,
      });
      await interaction.editReply(payload);
      return;
    }
    if (part === 'slip') {
      await editReplyOpenBetSlipReview(interaction, {
        userId,
        raceId: '000000000000',
        extraFlags,
      });
      return;
    }
  } catch (e) {
    console.error('raceHubButtons', e);
    await interaction
      .editReply(
        buildTextAndRowsV2Payload({
          headline: `❌ 表示の更新に失敗しました: ${e.message}`,
          actionRows: [buildRaceHubBackButtonRow()],
          extraFlags,
        }),
      )
      .catch(() => {});
  }
}
