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
import {
  fetchTodayVenuesAndRaces,
  findRaceMetaForToday,
  getRaceSalesStatus,
} from '../../cheerio/netkeibaSchedule.mjs';
import { buildRaceCardV2Payload } from '../utils/raceCardDisplay.mjs';
import { buildRaceResultEmbeds } from '../utils/raceResultEmbed.mjs';
import { setBetFlow } from '../utils/betFlowStore.mjs';
import { canBypassSalesClosed } from '../utils/raceDebugBypass.mjs';

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

function betTypeSelectRow(raceId, selectedBetTypeId = null) {
  const BET_TYPES = [
    { id: 'win', label: '単勝' },
    { id: 'place', label: '複勝' },
    { id: 'win_place', label: '単勝+複勝' },
    { id: 'frame_pair', label: '枠連' },
    { id: 'horse_pair', label: '馬連' },
    { id: 'wide', label: 'ワイド' },
    { id: 'umatan', label: '馬単' },
    { id: 'trifuku', label: '3連複' },
    { id: 'tritan', label: '3連単' },
  ];

  const sel = selectedBetTypeId != null ? String(selectedBetTypeId) : null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`race_bet_type|${raceId}`)
    .setPlaceholder('賭ける方式を選択')
    .addOptions(
      BET_TYPES.map((t) => {
        const o = new StringSelectMenuOptionBuilder()
          .setLabel(t.label)
          .setValue(t.id)
          .setDescription('選択後に馬番/枠番を指定します');
        if (sel && t.id === sel) o.setDefault(true);
        return o;
      }),
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
        const salesBypass = canBypassSalesClosed(interaction.user.id);
        const resultSnap = await scraper.scrapeRaceResult(raceId);
        if (resultSnap.confirmed && !salesBypass) {
          await interaction.editReply({
            content: '',
            embeds: buildRaceResultEmbeds(resultSnap),
            components: [],
          });
          return;
        }

        const meta = await findRaceMetaForToday(raceId);
        if (meta) {
          const st = getRaceSalesStatus(meta.race, meta.kaisaiDateYmd);
          if (meta.race.isResult && !salesBypass) {
            await interaction.editReply({
              content:
                '❌ レース結果の取得に失敗しました。時間をおいて再度お試しください。',
              embeds: [],
              components: [],
            });
            return;
          }
          if (st.closed && !salesBypass) {
            await interaction.editReply({
              content:
                '⏳ 発売は締め切られています。レース結果の確定までお待ちください。',
              embeds: [],
              components: [],
            });
            return;
          }
        }

        const result = await scraper.scrapeRaceCard(raceId);
        result.raceId = raceId;
        setBetFlow(interaction.user.id, raceId, { result });
        await interaction.editReply(
          buildRaceCardV2Payload({
            result,
            headline: '',
            actionRows: [betTypeSelectRow(raceId)],
            extraFlags: MessageFlags.Ephemeral,
          }),
        );
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
