import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  TextDisplayBuilder,
} from 'discord.js';
import { DEBUG_BP_KPAD_PREFIX } from './debugHubConstants.mjs';
import { botingEmoji } from './botingEmojis.mjs';

/** JS の安全な整数まで（それ以上は bufferToDebugBpAmount で丸める） */
const MAX_BUFFER_LEN = 16;

export function appendDigitDebugBp(buffer, digit) {
  const d = String(digit).replace(/\D/g, '');
  if (d.length !== 1) return buffer;
  if (buffer === '' && d === '0') return buffer;
  if (buffer.length >= MAX_BUFFER_LEN) return buffer;
  return buffer + d;
}

export function deleteLastDigitDebugBp(buffer) {
  return String(buffer || '').slice(0, -1);
}

export function bufferToDebugBpAmount(buffer) {
  const raw = String(buffer || '').replace(/\D/g, '');
  if (raw === '') return 1;
  let n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) n = 1;
  if (n > Number.MAX_SAFE_INTEGER) n = Number.MAX_SAFE_INTEGER;
  return n;
}

function mkId(op, arg = '') {
  if (op === 'd') return `${DEBUG_BP_KPAD_PREFIX}|d|${arg}`;
  return `${DEBUG_BP_KPAD_PREFIX}|${op}`;
}

/**
 * @param {{ mode: 'grant' | 'revoke', targetLabel: string, buffer: string, extraFlags?: number }} opts
 */
export function buildDebugBpKeypadPayload({
  mode,
  targetLabel,
  buffer,
  extraFlags = 0,
}) {
  const verb = mode === 'grant' ? '付与' : '剥奪';
  const part = buffer.length ? buffer : '_';
  const headline = [
    `**BP を${verb}（${targetLabel}）**`,
    `入力中: \`${part}\` bp（1〜${Number.MAX_SAFE_INTEGER.toLocaleString('ja-JP')} まで）`,
  ].join('\n');

  const bid = mkId;
  const mk = (label, style, op, arg) =>
    new ButtonBuilder().setCustomId(bid(op, arg)).setLabel(label).setStyle(style);

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
        .setLabel('ユーザー選択に戻る')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

  const text = headline.slice(0, 3900);
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
export function parseDebugBpKeypadId(customId) {
  const p = String(customId).split('|');
  if (p[0] !== DEBUG_BP_KPAD_PREFIX || p.length < 2) return null;
  const kind = p[1];
  if (kind === 'd' && p[2] != null) return { op: 'digit', digit: p[2] };
  if (kind === 'del') return { op: 'del' };
  if (kind === 'ok') return { op: 'ok' };
  if (kind === 'can') return { op: 'can' };
  return null;
}
