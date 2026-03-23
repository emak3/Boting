import { MessageFlags } from 'discord.js';
import {
  BP_RANK_DISPLAY_MAX,
  BP_RANK_SLICE_PICK_MAX,
  BP_RANK_SLICE_PICK_PREFIX,
  loadBpRankLeaderboardState,
} from '../../utils/bp/bpRankLeaderboardEmbed.mjs';
import { buildRacePurchaseHistoryV2Payload } from '../../utils/race/racePurchaseHistoryUi.mjs';
import { runPendingRaceRefundsForUser } from '../../utils/race/raceBetRefundSweep.mjs';
import { buildTextAndRowsV2Payload } from '../../utils/race/raceCardDisplay.mjs';

function normalizeMode(raw) {
  const m = String(raw || '');
  if (m === 'recovery' || m === 'hit_rate' || m === 'purchase') return m;
  return 'balance';
}

/**
 * 表示中ランキングの String Select → 購入履歴
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export default async function bpRankSlicePick(interaction) {
  if (!interaction.isStringSelectMenu()) return;
  const cid = interaction.customId;
  if (!cid.startsWith(`${BP_RANK_SLICE_PICK_PREFIX}|`)) return;

  const parts = cid.split('|');
  const lim = Math.min(BP_RANK_DISPLAY_MAX, Math.max(1, parseInt(parts[1], 10) || 20));
  const mode = normalizeMode(parts[2]);
  const targetId = interaction.values[0];

  const { slice } = await loadBpRankLeaderboardState(lim, mode, {
    refundForUserId: interaction.user.id,
  });
  const allowed = new Set(
    slice.slice(0, BP_RANK_SLICE_PICK_MAX).map((r) => r.userId),
  );
  if (!allowed.has(targetId)) {
    await interaction.reply({
      content:
        '❌ この選択は無効です。ランキングを更新してからもう一度選んでください。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const u = await interaction.client.users.fetch(targetId).catch(() => null);
  if (u?.bot) {
    await interaction.reply({
      content: '❌ BOT の履歴は表示できません。',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let extraFlags = 0;
  try {
    if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
      extraFlags |= MessageFlags.Ephemeral;
    }
  } catch (_) {
    /* ignore */
  }

  await interaction.deferUpdate();
  await runPendingRaceRefundsForUser(targetId);

  try {
    const payload = await buildRacePurchaseHistoryV2Payload({
      userId: targetId,
      page: 0,
      extraFlags,
      bpRankProfileUserId: targetId,
      rankLeaderboardReturn: { limit: lim, mode },
    });
    await interaction.editReply(payload);
  } catch (e) {
    console.error('bpRankSlicePick:', e);
    await interaction.editReply(
      buildTextAndRowsV2Payload({
        headline: `❌ 購入履歴の表示に失敗しました: ${e.message}`,
        actionRows: [],
        extraFlags,
        withBotingMenuBack: true,
      }),
    );
  }
}
