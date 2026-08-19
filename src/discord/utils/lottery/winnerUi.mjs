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
import { botingEmoji } from '../boting/botingEmojis.mjs';
import { getBalance } from '../user/userPointsStore.mjs';
import { discordTimestamp } from '../shared/discordTimestamp.mjs';
import { t } from '../../../i18n/index.mjs';
import {
  isWinnerMatchClosed,
  winnerSalesCloseAt,
} from '../../../scrapers/winner/winnerSchedule.mjs';
import { WINNER_UNIT_BP } from './winnerBetRecords.mjs';
import { getWinnerSlipCount, getWinnerSlipItems } from './winnerSlipStore.mjs';

export const WINNER_LOTTERY_PREFIX = 'winner_lottery';
export const WINNER_MATCH_SELECT_ID = `${WINNER_LOTTERY_PREFIX}|match`;
export const WINNER_OUTCOME_SELECT_PREFIX = `${WINNER_LOTTERY_PREFIX}|outcome`;
export const WINNER_SCORE_SELECT_PREFIX = `${WINNER_LOTTERY_PREFIX}|score`;
export const WINNER_STAKE_KEYPAD_PREFIX = `${WINNER_LOTTERY_PREFIX}|stake`;
export const WINNER_REMOVE_SELECT_PREFIX = `${WINNER_LOTTERY_PREFIX}|remove`;

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
  return t('winnerLottery.close_at', { time: discordTimestamp(d, 'f') }, locale);
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

