import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  TextDisplayBuilder,
} from 'discord.js';

/** 1点あたり bp の上限（従来モーダルに近い桁） */
export const MAX_UNIT_YEN = 9_999_999;
const MAX_HUNDREDS = Math.floor(MAX_UNIT_YEN / 100);
const MAX_BUFFER_LEN = String(MAX_HUNDREDS).length;

/**
 * 100 bp 単位に正規化（最低 100）
 * @param {number} n
 */
export function normalizeUnitYen100(n) {
  let v = Math.round(Number(n) || 0);
  if (!Number.isFinite(v) || v < 100) v = 100;
  v = Math.round(v / 100) * 100;
  if (v > MAX_UNIT_YEN) v = Math.floor(MAX_UNIT_YEN / 100) * 100;
  return v;
}

/**
 * 現在の単価からテンキー用の「100 の倍数の左側」（例: 1200 → "12"）を得る
 * @param {number} unitYen
 */
export function initBufferFromUnitYen(unitYen) {
  const u = normalizeUnitYen100(unitYen);
  const h = Math.max(1, u / 100);
  return String(h);
}

/**
 * テンキーのバッファ → 1点あたり bp（100 の倍数）
 * @param {string} buffer
 */
export function bufferToUnitYen(buffer) {
  const raw = String(buffer || '').replace(/\D/g, '');
  let h = parseInt(raw, 10);
  if (!Number.isFinite(h) || h < 1) h = 1;
  if (h > MAX_HUNDREDS) h = MAX_HUNDREDS;
  return h * 100;
}

/**
 * @param {string} digit
 * @param {string} buffer
 */
export function appendDigit(buffer, digit) {
  const d = String(digit).replace(/\D/g, '');
  if (d.length !== 1) return buffer;
  if (buffer === '' && d === '0') return buffer;
  if (buffer.length >= MAX_BUFFER_LEN) return buffer;
  return buffer + d;
}

/** @param {string} buffer */
export function deleteLastDigit(buffer) {
  return String(buffer || '').slice(0, -1);
}

/**
 * @param {{ buffer: string, subtitle?: string | null }} opts
 */
export function formatUnitKeypadHeadline({ buffer, subtitle }) {
  const part = buffer.length ? buffer : '_';
  const lines = [
    '**1点あたりの金額（100 bp 単位）**',
    subtitle ? String(subtitle) : null,
    `\`${part}\`00 bp`,
  ].filter(Boolean);
  return lines.join('\n');
}

function flowButtonId(raceId, op, arg) {
  if (op === 'd') return `race_unit_kpad|${raceId}|f|d|${arg}`;
  return `race_unit_kpad|${raceId}|f|${op}`;
}

function slipButtonId(raceId, idx, op, arg) {
  if (op === 'd') return `race_unit_kpad|${raceId}|s|${idx}|d|${arg}`;
  return `race_unit_kpad|${raceId}|s|${idx}|${op}`;
}

function idBuilder(raceId, kind, slipIdx) {
  if (kind === 'flow') {
    return (op, arg) => flowButtonId(raceId, op, arg);
  }
  const i = slipIdx ?? 0;
  return (op, arg) => slipButtonId(raceId, i, op, arg);
}

/**
 * @param {{ raceId: string, kind: 'flow' | 'slip', slipIdx?: number | null, buffer: string, subtitle?: string | null, extraFlags?: number }} opts
 */
export function buildUnitKeypadPayload({
  raceId,
  kind,
  slipIdx = null,
  buffer,
  subtitle = null,
  extraFlags = 0,
}) {
  const bid = idBuilder(raceId, kind, slipIdx);
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
      mk('del', ButtonStyle.Danger, 'del', ''),
      mk('0', ButtonStyle.Secondary, 'd', '0'),
      mk('決定', ButtonStyle.Success, 'ok', ''),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(bid('can', ''))
        .setLabel('キャンセル')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

  const text = formatUnitKeypadHeadline({ buffer, subtitle }).slice(0, 3900);
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
 * @returns {{ raceId: string, kind: 'flow' | 'slip', slipIdx?: number, op: 'digit' | 'del' | 'ok' | 'can', digit?: string } | null}
 */
export function parseUnitKeypadCustomId(customId) {
  const p = String(customId).split('|');
  if (p[0] !== 'race_unit_kpad' || p.length < 4) return null;
  const raceId = p[1];
  if (!/^\d{12}$/.test(raceId)) return null;

  if (p[2] === 'f') {
    if (p[3] === 'd' && p[4] != null && /^[0-9]$/.test(p[4])) {
      return { raceId, kind: 'flow', op: 'digit', digit: p[4] };
    }
    if (p[3] === 'del' || p[3] === 'ok' || p[3] === 'can') {
      return { raceId, kind: 'flow', op: p[3] };
    }
    return null;
  }

  if (p[2] === 's') {
    const slipIdx = parseInt(p[3], 10);
    if (!Number.isFinite(slipIdx) || slipIdx < 0) return null;
    if (p[4] === 'd' && p[5] != null && /^[0-9]$/.test(p[5])) {
      return { raceId, kind: 'slip', slipIdx, op: 'digit', digit: p[5] };
    }
    if (p[4] === 'del' || p[4] === 'ok' || p[4] === 'can') {
      return { raceId, kind: 'slip', slipIdx, op: p[4] };
    }
    return null;
  }

  return null;
}
