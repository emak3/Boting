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
import { formatBpWithUnit } from '../bp/bpFormat.mjs';
import { t } from '../../../i18n/index.mjs';

export { BOTING_HUB_PREFIX };
export { buildBotingMenuBackRow };

const HUB_ACCENT = 0x5865f2;

/** @deprecated 文言は `boting_hub.schedule_kind_intro`（`buildRaceScheduleIntroV2Payload` の locale 参照） */
export const SCHEDULE_KIND_INTRO_BODY =
  'まず **中央(JRA)** か **地方(NAR)** を選び、その後に開催場を選ぶとレース一覧が表示されます。続けてレースを選ぶと出馬表を表示します。';

/** @deprecated 文言は `boting_hub.venue_pick_intro` */
export const VENUE_PICK_INTRO_BODY =
  '開催場を選ぶと、その場のレース一覧（発走時刻・発売状態）が表示されます。続けてレースを選ぶと出馬表を表示します。';

function fmtBpLine(balance, locale = null) {
  const n = Math.round(Number(balance) || 0);
  return t('boting_hub.bp_line', { amount: formatBpWithUnit(n) }, locale);
}

/**
 * `/boting` メインパネル: Daily 収支 Container + 操作ボタン（常に Components V2）
 * @param {{ user: import('discord.js').User, guild: import('discord.js').Guild | null, extraFlags?: number, dailySuccessBanner?: string | null, locale?: string | null }} opts
 */
export async function buildBotingPanelPayload({
  user,
  guild,
  extraFlags = 0,
  dailySuccessBanner = null,
  locale = null,
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
    locale,
  });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BOTING_HUB_PREFIX}|daily`)
      .setLabel(t('boting_hub.buttons.daily', null, locale))
      .setEmoji(botingEmoji('daily'))
      .setStyle(ButtonStyle.Success)
      .setDisabled(dailyDisabled),
    new ButtonBuilder()
      .setCustomId(`${BOTING_HUB_PREFIX}|rank`)
      .setLabel(t('boting_hub.buttons.rank', null, locale))
      .setEmoji(botingEmoji('ranking'))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${BOTING_HUB_PREFIX}|ledger`)
      .setLabel(t('boting_hub.buttons.ledger', null, locale))
      .setEmoji(botingEmoji('syushi'))
      .setStyle(ButtonStyle.Secondary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BOTING_HUB_PREFIX}|purchase`)
      .setLabel(t('boting_hub.buttons.purchase', null, locale))
      .setEmoji(botingEmoji('ken'))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${BOTING_HUB_PREFIX}|history`)
      .setLabel(t('boting_hub.buttons.history', null, locale))
      .setEmoji(botingEmoji('history'))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${BOTING_HUB_PREFIX}|slip`)
      .setLabel(t('boting_hub.buttons.slip', null, locale))
      .setEmoji(botingEmoji('cart'))
      .setStyle(ButtonStyle.Secondary),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BOTING_HUB_PREFIX}|annual_stats`)
      .setLabel(t('boting_hub.buttons.annual_stats', null, locale))
      .setEmoji(BOTING_HUB_BUTTON_EMOJI.annualStats)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${BOTING_HUB_PREFIX}|weekly_challenge`)
      .setLabel(t('boting_hub.buttons.weekly_challenge', null, locale))
      .setEmoji(BOTING_HUB_BUTTON_EMOJI.weeklyChallenge)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${BOTING_HUB_PREFIX}|help`)
      .setLabel(t('boting_hub.buttons.help', null, locale))
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
 * @param {{ userId: string, extraFlags?: number, locale?: string | null }} opts
 */
export async function buildRaceScheduleIntroV2Payload({ userId, extraFlags = 0, locale = null }) {
  const balance = await getBalance(userId);
  const container = new ContainerBuilder().setAccentColor(HUB_ACCENT);
  const intro = t('boting_hub.schedule_kind_intro', null, locale);
  const body = [fmtBpLine(balance, locale), '', intro].join('\n');
  container.addTextDisplayComponents((td) => td.setContent(body));
  return {
    content: null,
    embeds: [],
    components: [container, scheduleKindSelectRow(locale), buildBotingMenuBackRow({ locale })],
    flags: MessageFlags.IsComponentsV2 | extraFlags,
  };
}

/**
 * 開催場選択の直前画面（bp + 案内を Container、続けて actionRows）
 * @param {{ userId: string, extraFlags?: number, actionRows?: import('discord.js').ActionRowBuilder[], introBodySuffix?: string, locale?: string | null }} opts
 */
export async function buildVenuePickIntroV2Payload({
  userId,
  extraFlags = 0,
  actionRows = [],
  introBodySuffix = '',
  locale = null,
}) {
  const balance = await getBalance(userId);
  const container = new ContainerBuilder().setAccentColor(HUB_ACCENT);
  const intro = t('boting_hub.venue_pick_intro', null, locale);
  const bodyParts = [fmtBpLine(balance, locale), '', intro];
  if (introBodySuffix) bodyParts.push(introBodySuffix);
  container.addTextDisplayComponents((td) => td.setContent(bodyParts.join('\n')));
  return {
    content: null,
    embeds: [],
    components: [container, ...actionRows.filter(Boolean), buildBotingMenuBackRow({ locale })],
    flags: MessageFlags.IsComponentsV2 | extraFlags,
  };
}
