import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import {
  fetchRaceListSub,
  parseRaceListSub,
  filterVenueRaces,
  getRaceSalesStatus,
  fetchNarVenuesForDate,
  fetchNarRaceListSub,
  parseNarRaceListSubToVenue,
  jstYmd,
  filterRacesByInteractionPostDateYmd,
  filterVenuesForInteractionPostDate,
} from '../../../scrapers/netkeiba/netkeibaSchedule.mjs';
import { getBetFlow } from '../../utils/bet/betFlowStore.mjs';
import { buildTextAndRowsV2Payload } from '../../utils/race/raceCardDisplay.mjs';
import {
  betSlipOpenReviewButtonRowForSchedule,
  firstScheduleAnchorRaceIdFromRaces,
  firstScheduleAnchorRaceIdFromVenues,
} from '../../utils/bet/betSlipViewUi.mjs';
import {
  SCHEDULE_KIND_BACK_BUTTON_ID,
  scheduleBackToKindSelectButtonRow,
} from '../../utils/race/scheduleKindUi.mjs';
import {
  buildRaceScheduleIntroV2Payload,
  buildVenuePickIntroV2Payload,
} from '../../utils/race/raceCommandHub.mjs';
import {
  buildQuickPickItemsFromScheduleVenues,
  buildHubQuickRacesSelectRow,
  venueQuickPickBodySuffix,
} from '../../utils/race/raceHubQuickPick.mjs';
import { v2ExtraFlags } from '../../utils/shared/interactionResponse.mjs';
import { resolveLocaleFromInteraction, t } from '../../../i18n/index.mjs';
import {
  raceSalesStatusShortLabel,
  raceSalesStatusDetailLabel,
} from '../../utils/race/raceSalesStatusLabels.mjs';

const VENUE_BACK_PREFIX = 'race_sched_back_to_venue|';
const RACE_LIST_BACK_PREFIX = 'race_sched_back_to_race_list|';

/**
 * 二重クリック・期限切れ (10062) で落ちないようにする。
 * @param {import('discord.js').ButtonInteraction} interaction
 * @returns {Promise<boolean>}
 */
async function safeDeferUpdate(interaction) {
  if (interaction.deferred || interaction.replied) return false;
  try {
    await interaction.deferUpdate();
    return true;
  } catch (e) {
    const code = e?.code ?? e?.rawError?.code;
    if (code === 10062) return false;
    throw e;
  }
}

function venueSelectRow(scheduleKind, kaisaiDateYmd, currentGroup, venues, locale = null) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('race_menu_venue')
    .setPlaceholder(t('race_schedule.placeholders.pick_venue', null, locale))
    .addOptions(
      venues.slice(0, 25).map((v) => {
        const value =
          scheduleKind === 'nar'
            ? `nar|${kaisaiDateYmd}|${v.kaisaiId}`
            : `jra|${kaisaiDateYmd}|${currentGroup}|${v.kaisaiId}`;
        const prefix =
          scheduleKind === 'nar' ? t('race_schedule.venue.nar_prefix', null, locale) : '';
        return new StringSelectMenuOptionBuilder()
          .setLabel(`${prefix}${v.title}`.slice(0, 100))
          .setValue(value)
          .setDescription(
            t('race_schedule.venue.race_count', { n: v.races.length }, locale).slice(0, 100),
          );
      }),
    );
  return new ActionRowBuilder().addComponents(menu);
}

function scheduleBackRaceSelectRow(kaisaiDateYmd, races, locale = null) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('race_menu_race')
    .setPlaceholder(t('race_schedule.placeholders.pick_race', null, locale))
    .addOptions(
      races.slice(0, 25).map((r) => {
        const st = getRaceSalesStatus(r, kaisaiDateYmd);
        const label = `${r.roundLabel} ${r.timeText}`.replace(/\s+/g, ' ').trim().slice(0, 100);
        const desc = `${raceSalesStatusShortLabel(st, locale)} · ${r.title}`.slice(0, 100);
        return new StringSelectMenuOptionBuilder()
          .setLabel(label || r.raceId)
          .setValue(`${r.raceId}|${r.isResult ? 1 : 0}`)
          .setDescription(desc);
      }),
    );
  return new ActionRowBuilder().addComponents(menu);
}

function scheduleBackToVenueButtonRow(kaisaiDateYmd, currentGroup, scheduleKind = 'jra', locale = null) {
  const pad = scheduleKind === 'nar' ? '_' : currentGroup;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`race_sched_back_to_venue|${scheduleKind}|${kaisaiDateYmd}|${pad}`)
      .setLabel(t('race_schedule.buttons.to_venue', null, locale))
      .setStyle(ButtonStyle.Secondary),
  );
}

