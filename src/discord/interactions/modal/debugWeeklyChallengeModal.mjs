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
import { v2ExtraFlags } from '../../utils/shared/interactionResponse.mjs';
import { resolveLocaleFromInteraction, t } from '../../../i18n/index.mjs';

function parseNonNegInt(s, fallback) {
  const rawStr = String(s ?? '').trim();
  const n = Math.trunc(Number(rawStr));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
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

  const loc = resolveLocaleFromInteraction(interaction);

  if (!canUseDebugCommands(interaction.user.id)) {
    await interaction.reply({
      content: t('debug_hub.errors.forbidden', null, loc),
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

    const extraFlags = v2ExtraFlags(interaction, { assumeEphemeral: true });
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
      content: t('debug_hub.weekly.saved_no_panel', null, loc),
    });
  } catch (e) {
    console.error('debugWeeklyChallengeModal:', e);
    await interaction
      .editReply({
        content: t(
          'debug_hub.weekly.save_failed',
          { message: e?.message ?? e },
          loc,
        ),
      })
      .catch(() => {});
  }
}
