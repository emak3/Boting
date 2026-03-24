import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from 'discord.js';
import {
  getDebugAuthorizedMentionsLine,
  isDebugSalesBypassEnabled,
} from './raceDebugBypass.mjs';
import {
  DEBUG_ACL_CFM_PREFIX,
  DEBUG_BP_CFM_PREFIX,
  DEBUG_HUB_PREFIX,
  DEBUG_HUB_SCHEDULE_KIND_ID,
  DEBUG_RACE_MODAL_PREFIX,
} from './debugHubConstants.mjs';
import { botingEmoji } from '../boting/botingEmojis.mjs';

const ACCENT = 0xed4245;

/**
 * @param {'jra' | 'nar'} kind
 */
export function buildRaceIdModal(kind) {
  const label = kind === 'jra' ? '中央(JRA)' : '地方(NAR)';
  return new ModalBuilder()
    .setCustomId(`${DEBUG_RACE_MODAL_PREFIX}|${kind}`)
    .setTitle(`レースID（${label}）`.slice(0, 45))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('レースID（12桁の数字）')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('race_id')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(12)
            .setMaxLength(12),
        ),
    );
}

function v2(extraFlags) {
  return MessageFlags.IsComponentsV2 | extraFlags;
}

/**
 * @param {{ extraFlags?: number }} [opts]
 */
export function buildDebugPanelPayload(opts = {}) {
  const extraFlags = opts.extraFlags ?? 0;
  const on = isDebugSalesBypassEnabled();
  const statusLine = [
    '**デバッグステータス**',
    `発売締切バイパス / Daily デバッグ: **${on ? 'ON' : 'OFF'}**`,
    '',
    '**デバッグ利用可能**',
    getDebugAuthorizedMentionsLine(),
  ].join('\n');

  const container = new ContainerBuilder().setAccentColor(ACCENT);
  container.addTextDisplayComponents((td) => td.setContent(statusLine.slice(0, 3900)));

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${DEBUG_HUB_PREFIX}|toggle`)
      .setLabel('モードを切り替える')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${DEBUG_HUB_PREFIX}|start_grant`)
      .setLabel('BP付与')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${DEBUG_HUB_PREFIX}|start_revoke`)
      .setLabel('BP剥奪')
      .setStyle(ButtonStyle.Danger),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${DEBUG_HUB_PREFIX}|start_race_id`)
      .setLabel('IDで出馬表')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${DEBUG_HUB_PREFIX}|acl_add`)
      .setLabel('Debug者追加')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${DEBUG_HUB_PREFIX}|acl_del`)
      .setLabel('Debug者削除')
      .setStyle(ButtonStyle.Secondary),
  );

  return {
    content: null,
    embeds: [],
    components: [container, row1, row2],
    flags: v2(extraFlags),
  };
}

/**
 * JRA / NAR セレクトで即モーダル。「進む」はモーダルを閉じたあと同じ入力を開き直す用。
 * @param {{ extraFlags?: number }} [opts]
 */
export function buildDebugRaceKindSelectPayload(opts = {}) {
  const extraFlags = opts.extraFlags ?? 0;

  const container = new ContainerBuilder().setAccentColor(ACCENT);
  container.addTextDisplayComponents((td) =>
    td.setContent(
      [
        '**レースIDで馬券**',
        'セレクトで JRA / NAR を選ぶと、すぐレースID入力が開きます。',
        'モーダルを閉じたあと、選び直さずに入り直すときは「進む」。',
      ].join('\n'),
    ),
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId(DEBUG_HUB_SCHEDULE_KIND_ID)
    .setPlaceholder('JRA か NAR を選ぶ')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('中央 (JRA)')
        .setDescription('race.netkeiba.com')
        .setValue('jra'),
      new StringSelectMenuOptionBuilder()
        .setLabel('地方 (NAR)')
        .setDescription('nar.netkeiba.com')
        .setValue('nar'),
    );

  const rowSelect = new ActionRowBuilder().addComponents(select);
  const rowBtn = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${DEBUG_HUB_PREFIX}|race_next`)
      .setLabel('進む')
      .setEmoji(botingEmoji('susumu'))
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${DEBUG_HUB_PREFIX}|back`)
      .setLabel('メニューに戻る')
      .setEmoji(botingEmoji('home'))
      .setStyle(ButtonStyle.Secondary),
  );

  return {
    content: null,
    embeds: [],
    components: [container, rowSelect, rowBtn],
    flags: v2(extraFlags),
  };
}

/**
 * @param {{ mode: 'grant' | 'revoke', extraFlags?: number }} opts
 */
export function buildDebugUserPickPayload(opts) {
  const mode = opts.mode;
  const extraFlags = opts.extraFlags ?? 0;
  const verb = mode === 'grant' ? '付与' : '剥奪';
  const container = new ContainerBuilder().setAccentColor(ACCENT);
  container.addTextDisplayComponents((td) =>
    td.setContent(
      [
        `**対象ユーザーを選ぶ（BP${verb}）**`,
        '下のメニューから選ぶか、「ユーザーIDを入力」で ID を直接指定できます。',
      ].join('\n'),
    ),
  );

  const select = new UserSelectMenuBuilder()
    .setCustomId(`${DEBUG_HUB_PREFIX}|user_pick|${mode}`)
    .setPlaceholder('ユーザーを選ぶ')
    .setMinValues(1)
    .setMaxValues(1);

  const rowSelect = new ActionRowBuilder().addComponents(select);
  const rowBtn = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${DEBUG_HUB_PREFIX}|open_modal|${mode}`)
      .setLabel('ユーザーIDを入力')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${DEBUG_HUB_PREFIX}|back`)
      .setLabel('メニューに戻る')
      .setEmoji(botingEmoji('home'))
      .setStyle(ButtonStyle.Secondary),
  );

  return {
    content: null,
    embeds: [],
    components: [container, rowSelect, rowBtn],
    flags: v2(extraFlags),
  };
}