export default async function scheduleBackButtons(interaction) {
  if (!interaction.isButton()) return;
  const customId = interaction.customId;

  const isVenueBack = customId.startsWith(VENUE_BACK_PREFIX);
  const isRaceListBack = customId.startsWith(RACE_LIST_BACK_PREFIX);
  const isKindBack = customId === SCHEDULE_KIND_BACK_BUTTON_ID;
  if (!isVenueBack && !isRaceListBack && !isKindBack) return;

  if (!(await safeDeferUpdate(interaction))) return;

  const loc = resolveLocaleFromInteraction(interaction);

  try {
    if (isKindBack) {
      await interaction.editReply(
        await buildRaceScheduleIntroV2Payload({
          userId: interaction.user.id,
          extraFlags: v2ExtraFlags(interaction),
          locale: loc,
        }),
      );
      return;
    }

    if (isVenueBack) {
      const parts = customId.split('|');
      const scheduleKind = parts[1];
      const kaisaiDateYmd = parts[2];
      const currentGroup = parts[3];
      if (!kaisaiDateYmd || !scheduleKind || (scheduleKind === 'jra' && !currentGroup)) {
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline: t('race_schedule.errors.schedule_back_invalid', null, loc),
            actionRows: [],
            extraFlags: v2ExtraFlags(interaction),
            withBotingMenuBack: true,
            locale: loc,
          }),
        );
        return;
      }

      if (scheduleKind === 'nar') {
        const { venues } = await fetchNarVenuesForDate(kaisaiDateYmd);
        const venuesDay = filterVenuesForInteractionPostDate(
          venues,
          kaisaiDateYmd,
          jstYmd(),
          { source: 'nar' },
        );
        if (!venuesDay.length) {
          await interaction.editReply(
            buildTextAndRowsV2Payload({
              headline: t('race_schedule.errors.nar_no_races_post_date', null, loc),
              actionRows: [],
              extraFlags: v2ExtraFlags(interaction),
              withBotingMenuBack: true,
              locale: loc,
            }),
          );
          return;
        }
        const row = venueSelectRow('nar', kaisaiDateYmd, null, venuesDay, loc);
        const narQuickItems = buildQuickPickItemsFromScheduleVenues({
          venuesDay,
          kaisaiDateYmd,
          source: 'nar',
          currentGroup: null,
        });
        const narQuickRow = buildHubQuickRacesSelectRow(narQuickItems);
        await interaction.editReply(
          await buildVenuePickIntroV2Payload({
            userId: interaction.user.id,
            extraFlags: v2ExtraFlags(interaction),
            locale: loc,
            introBodySuffix: narQuickItems.length ? venueQuickPickBodySuffix(loc) : '',
            actionRows: [
              row,
              ...(narQuickRow ? [narQuickRow] : []),
              scheduleBackToKindSelectButtonRow(loc),
              betSlipOpenReviewButtonRowForSchedule(
                interaction.user.id,
                firstScheduleAnchorRaceIdFromVenues(venuesDay),
              ),
            ],
          }),
        );
        return;
      }

      const html = await fetchRaceListSub(kaisaiDateYmd, currentGroup);
      const { venues } = parseRaceListSub(html, kaisaiDateYmd);
      const venuesDay = filterVenuesForInteractionPostDate(
        venues,
        kaisaiDateYmd,
        jstYmd(),
        { source: 'jra' },
      );
      if (!venuesDay.length) {
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline: t('race_schedule.errors.jra_no_races_post_date', null, loc),
            actionRows: [],
            extraFlags: v2ExtraFlags(interaction),
            withBotingMenuBack: true,
            locale: loc,
          }),
        );
        return;
      }
      const row = venueSelectRow('jra', kaisaiDateYmd, currentGroup, venuesDay, loc);
      const jraQuickItems = buildQuickPickItemsFromScheduleVenues({
        venuesDay,
        kaisaiDateYmd,
        source: 'jra',
        currentGroup,
      });
      const jraQuickRow = buildHubQuickRacesSelectRow(jraQuickItems);

      await interaction.editReply(
        await buildVenuePickIntroV2Payload({
          userId: interaction.user.id,
          extraFlags: v2ExtraFlags(interaction),
          locale: loc,
          introBodySuffix: jraQuickItems.length ? venueQuickPickBodySuffix(loc) : '',
          actionRows: [
            row,
            ...(jraQuickRow ? [jraQuickRow] : []),
            scheduleBackToKindSelectButtonRow(loc),
            betSlipOpenReviewButtonRowForSchedule(
              interaction.user.id,
              firstScheduleAnchorRaceIdFromVenues(venuesDay),
            ),
          ],
        }),
      );
      return;
    }

    // RACE_LIST_BACK_PREFIX
    const [, raceId] = customId.split('|');
    if (!raceId) {
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline: t('race_schedule.errors.schedule_back_invalid', null, loc),
          actionRows: [],
          extraFlags: v2ExtraFlags(interaction),
          withBotingMenuBack: true,
          locale: loc,
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
          headline: t('race_schedule.errors.schedule_back_no_flow', null, loc),
          actionRows: [],
          extraFlags: v2ExtraFlags(interaction),
          withBotingMenuBack: true,
          locale: loc,
        }),
      );
      return;
    }

    if (scheduleKind === 'nar') {
      const html = await fetchNarRaceListSub(kaisaiDateYmd, kaisaiId);
      const venue = parseNarRaceListSubToVenue(html, kaisaiDateYmd);
      let races = venue?.races || [];
      if (!races.length) {
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline: t('race_schedule.errors.schedule_back_race_list_refetch', null, loc),
            actionRows: [],
            extraFlags: v2ExtraFlags(interaction),
            withBotingMenuBack: true,
            locale: loc,
          }),
        );
        return;
      }
      races = filterRacesByInteractionPostDateYmd(races, kaisaiDateYmd, jstYmd(), {
        source: 'nar',
      });
      if (!races.length) {
        await interaction.editReply(
          buildTextAndRowsV2Payload({
            headline: t('race_schedule.errors.schedule_back_no_races_post_date', null, loc),
            actionRows: [],
            extraFlags: v2ExtraFlags(interaction),
            withBotingMenuBack: true,
            locale: loc,
          }),
        );
        return;
      }

      const lines = races.map((r) => {
        const st = getRaceSalesStatus(r, kaisaiDateYmd);
        const detail = raceSalesStatusDetailLabel(st, loc);
        return `**${r.roundLabel}** ${r.timeText} — ${r.title}\n└ ${detail}`;
      });

      let description = lines.join('\n\n');
      if (description.length > 4090) description = `${description.slice(0, 4087)}…`;

      const headline = [
        t('race_schedule.lines.race_list_title', null, loc),
        '',
        description,
        '',
        t('race_schedule.lines.race_list_kaisai', { date: kaisaiDateYmd }, loc),
      ].join('\n');

      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline,
          actionRows: [
            scheduleBackRaceSelectRow(kaisaiDateYmd, races, loc),
            scheduleBackToVenueButtonRow(kaisaiDateYmd, '_', 'nar', loc),
            scheduleBackToKindSelectButtonRow(loc),
            betSlipOpenReviewButtonRowForSchedule(
              interaction.user.id,
              firstScheduleAnchorRaceIdFromRaces(races),
            ),
          ],
          extraFlags: v2ExtraFlags(interaction),
          withBotingMenuBack: true,
          locale: loc,
        }),
      );
      return;
    }

    if (!currentGroup) {
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline: t('race_schedule.errors.schedule_back_no_flow', null, loc),
          actionRows: [],
          extraFlags: v2ExtraFlags(interaction),
          withBotingMenuBack: true,
          locale: loc,
        }),
      );
      return;
    }

    const html = await fetchRaceListSub(kaisaiDateYmd, currentGroup);
    const { venues } = parseRaceListSub(html, kaisaiDateYmd);
    let races = filterVenueRaces(venues, kaisaiId);
    races = filterRacesByInteractionPostDateYmd(races, kaisaiDateYmd, jstYmd(), {
      source: 'jra',
    });
    if (!races.length) {
      await interaction.editReply(
        buildTextAndRowsV2Payload({
          headline: t('race_schedule.errors.schedule_back_no_races_post_date', null, loc),
          actionRows: [],
          extraFlags: v2ExtraFlags(interaction),
          withBotingMenuBack: true,
          locale: loc,
        }),
      );
      return;
    }

    const lines = races.map((r) => {
      const st = getRaceSalesStatus(r, kaisaiDateYmd);
      const detail = raceSalesStatusDetailLabel(st, loc);
      return `**${r.roundLabel}** ${r.timeText} — ${r.title}\n└ ${detail}`;
    });

    let description = lines.join('\n\n');
    if (description.length > 4090) description = `${description.slice(0, 4087)}…`;

    const headline = [
      t('race_schedule.lines.race_list_title', null, loc),
      '',
      description,
      '',
      t('race_schedule.lines.race_list_kaisai', { date: kaisaiDateYmd }, loc),
    ].join('\n');

    await interaction.editReply(
      buildTextAndRowsV2Payload({
        headline,
        actionRows: [
          scheduleBackRaceSelectRow(kaisaiDateYmd, races, loc),
          scheduleBackToVenueButtonRow(kaisaiDateYmd, currentGroup, 'jra', loc),
          scheduleBackToKindSelectButtonRow(loc),
          betSlipOpenReviewButtonRowForSchedule(
            interaction.user.id,
            firstScheduleAnchorRaceIdFromRaces(races),
          ),
        ],
        extraFlags: v2ExtraFlags(interaction),
        withBotingMenuBack: true,
        locale: loc,
      }),
    );
  } catch (e) {
    console.error(e);
    await interaction.editReply(
      buildTextAndRowsV2Payload({
        headline: t('race_schedule.errors.schedule_back_failed', { message: e.message }, loc),
        actionRows: [],
        extraFlags: v2ExtraFlags(interaction),
        withBotingMenuBack: true,
        locale: loc,
      }),
    );
  }
}
