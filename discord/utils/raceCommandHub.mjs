import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
} from 'discord.js';
import { getBalance } from './userPointsStore.mjs';
import { scheduleKindSelectRow } from './scheduleKindUi.mjs';

export const RACE_CMD_HUB_PREFIX = 'race_cmd_hub';

const HUB_ACCENT = 0x5865f2;

export const SCHEDULE_KIND_INTRO_BODY =
  'まず **中央(JRA)** か **地方(NAR)** を選び、その後に開催場を選ぶとレース一覧が表示されます。続けてレースを選ぶと出馬表を表示します。';

export const VENUE_PICK_INTRO_BODY =
  '開催場を選ぶと、その場のレース一覧（発走時刻・発売状態）が表示されます。続けてレースを選ぶと出馬表を表示します。';

/** /race ハブへ戻る（各サブ画面の最下行に並べる） */
export function buildRaceHubBackButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${RACE_CMD_HUB_PREFIX}|back`)
      .setLabel('メニューに戻る')
      .setStyle(ButtonStyle.Secondary),
  );
}

function fmtBpLine(balance) {
  const n = Math.round(Number(balance) || 0);
  return `bp残高：\`${n.toLocaleString('ja-JP')}bp\``;
}

/**
 * /race トップ: bp 表示 + 馬券購入 / 履歴 / 購入予定
 * @param {{ userId: string, extraFlags?: number }} opts
 */
export async function buildRaceHubV2Payload({ userId, extraFlags = 0 }) {
  const balance = await getBalance(userId);
  const container = new ContainerBuilder().setAccentColor(HUB_ACCENT);
  container.addTextDisplayComponents((td) =>
    td.setContent(
      [fmtBpLine(balance), '', 'ボタンかコマンドの選択肢から操作してください。'].join('\n'),
    ),
  );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${RACE_CMD_HUB_PREFIX}|purchase`)
      .setLabel('馬券を購入')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${RACE_CMD_HUB_PREFIX}|history`)
      .setLabel('購入履歴')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${RACE_CMD_HUB_PREFIX}|slip`)
      .setLabel('購入予定')
      .setStyle(ButtonStyle.Secondary),
  );
  return {
    content: null,
    embeds: [],
    components: [container, row],
    flags: MessageFlags.IsComponentsV2 | extraFlags,
  };
}

/**
 * JRA/NAR 選択へ（説明を Container に載せる）
 * @param {{ userId: string, extraFlags?: number }} opts
 */
export async function buildRaceScheduleIntroV2Payload({ userId, extraFlags = 0 }) {
  const balance = await getBalance(userId);
  const container = new ContainerBuilder().setAccentColor(HUB_ACCENT);
  const body = [fmtBpLine(balance), '', SCHEDULE_KIND_INTRO_BODY].join('\n');
  container.addTextDisplayComponents((td) => td.setContent(body));
  return {
    content: null,
    embeds: [],
    components: [container, scheduleKindSelectRow(), buildRaceHubBackButtonRow()],
    flags: MessageFlags.IsComponentsV2 | extraFlags,
  };
}

/**
 * 開催場選択の直前画面（bp + 案内を Container、続けて actionRows）
 * @param {{ userId: string, extraFlags?: number, actionRows?: import('discord.js').ActionRowBuilder[] }} opts
 */
export async function buildVenuePickIntroV2Payload({
  userId,
  extraFlags = 0,
  actionRows = [],
}) {
  const balance = await getBalance(userId);
  const container = new ContainerBuilder().setAccentColor(HUB_ACCENT);
  container.addTextDisplayComponents((td) =>
    td.setContent([fmtBpLine(balance), '', VENUE_PICK_INTRO_BODY].join('\n')),
  );
  return {
    content: null,
    embeds: [],
    components: [container, ...actionRows.filter(Boolean)],
    flags: MessageFlags.IsComponentsV2 | extraFlags,
  };
}
