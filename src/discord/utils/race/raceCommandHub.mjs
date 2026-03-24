import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
} from 'discord.js';
import { canBypassDailyCooldown } from '../debug/raceDebugBypass.mjs';
import { getBalance, getDailyAccountView } from '../user/userPointsStore.mjs';
import { scheduleKindSelectRow } from './scheduleKindUi.mjs';
import { buildDailyAccountV2Container } from '../daily/dailyAccountDisplay.mjs';
import {
  BOTING_HUB_BUTTON_EMOJI,
  BOTING_HUB_PREFIX,
} from '../boting/botingHubConstants.mjs';
import { buildBotingMenuBackRow } from '../boting/botingBackButton.mjs';
import { botingEmoji } from '../boting/botingEmojis.mjs';

export { BOTING_HUB_PREFIX };
export { buildBotingMenuBackRow };

const HUB_ACCENT = 0x5865f2;

export const SCHEDULE_KIND_INTRO_BODY =
  'まず **中央(JRA)** か **地方(NAR)** を選び、その後に開催場を選ぶとレース一覧が表示されます。続けてレースを選ぶと出馬表を表示します。';

export const VENUE_PICK_INTRO_BODY =
  '開催場を選ぶと、その場のレース一覧（発走時刻・発売状態）が表示されます。続けてレースを選ぶと出馬表を表示します。';

function fmtBpLine(balance) {
  const n = Math.round(Number(balance) || 0);
  return `bp残高：\`${n.toLocaleString('ja-JP')}bp\``;
}

/**
 * `/boting` メインパネル: Daily 収支 Container + 操作ボタン（常に Components V2）
 * @param {{ user: import('discord.js').User, guild: import('discord.js').Guild | null, extraFlags?: number, dailySuccessBanner?: string | null }} opts
 */
export async function buildBotingPanelPayload({
  user,
  guild,
  extraFlags = 0,
  dailySuccessBanner = null,
}) {
  void guild;
  const view = await getDailyAccountView(user.id, { withLedgerPreview: false });
  const debugBypass = canBypassDailyCooldown(user.id);
  const claimed =
    view.lastDailyPeriodKey === view.currentPeriodKey && !!view.lastDailyPeriodKey;
  const dailyDisabled = claimed && !debugBypass;

  const dailyContainer = buildDailyAccountV2Container(view, {
    claimed,
    successBanner: dailySuccessBanner,
  });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BOTING_HUB_PREFIX}|daily`)
      .setLabel('Dailyをもらう')
      .setEmoji(botingEmoji('daily'))
      .setStyle(ButtonStyle.Success)
      .setDisabled(dailyDisabled),
    new ButtonBuilder()
      .setCustomId(`${BOTING_HUB_PREFIX}|rank`)
      .setLabel('ランキング')
      .setEmoji(botingEmoji('ranking'))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${BOTING_HUB_PREFIX}|ledger`)
      .setLabel('直近の収支')
      .setEmoji(botingEmoji('syushi'))
      .setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BOTING_HUB_PREFIX}|purchase`)
      .setLabel('馬券を購入')
      .setEmoji(botingEmoji('ken'))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${BOTING_HUB_PREFIX}|history`)
      .setLabel('購入履歴')
      .setEmoji(botingEmoji('history'))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${BOTING_HUB_PREFIX}|slip`)
      .setLabel('購入予定')
      .setEmoji(botingEmoji('cart'))
      .setStyle(ButtonStyle.Secondary),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BOTING_HUB_PREFIX}|annual_stats`)
      .setLabel('年間統計')
      .setEmoji(BOTING_HUB_BUTTON_EMOJI.annualStats)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${BOTING_HUB_PREFIX}|weekly_challenge`)
      .setLabel('週間チャレンジ')
      .setEmoji(BOTING_HUB_BUTTON_EMOJI.weeklyChallenge)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${BOTING_HUB_PREFIX}|help`)
      .setLabel('ヘルプ')
      .setEmoji(botingEmoji('help'))
      .setStyle(ButtonStyle.Secondary),
  );

  return {
    content: null,
    embeds: [],
    components: [dailyContainer, row1, row2, row3],
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
    components: [container, scheduleKindSelectRow(), buildBotingMenuBackRow()],
    flags: MessageFlags.IsComponentsV2 | extraFlags,
  };
}

/**
 * 開催場選択の直前画面（bp + 案内を Container、続けて actionRows）
 * @param {{ userId: string, extraFlags?: number, actionRows?: import('discord.js').ActionRowBuilder[], introBodySuffix?: string }} opts
 */
export async function buildVenuePickIntroV2Payload({
  userId,
  extraFlags = 0,
  actionRows = [],
  introBodySuffix = '',
}) {
  const balance = await getBalance(userId);
  const container = new ContainerBuilder().setAccentColor(HUB_ACCENT);
  const bodyParts = [fmtBpLine(balance), '', VENUE_PICK_INTRO_BODY];
  if (introBodySuffix) bodyParts.push(introBodySuffix);
  container.addTextDisplayComponents((td) => td.setContent(bodyParts.join('\n')));
  return {
    content: null,
    embeds: [],
    components: [container, ...actionRows.filter(Boolean), buildBotingMenuBackRow()],
    flags: MessageFlags.IsComponentsV2 | extraFlags,
  };
}
