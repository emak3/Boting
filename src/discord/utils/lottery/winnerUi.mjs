import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { formatBpAmount, formatBpWithUnit } from '../bp/bpFormat.mjs';
import { buildBotingMenuBackRow } from '../boting/botingBackButton.mjs';
import { getBalance } from '../user/userPointsStore.mjs';
import { t } from '../../../i18n/index.mjs';
import {
  isWinnerMatchClosed,
  winnerSalesCloseAt,
} from '../../../scrapers/winner/winnerSchedule.mjs';
import { WINNER_UNIT_BP } from './winnerBetRecords.mjs';
import { getWinnerSlipItems } from './winnerSlipStore.mjs';

export const WINNER_LOTTERY_PREFIX = 'winner_lottery';
export const WINNER_MATCH_SELECT_ID = `${WINNER_LOTTERY_PREFIX}|match`;
export const WINNER_OUTCOME_SELECT_PREFIX = `${WINNER_LOTTERY_PREFIX}|outcome`;
export const WINNER_SCORE_SELECT_PREFIX = `${WINNER_LOTTERY_PREFIX}|score`;
export const WINNER_STAKE_KEYPAD_PREFIX = `${WINNER_LOTTERY_PREFIX}|stake`;

export function winnerScoreOptions(locale = null) {
  return {
    home: [
      ['1-0', '1-0'],
      ['2-0', '2-0'],
      ['2-1', '2-1'],
      ['3-0', '3-0'],
      ['3-1', '3-1'],
      ['3-2', '3-2'],
      ['home4+', t('winnerLottery.score.home4', null, locale)],
    ],
    away: [
      ['0-1', '1-0'],
      ['0-2', '2-0'],
      ['1-2', '2-1'],
      ['0-3', '3-0'],
      ['1-3', '3-1'],
      ['2-3', '3-2'],
      ['away4+', t('winnerLottery.score.away4', null, locale)],
    ],
    draw: [
      ['0-0', '0-0'],
      ['1-1', '1-1'],
      ['2-2', '2-2'],
      ['draw3+', t('winnerLottery.score.draw3', null, locale)],
    ],
  };
}

export function oddsForPick(match, outcome, scorePick) {
  const v = match?.odds?.[`${outcome}:${scorePick}`];
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function formatOdds(odds, locale = null) {
  const n = Number(odds);
  return Number.isFinite(n) && n > 0 ? n.toFixed(1) : t('winnerLottery.odds_unknown', null, locale);
}

export function formatWinnerCloseAt(match, locale = null) {
  const d = winnerSalesCloseAt(match);
  if (!d) return t('winnerLottery.close_unknown', null, locale);
  const shifted = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mi = String(shifted.getUTCMinutes()).padStart(2, '0');
  return t('winnerLottery.close_at', { time: `${mm}/${dd} ${hh}:${mi}` }, locale);
}

function extraFlagsFromMessage(message) {
  try {
    return message?.flags?.has(MessageFlags.Ephemeral) ? MessageFlags.Ephemeral : 0;
  } catch {
    return 0;
  }
}

export function winnerExtraFlagsFromInteraction(interaction) {
  return extraFlagsFromMessage(interaction.message);
}

export function matchTitle(match, locale = null) {
  return t(
    'winnerLottery.match_title',
    { home: match.homeTeam, away: match.awayTeam },
    locale,
  );
}

export function matchMetaLine(match, locale = null) {
  return [
    match.league,
    match.round,
    match.matchDate,
    match.kickOff,
    match.venue,
    formatWinnerCloseAt(match, locale),
  ]
    .filter(Boolean)
    .join(' / ');
}

function buildMatchSelect(matches, locale = null) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(WINNER_MATCH_SELECT_ID)
    .setPlaceholder(t('winnerLottery.button.list', null, locale))
    .setMinValues(1)
    .setMaxValues(1);
  for (const match of matches.slice(0, 25)) {
    select.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(matchTitle(match, locale).slice(0, 100))
        .setDescription(matchMetaLine(match, locale).slice(0, 100))
        .setValue(match.id),
    );
  }
  return new ActionRowBuilder().addComponents(select);
}

