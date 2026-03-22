import {
  SlashCommandBuilder,
  InteractionContextType,
  MessageFlags,
  EmbedBuilder,
} from 'discord.js';
import {
  fetchFirstLedgerAt,
} from '../utils/userPointsStore.mjs';
import { fetchUserRaceBetAggregates } from '../utils/raceBetRecords.mjs';
import {
  fetchAllUsersByBalanceDesc,
  computeBpRank,
} from '../utils/bpLeaderboard.mjs';
import { runPendingRaceRefundsForUser } from '../utils/raceBetRefundSweep.mjs';

function formatJst(d) {
  return d.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function pct(r) {
  if (r == null || !Number.isFinite(r)) return '—';
  return `${(r * 100).toFixed(2)}%`;
}

function earliestDate(a, b) {
  if (a && b) return a < b ? a : b;
  return a || b || null;
}

const commandObject = {
  command: new SlashCommandBuilder()
    .setName('bp_rank')
    .setDescription('BP 残高ランキング、または指定ユーザーの順位・購入統計')
    .addIntegerOption((o) =>
      o
        .setName('limit')
        .setDescription('ランキングの表示件数（1〜50、ユーザー未指定時のみ）')
        .setMinValue(1)
        .setMaxValue(50),
    )
    .addUserOption((o) =>
      o.setName('user').setDescription('詳細（順位・統計）を表示するユーザー'),
    )
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('user');
    const limitRaw = interaction.options.getInteger('limit');
    const limit = Math.min(
      50,
      Math.max(1, limitRaw ?? 20),
    );

    if (targetUser) {
      if (targetUser.bot) {
        await interaction.reply({
          content: '❌ BOT ではなくユーザーを指定してください。',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply();
      await runPendingRaceRefundsForUser(interaction.user.id);

      let sorted;
      try {
        sorted = await fetchAllUsersByBalanceDesc();
      } catch (e) {
        console.error('bp_rank / fetchAllUsersByBalanceDesc:', e);
        await interaction.editReply({
          content: `❌ ランキングデータの取得に失敗しました: ${e.message}`,
        });
        return;
      }

      const { rank, balance, totalUsers } = computeBpRank(
        sorted,
        targetUser.id,
      );

      let ledgerFirst;
      let agg;
      try {
        [ledgerFirst, agg] = await Promise.all([
          fetchFirstLedgerAt(targetUser.id),
          fetchUserRaceBetAggregates(targetUser.id),
        ]);
      } catch (e) {
        console.error('bp_rank / stats:', e);
        await interaction.editReply({
          content: `❌ 統計の取得に失敗しました: ${e.message}`,
        });
        return;
      }

      const firstUse = earliestDate(ledgerFirst, agg.firstPurchasedAt);

      let guildJoinedLine = '—';
      try {
        const member = await interaction.guild.members
          .fetch(targetUser.id)
          .catch(() => null);
        if (member?.joinedAt) {
          guildJoinedLine = formatJst(member.joinedAt);
        }
      } catch {
        /* ignore */
      }

      const rankLine =
        rank != null && totalUsers > 0
          ? `**${rank}** / ${totalUsers} 位（同率は同順位）`
          : '（ランキング対象外・データなし）';

      const embed = new EmbedBuilder()
        .setTitle(`BP 詳細 — ${targetUser.username}`)
        .setColor(0x5865f2)
        .setThumbnail(targetUser.displayAvatarURL({ size: 128 }))
        .addFields(
          { name: '現在の BP', value: `**${balance}** bp`, inline: true },
          { name: '順位', value: rankLine, inline: true },
          { name: 'サーバー参加日', value: guildJoinedLine, inline: false },
          {
            name: '初回利用（台帳・購入の早い方）',
            value: firstUse ? formatJst(firstUse) : '—',
            inline: false,
          },
          {
            name: '競馬購入',
            value: [
              `的中件数: **${agg.hitCount}** 件`,
              `購入件数: **${agg.purchaseCount}** 件`,
              `購入金額合計: **${agg.totalCostBp}** bp`,
              `1点あたり最大金額: **${agg.maxCostBp}** bp`,
              `精算済み件数: **${agg.settledCount}** 件`,
              `最大回収率（精算済み1件あたり）: **${pct(agg.maxRecoveryRate)}**`,
              `最低回収率（精算済み1件あたり）: **${pct(agg.minRecoveryRate)}**`,
            ].join('\n'),
            inline: false,
          },
        )
        .setFooter({
          text: '回収率 = 払戻 bp ÷ 購入 bp（未確定は集計に含めません）',
        });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    await interaction.deferReply();
    await runPendingRaceRefundsForUser(interaction.user.id);

    let sorted;
    try {
      sorted = await fetchAllUsersByBalanceDesc();
    } catch (e) {
      console.error('bp_rank / fetchAllUsersByBalanceDesc:', e);
      await interaction.editReply({
        content: `❌ ランキングの取得に失敗しました: ${e.message}`,
      });
      return;
    }

    const slice = sorted.slice(0, limit);
    const lines = slice.map((row, i) => {
      const medal =
        i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      return `${medal} <@${row.userId}> — **${row.balance}** bp`;
    });

    const body =
      lines.length > 0
        ? lines.join('\n')
        : 'まだ誰も BP データがありません。';

    const embed = new EmbedBuilder()
      .setTitle(`BP ランキング（上位 ${slice.length} / 全 ${sorted.length} 名）`)
      .setColor(0xf1c40f)
      .setDescription(body);

    await interaction.editReply({ embeds: [embed] });
  },
};

export default commandObject;
