import { fetchWinnerMatches, findWinnerMatch } from '../../../scrapers/winner/winnerSchedule.mjs';
import { resolveLocaleFromInteraction, t } from '../../../i18n/index.mjs';
import { buildTextAndRowsV2Payload } from '../../utils/race/raceCardDisplay.mjs';
import { buildBotingMenuBackRow } from '../../utils/boting/botingBackButton.mjs';
import {
  WINNER_MATCH_SELECT_ID,
  WINNER_OUTCOME_SELECT_PREFIX,
  WINNER_SCORE_SELECT_PREFIX,
  buildWinnerConfirmPayload,
  buildWinnerOutcomePayload,
  buildWinnerScorePayload,
  scoreDisplay,
  winnerExtraFlagsFromInteraction,
} from '../../utils/lottery/winnerUi.mjs';

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
    customId !== WINNER_MATCH_SELECT_ID &&
    !customId.startsWith(`${WINNER_OUTCOME_SELECT_PREFIX}|`) &&
    !customId.startsWith(`${WINNER_SCORE_SELECT_PREFIX}|`)
  ) {
    return;
  }
  const extraFlags = winnerExtraFlagsFromInteraction(interaction);
  const locale = resolveLocaleFromInteraction(interaction);
  if (!(await safeDeferUpdate(interaction))) return;

  try {
    if (customId === WINNER_MATCH_SELECT_ID) {
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