export async function buildWinnerMatchListPayload({
  matches,
  userId,
  extraFlags = 0,
  locale = null,
}) {
  const balance = await getBalance(userId);
  const container = new ContainerBuilder().setAccentColor(0x00a878);
  const lines = [
    t('winnerLottery.title.match_list', null, locale),
    t('winnerLottery.balance', { amount: formatBpWithUnit(balance) }, locale),
    t('winnerLottery.unit', { amount: formatBpWithUnit(WINNER_UNIT_BP) }, locale),
    t('winnerLottery.rule', null, locale),
    '',
  ];
  if (matches.length) {
    lines.push(t('winnerLottery.match_pick', null, locale));
    lines.push(
      '',
      ...matches.slice(0, 8).map((m) =>
        t(
          'winnerLottery.match_summary',
          { title: matchTitle(m, locale), meta: matchMetaLine(m, locale) },
          locale,
        ),
      ),
    );
    if (matches.length > 8) {
      lines.push(t('winnerLottery.other_matches', { count: matches.length - 8 }, locale));
    }
  } else {
    lines.push(t('winnerLottery.empty_matches', null, locale));
  }
  container.addTextDisplayComponents((td) => td.setContent(lines.join('\n').slice(0, 3900)));
  const rows = matches.length ? [buildMatchSelect(matches, locale)] : [];
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${WINNER_LOTTERY_PREFIX}|slip`)
        .setLabel(t('winnerLottery.button.slip', null, locale))
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  rows.push(buildBotingMenuBackRow({ locale }));
  return {
    content: null,
    embeds: [],
    components: [container, ...rows],
    flags: MessageFlags.IsComponentsV2 | extraFlags,
  };
}

export function scoreDisplay(outcome, scoreValue, locale = null) {
  const found = (winnerScoreOptions(locale)[outcome] || []).find(([v]) => v === scoreValue);
  return found?.[1] || scoreValue;
}

export function outcomeDisplay(match, outcome, locale = null) {
  if (outcome === 'home') {
    return t('winnerLottery.outcome.home', { team: match.homeTeam }, locale);
  }
  if (outcome === 'away') {
    return t('winnerLottery.outcome.away', { team: match.awayTeam }, locale);
  }
  return t('winnerLottery.outcome.draw', null, locale);
}

export function buildWinnerOutcomePayload({ match, extraFlags = 0, locale = null }) {
  const container = new ContainerBuilder().setAccentColor(0x00a878);
  container.addTextDisplayComponents((td) =>
    td.setContent(
      [
        t('winnerLottery.title.outcome', null, locale),
        `**${matchTitle(match, locale)}**`,
        matchMetaLine(match, locale),
        '',
        t('winnerLottery.outcome_help', null, locale),
      ].join('\n'),
    ),
  );
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${WINNER_OUTCOME_SELECT_PREFIX}|${match.id}`)
    .setPlaceholder(t('winnerLottery.title.outcome', null, locale).replace(/^#+\s*/, ''))
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(outcomeDisplay(match, 'home', locale))
        .setValue('home'),
      new StringSelectMenuOptionBuilder()
        .setLabel(outcomeDisplay(match, 'draw', locale))
        .setValue('draw'),
      new StringSelectMenuOptionBuilder()
        .setLabel(outcomeDisplay(match, 'away', locale))
        .setValue('away'),
    );
  return {
    content: null,
    embeds: [],
    components: [
      container,
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${WINNER_LOTTERY_PREFIX}|list`)
          .setLabel(t('winnerLottery.button.list', null, locale))
          .setStyle(ButtonStyle.Secondary),
      ),
      buildBotingMenuBackRow({ locale }),
    ],
    flags: MessageFlags.IsComponentsV2 | extraFlags,
  };
}

export function buildWinnerScorePayload({ match, outcome, extraFlags = 0, locale = null }) {
  const container = new ContainerBuilder().setAccentColor(0x00a878);
  container.addTextDisplayComponents((td) =>
    td.setContent(
      [
        t('winnerLottery.title.score', null, locale),
        `**${matchTitle(match, locale)}**`,
        matchMetaLine(match, locale),
        `${t('winnerLottery.prediction', null, locale)}: **${outcomeDisplay(match, outcome, locale)}**`,
      ].join('\n'),
    ),
  );
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${WINNER_SCORE_SELECT_PREFIX}|${match.id}|${outcome}`)
    .setPlaceholder(t('winnerLottery.title.score', null, locale).replace(/^#+\s*/, ''))
    .setMinValues(1)
    .setMaxValues(1);
  for (const [value, label] of winnerScoreOptions(locale)[outcome] || []) {
    select.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(label)
        .setDescription(`${t('winnerLottery.odds', null, locale)} ${formatOdds(oddsForPick(match, outcome, value), locale)}`)
        .setValue(value),
    );
  }
  return {
    content: null,
    embeds: [],
    components: [
      container,
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${WINNER_LOTTERY_PREFIX}|match|${match.id}`)
          .setLabel(t('winnerLottery.button.back_outcome', null, locale))
          .setStyle(ButtonStyle.Secondary),
      ),
      buildBotingMenuBackRow({ locale }),
    ],
    flags: MessageFlags.IsComponentsV2 | extraFlags,
  };
}

export function buildWinnerConfirmPayload({
  match,
  outcome,
  scorePick,
  stakeCount = 1,
  extraFlags = 0,
  locale = null,
}) {
  const stakes = Math.max(1, Math.min(9999, Math.round(Number(stakeCount) || 1)));
  const selectionLine = `${outcomeDisplay(match, outcome, locale)} / ${scoreDisplay(outcome, scorePick, locale)}`;
  const odds = oddsForPick(match, outcome, scorePick);
  const container = new ContainerBuilder().setAccentColor(0x00a878);
  container.addTextDisplayComponents((td) =>
    td.setContent(
      [
        t('winnerLottery.title.confirm', null, locale),
        `**${matchTitle(match, locale)}**`,
        matchMetaLine(match, locale),
        isWinnerMatchClosed(match) ? `**${t('winnerLottery.closed', null, locale)}**` : null,
        '',
        `${t('winnerLottery.prediction', null, locale)}: **${selectionLine}**`,
        `${t('winnerLottery.odds', null, locale)}: **${formatOdds(odds, locale)}**`,
        `${t('winnerLottery.stake_count', null, locale)}: **${stakes}**`,
        `${t('winnerLottery.subtotal', null, locale)}: \`${formatBpWithUnit(stakes * WINNER_UNIT_BP)}\``,
      ].filter(Boolean).join('\n'),
    ),
  );
  return {
    content: null,
    embeds: [],
    components: [
      container,
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${WINNER_LOTTERY_PREFIX}|add|${match.id}|${outcome}|${scorePick}|${stakes}`)
          .setLabel(t('winnerLottery.button.add', null, locale))
          .setStyle(ButtonStyle.Success)
          .setDisabled(isWinnerMatchClosed(match)),
        new ButtonBuilder()
          .setCustomId(`${WINNER_STAKE_KEYPAD_PREFIX}|open|${match.id}|${outcome}|${scorePick}|${stakes}`)
          .setLabel(t('winnerLottery.button.stake', null, locale))
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`${WINNER_LOTTERY_PREFIX}|score|${match.id}|${outcome}`)
          .setLabel(t('winnerLottery.button.back_score', null, locale))
          .setStyle(ButtonStyle.Secondary),
      ),
      buildBotingMenuBackRow({ locale }),
    ],
    flags: MessageFlags.IsComponentsV2 | extraFlags,
  };
}

export async function buildWinnerSlipPayload({
  userId,
  extraFlags = 0,
  notice = '',
  locale = null,
}) {
  const items = getWinnerSlipItems(userId);
  const hasClosed = items.some((it) => isWinnerMatchClosed(it));
  const totalStakes = items.reduce((sum, it) => sum + Math.max(1, Number(it.stakeCount) || 1), 0);
  const total = totalStakes * WINNER_UNIT_BP;
  const container = new ContainerBuilder().setAccentColor(0x00a878);
  const lines = [
    t('winnerLottery.title.slip', null, locale),
    notice ? String(notice) : null,
    `${t('winnerLottery.total_stakes', null, locale)}: **${totalStakes}**`,
    `${t('winnerLottery.total', null, locale)}: \`${formatBpWithUnit(total)}\``,
    '',
  ].filter(Boolean);
  if (!items.length) {
    lines.push(t('winnerLottery.empty_slip', null, locale));
  } else {
    items.forEach((it, i) => {
      lines.push(
        `${i + 1}. **${matchTitle(it, locale)}** ${it.matchDate || ''} ${it.kickOff || ''}`,
        `   ${it.selectionLine} / ${t('winnerLottery.odds', null, locale)} ${formatOdds(it.odds, locale)} / ${it.stakeCount}${t('winnerLottery.stake_suffix', null, locale)} / ${formatBpWithUnit(it.stakeCount * WINNER_UNIT_BP)} / ${formatWinnerCloseAt(it, locale)}${isWinnerMatchClosed(it) ? ` / ${t('winnerLottery.closed', null, locale)}` : ''}`,
      );
    });
  }
  container.addTextDisplayComponents((td) => td.setContent(lines.join('\n').slice(0, 3900)));
  const rows = [];
  if (items.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${WINNER_LOTTERY_PREFIX}|checkout`)
          .setLabel(t('winnerLottery.button.checkout', null, locale))
          .setStyle(ButtonStyle.Success)
          .setDisabled(hasClosed),
        new ButtonBuilder()
          .setCustomId(`${WINNER_LOTTERY_PREFIX}|clear`)
          .setLabel(t('winnerLottery.button.clear', null, locale))
          .setStyle(ButtonStyle.Danger),
      ),
    );
  }
  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${WINNER_LOTTERY_PREFIX}|list`)
        .setLabel(t('winnerLottery.button.list', null, locale))
        .setStyle(ButtonStyle.Secondary),
    ),
    buildBotingMenuBackRow({ locale }),
  );
  return {
    content: null,
    embeds: [],
    components: [container, ...rows],
    flags: MessageFlags.IsComponentsV2 | extraFlags,
  };
}

