import { fetchWinnerMatches, findWinnerMatch } from '../../../scrapers/winner/winnerSchedule.mjs';
import { resolveLocaleFromInteraction, t } from '../../../i18n/index.mjs';
import { buildTextAndRowsV2Payload } from '../../utils/race/raceCardDisplay.mjs';
import { buildBotingMenuBackRow } from '../../utils/boting/botingBackButton.mjs';
import {
  WINNER_MATCH_SELECT_ID,
  WINNER_OUTCOME_SELECT_PREFIX,
  WINNER_REMOVE_SELECT_PREFIX,
  WINNER_SCORE_SELECT_PREFIX,
  buildWinnerConfirmPayload,
  buildWinnerOutcomePayload,
  buildWinnerScorePayload,
  buildWinnerSlipPayload,
  scoreDisplay,
  winnerExtraFlagsFromInteraction,
} from '../../utils/lottery/winnerUi.mjs';
import { removeWinnerSlipItem } from '../../utils/lottery/winnerSlipStore.mjs';

async function safeDeferUpdate(interaction) {
  if (interaction.deferred || interaction.replied) return false;
  try {
    await interaction.deferUpdate();
    return true;
  } catch (e) {
    if ((e?.code ?? e?.rawError?.code) === 10062) return false;
    throw e;
  }
}

function missingPayload(extraFlags, locale) {
  return buildTextAndRowsV2Payload({
    headline: t('winnerLottery.notice.missing_match', null, locale),
    actionRows: [buildBotingMenuBackRow({ locale })],
    extraFlags,
    locale,
  });
}

export default async function winnerLotteryMenu(interaction) {
  if (!interaction.isStringSelectMenu()) return;
  const customId = interaction.customId;
  if (
    !customId.startsWith(`${WINNER_MATCH_SELECT_ID}|`) &&
    !customId.startsWith(`${WINNER_OUTCOME_SELECT_PREFIX}|`) &&
    customId !== WINNER_REMOVE_SELECT_PREFIX &&
    !customId.startsWith(`${WINNER_SCORE_SELECT_PREFIX}|`)
  ) {
    return;
  }
  const extraFlags = winnerExtraFlagsFromInteraction(interaction);
  const locale = resolveLocaleFromInteraction(interaction);
  if (!(await safeDeferUpdate(interaction))) return;

  try {
    if (customId.startsWith(`${WINNER_MATCH_SELECT_ID}|`)) {
      const matchId = interaction.values[0];
      const match = await findWinnerMatch(matchId);
      if (!match) {
        const matches = await fetchWinnerMatches({ force: true });
        const refreshed = matches.find((m) => m.id === matchId);
        await interaction.editReply(
          refreshed
            ? buildWinnerOutcomePayload({ match: refreshed, extraFlags, locale })
            : missingPayload(extraFlags, locale),
        );
        return;
      }
      await interaction.editReply(buildWinnerOutcomePayload({ match, extraFlags, locale }));
      return;
    }

    if (customId === WINNER_REMOVE_SELECT_PREFIX) {
      const idx = parseInt(interaction.values[0], 10);
      const ok = removeWinnerSlipItem(interaction.user.id, idx);
      await interaction.editReply(
        await buildWinnerSlipPayload({
          userId: interaction.user.id,
          extraFlags,
          locale,
          notice: t(
            ok ? 'winnerLottery.notice.removed' : 'winnerLottery.notice.remove_failed',
            null,
            locale,
          ),
        }),
      );
      return;
    }

    if (customId.startsWith(`${WINNER_OUTCOME_SELECT_PREFIX}|`)) {
      const matchId = customId.split('|')[2];
      const match = await findWinnerMatch(matchId);
      if (!match) {
        await interaction.editReply(missingPayload(extraFlags, locale));
        return;
      }
      const outcome = interaction.values[0];
      await interaction.editReply(buildWinnerScorePayload({ match, outcome, extraFlags, locale }));
      return;
    }

    if (customId.startsWith(`${WINNER_SCORE_SELECT_PREFIX}|`)) {
      const [, , matchId, outcome] = customId.split('|');
      const match = await findWinnerMatch(matchId);
      if (!match) {
        await interaction.editReply(missingPayload(extraFlags, locale));
        return;
      }
      const scorePick = interaction.values[0];
      if (!scoreDisplay(outcome, scorePick, locale)) return;
      await interaction.editReply(
        buildWinnerConfirmPayload({ match, outcome, scorePick, extraFlags, locale }),
      );
    }
  } catch (e) {
    console.error('winnerLotteryMenu', e);
    await interaction
      .editReply(
        buildTextAndRowsV2Payload({
          headline: t('winnerLottery.notice.display_failed', { message: e.message }, locale),
          actionRows: [buildBotingMenuBackRow({ locale })],
          extraFlags,
          locale,
        }),
      )
      .catch(() => {});
  }
}
