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
  findRaceMetaForToday,
  getRaceSalesStatus,
} from '../../cheerio/netkeibaSchedule.mjs';
import { buildRaceCardV2Payload } from '../utils/raceCardDisplay.mjs';
import { buildRaceResultEmbeds } from '../utils/raceResultEmbed.mjs';
import { setBetFlow } from '../utils/betFlowStore.mjs';
import { canBypassSalesClosed } from '../utils/raceDebugBypass.mjs';
import { scheduleKindSelectRow } from '../utils/scheduleKindUi.mjs';
import { filterBetTypesForJraSale } from '../utils/jraBetAvailability.mjs';

function venueSelectRow(scheduleKind, kaisaiDate, currentGroup, venues) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('race_menu_venue')
    .setPlaceholder('開催場を選択')
    .addOptions(
      venues.slice(0, 25).map((v) => {
        const value =
          scheduleKind === 'nar'
            ? `nar|${kaisaiDate}|${v.kaisaiId}`
            : `jra|${kaisaiDate}|${currentGroup}|${v.kaisaiId}`;
        const prefix = scheduleKind === 'nar' ? '[地方] ' : '';
        return new StringSelectMenuOptionBuilder()
          .setLabel(`${prefix}${v.title}`.slice(0, 100))
          .setValue(value)
          .setDescription(`全${v.races.length}レース`.slice(0, 100));
      }),
    );
  return new ActionRowBuilder().addComponents(menu);
}

function betTypeSelectRow(raceId, selectedBetTypeId = null, saleCtx = null) {
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

  const types = filterBetTypesForJraSale(BET_TYPES, saleCtx || {});
  const selRaw = selectedBetTypeId != null ? String(selectedBetTypeId) : null;
  const sel = selRaw && types.some((t) => t.id === selRaw) ? selRaw : null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`race_bet_type|${raceId}`)
    .setPlaceholder('賭ける方式を選択')
    .addOptions(
      types.map((t) => {
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
    .setDescription('競馬の出馬表・本日の開催（中央JRA / 地方NAR）を表示します')
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
        const flowPatch = { result };
        if (meta?.source === 'nar' || meta?.source === 'jra') {
          flowPatch.source = meta.source;
        } else if (result.netkeibaOrigin) {
          flowPatch.source = result.netkeibaOrigin;
        }
        setBetFlow(interaction.user.id, raceId, flowPatch);
        const saleCtx = {
          source: flowPatch.source,
          result,
        };
        await interaction.editReply(
          buildRaceCardV2Payload({
            result,
            headline: '',
            actionRows: [betTypeSelectRow(raceId, null, saleCtx)],
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
      await interaction.editReply({
        content:
          'まず **中央(JRA)** か **地方(NAR)** を選び、その後に開催場を選ぶとレース一覧が表示されます。続けてレースを選ぶと出馬表を表示します。',
        components: [scheduleKindSelectRow()],
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
