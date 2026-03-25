import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  TextDisplayBuilder,
} from 'discord.js';
import { botingEmoji } from '../boting/botingEmojis.mjs';
import { t } from '../../../i18n/index.mjs';

export const BP_RANK_OPEN_LIM_PREFIX = 'bp_rank_open_lim';
export const BP_RANK_LIM_KPAD_PREFIX = 'bp_rank_lim_kpad';

/** ランキング表示件数の上限（1〜この値） */
export const BP_RANK_DISPLAY_MAX = 25;

const MAX_LIMIT = BP_RANK_DISPLAY_MAX;
const MAX_BUFFER_LEN = 2;

/**
 * @param {string} buffer
 * @param {string} digit
 */
export function appendDigitLimit(buffer, digit) {
  const d = String(digit).replace(/\D/g, '');
  if (d.length !== 1) return buffer;
  if (buffer === '' && d === '0') return buffer;
  if (buffer.length >= MAX_BUFFER_LEN) return buffer;
  const next = buffer + d;
  const n = parseInt(next, 10);
  if (!Number.isFinite(n) || n > MAX_LIMIT) return buffer;
  return next;
}

/** @param {string} buffer */
export function deleteLastDigitLimit(buffer) {
  return String(buffer || '').slice(0, -1);
}

/**
 * @param {string} buffer
 * @returns {number}
 */
export function bufferToLimit(buffer) {
  const raw = String(buffer || '').replace(/\D/g, '');
  let n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) n = 1;
  if (n > MAX_LIMIT) n = MAX_LIMIT;
  return n;
}

function formatHeadline(buffer, locale = null) {
  const part = buffer.length ? buffer : '_';
  return [
    t('bp_rank.keypad.headline', { max: MAX_LIMIT }, locale),
    t('bp_rank.keypad.value_line', { part }, locale),
  ].join('\n');
}

function mkId(op, arg = '') {
  if (op === 'd') return `${BP_RANK_LIM_KPAD_PREFIX}|d|${arg}`;
  return `${BP_RANK_LIM_KPAD_PREFIX}|${op}`;
}

/**
 * @param {{ buffer: string, extraFlags?: number, locale?: string | null }} opts
 */
export function buildBpRankLimitKeypadPayload({
  buffer,
  extraFlags = 0,
  locale = null,
}) {
  const bid = mkId;
  const mk = (label, style, op, arg) =>
    new ButtonBuilder().setCustomId(bid(op, arg)).setLabel(label).setStyle(style);
  const mkEmoji = (emojiKey, style, op, arg) =>
    new ButtonBuilder()
      .setCustomId(bid(op, arg))
      .setStyle(style)
      .setEmoji(botingEmoji(emojiKey));

  const rows = [
    new ActionRowBuilder().addComponents(
      mk('7', ButtonStyle.Secondary, 'd', '7'),
      mk('8', ButtonStyle.Secondary, 'd', '8'),
      mk('9', ButtonStyle.Secondary, 'd', '9'),
    ),
    new ActionRowBuilder().addComponents(
      mk('4', ButtonStyle.Secondary, 'd', '4'),
      mk('5', ButtonStyle.Secondary, 'd', '5'),
      mk('6', ButtonStyle.Secondary, 'd', '6'),
    ),
    new ActionRowBuilder().addComponents(
      mk('1', ButtonStyle.Secondary, 'd', '1'),
      mk('2', ButtonStyle.Secondary, 'd', '2'),
      mk('3', ButtonStyle.Secondary, 'd', '3'),
    ),
    new ActionRowBuilder().addComponents(
      mkEmoji('textdelete', ButtonStyle.Danger, 'del', ''),
      mk('0', ButtonStyle.Secondary, 'd', '0'),
      mkEmoji('check', ButtonStyle.Success, 'ok', ''),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(bid('can', ''))
        .setLabel(t('bp_rank.keypad.cancel', null, locale))
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

  const text = formatHeadline(buffer, locale).slice(0, 3900);
  const flags = MessageFlags.IsComponentsV2 | extraFlags;
  return {
    content: null,
    embeds: [],
    components: [new TextDisplayBuilder().setContent(text), ...rows],
    flags,
  };
}

/**
 * @param {string} customId
 * @returns {{ op: 'digit' | 'del' | 'ok' | 'can', digit?: string } | null}
 */
export function parseBpRankLimitKeypadId(customId) {
  const p = String(customId).split('|');
  if (p[0] !== BP_RANK_LIM_KPAD_PREFIX || p.length < 2) return null;
  if (p[1] === 'd' && p[2] != null && /^[0-9]$/.test(p[2])) {
    return { op: 'digit', digit: p[2] };
  }
  if (p[1] === 'del' || p[1] === 'ok' || p[1] === 'can') {
    return { op: p[1] };
  }
  return null;
}
