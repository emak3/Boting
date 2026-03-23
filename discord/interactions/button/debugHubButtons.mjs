import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  addDebugAuthorizedUser,
  removeDebugAuthorizedUser,
} from '../../utils/debugAuthStore.mjs';
import {
  clearDebugAclDraft,
  getDebugAclDraft,
} from '../../utils/debugAclFlowStore.mjs';
import { canUseDebugCommands, setDebugSalesBypass, isDebugSalesBypassEnabled } from '../../utils/raceDebugBypass.mjs';
import { applyDebugBpAdjustment, getBalance } from '../../utils/userPointsStore.mjs';
import { runPendingRaceRefundsForUser } from '../../utils/raceBetRefundSweep.mjs';
import {
  appendDigitDebugBp,
  bufferToDebugBpAmount,
  buildDebugBpKeypadPayload,
  deleteLastDigitDebugBp,
  parseDebugBpKeypadId,
} from '../../utils/debugBpKeypad.mjs';
import {
  clearDebugBpDraft,
  getDebugBpDraft,
  setDebugBpDraft,
} from '../../utils/debugBpFlowStore.mjs';
import {
  buildDebugAclUserPickPayload,
  buildDebugConfirmPayload,
  buildDebugPanelPayload,
  buildDebugRaceKindSelectPayload,
  buildDebugResultPayload,
  buildDebugUserPickPayload,
  buildRaceIdModal,
} from '../../utils/debugHubPanel.mjs';
import {
  clearDebugRaceKindDraft,
  getDebugRaceKindDraft,
} from '../../utils/debugRaceKindStore.mjs';
import {
  DEBUG_ACL_CFM_PREFIX,
  DEBUG_BP_CFM_PREFIX,
  DEBUG_BP_KPAD_PREFIX,
  DEBUG_HUB_MODAL_PREFIX,
  DEBUG_HUB_PREFIX,
} from '../../utils/debugHubConstants.mjs';

function v2ExtraFlags(interaction) {
  let extraFlags = 0;
  try {
    if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
      extraFlags |= MessageFlags.Ephemeral;
    }
  } catch (_) {
    /* ignore */
  }
  return extraFlags;
}

function buildUserIdModal(mode) {
  const title = mode === 'grant' ? 'ユーザーID（付与）' : 'ユーザーID（剥奪）';
  return new ModalBuilder()
    .setCustomId(`${DEBUG_HUB_MODAL_PREFIX}|${mode}`)
    .setTitle(title.slice(0, 45))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('user_id')
          .setLabel('ユーザーID')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(17)
          .setMaxLength(20),
      ),
    );
}

function buildAclUserIdModal(mode) {
  const title = mode === 'add' ? 'ユーザーID（追加）' : 'ユーザーID（削除）';
  return new ModalBuilder()
    .setCustomId(`${DEBUG_HUB_MODAL_PREFIX}|acl|${mode}`)
    .setTitle(title.slice(0, 45))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('user_id')
          .setLabel('ユーザーID')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(17)
          .setMaxLength(20),
      ),
    );
}

function targetMention(userId) {
  return `<@${userId}>`;
}

/**
 * @param {import('discord.js').ButtonInteraction} interaction
 */
