import {
  SlashCommandBuilder,
  InteractionContextType,
  MessageFlags,
  EmbedBuilder,
} from 'discord.js';
import { canBypassDailyCooldown } from '../utils/raceDebugBypass.mjs';
import {
  tryClaimDaily,
  getDailyAccountView,
  kindLabelJa,
} from '../utils/userPointsStore.mjs';
import { runPendingRaceRefundsForUser } from '../utils/raceBetRefundSweep.mjs';

function formatJst(d) {
  return d.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatLedgerLines(entries) {
  if (!entries.length) {
    return '（これ以降の受け取りから記録されます）';
  }
  const lines = entries.map((e) => {
    const t = e.at ? formatJst(e.at) : '—';
    const sign = e.delta >= 0 ? `+${e.delta}` : `${e.delta}`;
    return `\`${t}\` **${sign}** bp → **${e.balanceAfter}** bp（${kindLabelJa(e.kind)}）`;
  });
  let text = lines.join('\n');
  if (text.length > 3500) {
    text = lines.slice(0, 8).join('\n') + '\n…他省略';
  }
  return text;
}

const commandObject = {
  command: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('毎日のポイント（bp）を受け取ります（初回は 10000 bp）')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await runPendingRaceRefundsForUser(interaction.user.id);

    const debugBypass = canBypassDailyCooldown(interaction.user.id);
    let result;
    try {
      result = await tryClaimDaily(interaction.user.id, { debugBypass });
    } catch (e) {
      console.error('daily / tryClaimDaily:', e);
      await interaction.editReply({
        content: `❌ ポイントの保存に失敗しました: ${e.message}`,
      });
      return;
    }

    if (!result.ok && result.reason === 'already_claimed') {
      let view;
      try {
        view = await getDailyAccountView(interaction.user.id);
      } catch (e) {
        console.error('daily / getDailyAccountView:', e);
        await interaction.editReply({
          content: `❌ 収支の取得に失敗しました: ${e.message}`,
        });
        return;
      }

      const nextLine = view.nextClaimAt
        ? formatJst(view.nextClaimAt)
        : '—';

      const embed = new EmbedBuilder()
        .setTitle('本日分は受け取り済み')
        .setColor(0xed4245)
        .addFields(
          { name: '残高', value: `**${view.balance}** bp`, inline: true },
          {
            name: '次に /daily できる目安',
            value: nextLine,
            inline: true,
          },
          {
            name: 'いまの日次帯（JST 8:00 区切り）',
            value: `\`${view.currentPeriodKey}\``,
            inline: false,
          },
          {
            name: '直近の収支（最大15件）',
            value: formatLedgerLines(view.entries),
            inline: false,
          },
        )
        .setFooter({ text: '日次は日本時間 毎日 8:00 で切り替わります' });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const kindLine = kindLabelJa(result.kind);

    await interaction.editReply({
      content: `✅ **+${result.granted}** bp（${kindLine}）\n残高: **${result.balance}** bp`,
    });
  },
};

export default commandObject;
