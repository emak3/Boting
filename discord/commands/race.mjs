import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import NetkeibaScraper from '../../cheerio/netkeibaScraper.mjs';
import { fetchTodayVenuesAndRaces } from '../../cheerio/netkeibaSchedule.mjs';
import { buildRaceCardEmbed } from '../utils/raceCardEmbed.mjs';

function venueSelectRow(kaisaiDate, currentGroup, venues) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('race_menu_venue')
    .setPlaceholder('開催場を選択')
    .addOptions(
      venues.slice(0, 25).map((v) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(v.title.slice(0, 100))
          .setValue(`${kaisaiDate}|${currentGroup}|${v.kaisaiId}`)
          .setDescription(`全${v.races.length}レース`.slice(0, 100)),
      ),
    );
  return new ActionRowBuilder().addComponents(menu);
}

const commandObject = {
  command: new SlashCommandBuilder()
    .setName('race')
    .setDescription('競馬の出馬表・本日の開催を表示します')
    .addStringOption((option) =>
      option
        .setName('raceid')
        .setDescription('省略時は開催場→レースをメニューで選択（12桁のレースID）')
        .setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const raceIdOpt = interaction.options.getString('raceid');
    if (raceIdOpt) {
      const raceId = raceIdOpt.trim();
      if (!/^\d{12}$/.test(raceId)) {
        await interaction.editReply({
          content: '❌ raceid は12桁の数字で指定してください。',
        });
        return;
      }
      const scraper = new NetkeibaScraper();
      try {
        const result = await scraper.scrapeRaceCard(raceId);
        await interaction.editReply({
          embeds: [buildRaceCardEmbed(result)],
        });
      } catch (error) {
        console.error('Race command error:', error);
        await interaction.editReply({
          content: `❌ エラー: ${error.message}\n\n無効なレースID・ネットワーク・サイト制限の可能性があります。`,
        });
      }
      return;
    }

    try {
      const { venues, kaisaiDateYmd, currentGroup } = await fetchTodayVenuesAndRaces();
      if (!venues.length) {
        await interaction.editReply({
          content: '❌ 本日の開催データが取得できませんでした。',
        });
        return;
      }
      await interaction.editReply({
        content: '開催場を選ぶと、その場のレース一覧（発走時刻・発売状態）が表示されます。続けてレースを選ぶと出馬表を表示します。',
        components: [venueSelectRow(kaisaiDateYmd, currentGroup, venues)],
      });
    } catch (e) {
      console.error('Race schedule error:', e);
      await interaction.editReply({
        content: `❌ 開催一覧の取得に失敗: ${e.message}`,
      });
    }
  },
};

export default commandObject;