export function buildWinnerStakeKeypadPayload({
  match,
  outcome,
  scorePick,
  stakeCount = 1,
  extraFlags = 0,
  locale = null,
}) {
  const stakes = Math.max(1, Math.min(9999, Math.round(Number(stakeCount) || 1)));
  const selectionLine = `${outcomeDisplay(match, outcome, locale)} / ${scoreDisplay(outcome, scorePick, locale)}`;
  const container = new ContainerBuilder().setAccentColor(0x00a878);
  container.addTextDisplayComponents((td) =>
    td.setContent(
      [
        t('winnerLottery.title.stake', null, locale),
        `**${matchTitle(match, locale)}**`,
        `${t('winnerLottery.prediction', null, locale)}: **${selectionLine}**`,
        `${t('winnerLottery.odds', null, locale)}: **${formatOdds(oddsForPick(match, outcome, scorePick), locale)}**`,
        `# ${stakes}`,
        `${t('winnerLottery.subtotal', null, locale)}: \`${formatBpWithUnit(stakes * WINNER_UNIT_BP)}\``,
      ].join('\n'),
    ),
  );
  const bid = (op, arg = '') =>
    `${WINNER_STAKE_KEYPAD_PREFIX}|${op}|${match.id}|${outcome}|${scorePick}|${stakes}${arg ? `|${arg}` : ''}`;
  const digit = (n) =>
    new ButtonBuilder().setCustomId(bid('d', String(n))).setLabel(String(n)).setStyle(ButtonStyle.Secondary);
  return {
    content: null,
    embeds: [],
    components: [
      container,
      new ActionRowBuilder().addComponents(digit(7), digit(8), digit(9)),
      new ActionRowBuilder().addComponents(digit(4), digit(5), digit(6)),
      new ActionRowBuilder().addComponents(digit(1), digit(2), digit(3)),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(bid('del'))
          .setLabel(t('winnerLottery.button.delete', null, locale))
          .setStyle(ButtonStyle.Danger),
        digit(0),
        new ButtonBuilder()
          .setCustomId(bid('ok'))
          .setLabel(t('winnerLottery.button.ok', null, locale))
          .setStyle(ButtonStyle.Success),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${WINNER_LOTTERY_PREFIX}|confirm_screen|${match.id}|${outcome}|${scorePick}|${stakes}`)
          .setLabel(t('winnerLottery.button.back', null, locale))
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
    flags: MessageFlags.IsComponentsV2 | extraFlags,
  };
}

export function buildWinnerPurchaseDonePayload({
  stakes,
  spent,
  balance,
  extraFlags = 0,
  locale = null,
}) {
  const container = new ContainerBuilder().setAccentColor(0x2ecc71);
  container.addTextDisplayComponents((td) =>
    td.setContent(
      [
        t('winnerLottery.title.done', null, locale),
        t('winnerLottery.done', { stakes }, locale),
        t('winnerLottery.spent', {
          spent: formatBpAmount(spent),
          balance: formatBpAmount(balance),
        }, locale),
      ].join('\n'),
    ),
  );
  return {
    content: null,
    embeds: [],
    components: [container, buildBotingMenuBackRow({ locale })],
    flags: MessageFlags.IsComponentsV2 | extraFlags,
  };
}
