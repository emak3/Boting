import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import NetkeibaScraper from '../../../cheerio/netkeibaScraper.mjs';
import {
  fetchRaceListSub,
  parseRaceListSub,
  filterVenueRaces,
  getRaceSalesStatus,
} from '../../../cheerio/netkeibaSchedule.mjs';
import { buildRaceCardEmbed } from '../../utils/raceCardEmbed.mjs';

const VENUE_MENU_ID = 'race_menu_venue';
const RACE_MENU_ID = 'race_menu_race';

function raceSelectRow(kaisaiDateYmd, races) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(RACE_MENU_ID)
    .setPlaceholder('レースを選択（出馬表を表示）')
    .addOptions(
      races.slice(0, 25).map((r) => {
        const st = getRaceSalesStatus(r, kaisaiDateYmd);
        const label = `${r.roundLabel} ${r.timeText}`.replace(/\s+/g, ' ').trim().slice(0, 100);
        const desc = `${st.shortLabel} · ${r.title}`.slice(0, 100);
        return new StringSelectMenuOptionBuilder()
          .setLabel(label || r.raceId)
          .setValue(r.raceId)
          .setDescription(desc);
      }),
    );
  return new ActionRowBuilder().addComponents(menu);
}

/**
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export default async function raceScheduleMenu(interaction) {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId !== VENUE_MENU_ID && interaction.customId !== RACE_MENU_ID) return;

  if (interaction.customId === VENUE_MENU_ID) {
    await interaction.deferUpdate();
    const val = interaction.values[0];
    const [kaisaiDate, currentGroup, kaisaiId] = val.split('|');
    if (!kaisaiDate || !currentGroup || !kaisaiId) {
      await interaction.editReply({
        content: '❌ メニュー値が不正です。もう一度 /race から試してください。',
        embeds: [],
        components: [],
      });
      return;
    }
    try {
      const html = await fetchRaceListSub(kaisaiDate, currentGroup);
      const { venues } = parseRaceListSub(html, kaisaiDate);
      const races = filterVenueRaces(venues, kaisaiId);
      if (!races.length) {
        await interaction.editReply({
          content: '❌ その開催場のレースが見つかりませんでした。',
          embeds: [],
          components: [],
        });
        return;
      }
      const lines = races.map((r) => {
        const st = getRaceSalesStatus(r, kaisaiDate);
        return `**${r.roundLabel}** ${r.timeText} — ${r.title}\n└ ${st.detail}`;
      });
      let description = lines.join('\n\n');
      if (description.length > 4090) {
        description = `${description.slice(0, 4087)}…`;
      }
      const embed = {
        color: 0x0099ff,
        title: '🏇 レース一覧',
        description,
        footer: { text: `開催日 ${kaisaiDate}（日本時間）` },
      };
      await interaction.editReply({
        content: '',
        embeds: [embed],
        components: [raceSelectRow(kaisaiDate, races)],
      });
    } catch (e) {
      console.error(e);
      await interaction.editReply({
        content: `❌ ${e.message}`,
        embeds: [],
        components: [],
      });
    }
    return;
  }

  if (interaction.customId === RACE_MENU_ID) {
    await interaction.deferUpdate();
    const raceId = interaction.values[0];
    const scraper = new NetkeibaScraper();
    try {
      const result = await scraper.scrapeRaceCard(raceId);
      await interaction.editReply({
        content: '',
        embeds: [buildRaceCardEmbed(result)],
        components: [],
      });
    } catch (e) {
      console.error(e);
      await interaction.editReply({
        content: `❌ 出馬表の取得に失敗: ${e.message}`,
        embeds: [],
        components: [],
      });
    }
  }
}