/**
 * @param {{ mode: 'grant' | 'revoke', targetLabel: string, amount: number, balanceBefore: number, extraFlags?: number }} opts
 */
export function buildDebugConfirmPayload(opts) {
  const { mode, targetLabel, amount, balanceBefore } = opts;
  const extraFlags = opts.extraFlags ?? 0;
  const verb = mode === 'grant' ? '付与' : '剥奪';
  const bal = Math.round(Number(balanceBefore) || 0);
  const balanceAfter =
    mode === 'grant'
      ? bal + amount
      : Math.max(0, bal - amount);
  const lines = [
    '**確認**',
    `操作: BP **${verb}**`,
    `対象: ${targetLabel}`,
    `数量: **${amount.toLocaleString('ja-JP')}** bp`,
    '',
    `現在の残高: **${bal.toLocaleString('ja-JP')}** bp`,
    `実行後の残高（予定）: **${Math.round(balanceAfter).toLocaleString('ja-JP')}** bp`,
  ];
  if (mode === 'revoke' && amount > bal) {
    lines.push(
      '',
      `※ 残高より多いため、実際に剥奪するのは **${bal.toLocaleString('ja-JP')}** bp までです（実行後は 0 bp）。`,
    );
  }
  lines.push('', 'この内容で実行しますか？');
  const container = new ContainerBuilder().setAccentColor(ACCENT);
  container.addTextDisplayComponents((td) => td.setContent(lines.join('\n').slice(0, 3900)));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${DEBUG_BP_CFM_PREFIX}|back`)
      .setLabel('戻る')
      .setEmoji(botingEmoji('modoru'))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${DEBUG_BP_CFM_PREFIX}|ok`)
      .setLabel('確定')
      .setStyle(ButtonStyle.Success),
  );

  return {
    content: null,
    embeds: [],
    components: [container, row],
    flags: v2(extraFlags),
  };
}

/**
 * @param {{ title: string, bodyLines: string[], extraFlags?: number }} opts
 */
export function buildDebugResultPayload(opts) {
  const extraFlags = opts.extraFlags ?? 0;
  const container = new ContainerBuilder().setAccentColor(ACCENT);
  container.addTextDisplayComponents((td) =>
    td.setContent(
      [opts.title, ...opts.bodyLines].join('\n').slice(0, 3900),
    ),
  );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${DEBUG_HUB_PREFIX}|back`)
      .setLabel('メニューに戻る')
      .setEmoji(botingEmoji('home'))
      .setStyle(ButtonStyle.Secondary),
  );
  return {
    content: null,
    embeds: [],
    components: [container, row],
    flags: v2(extraFlags),
  };
}

/**
 * @param {{ mode: 'add' | 'remove', extraFlags?: number }} opts
 */
export function buildDebugAclUserPickPayload(opts) {
  const mode = opts.mode;
  const extraFlags = opts.extraFlags ?? 0;
  const verb = mode === 'add' ? '追加' : '削除';
  const container = new ContainerBuilder().setAccentColor(ACCENT);
  container.addTextDisplayComponents((td) =>
    td.setContent(
      [
        `**デバッグ利用者を${verb}**`,
        'ユーザーを選ぶか、「ユーザーIDを入力」で ID を直接指定できます。',
      ].join('\n'),
    ),
  );

  const select = new UserSelectMenuBuilder()
    .setCustomId(`${DEBUG_HUB_PREFIX}|acl_user_pick|${mode}`)
    .setPlaceholder('ユーザーを選ぶ')
    .setMinValues(1)
    .setMaxValues(1);

  const rowSelect = new ActionRowBuilder().addComponents(select);
  const rowBtn = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${DEBUG_HUB_PREFIX}|acl_open_modal|${mode}`)
      .setLabel('ユーザーIDを入力')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${DEBUG_HUB_PREFIX}|back`)
      .setLabel('メニューに戻る')
      .setEmoji(botingEmoji('home'))
      .setStyle(ButtonStyle.Secondary),
  );

  return {
    content: null,
    embeds: [],
    components: [container, rowSelect, rowBtn],
    flags: v2(extraFlags),
  };
}

/**
 * @param {{ mode: 'add' | 'remove', targetLabel: string, extraFlags?: number }} opts
 */
export function buildDebugAclConfirmPayload(opts) {
  const { mode, targetLabel } = opts;
  const extraFlags = opts.extraFlags ?? 0;
  const verb = mode === 'add' ? '追加' : '削除';
  const container = new ContainerBuilder().setAccentColor(ACCENT);
  container.addTextDisplayComponents((td) =>
    td.setContent(
      [
        '**確認**',
        `操作: デバッグ利用者を **${verb}**`,
        `対象: ${targetLabel}`,
        '',
        'この内容で実行しますか？',
      ].join('\n'),
    ),
  );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${DEBUG_ACL_CFM_PREFIX}|back`)
      .setLabel('戻る')
      .setEmoji(botingEmoji('modoru'))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${DEBUG_ACL_CFM_PREFIX}|ok`)
      .setLabel('確定')
      .setStyle(ButtonStyle.Success),
  );

  return {
    content: null,
    embeds: [],
    components: [container, row],
    flags: v2(extraFlags),
  };
}
