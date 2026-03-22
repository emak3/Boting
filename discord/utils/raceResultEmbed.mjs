import {
  wakuUmaEmoji,
  jogaiEmoji,
  formatNumsWithWakuUmaEmoji,
  formatWakurenNumsWithEmoji,
} from './raceNumberEmoji.mjs';
import { netkeibaResultUrl } from './netkeibaUrls.mjs';

function buildHorseNumToFrameMap(horses) {
  const horseNumToFrame = new Map();
  for (const h of horses) {
    const key = parseInt(String(h.horseNumber).replace(/\D/g, ''), 10);
    if (Number.isFinite(key)) horseNumToFrame.set(String(key), h.frameNumber);
  }
  return horseNumToFrame;
}

/** 1頭分（見出し行 + 詳細行） */
function formatHorseResultBlock(h) {
  const wu = wakuUmaEmoji(h.frameNumber, h.horseNumber);
  const frame = h.frameNumber != null && h.frameNumber !== 'N/A' ? `枠${h.frameNumber}` : '';
  const num = h.horseNumber != null && h.horseNumber !== 'N/A' ? `${h.horseNumber}番` : '';
  const wakuUma = wu ? `${wu}` : [frame, num].filter(Boolean).join(' ');
  const jog = h.excluded ? jogaiEmoji() : null;
  const rankText =
    h.excluded || String(h.finishRank || '').includes('除')
      ? `**除外**${jog ? ` ${jog}` : ''}`
      : `**${h.finishRank}着**`;
  const head = `${rankText} ${wakuUma} ${h.name || '—'}`.replace(/\s+/g, ' ').trim();
  const meta = [
    h.jockey && h.jockey !== 'N/A' ? h.jockey : null,
    h.time && h.time !== 'N/A' ? `タイム ${h.time}` : null,
    h.margin ? `着差 ${h.margin}` : null,
    h.popularity && h.popularity !== 'N/A' ? `${h.popularity}人気` : null,
    h.odds && h.odds !== 'N/A' ? `単勝 ${h.odds}` : null,
  ].filter(Boolean);
  const sub = meta.length ? meta.join(' · ') : '';
  return { head, sub };
}

function groupPayoutsByLabel(payouts) {
  const groups = [];
  for (const p of payouts) {
    const lab = (p.label || 'その他').trim();
    const prev = groups[groups.length - 1];
    if (prev && prev.label === lab) prev.items.push(p);
    else groups.push({ label: lab, items: [p] });
  }
  return groups;
}

function formatPayoutItemLine(p, horseNumToFrame) {
  const fmtNums = (nums, joiner) => {
    if (!nums?.length) return '—';
    return formatNumsWithWakuUmaEmoji(nums, joiner || '-', horseNumToFrame);
  };
  const isWakuren = /枠連/.test(p.label || '');
  const numPart = p.nums?.length
    ? isWakuren
      ? formatWakurenNumsWithEmoji(p.nums, p.joiner || '-')
      : fmtNums(p.nums, p.joiner || '-')
    : p.result && p.result !== '—'
      ? p.result
      : '—';
  const nk = p.ninki ? String(p.ninki).replace(/\s+/g, ' ').trim() : '';
  const ninkiSuffix = nk ? `（${nk}）` : '';
  return `・${numPart}　→　**${p.payout}**${ninkiSuffix}`;
}