export default async function debugHubButtons(interaction) {
  if (!interaction.isButton()) return;

  const customId = interaction.customId;
  const userId = interaction.user.id;

  if (customId.startsWith(`${DEBUG_BP_KPAD_PREFIX}|`)) {
    await handleKeypad(interaction);
    return;
  }

  if (customId.startsWith(`${DEBUG_BP_CFM_PREFIX}|`)) {
    await handleConfirm(interaction);
    return;
  }

  if (customId.startsWith(`${DEBUG_ACL_CFM_PREFIX}|`)) {
    await handleAclConfirm(interaction);
    return;
  }

  if (!customId.startsWith(`${DEBUG_HUB_PREFIX}|`)) return;

  if (!canUseDebugCommands(userId)) {
    await interaction.reply({
      content: '❌ この操作は使用できません。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const extraFlags = v2ExtraFlags(interaction);
  const parts = customId.split('|');
  const action = parts[1];

  if (action === 'toggle') {
    clearDebugRaceKindDraft(userId);
    setDebugSalesBypass(!isDebugSalesBypassEnabled());
    await interaction.update(buildDebugPanelPayload({ extraFlags }));
    return;
  }

  if (action === 'start_grant') {
    clearDebugRaceKindDraft(userId);
    await interaction.update(buildDebugUserPickPayload({ mode: 'grant', extraFlags }));
    return;
  }

  if (action === 'start_revoke') {
    clearDebugRaceKindDraft(userId);
    await interaction.update(buildDebugUserPickPayload({ mode: 'revoke', extraFlags }));
    return;
  }

  if (action === 'back') {
    clearDebugBpDraft(userId);
    clearDebugAclDraft(userId);
    clearDebugRaceKindDraft(userId);
    await interaction.update(buildDebugPanelPayload({ extraFlags }));
    return;
  }

  if (action === 'start_race_id') {
    clearDebugRaceKindDraft(userId);
    await interaction.update(buildDebugRaceKindSelectPayload({ extraFlags }));
    return;
  }

  if (action === 'race_next') {
    const kind = getDebugRaceKindDraft(userId);
    if (!kind || (kind !== 'jra' && kind !== 'nar')) {
      await interaction.reply({
        content:
          '❌ 先にセレクトで JRA / NAR を選んでください（選ぶとすぐモーダルが開きます）。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.showModal(buildRaceIdModal(kind));
    return;
  }

  if (action === 'acl_add') {
    clearDebugRaceKindDraft(userId);
    await interaction.update(buildDebugAclUserPickPayload({ mode: 'add', extraFlags }));
    return;
  }

  if (action === 'acl_del') {
    clearDebugRaceKindDraft(userId);
    await interaction.update(buildDebugAclUserPickPayload({ mode: 'remove', extraFlags }));
    return;
  }

  if (action === 'acl_open_modal') {
    const mode = parts[2] === 'remove' ? 'remove' : 'add';
    await interaction.showModal(buildAclUserIdModal(mode));
    return;
  }

  if (action === 'open_modal') {
    const mode = parts[2] === 'revoke' ? 'revoke' : 'grant';
    await interaction.showModal(buildUserIdModal(mode));
    return;
  }

  await interaction.reply({
    content: '❌ 不明な操作です。',
    flags: MessageFlags.Ephemeral,
  });
}

async function handleKeypad(interaction) {
  if (!canUseDebugCommands(interaction.user.id)) {
    await interaction.reply({
      content: '❌ この操作は使用できません。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const parsed = parseDebugBpKeypadId(interaction.customId);
  if (!parsed) {
    await interaction.reply({
      content: '❌ 無効な操作です。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const userId = interaction.user.id;
  const draft = getDebugBpDraft(userId);
  if (!draft?.targetUserId) {
    await interaction.reply({
      content: '❌ セッションが無効です。`/debug` から開き直してください。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const extraFlags = v2ExtraFlags(interaction);

  if (parsed.op === 'digit' && parsed.digit != null) {
    const nextBuf = appendDigitDebugBp(draft.buffer, parsed.digit);
    setDebugBpDraft(userId, { ...draft, buffer: nextBuf });
    await interaction.update(
      buildDebugBpKeypadPayload({
        mode: draft.mode,
        targetLabel: targetMention(draft.targetUserId),
        buffer: nextBuf,
        extraFlags,
      }),
    );
    return;
  }

  if (parsed.op === 'del') {
    const nextBuf = deleteLastDigitDebugBp(draft.buffer);
    setDebugBpDraft(userId, { ...draft, buffer: nextBuf });
    await interaction.update(
      buildDebugBpKeypadPayload({
        mode: draft.mode,
        targetLabel: targetMention(draft.targetUserId),
        buffer: nextBuf,
        extraFlags,
      }),
    );
    return;
  }

  if (parsed.op === 'can') {
    const mode = draft.mode;
    clearDebugBpDraft(userId);
    await interaction.update(buildDebugUserPickPayload({ mode, extraFlags }));
    return;
  }

  if (parsed.op === 'ok') {
    const buf = String(draft.buffer || '').trim();
    if (!buf) {
      await interaction.reply({
        content: '❌ テンキーで数量を入力してから決定してください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const amount = bufferToDebugBpAmount(buf);
    const balanceBefore = await getBalance(draft.targetUserId);
    await interaction.update(
      buildDebugConfirmPayload({
        mode: draft.mode,
        targetLabel: `${targetMention(draft.targetUserId)}（\`${draft.targetUserId}\`）`,
        amount,
        balanceBefore,
        extraFlags,
      }),
    );
    return;
  }
}

async function handleConfirm(interaction) {
  if (!canUseDebugCommands(interaction.user.id)) {
    await interaction.reply({
      content: '❌ この操作は使用できません。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const parts = interaction.customId.split('|');
  const op = parts[1];
  const userId = interaction.user.id;
  const draft = getDebugBpDraft(userId);
  const extraFlags = v2ExtraFlags(interaction);

  if (!draft?.targetUserId) {
    await interaction.reply({
      content: '❌ セッションが無効です。`/debug` から開き直してください。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const buf = String(draft.buffer || '').trim();
  if (!buf) {
    clearDebugBpDraft(userId);
    await interaction.update(buildDebugPanelPayload({ extraFlags }));
    return;
  }
  const amount = bufferToDebugBpAmount(buf);

  if (op === 'back') {
    await interaction.update(
      buildDebugBpKeypadPayload({
        mode: draft.mode,
        targetLabel: targetMention(draft.targetUserId),
        buffer: draft.buffer,
        extraFlags,
      }),
    );
    return;
  }

  if (op !== 'ok') {
    await interaction.reply({
      content: '❌ 不明な操作です。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();

  const delta = draft.mode === 'grant' ? amount : -amount;
  clearDebugBpDraft(userId);

  await runPendingRaceRefundsForUser(interaction.user.id);

  const result = await applyDebugBpAdjustment(draft.targetUserId, delta);
  if (!result.ok) {
    let msg = '❌ 調整に失敗しました。';
    if (result.reason === 'zero_delta') {
      msg =
        '❌ 反映できる量がありません（剥奪で残高が 0 の場合など）。';
    }
    if (result.reason === 'delta_too_large') msg = '❌ 調整量が大きすぎます。';
    await interaction.editReply(
      buildDebugResultPayload({
        title: msg,
        bodyLines: [],
        extraFlags,
      }),
    );
    return;
  }

  const sign = result.delta > 0 ? '+' : '';
  const who = `${targetMention(draft.targetUserId)}（\`${draft.targetUserId}\`）`;
  await interaction.editReply(
    buildDebugResultPayload({
      title: '✅ 反映しました',
      bodyLines: [
        who,
        `${sign}${result.delta} bp → 残高 **${result.balanceAfter}** bp（調整前 ${result.balanceBefore} bp）`,
      ],
      extraFlags,
    }),
  );
}

async function handleAclConfirm(interaction) {
  if (!canUseDebugCommands(interaction.user.id)) {
    await interaction.reply({
      content: '❌ この操作は使用できません。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const parts = interaction.customId.split('|');
  const op = parts[1];
  const userId = interaction.user.id;
  const draft = getDebugAclDraft(userId);
  const extraFlags = v2ExtraFlags(interaction);

  if (!draft?.targetUserId) {
    await interaction.reply({
      content: '❌ セッションが無効です。`/debug` から開き直してください。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (op === 'back') {
    const mode = draft.mode;
    clearDebugAclDraft(userId);
    await interaction.update(buildDebugAclUserPickPayload({ mode, extraFlags }));
    return;
  }

  if (op !== 'ok') {
    await interaction.reply({
      content: '❌ 不明な操作です。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();
  const targetId = draft.targetUserId;
  const mode = draft.mode;
  clearDebugAclDraft(userId);

  if (mode === 'add') {
    const r = await addDebugAuthorizedUser(targetId);
    if (!r.ok) {
      await interaction.editReply(
        buildDebugResultPayload({
          title: '❌ 追加に失敗しました。',
          bodyLines: [],
          extraFlags,
        }),
      );
      return;
    }
    await interaction.editReply(
      buildDebugResultPayload({
        title: '✅ デバッグ利用者を追加しました',
        bodyLines: [`<@${targetId}>（\`${targetId}\`）`],
        extraFlags,
      }),
    );
    return;
  }

  const r = await removeDebugAuthorizedUser(targetId);
  if (!r.ok) {
    await interaction.editReply(
      buildDebugResultPayload({
        title: '❌ 削除に失敗しました。',
        bodyLines: [],
        extraFlags,
      }),
    );
    return;
  }
  const body =
    r.reason === 'restored_seed'
      ? ['リストが空になったため初期ユーザーを復元しました。']
      : [`<@${targetId}>（\`${targetId}\`）`];
  await interaction.editReply(
    buildDebugResultPayload({
      title: '✅ デバッグ利用者から削除しました',
      bodyLines: body,
      extraFlags,
    }),
  );
}
