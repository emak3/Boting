import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} from 'discord.js';
import { buildRaceMenuSelectionPayload } from './raceSchedule.mjs';
import { botingEmoji } from '../../utils/boting/botingEmojis.mjs';
import { RACE_PURCHASE_HISTORY_CUSTOM_ID } from '../../utils/bet/betSlipViewUi.mjs';
import {
  RACE_HISTORY_RESULT_PICK_PREFIX,
  buildRaceHistoryNavCustomId,
  stripRaceHistoryBpCtx,
} from '../../components/racePurchaseHistory/ids.mjs';
import { v2ExtraFlags } from '../../utils/shared/interactionResponse.mjs';
import { resolveLocaleFromInteraction, t } from '../../../i18n/index.mjs';

/**
 * 出馬表などで `maybeInsertRaceBetUtilityRow` 済みのときは券種セレクト直下に
 * `race_bet_purchase_history` があり、その上に同ラベル行を足すと二重になるため挿入しない。
 */
function payloadHasUtilityPurchaseHistoryButton(payload) {
  for (const row of payload.components || []) {
    const t = row.type ?? row.data?.type;
    if (t !== ComponentType.ActionRow) continue;
    for (const c of row.components || []) {
      const id = c.customId ?? c.data?.custom_id;
      if (
        typeof id === 'string' &&
        id.startsWith(`${RACE_PURCHASE_HISTORY_CUSTOM_ID}|`)
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * レース結果・出馬表ペイロードの本文ブロック直下に「購入履歴に戻る」を差し込む
 * @param {import('discord.js').BaseMessageOptions} payload
 * @param {object} ctx
 * @param {'ja'|'en'|string|null} [locale]
 */
function injectPurchaseHistoryBack(payload, ctx, locale = null) {
  if (payloadHasUtilityPurchaseHistoryButton(payload)) {
    return payload;
  }
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildRaceHistoryNavCustomId(ctx))
      .setLabel(t('race_schedule.buttons.purchase_history', null, locale))
      .setEmoji(botingEmoji('history'))
      .setStyle(ButtonStyle.Secondary),
  );
  const c = [...(payload.components || [])];
  if (!c.length) return payload;
  c.splice(1, 0, row);
  return { ...payload, components: c };
}

/**
 * 購入履歴ページの String Select → レース結果（戻るはページングと同じ customId）
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export default async function raceHistoryResultPick(interaction) {
  if (!interaction.isStringSelectMenu()) return;
  const cid = interaction.customId;
  if (!cid.startsWith(`${RACE_HISTORY_RESULT_PICK_PREFIX}|`)) return;

  const loc = resolveLocaleFromInteraction(interaction);
  const { withoutCtx, bpctxUserId, rankLeaderboardReturn } = stripRaceHistoryBpCtx(cid);
  const parts = withoutCtx.split('|');
  if (parts.length < 4 || parts[0] !== RACE_HISTORY_RESULT_PICK_PREFIX) return;

  const periodKey = parts[1];
  const page = parseInt(parts[2], 10);
  let meetingFilter = parts[3];
  if (meetingFilter === undefined || meetingFilter === '') meetingFilter = 'all';

  if (!/^\d{8}$/.test(String(periodKey || '')) || !Number.isFinite(page) || page < 0) {
    await interaction.reply({
      content: t('race_purchase_history.errors.invalid_history_param', null, loc),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (meetingFilter !== 'all' && !/^\d{10}$/.test(String(meetingFilter))) {
    await interaction.reply({
      content: t('race_purchase_history.errors.invalid_meeting', null, loc),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const rawVal = interaction.values[0];
  const [raceId, flag] = String(rawVal || '').split('|');
  if (!/^\d{12}$/.test(raceId) || (flag !== '0' && flag !== '1')) {
    await interaction.reply({
      content: t('race_purchase_history.errors.invalid_race_selection', null, loc),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();

  const ctx = {
    periodKey,
    page,
    meetingFilter,
    bpRankProfileUserId: bpctxUserId || null,
    rankLeaderboardReturn: rankLeaderboardReturn || null,
  };

  try {
    let payload = await buildRaceMenuSelectionPayload(interaction, {
      raceId,
      isResultFlag: flag,
    });
    payload = injectPurchaseHistoryBack(payload, ctx, loc);
    const xf = v2ExtraFlags(interaction);
    if (xf) {
      payload.flags = (payload.flags ?? 0) | xf;
    }
    await interaction.editReply(payload);
  } catch (e) {
    console.error('raceHistoryResultPick', e);
    await interaction
      .editReply({
        content: t('race_purchase_history.errors.result_display_failed', { message: e.message }, loc),
      })
      .catch(() => {});
  }
}