function buildMatchSelect(matches, pageIndex = 0, locale = null) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${WINNER_MATCH_SELECT_ID}|${pageIndex}`)
    .setPlaceholder(t('winnerLottery.match_menu_placeholder', { index: pageIndex + 1 }, locale))
    .setMinValues(1)
    .setMaxValues(1);
  for (const match of matches.slice(pageIndex * 25, pageIndex * 25 + 25)) {
    select.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(matchTitle(match, locale).slice(0, 100))
        .setDescription(matchMetaLine(match, locale).slice(0, 100))
        .setValue(match.id),
    );
  }
  return new ActionRowBuilder().addComponents(select);
}

function buildRemoveSelect(items, locale = null) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(WINNER_REMOVE_SELECT_PREFIX)
    .setPlaceholder(t('winnerLottery.remove_placeholder', null, locale))
    .setMinValues(1)
    .setMaxValues(1);
  for (const [i, item] of items.slice(0, 25).entries()) {
    const desc = `${item.selectionLine || ''} / ${item.stakeCount || 1}${t('winnerLottery.stake_suffix', null, locale)}`;
    select.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(`${i + 1}. ${matchTitle(item, locale)}`.slice(0, 100))
        .setDescription(desc.slice(0, 100))
        .setValue(String(i)),
    );
  }
  return new ActionRowBuilder().addComponents(select);
}

export async function buildWinnerMatchListPayload({
  matches,
  userId,
  extraFlags = 0,
  locale = null,
  pageIndex = 0,
}) {
  const balance = await getBalance(userId);
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil((matches?.length || 0) / pageSize));
  const currentPage = Math.min(Math.max(0, Math.trunc(Number(pageIndex) || 0)), totalPages - 1);
  const pageMatches = (matches || []).slice(currentPage * pageSize, currentPage * pageSize + pageSize);
  const container = new ContainerBuilder().setAccentColor(0x00a878);
  const lines = [
    t('winnerLottery.title.match_list', null, locale),
    t('winnerLottery.balance', { amount: formatBpWithUnit(balance) }, locale),
    t('winnerLottery.unit', { amount: formatBpWithUnit(WINNER_UNIT_BP) }, locale),
    t('winnerLottery.rule', null, locale),
    totalPages > 1
      ? t('winnerLottery.page', { current: currentPage + 1, total: totalPages }, locale)
      : null,
    '',
  ].filter(Boolean);
  if (pageMatches.length) {
    lines.push(t('winnerLottery.match_pick', null, locale));
    lines.push(
      '',
      ...pageMatches.slice(0, 8).map((m) =>
        t(
          'winnerLottery.match_summary',
          { title: matchTitle(m, locale), meta: matchMetaLine(m, locale) },
          locale,
        ),
      ),
    );
    if (pageMatches.length > 8) {
      lines.push(t('winnerLottery.other_matches', { count: pageMatches.length - 8 }, locale));
    }
  } else {
    lines.push(t('winnerLottery.empty_matches', null, locale));
  }
  container.addTextDisplayComponents((td) => td.setContent(lines.join('\n').slice(0, 3900)));
  const rows = [];
  if (pageMatches.length) {
    rows.push(buildMatchSelect(pageMatches, 0, locale));
    if (pageMatches.length > 25) rows.push(buildMatchSelect(pageMatches, 1, locale));
  }
  const listButtons = [];
  if (totalPages > 1) {
    listButtons.push(
      new ButtonBuilder()
        .setCustomId(`${WINNER_LOTTERY_PREFIX}|list_page|${currentPage - 1}`)
        .setLabel(t('winnerLottery.button.prev_page', null, locale))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage <= 0),
      new ButtonBuilder()
        .setCustomId(`${WINNER_LOTTERY_PREFIX}|list_page|${currentPage + 1}`)
        .setLabel(t('winnerLottery.button.next_page', null, locale))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage >= totalPages - 1),
    );
  }
  listButtons.push(
    new ButtonBuilder()
      .setCustomId(`${WINNER_LOTTERY_PREFIX}|slip`)
      .setLabel(t('winnerLottery.button.slip', null, locale))
      .setEmoji(botingEmoji('cart'))
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(getWinnerSlipCount(userId) === 0),
  );
  rows.push(
    new ActionRowBuilder().addComponents(...listButtons),
    buildBotingMenuBackRow({ locale }),
  );
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
          .setEmoji(botingEmoji('plus'))
          .setStyle(ButtonStyle.Success)
          .setDisabled(isWinnerMatchClosed(match)),
        new ButtonBuilder()
          .setCustomId(`${WINNER_STAKE_KEYPAD_PREFIX}|open|${match.id}|${outcome}|${scorePick}|${stakes}`)
          .setLabel(t('winnerLottery.button.stake', null, locale))
          .setEmoji(botingEmoji('henko'))
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`${WINNER_LOTTERY_PREFIX}|score|${match.id}|${outcome}`)
          .setLabel(t('winnerLottery.button.back_score', null, locale))
          .setEmoji(botingEmoji('scoreboard'))
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
    rows.push(buildRemoveSelect(items, locale));
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${WINNER_LOTTERY_PREFIX}|checkout`)
          .setLabel(t('winnerLottery.button.checkout', null, locale))
          .setStyle(ButtonStyle.Success)
          .setDisabled(hasClosed),
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
  baseStakeCount = null,
  extraFlags = 0,
  locale = null,
}) {
  const stakes = Math.max(1, Math.min(9999, Math.round(Number(stakeCount) || 1)));
  const baseStakes = Math.max(
    1,
    Math.min(9999, Math.round(Number(baseStakeCount ?? stakeCount) || 1)),
  );
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
  const deltaButton = (delta, key, style = ButtonStyle.Secondary) =>
    new ButtonBuilder()
      .setCustomId(`${WINNER_STAKE_KEYPAD_PREFIX}|delta|${match.id}|${outcome}|${scorePick}|${stakes}|${delta}|${baseStakes}`)
      .setLabel(t(key, null, locale))
      .setStyle(style);
  return {
    content: null,
    embeds: [],
    components: [
      container,
      new ActionRowBuilder().addComponents(
        deltaButton(-10, 'winnerLottery.button.minus10', ButtonStyle.Danger),
        deltaButton(-1, 'winnerLottery.button.minus1', ButtonStyle.Danger),
        deltaButton(1, 'winnerLottery.button.plus1'),
        deltaButton(10, 'winnerLottery.button.plus10'),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${WINNER_LOTTERY_PREFIX}|confirm_screen|${match.id}|${outcome}|${scorePick}|${baseStakes}`)
          .setLabel(t('winnerLottery.button.back', null, locale))
          .setEmoji(botingEmoji('modoru'))
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`${WINNER_STAKE_KEYPAD_PREFIX}|ok|${match.id}|${outcome}|${scorePick}|${stakes}|${baseStakes}`)
          .setLabel(t('winnerLottery.button.ok', null, locale))
          .setEmoji(botingEmoji('naiyoukakutei'))
          .setStyle(ButtonStyle.Success),
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
