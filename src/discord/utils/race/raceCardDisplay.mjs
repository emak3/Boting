import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  ComponentType,
  ActionRowBuilder,
} from 'discord.js';
import { wakuUmaEmoji, jogaiEmoji } from './raceNumberEmoji.mjs';
import { netkeibaResultUrl } from '../netkeiba/netkeibaUrls.mjs';
import { buildRaceResultV2Sections } from './raceResultEmbed.mjs';
import { maybeInsertRaceBetUtilityRow } from '../bet/betSlipViewUi.mjs';
import { buildBotingMenuBackRow } from '../boting/botingBackButton.mjs';

/** Discord Display Components: 全 Text Display 合計 4000 文字まで */
export const V2_TEXT_TOTAL_MAX = 3900;
export const V2_SINGLE_CHUNK = 3500;

export const RACE_CARD_V2_FLAGS = MessageFlags.IsComponentsV2;

/** 出馬表 Container のアクセント（左側の色帯） */
export const RACE_CARD_ACCENT_BLUE = 0x0099ff;
/** レース結果・払戻 Container のアクセント */
export const RACE_RESULT_ACCENT_RED = 0xed4245;
/** 購入サマリー・完了・エラー案内など、本文のみの V2 パネル（まとめ購入確認と同系の緑帯） */
export const V2_TEXT_PANEL_ACCENT = 0x2ecc71;

function horseBlock(horse) {
  const place = horse.placeOddsMin ? ` / 複勝〜${horse.placeOddsMin}` : '';
  const ninki =
    horse.popularity && horse.popularity !== 'N/A'
      ? ` | ${horse.popularity}人気`
      : '';
  const wu = wakuUmaEmoji(horse.frameNumber, horse.horseNumber);
  const numLabel = wu ? `${wu}` : `${horse.horseNumber}.`;
  const wakuPart = wu ? '' : `枠${horse.frameNumber} | `;
  const jog = horse.excluded ? jogaiEmoji() : null;
  const head = `**${numLabel} ${horse.name}${jog ? ` ${jog}` : ''}**`.trim();
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

/** 長文を複数 Text Display に分割し、間に Separator を挟む */
function appendChunkedToContainer(container, text) {
  const chunks = splitForTextDisplays(String(text || '').trimEnd()).filter((c) => String(c).trim());
  for (let i = 0; i < chunks.length; i++) {
    container.addTextDisplayComponents((td) => td.setContent(chunks[i]));
    if (i < chunks.length - 1) {
      container.addSeparatorComponents((sep) =>
        sep.setSpacing(SeparatorSpacingSize.Small).setDivider(true),
      );
    }
  }
}

/**
 * 出馬表を Container（Text Display + Separator）で組み立て、続けて操作行を並べる。
 * @param {{ result: object, headline?: string, actionRows?: import('discord.js').ActionRowBuilder[], extraFlags?: number, utilityContext?: { userId: string, flow?: object } | null }} opts
 */
export function buildRaceCardV2Payload({
  result,
  headline = '',
  actionRows = [],
  extraFlags = 0,
  utilityContext = null,
}) {
  let rows = actionRows.filter(Boolean);
  if (utilityContext?.userId && result?.raceId) {
    rows = maybeInsertRaceBetUtilityRow(
      utilityContext.userId,
      String(result.raceId),
      rows,
      utilityContext.flow,
    );
  }
  const flags = MessageFlags.IsComponentsV2 | extraFlags;

  if (!result?.horses?.length) {
    const msg =
      '出馬表データがありません。セッションが切れたか取得に失敗しています。もう一度 /boting から開き直してください。';
    const body = [headline, msg].filter(Boolean).join('\n\n').slice(0, V2_TEXT_TOTAL_MAX);
    return {
      content: null,
      embeds: [],
      components: [
        new TextDisplayBuilder().setContent(body),
        buildBotingMenuBackRow(),
        ...rows,
      ],
      flags,
    };
  }

  const raceId = result.raceId;
  const isResult = !!result.isResult;
  const origin = result.netkeibaOrigin === 'nar' ? 'nar' : 'jra';
  const resultUrl = raceId ? netkeibaResultUrl(raceId, origin) : null;

  const titleLine = `${isResult ? '🏁' : '🐎'} **${result.raceInfo?.title || 'レース情報'}**`;
  const ri = result.raceInfo || {};
  const courseBlock = ri.prizeMoney
    ? `**コース:** ${ri.course || 'N/A'}\n${ri.prizeMoney}`
    : `**コース:** ${ri.course || 'N/A'}`;
  const meta = `**日程:** ${ri.date || 'N/A'}\n${courseBlock}`;
  const footParts = [
    `全${result.totalHorses}頭${
      result.oddsOfficialTime ? ` · 取得時刻 ${result.oddsOfficialTime}` : ''
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

  const topBlock = [headline, titleLine, meta, footerLine].filter(Boolean).join('\n\n');
  const horsesText = horseLines.join('\n\n');

  const container = new ContainerBuilder().setAccentColor(RACE_CARD_ACCENT_BLUE);
  appendChunkedToContainer(container, topBlock);
  container.addSeparatorComponents((separator) => separator);
  appendChunkedToContainer(container, horsesText);

  return {
    content: null,
    embeds: [],
    components: [container, ...rows],
    flags,
  };
}

/**
 * レース結果・払戻（Components V2）— 赤アクセントの Container
 * @param {{ parsed: object, actionRows?: import('discord.js').ActionRowBuilder[], extraFlags?: number, bpFooter?: string | null }} opts
 */
export function buildRaceResultV2Payload({
  parsed,
  actionRows = [],
  extraFlags = 0,
  bpFooter = null,
}) {
  const rows = actionRows.filter(Boolean);
  const flags = MessageFlags.IsComponentsV2 | extraFlags;
  const { header, ranks, payout } = buildRaceResultV2Sections(parsed);
  const container = new ContainerBuilder().setAccentColor(RACE_RESULT_ACCENT_RED);

  appendChunkedToContainer(container, header);
  container.addSeparatorComponents((separator) => separator);
  appendChunkedToContainer(container, ranks);
  if (payout) {
    container.addSeparatorComponents((separator) => separator);
    appendChunkedToContainer(container, payout);
  }
  if (bpFooter) {
    container.addSeparatorComponents((separator) => separator);
    appendChunkedToContainer(container, String(bpFooter));
  }

  return {
    content: null,
    embeds: [],
    components: [container, ...rows],
    flags,
  };
}

/**
 * 出馬表なし（購入サマリー・購入完了等）の Components V2: Container + 操作行
 * @param {{ headline: string, actionRows?: import('discord.js').ActionRowBuilder[], extraFlags?: number, accentColor?: number, withBotingMenuBack?: boolean }} opts
 */
export function buildTextAndRowsV2Payload({
  headline,
  actionRows = [],
  extraFlags = 0,
  accentColor = V2_TEXT_PANEL_ACCENT,
  withBotingMenuBack = false,
}) {
  const rows = actionRows.filter(Boolean);
  if (withBotingMenuBack) {
    rows.push(buildBotingMenuBackRow());
  }
  const raw = String(headline || '').trimEnd().slice(0, V2_TEXT_TOTAL_MAX);
  const container = new ContainerBuilder().setAccentColor(accentColor);
  if (raw.trim()) {
    appendChunkedToContainer(container, raw);
  } else {
    container.addTextDisplayComponents((td) => td.setContent('—'));
  }
  return {
    content: null,
    embeds: [],
    components: [container, ...rows],
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
