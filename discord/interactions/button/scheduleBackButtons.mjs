import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
} from 'discord.js';
import {
  fetchRaceListSub,
  parseRaceListSub,
  filterVenueRaces,
  getRaceSalesStatus,
  fetchNarVenuesForDate,
  fetchNarRaceListSub,
  parseNarRaceListSubToVenue,
} from '../../../cheerio/netkeibaSchedule.mjs';
import { getBetFlow } from '../../utils/betFlowStore.mjs';
import { buildTextAndRowsV2Payload } from '../../utils/raceCardDisplay.mjs';

function v2ExtraFlags(interaction) {
  try {
    if (interaction.message?.flags?.has(MessageFlags.Ephemeral)) {
      return MessageFlags.Ephemeral;
    }
  } catch (_) {
    /* ignore */
  }
  return 0;
}

const VENUE_BACK_PREFIX = 'race_sched_back_to_venue|';
const RACE_LIST_BACK_PREFIX = 'race_sched_back_to_race_list|';

function venueSelectRow(scheduleKind, kaisaiDateYmd, currentGroup, venues) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('race_menu_venue')
    .setPlaceholder('開催場を選択')
    .addOptions(
      venues.slice(0, 25).map((v) => {
        const value =
          scheduleKind === 'nar'
            ? `nar|${kaisaiDateYmd}|${v.kaisaiId}`
            : `jra|${kaisaiDateYmd}|${currentGroup}|${v.kaisaiId}`;
        const prefix = scheduleKind === 'nar' ? '[地方] ' : '';
        return new StringSelectMenuOptionBuilder()
          .setLabel(`${prefix}${v.title}`.slice(0, 100))
          .setValue(value)
          .setDescription(`全${v.races.length}レース`.slice(0, 100));
      }),
    );
  return new ActionRowBuilder().addComponents(menu);
}

function raceSelectRow(kaisaiDateYmd, races) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('race_menu_race')
    .setPlaceholder('レースを選択（出馬表を表示）')
    .addOptions(
      races.slice(0, 25).map((r) => {
        const st = getRaceSalesStatus(r, kaisaiDateYmd);
        const label = `${r.roundLabel} ${r.timeText}`.replace(/\s+/g, ' ').trim().slice(0, 100);
        const desc = `${st.shortLabel} · ${r.title}`.slice(0, 100);
        return new StringSelectMenuOptionBuilder()
          .setLabel(label || r.raceId)
          .setValue(`${r.raceId}|${r.isResult ? 1 : 0}`)
          .setDescription(desc);
      }),
    );
  return new ActionRowBuilder().addComponents(menu);
}

function scheduleBackToVenueButtonRow(kaisaiDateYmd, currentGroup, scheduleKind = 'jra') {
  const pad = scheduleKind === 'nar' ? '_' : currentGroup;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`race_sched_back_to_venue|${scheduleKind}|${kaisaiDateYmd}|${pad}`)
      .setLabel('開催場へ')
      .setStyle(ButtonStyle.Secondary),
  );
}

