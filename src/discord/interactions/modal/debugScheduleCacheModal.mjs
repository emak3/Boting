import { InteractionWebhook, MessageFlags } from 'discord.js';
import { DEBUG_SCHEDULE_CACHE_MODAL_PREFIX } from '../../utils/debug/debugHubConstants.mjs';
import { canUseDebugCommands } from '../../utils/debug/raceDebugBypass.mjs';
import {
  getDebugPanelWebhookContext,
  saveDebugPanelWebhookContext,
} from '../../utils/debug/debugPanelWebhookStore.mjs';
import {
  buildDebugPanelPayload,
  formatDebugScheduleCacheRefreshInterval,
} from '../../utils/debug/debugHubPanel.mjs';
import {
  setScheduleCacheRefreshIntervalMs,
} from '../../../scrapers/netkeiba/cache/netkeibaScheduleCache.mjs';
import { v2ExtraFlags } from '../../utils/shared/interactionResponse.mjs';
import { resolveLocaleFromInteraction, t } from '../../../i18n/index.mjs';

function parseRefreshIntervalSeconds(value) {
  const n = Math.trunc(Number(String(value ?? '').trim()));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * @param {import('discord.js').ModalSubmitInteraction} interaction
 */
export default async function debugScheduleCacheModal(interaction) {
  if (!interaction.isModalSubmit()) return;
  if (interaction.customId !== DEBUG_SCHEDULE_CACHE_MODAL_PREFIX) return;

  const loc = resolveLocaleFromInteraction(interaction);

  if (!canUseDebugCommands(interaction.user.id)) {
    await interaction.reply({
      content: t('debug_hub.errors.forbidden', null, loc),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const seconds = parseRefreshIntervalSeconds(
    interaction.fields.getTextInputValue('refresh_interval_seconds'),
  );
  if (!seconds) {
    await interaction.reply({
      content: t('debug_hub.schedule_cache.invalid_seconds', null, loc),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const next = await setScheduleCacheRefreshIntervalMs(seconds * 1000);
    const label = formatDebugScheduleCacheRefreshInterval(next.refreshIntervalMs, loc);
    const extraFlags = v2ExtraFlags(interaction, { assumeEphemeral: true });
    const payload = await buildDebugPanelPayload({
      extraFlags,
      locale: loc,
      topBanner: t('debug_hub.schedule_cache.saved_banner', { interval: label }, loc),
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
      content: t('debug_hub.schedule_cache.saved_no_panel', { interval: label }, loc),
    });
  } catch (e) {
    console.error('debugScheduleCacheModal:', e);
    await interaction.editReply({
      content: t(
        'debug_hub.schedule_cache.save_failed',
        { message: e?.message ?? e },
        loc,
      ),
    });
  }
}
