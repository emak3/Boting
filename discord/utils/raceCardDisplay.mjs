import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  ComponentType,
  ActionRowBuilder,
} from 'discord.js';
import { wakuUmaEmoji } from './raceNumberEmoji.mjs';
import { netkeibaResultUrl } from './netkeibaUrls.mjs';

/** Discord Display Components: 全 Text Display 合計 4000 文字まで */
const V2_TEXT_TOTAL_MAX = 3900;
const V2_SINGLE_CHUNK = 3500;

export const RACE_CARD_V2_FLAGS = MessageFlags.IsComponentsV2;

function horseBlock(horse) {
  const place = horse.placeOddsMin ? ` / 複勝〜${horse.placeOddsMin}` : '';
  const ninki =
    horse.popularity && horse.popularity !== 'N/A'
      ? ` | ${horse.popularity}人気`
      : '';
  const wu = wakuUmaEmoji(horse.frameNumber, horse.horseNumber);
  const numLabel = wu ? `${wu}` : `${horse.horseNumber}.`;
  const wakuPart = wu ? '' : `枠${horse.frameNumber} | `;
  const head = `**${numLabel} ${horse.name}**`.trim();
  const body = `${wakuPart}${horse.age} | ${horse.weight}kg · ${horse.jockey}${ninki}\n単勝 ${horse.odds}${place}`;
  return `${head}\n${body}`;
}

/** @returns {string[]} 各要素を Text Display 1つに近いサイズに分割 */
function splitForTextDisplays(fullText) {
  const capped = fullText.slice(0, V2_TEXT_TOTAL_MAX);
  if (capped.length <= V2_SINGLE_CHUNK) return [capped];
  const out = [];
  let rest = capped;
  while (rest.length > 0) {
    if (rest.length <= V2_SINGLE_CHUNK) {
      out.push(rest);
      break;
    }
    let cut = rest.lastIndexOf('\n\n', V2_SINGLE_CHUNK);
    if (cut < V2_SINGLE_CHUNK / 2) cut = V2_SINGLE_CHUNK;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  return out;
}

/**
 * 出馬表を Container（Text Display + Separator）で組み立て、続けて操作行を並べる。
 * @param {{ result: object, headline?: string, actionRows?: import('discord.js').ActionRowBuilder[], extraFlags?: number }} opts
 */
export function buildRaceCardV2Payload({
  result,
  headline = '',
  actionRows = [],
  extraFlags = 0,
}) {
  const rows = actionRows.filter(Boolean);
  const flags = MessageFlags.IsComponentsV2 | extraFlags;

  if (!result?.horses?.length) {
    const msg =
      '出馬表データがありません。セッションが切れたか取得に失敗しています。もう一度 /race から開き直してください。';
    const body = [headline, msg].filter(Boolean).join('\n\n').slice(0, V2_TEXT_TOTAL_MAX);
    return {
      content: null,
      embeds: [],
      components: [new TextDisplayBuilder().setContent(body), ...rows],
      flags,
    };
  }

  const raceId = result.raceId;
  const isResult = !!result.isResult;
  const origin = result.netkeibaOrigin === 'nar' ? 'nar' : 'jra';
  const resultUrl = raceId ? netkeibaResultUrl(raceId, origin) : null;

  const titleLine = `${isResult ? '🏁' : '🐎'} **${result.raceInfo?.title || 'レース情報'}**`;
  const meta = `**日程:** ${result.raceInfo?.date || 'N/A'}\n**コース:** ${result.raceInfo?.course || 'N/A'}`;
  const footParts = [
    `全${result.totalHorses}頭${
      result.oddsOfficialTime ? ` · オッズ時刻 ${result.oddsOfficialTime}` : ''
    }`,
    isResult && resultUrl ? `結果: ${resultUrl}` : null,
  ].filter(Boolean);
  const footerLine = footParts.join(' · ');

  const slice = result.horses.slice(0, 18);
  const horseLines = slice.map(horseBlock);
  if (result.horses.length > 18) {
    horseLines.push(
      `*※ 表示は先頭18頭まで（全${result.totalHorses}頭取得済み）*`,
    );
  }

  const prose = [
    headline,
    titleLine,
    meta,
    footerLine,
    '—',
    horseLines.join('\n\n'),
  ]
    .filter(Boolean)
    .join('\n\n');

  const chunks = splitForTextDisplays(prose);
  const container = new ContainerBuilder().setAccentColor(
    isResult ? 0xf1c40f : 0x0099ff,
  );

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    container.addTextDisplayComponents((td) => td.setContent(chunk));
    if (i < chunks.length - 1) {
      container.addSeparatorComponents((sep) =>
        sep.setSpacing(SeparatorSpacingSize.Small).setDivider(true),
      );
    }
  }

  return {
    content: null,
    embeds: [],
    components: [container, ...rows],
    flags,
  };
}

/**
 * 出馬表なし（購入サマリー等）の Components V2 本文 + 操作行
 * @param {{ headline: string, actionRows?: import('discord.js').ActionRowBuilder[], extraFlags?: number }} opts
 */
export function buildTextAndRowsV2Payload({
  headline,
  actionRows = [],
  extraFlags = 0,
}) {
  const rows = actionRows.filter(Boolean);
  const text = String(headline || '').slice(0, V2_TEXT_TOTAL_MAX);
  return {
    content: null,
    embeds: [],
    components: [new TextDisplayBuilder().setContent(text), ...rows],
    flags: MessageFlags.IsComponentsV2 | extraFlags,
  };
}

/** Components V2 メッセージのうち、トップレベルの Action Row だけ取り出す（モーダル後の部分更新用） */
export function extractTopLevelActionRowsFromMessage(message) {
  const out = [];
  for (const row of message.components ?? []) {
    const type = row.type ?? row.data?.type;
    if (type === ComponentType.ActionRow) {
      out.push(ActionRowBuilder.from(row.toJSON()));
    }
  }
  return out;
}