export default async function scheduleBackButtons(interaction) {
  if (!interaction.isButton()) return;
  const customId = interaction.customId;

  const isVenueBack = customId.startsWith(VENUE_BACK_PREFIX);
  const isRaceListBack = customId.startsWith(RACE_LIST_BACK_PREFIX);
  if (!isVenueBack && !isRaceListBack) return;

  await interaction.deferUpdate();

  try {
    if (isVenueBack) {
      const parts = customId.split('|');
      const scheduleKind = parts[1];
      const kaisaiDateYmd = parts[2];
      const currentGroup = parts[3];
      if (!kaisaiDateYmd || !scheduleKind || (scheduleKind === 'jra' && !currentGroup)) {
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline: '❌ 戻れません。',
            actionRows: [],
            extraFlags: v2ExtraFlags(interaction),
          }),
        );
        return;
      }

      if (scheduleKind === 'nar') {
        const { venues } = await fetchNarVenuesForDate(kaisaiDateYmd);
        const row = venueSelectRow('nar', kaisaiDateYmd, null, venues);
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline:
              '開催場を選ぶと、その場のレース一覧（発走時刻・発売状態）が表示されます。続けてレースを選ぶと出馬表を表示します。',
            actionRows: [row],
            extraFlags: v2ExtraFlags(interaction),
          }),
        );
        return;
      }

      const html = await fetchRaceListSub(kaisaiDateYmd, currentGroup);
      const { venues } = parseRaceListSub(html, kaisaiDateYmd);
      const row = venueSelectRow('jra', kaisaiDateYmd, currentGroup, venues);

      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline:
            '開催場を選ぶと、その場のレース一覧（発走時刻・発売状態）が表示されます。続けてレースを選ぶと出馬表を表示します。',
          actionRows: [row],
          extraFlags: v2ExtraFlags(interaction),
        }),
      );
      return;
    }

    // RACE_LIST_BACK_PREFIX
    const [, raceId] = customId.split('|');
    if (!raceId) {
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline: '❌ 戻れません。',
          actionRows: [],
          extraFlags: v2ExtraFlags(interaction),
        }),
      );
      return;
    }

    const flow = getBetFlow(interaction.user.id, raceId);
    const kaisaiDateYmd = flow?.kaisaiDate;
    const currentGroup = flow?.currentGroup;
    const kaisaiId = flow?.kaisaiId;
    const scheduleKind = flow?.source === 'nar' ? 'nar' : 'jra';

    if (!kaisaiDateYmd || !kaisaiId) {
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline:
            '❌ 戻れません（開催情報が見つかりません）。もう一度 /race から試してください。',
          actionRows: [],
          extraFlags: v2ExtraFlags(interaction),
        }),
      );
      return;
    }

    if (scheduleKind === 'nar') {
      const html = await fetchNarRaceListSub(kaisaiDateYmd, kaisaiId);
      const venue = parseNarRaceListSubToVenue(html, kaisaiDateYmd);
      const races = venue?.races || [];
      if (!races.length) {
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline: '❌ レース一覧を再取得できませんでした。',
            actionRows: [],
            extraFlags: v2ExtraFlags(interaction),
          }),
        );
        return;
      }

      const lines = races.map((r) => {
        const st = getRaceSalesStatus(r, kaisaiDateYmd);
        return `**${r.roundLabel}** ${r.timeText} — ${r.title}\n└ ${st.detail}`;
      });

      let description = lines.join('\n\n');
      if (description.length > 4090) description = `${description.slice(0, 4087)}…`;

      const headline = [
        '🏇 **レース一覧**',
        '',
        description,
        '',
        `開催日 ${kaisaiDateYmd}（日本時間）`,
      ].join('\n');

      const raceSelectRow = (() => {
        const menu = new StringSelectMenuBuilder()
          .setCustomId('race_menu_race')
          .setPlaceholder('レースを選択（出馬表を表示）')
          .addOptions(
            races.slice(0, 25).map((r) => {
              const st = getRaceSalesStatus(r, kaisaiDateYmd);
              const label = `${r.roundLabel} ${r.timeText}`.replace(/\s+/g, ' ').trim().slice(0, 100);
              const desc = `${st.shortLabel} · ${r.title}`.slice(0, 100);
              return new StringSelectMenuOptionBuilder()
                .setLabel(label || r.raceId)
                .setValue(`${r.raceId}|${r.isResult ? 1 : 0}`)
                .setDescription(desc);
            }),
          );
        return new ActionRowBuilder().addComponents(menu);
      })();

      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline,
          actionRows: [
            raceSelectRow,
            scheduleBackToVenueButtonRow(kaisaiDateYmd, '_', 'nar'),
          ],
          extraFlags: v2ExtraFlags(interaction),
        }),
      );
      return;
    }

    if (!currentGroup) {
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline:
            '❌ 戻れません（開催情報が見つかりません）。もう一度 /race から試してください。',
          actionRows: [],
          extraFlags: v2ExtraFlags(interaction),
        }),
      );
      return;
    }

    const html = await fetchRaceListSub(kaisaiDateYmd, currentGroup);
    const { venues } = parseRaceListSub(html, kaisaiDateYmd);
    const races = filterVenueRaces(venues, kaisaiId);

    const lines = races.map((r) => {
      const st = getRaceSalesStatus(r, kaisaiDateYmd);
      return `**${r.roundLabel}** ${r.timeText} — ${r.title}\n└ ${st.detail}`;
    });

    let description = lines.join('\n\n');
    if (description.length > 4090) description = `${description.slice(0, 4087)}…`;

    const headline = [
      '🏇 **レース一覧**',
      '',
      description,
      '',
      `開催日 ${kaisaiDateYmd}（日本時間）`,
    ].join('\n');

    await interaction.editReply(
      buildTextAndRowsV2Payload({
        headline,
        actionRows: [
          raceSelectRow(kaisaiDateYmd, races),
          scheduleBackToVenueButtonRow(kaisaiDateYmd, currentGroup, 'jra'),
        ],
        extraFlags: v2ExtraFlags(interaction),
      }),
    );
  } catch (e) {
    console.error(e);
    await interaction.editReply(
      buildTextAndRowsV2Payload({
        headline: `❌ 戻る処理に失敗: ${e.message}`,
        actionRows: [],
        extraFlags: v2ExtraFlags(interaction),
      }),
    );
  }
}

