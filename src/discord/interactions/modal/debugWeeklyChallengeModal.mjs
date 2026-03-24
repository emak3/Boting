import { InteractionWebhook, MessageFlags } from 'discord.js';
import { DEBUG_WEEKLY_CFG_MODAL_PREFIX } from '../../utils/debug/debugHubConstants.mjs';
import { canUseDebugCommands } from '../../utils/debug/raceDebugBypass.mjs';
import {
  getDebugPanelWebhookContext,
  saveDebugPanelWebhookContext,
} from '../../utils/debug/debugPanelWebhookStore.mjs';
import {
  getWeeklyChallengeConfig,
  setWeeklyChallengeConfig,
} from '../../utils/challenge/weeklyChallengeConfig.mjs';
import { buildDebugPanelPayload } from '../../utils/debug/debugHubPanel.mjs';

function parseNonNegInt(s, fallback) {
  const t = String(s ?? '').trim();
  const n = Math.trunc(Number(t));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function v2ExtraFlags(interaction) {
  let extraFlags = MessageFlags.Ephemeral;
  try {
    if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
      extraFlags |= MessageFlags.Ephemeral;
    }
  } catch (_) {
    /* ignore */
  }
  return extraFlags;
}

/**
 * 親パネルは「最後にメインを表示したインタラクション」の token でしか編集できない。
 * `debugPanelWebhookStore` に保存した applicationId / token / messageId で InteractionWebhook 経由 PATCH する。
 *
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 */
export default async function debugWeeklyChallengeModal(interaction) {
  if (!interaction.isModalSubmit()) return;
  const customId = interaction.customId;
  if (!customId.startsWith(`${DEBUG_WEEKLY_CFG_MODAL_PREFIX}|`)) return;

  if (!canUseDebugCommands(interaction.user.id)) {
    await interaction.reply({
      content: '❌ この操作は使用できません。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const kind = customId.split('|')[1];
    const cur = await getWeeklyChallengeConfig();

    if (kind === 'thresholds') {
      const next = {
        ...cur,
        hitsMin: parseNonNegInt(
          interaction.fields.getTextInputValue('hits_min'),
          cur.hitsMin,
        ),
        recoveryMinPct: parseNonNegInt(
          interaction.fields.getTextInputValue('recovery_min_pct'),
          cur.recoveryMinPct,
        ),
        hitRateMinPct: parseNonNegInt(
          interaction.fields.getTextInputValue('hit_rate_min_pct'),
          cur.hitRateMinPct,
        ),
        purchasesMin: parseNonNegInt(
          interaction.fields.getTextInputValue('purchases_min'),
          cur.purchasesMin,
        ),
      };
      await setWeeklyChallengeConfig(next);
    } else if (kind === 'rewards') {
      const next = {
        ...cur,
        hitsRewardBp: parseNonNegInt(
          interaction.fields.getTextInputValue('hits_reward_bp'),
          cur.hitsRewardBp,
        ),
        recoveryRewardBp: parseNonNegInt(
          interaction.fields.getTextInputValue('recovery_reward_bp'),
          cur.recoveryRewardBp,
        ),
        hitRateRewardBp: parseNonNegInt(
          interaction.fields.getTextInputValue('hit_rate_reward_bp'),
          cur.hitRateRewardBp,
        ),
        purchasesRewardBp: parseNonNegInt(
          interaction.fields.getTextInputValue('purchases_reward_bp'),
          cur.purchasesRewardBp,
        ),
      };
      await setWeeklyChallengeConfig(next);
    } else {
      await interaction.editReply({
        content: '❌ 不明なモーダルです。',
      });
      return;
    }

    const extraFlags = v2ExtraFlags(interaction);
    const payload = await buildDebugPanelPayload({
      extraFlags,
      topBanner: '✅ 週間チャレンジの設定を保存しました。',
    });

    const ctx = getDebugPanelWebhookContext(interaction.user.id);
    if (ctx) {
      const wh = new InteractionWebhook(
        interaction.client,
        ctx.applicationId,
        ctx.token,
      );
      await wh.editMessage(ctx.messageId, payload);
      saveDebugPanelWebhookContext(interaction.user.id, ctx);
      await interaction.deleteReply();
      return;
    }

    await interaction.editReply({
      content:
        '✅ 保存しました。`/debug` でパネルを開き直すと反映されます（編集用の記録がないか期限切れです）。',
    });
  } catch (e) {
    console.error('debugWeeklyChallengeModal:', e);
    await interaction
      .editReply({
        content: `❌ 保存またはパネル更新に失敗しました: ${e?.message ?? e}`,
      })
      .catch(() => {});
  }
}