/** 払い戻しブロック（Markdown） */
function formatPayoutSection(payouts, horseNumToFrame) {
  if (!payouts?.length) return '';
  const lines = [];
  for (const { label, items } of groupPayoutsByLabel(payouts)) {
    lines.push(`**${label}**`);
    for (const p of items) lines.push(formatPayoutItemLine(p, horseNumToFrame));
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

const EMBED_FIELD_VALUE_MAX = 1024;
const EMBED_HORSE_CHUNK_TARGET = 950;

function chunkHorseEmbedValues(horseLines) {
  const chunks = [];
  let cur = [];
  let n = 0;
  for (const block of horseLines) {
    const piece = block;
    const add = piece.length + (cur.length ? 1 : 0);
    if (n + add > EMBED_HORSE_CHUNK_TARGET && cur.length) {
      chunks.push(cur.join('\n\n'));
      cur = [piece];
      n = piece.length;
    } else {
      cur.push(piece);
      n += add;
    }
  }
  if (cur.length) chunks.push(cur.join('\n\n'));
  return chunks.map((c) => c.slice(0, EMBED_FIELD_VALUE_MAX));
}

/** @param {{ raceId?: string, raceInfo?: object, horses?: object[], payouts?: object[], netkeibaOrigin?: string }} parsed */
export function buildRaceResultEmbeds(parsed) {
  const raceId = parsed?.raceId;
  const origin = parsed?.netkeibaOrigin === 'nar' ? 'nar' : 'jra';
  const url = raceId ? netkeibaResultUrl(raceId, origin) : null;

  const ri = parsed.raceInfo || {};
  const descLines = [
    `📅 **日程** ${ri.date || 'N/A'}`,
    `🏟 **コース** ${ri.course || 'N/A'}`,
  ];
  if (ri.prizeMoney) descLines.push(ri.prizeMoney);
  if (url) descLines.push(`🔗 [netkeibaで開く](${url})`);
  const desc = descLines.join('\n');

  const horses = parsed.horses || [];
  const horseNumToFrame = buildHorseNumToFrameMap(horses);

  const horseBlocks = horses.slice(0, 25).map((h) => {
    const { head, sub } = formatHorseResultBlock(h);
    return sub ? `${head}\n${sub}` : head;
  });
  const allHorseChunks = chunkHorseEmbedValues(horseBlocks);
  const totalHorseChunks = allHorseChunks.length;
  const horseChunks = allHorseChunks.slice(0, 25);
  const fields = horseChunks.map((content, i) => ({
    name:
      totalHorseChunks > 1
        ? `着順（${i + 1} / ${totalHorseChunks}）`
        : '着順',
    value:
      i === horseChunks.length - 1 && totalHorseChunks > 25
        ? `${content}\n\n*（Discordの枠数制限のため以降省略）*`.slice(0, EMBED_FIELD_VALUE_MAX)
        : content || '—',
    inline: false,
  }));

  let payoutDesc = formatPayoutSection(parsed.payouts || [], horseNumToFrame);
  if (payoutDesc.length > 4090) payoutDesc = `${payoutDesc.slice(0, 4087)}…`;

  const main = {
    color: 0xed4245,
    title: `🏁 ${ri.title || 'レース結果'}`,
    description: desc,
    fields,
    footer: { text: `全${horses.length}頭` },
  };

  const embeds = [main];
  if (payoutDesc) {
    embeds.push({
      color: 0xed4245,
      title: '💴 払い戻し',
      description: payoutDesc,
    });
  }

  return embeds;
}

const V2_RESULT_TEXT_MAX = 3900;

/**
 * Components V2 用：区切り線は Text ではなく Separator コンポーネントで入れる前提の3ブロック
 * @returns {{ header: string, ranks: string, payout: string | null }}
 */
export function buildRaceResultV2Sections(parsed) {
  const ri = parsed.raceInfo || {};
  const raceId = parsed?.raceId;
  const origin = parsed?.netkeibaOrigin === 'nar' ? 'nar' : 'jra';
  const url = raceId ? netkeibaResultUrl(raceId, origin) : null;
  const horses = parsed.horses || [];
  const horseNumToFrame = buildHorseNumToFrameMap(horses);

  const headLines = [
    `🏁 **${ri.title || 'レース結果'}**`,
    '',
    `📅 ${ri.date || 'N/A'}`,
    `🏟 ${ri.course || 'N/A'}`,
  ];
  if (ri.prizeMoney) headLines.push(ri.prizeMoney);
  if (url) headLines.push(url);
  const header = headLines.join('\n');

  const rankLines = ['**着順**', ''];
  for (const h of horses) {
    const { head, sub } = formatHorseResultBlock(h);
    rankLines.push(head);
    if (sub) rankLines.push(sub);
    rankLines.push('');
  }
  const ranks = rankLines.join('\n').trimEnd();

  const pay = formatPayoutSection(parsed.payouts || [], horseNumToFrame);
  const payout = pay ? `**払い戻し**\n\n${pay}` : null;

  return { header, ranks, payout };
}

/** プレーンテキストが必要なとき用（区切りは空行のみ） */
export function buildRaceResultV2Text(parsed) {
  const { header, ranks, payout } = buildRaceResultV2Sections(parsed);
  const parts = [header, ranks];
  if (payout) parts.push(payout);
  let out = parts.join('\n\n').trimEnd();
  if (out.length > V2_RESULT_TEXT_MAX) out = `${out.slice(0, V2_RESULT_TEXT_MAX - 1)}…`;
  return out;
}
