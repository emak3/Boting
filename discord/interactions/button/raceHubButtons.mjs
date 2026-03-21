import { MessageFlags } from 'discord.js';
import {
  RACE_CMD_HUB_PREFIX,
  buildRaceHubBackButtonRow,
  buildRaceHubV2Payload,
  buildRaceScheduleIntroV2Payload,
} from '../../utils/raceCommandHub.mjs';
import { buildRacePurchaseHistoryV2Payload } from '../../utils/racePurchaseHistoryUi.mjs';
import {
  abandonSlipReviewToSavedState,
  editReplyOpenBetSlipReview,
} from '../../utils/betSlipOpenReview.mjs';
import { buildTextAndRowsV2Payload } from '../../utils/raceCardDisplay.mjs';

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
  if (!id.startsWith(`${RACE_CMD_HUB_PREFIX}|`)) return;

  const part = id.split('|')[1];
  const userId = interaction.user.id;
  const extraFlags = ephemeralExtraFromMessage(interaction.message);

  await interaction.deferUpdate();

  try {
    if (part === 'back') {
      abandonSlipReviewToSavedState(userId);
      await interaction.editReply(
        await buildRaceHubV2Payload({ userId, extraFlags }),
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
