import {
  SlashCommandBuilder,
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
import { getBetFlow, setBetFlow } from '../utils/betFlowStore.mjs';
import { canBypassSalesClosed } from '../utils/raceDebugBypass.mjs';
import { filterBetTypesForJraSale } from '../utils/jraBetAvailability.mjs';
import { settleOpenRaceBetsForUser } from '../utils/raceBetRecords.mjs';
import {
  buildRaceHubV2Payload,
  buildRaceScheduleIntroV2Payload,
} from '../utils/raceCommandHub.mjs';
import { buildRacePurchaseHistoryV2Payload } from '../utils/racePurchaseHistoryUi.mjs';
import { editReplyOpenBetSlipReview } from '../utils/betSlipOpenReview.mjs';
import { normalizeScheduleVenueDisplayName } from '../utils/netkeibaJraVenueCode.mjs';
import { runPendingRaceRefundsForUser } from '../utils/raceBetRefundSweep.mjs';

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

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {string} raceId
 */
async function runRaceIdFlow(interaction, raceId) {
  const scraper = new NetkeibaScraper();
  try {
    const salesBypass = canBypassSalesClosed(interaction.user.id);
    const resultSnap = await scraper.scrapeRaceResult(raceId);
    // デバッグ発売バイパス時も精算・結果表示は行う（バイパスは締切後の購入可否用）
    if (resultSnap.confirmed) {
      let bpLine = '';
      try {
        const pay = await settleOpenRaceBetsForUser(
          interaction.user.id,
          raceId,
          resultSnap,
        );
        if (pay.settled > 0 && pay.totalRefund > 0) {
          bpLine = `**競馬払戻** +${pay.totalRefund} bp（残高 ${pay.balance} bp）\n\n`;
        } else if (pay.settled > 0) {
          bpLine = `**競馬払戻** 該当なし（精算 ${pay.settled} 件・残高 ${pay.balance} bp）\n\n`;
        }
      } catch (e) {
        console.warn('settleOpenRaceBetsForUser', e);
      }
      await interaction.editReply({
        content: bpLine,
        embeds: buildRaceResultEmbeds(resultSnap),
        components: [],
      });
      return;
    }

    const [meta, result] = await Promise.all([
      findRaceMetaForToday(raceId),
      scraper.scrapeRaceCard(raceId),
    ]);

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
    result.raceId = raceId;
    const flowPatch = { result };
    if (meta?.source === 'nar' || meta?.source === 'jra') {
      flowPatch.source = meta.source;
    } else if (result.netkeibaOrigin) {
      flowPatch.source = result.netkeibaOrigin;
    }
    if (meta?.scheduleKaisaiId) {
      flowPatch.kaisaiDate = meta.kaisaiDateYmd;
      flowPatch.kaisaiId = meta.scheduleKaisaiId;
      flowPatch.currentGroup = meta.currentGroup ?? null;
      flowPatch.venueTitle = normalizeScheduleVenueDisplayName(
        (meta.venueTitle || '').replace(/\s+/g, ' ').trim(),
      );
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
        utilityContext: {
          userId: interaction.user.id,
          flow: getBetFlow(interaction.user.id, raceId),
        },
      }),
    );
  } catch (error) {
    console.error('Race command error:', error);
    await interaction.editReply({
      content: `❌ エラー: ${error.message}\n\n無効なレースID・ネットワーク・サイト制限の可能性があります。`,
    });
  }
}

const commandObject = {
  command: new SlashCommandBuilder()
    .setName('race')
    .setDescription('競馬の出馬表・馬券購入・購入履歴（中央JRA / 地方NAR）')
    .addStringOption((option) =>
      option
        .setName('action')
        .setDescription('省略時は BP 詳細（/bp_rank user と同様）と操作ボタンを表示')
        .setRequired(false)
        .addChoices(
          { name: '馬券を購入', value: 'purchase' },
          { name: '購入履歴', value: 'history' },
          { name: '購入予定', value: 'slip' },
          { name: 'レースIDを指定', value: 'race_id' },
        ),
    )
    .addStringOption((option) =>
      option
        .setName('raceid')
        .setDescription(
          '12桁のレースID（レースIDを指定を選んだときは必須。省略時はメニューから選択）',
        )
        .setRequired(false),
    )
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await runPendingRaceRefundsForUser(interaction.user.id);

    const userId = interaction.user.id;
    const raceIdRaw = interaction.options.getString('raceid');
    const raceIdOpt = raceIdRaw?.trim() ?? '';
    const actionOpt = interaction.options.getString('action');
    const validRace = /^\d{12}$/.test(raceIdOpt);

    if (validRace) {
      await runRaceIdFlow(interaction, raceIdOpt);
      return;
    }

    if (actionOpt === 'race_id') {
      await interaction.editReply({
        content:
          '❌ **レースIDを指定** を選んだときは、raceid に12桁の数字を入力してください。',
      });
      return;
    }

    if (actionOpt === 'history') {
      try {
        const payload = await buildRacePurchaseHistoryV2Payload({
          userId,
          page: 0,
          extraFlags: MessageFlags.Ephemeral,
        });
        await interaction.editReply(payload);
      } catch (e) {
        console.error('race command history', e);
        await interaction.editReply({
          content: `❌ 購入履歴の取得に失敗しました: ${e.message}`,
        });
      }
      return;
    }

    if (actionOpt === 'slip') {
      await editReplyOpenBetSlipReview(interaction, {
        userId,
        raceId: '000000000000',
        extraFlags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (actionOpt === 'purchase') {
      await interaction.editReply(
        await buildRaceScheduleIntroV2Payload({
          userId,
          extraFlags: MessageFlags.Ephemeral,
        }),
      );
      return;
    }

    try {
      await interaction.editReply(
        await buildRaceHubV2Payload({
          user: interaction.user,
          guild: interaction.guild,
          extraFlags: MessageFlags.Ephemeral,
        }),
      );
    } catch (e) {
      console.error('Race hub error:', e);
      await interaction.editReply({
        content: `❌ 表示に失敗しました: ${e.message}`,
      });
    }
  },
};

export default commandObject;
