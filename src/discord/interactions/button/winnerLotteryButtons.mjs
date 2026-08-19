import {
  fetchWinnerMatches,
  findWinnerMatch,
  isWinnerMatchClosed,
} from '../../../scrapers/winner/winnerSchedule.mjs';
import { resolveLocaleFromInteraction, t } from '../../../i18n/index.mjs';
import { buildBotingMenuBackRow } from '../../utils/boting/botingBackButton.mjs';
import {
  WINNER_LOTTERY_PREFIX,
  WINNER_STAKE_KEYPAD_PREFIX,
  buildWinnerConfirmPayload,
  buildWinnerMatchListPayload,
  buildWinnerOutcomePayload,
  buildWinnerPurchaseDonePayload,
  buildWinnerScorePayload,
  buildWinnerSlipPayload,
  buildWinnerStakeKeypadPayload,
  oddsForPick,
  outcomeDisplay,
  scoreDisplay,
  winnerExtraFlagsFromInteraction,
} from '../../utils/lottery/winnerUi.mjs';
import { tryConfirmWinnerPurchase } from '../../utils/lottery/winnerBetRecords.mjs';
import {
  addWinnerSlipItem,
  clearWinnerSlip,
  getWinnerSlipItems,
} from '../../utils/lottery/winnerSlipStore.mjs';
import { buildTextAndRowsV2Payload } from '../../utils/race/raceCardDisplay.mjs';

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

async function replyMissing(interaction, extraFlags, locale) {
  await interaction.editReply(
    buildTextAndRowsV2Payload({
      headline: t('winnerLottery.notice.missing_match', null, locale),
      actionRows: [buildBotingMenuBackRow({ locale })],
      extraFlags,
      locale,
    }),
  );
}

function normalizeStake(v) {
  return Math.max(1, Math.min(9999, Math.round(Number(v) || 1)));
}

function slipStakeTotal(items) {
  return items.reduce((sum, item) => sum + normalizeStake(item?.stakeCount), 0);
}

function buildSlipItem(match, outcome, scorePick, stakeCount, locale) {
  return {
    ...match,
    matchId: match.id,
    outcome,
    scorePick,
    selectionLine: `${outcomeDisplay(match, outcome, locale)} / ${scoreDisplay(outcome, scorePick, locale)}`,
    odds: oddsForPick(match, outcome, scorePick),
    stakeCount: normalizeStake(stakeCount),
  };
}

async function handleStakeKeypad(interaction, extraFlags, locale) {
  const [, , op, matchId, outcome, scorePick, stakeRaw, digitRaw] = interaction.customId.split('|');
  const match = await findWinnerMatch(matchId);
  if (!match) return replyMissing(interaction, extraFlags, locale);

  let stake = normalizeStake(stakeRaw);
  if (op === 'd') {
    const digit = String(digitRaw || '').replace(/\D/g, '').slice(0, 1);
    const next = Number(`${stake}${digit}`);
    stake = normalizeStake(Number.isFinite(next) ? next : stake);
    await interaction.editReply(
      buildWinnerStakeKeypadPayload({ match, outcome, scorePick, stakeCount: stake, extraFlags, locale }),
    );
    return;
  }
  if (op === 'del') {
    stake = normalizeStake(Math.floor(stake / 10));
    await interaction.editReply(
      buildWinnerStakeKeypadPayload({ match, outcome, scorePick, stakeCount: stake, extraFlags, locale }),
    );
    return;
  }
  if (op === 'open') {
    await interaction.editReply(
      buildWinnerStakeKeypadPayload({ match, outcome, scorePick, stakeCount: stake, extraFlags, locale }),
    );
    return;
  }
  if (op === 'ok') {
    await interaction.editReply(
      buildWinnerConfirmPayload({ match, outcome, scorePick, stakeCount: stake, extraFlags, locale }),
    );
  }
}

export default async function winnerLotteryButtons(interaction) {
  if (!interaction.isButton()) return;
  const customId = interaction.customId;
  if (!customId.startsWith(`${WINNER_LOTTERY_PREFIX}|`)) return;

  const extraFlags = winnerExtraFlagsFromInteraction(interaction);
  const locale = resolveLocaleFromInteraction(interaction);
  if (!(await safeDeferUpdate(interaction))) return;

  try {
    if (customId.startsWith(`${WINNER_STAKE_KEYPAD_PREFIX}|`)) {
      await handleStakeKeypad(interaction, extraFlags, locale);
      return;
    }

    const parts = customId.split('|');
    const action = parts[1];
    if (action === 'list') {
      const matches = await fetchWinnerMatches({ force: true });
      await interaction.editReply(
        await buildWinnerMatchListPayload({ matches, userId: interaction.user.id, extraFlags, locale }),
      );
      return;
    }

    if (action === 'slip') {
      await interaction.editReply(
        await buildWinnerSlipPayload({ userId: interaction.user.id, extraFlags, locale }),
      );
      return;
    }

    if (action === 'clear') {
      clearWinnerSlip(interaction.user.id);
      await interaction.editReply(
        await buildWinnerSlipPayload({
          userId: interaction.user.id,
          extraFlags,
          locale,
          notice: t('winnerLottery.notice.cleared', null, locale),
        }),
      );
      return;
    }

    if (action === 'match') {
      const match = await findWinnerMatch(parts[2]);
      if (!match) return replyMissing(interaction, extraFlags, locale);
      await interaction.editReply(buildWinnerOutcomePayload({ match, extraFlags, locale }));
      return;
    }

    if (action === 'score') {
      const match = await findWinnerMatch(parts[2]);
      if (!match) return replyMissing(interaction, extraFlags, locale);
      await interaction.editReply(
        buildWinnerScorePayload({ match, outcome: parts[3], extraFlags, locale }),
      );
      return;
    }

    if (action === 'confirm_screen') {
      const [, , matchId, outcome, scorePick, stakeRaw] = parts;
      const match = await findWinnerMatch(matchId);
      if (!match) return replyMissing(interaction, extraFlags, locale);
      await interaction.editReply(
        buildWinnerConfirmPayload({
          match,
          outcome,
          scorePick,
          stakeCount: stakeRaw,
          extraFlags,
          locale,
        }),
      );
      return;
    }

    if (action === 'add') {
      const [, , matchId, outcome, scorePick, stakeRaw] = parts;
      const match = await findWinnerMatch(matchId);
      if (!match) return replyMissing(interaction, extraFlags, locale);
      if (isWinnerMatchClosed(match)) {
        await interaction.editReply(
          await buildWinnerSlipPayload({
            userId: interaction.user.id,
            extraFlags,
            locale,
            notice: t('winnerLottery.notice.closed_add', null, locale),
          }),
        );
        return;
      }
      const added = addWinnerSlipItem(
        interaction.user.id,
        buildSlipItem(match, outcome, scorePick, stakeRaw, locale),
      );
      const notice =
        added.ok
          ? t(
              'winnerLottery.notice.added',
              { stakes: slipStakeTotal(getWinnerSlipItems(interaction.user.id)) },
              locale,
            )
          : t(`winnerLottery.notice.${added.reason === 'duplicate' ? 'duplicate' : 'full'}`, null, locale);
      await interaction.editReply(
        await buildWinnerSlipPayload({ userId: interaction.user.id, extraFlags, locale, notice }),
      );
      return;
    }

    if (action === 'checkout') {
      const items = getWinnerSlipItems(interaction.user.id);
      if (!items.length) {
        await interaction.editReply(
          await buildWinnerSlipPayload({
            userId: interaction.user.id,
            extraFlags,
            locale,
            notice: t('winnerLottery.notice.empty_checkout', null, locale),
          }),
        );
        return;
      }
      if (items.some((item) => isWinnerMatchClosed(item))) {
        await interaction.editReply(
          await buildWinnerSlipPayload({
            userId: interaction.user.id,
            extraFlags,
            locale,
            notice: t('winnerLottery.notice.closed_checkout', null, locale),
          }),
        );
        return;
      }

      const purchase = await tryConfirmWinnerPurchase(interaction.user.id, items);
      if (!purchase.ok && purchase.reason === 'insufficient') {
        await interaction.editReply(
          await buildWinnerSlipPayload({
            userId: interaction.user.id,
            extraFlags,
            locale,
            notice: t(
              'winnerLottery.notice.insufficient',
              { need: purchase.need, balance: purchase.balance },
              locale,
            ),
          }),
        );
        return;
      }
      if (!purchase.ok) {
        const reason =
          purchase.reason === 'closed'
            ? 'closed_checkout'
            : purchase.reason === 'empty'
              ? 'empty_checkout'
              : 'bad_item';
        await interaction.editReply(
          await buildWinnerSlipPayload({
            userId: interaction.user.id,
            extraFlags,
            locale,
            notice: t(`winnerLottery.notice.${reason}`, null, locale),
          }),
        );
        return;
      }
      clearWinnerSlip(interaction.user.id);
      await interaction.editReply(
        buildWinnerPurchaseDonePayload({
          stakes: purchase.stakes,
          spent: purchase.spent,
          balance: purchase.balance,
          extraFlags,
          locale,
        }),
      );
    }
  } catch (e) {
    console.error('winnerLotteryButtons', e);
    await interaction
      .editReply(
        buildTextAndRowsV2Payload({
          headline: t('winnerLottery.notice.purchase_failed', { message: e.message }, locale),
          actionRows: [buildBotingMenuBackRow({ locale })],
          extraFlags,
          locale,
        }),
      )
      .catch(() => {});
  }
}
