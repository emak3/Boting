import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { getRaceSalesStatus } from '../../../scrapers/netkeiba/netkeibaSchedule.mjs';
import { t } from '../../../i18n/index.mjs';
import { raceSalesStatusShortLabel } from './raceSalesStatusLabels.mjs';

export const VENUE_MENU_ID = 'race_menu_venue';
export const RACE_MENU_ID = 'race_menu_race';

export function buildScheduleVenueSelectRow(
  scheduleKind,
  kaisaiDateYmd,
  currentGroup,
  venues,
  locale = null,
) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(VENUE_MENU_ID)
    .setPlaceholder(t('race_schedule.placeholders.pick_venue', null, locale))
    .addOptions(
      venues.slice(0, 25).map((venue) => {
        const value =
          scheduleKind === 'nar'
            ? `nar|${kaisaiDateYmd}|${venue.kaisaiId}`
            : `jra|${kaisaiDateYmd}|${currentGroup}|${venue.kaisaiId}`;
        const prefix =
          scheduleKind === 'nar'
            ? t('race_schedule.venue.nar_prefix', null, locale)
            : '';
        return new StringSelectMenuOptionBuilder()
          .setLabel(`${prefix}${venue.title}`.slice(0, 100))
          .setValue(value)
          .setDescription(
            t('race_schedule.venue.race_count', { n: venue.races.length }, locale).slice(
              0,
              100,
            ),
          );
      }),
    );
  return new ActionRowBuilder().addComponents(menu);
}

export function buildScheduleRaceSelectRow(kaisaiDateYmd, races, locale = null) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(RACE_MENU_ID)
    .setPlaceholder(t('race_schedule.placeholders.pick_race', null, locale))
    .addOptions(
      races.slice(0, 25).map((race) => {
        const status = getRaceSalesStatus(race, kaisaiDateYmd);
        const label = `${race.roundLabel} ${race.timeText}`
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 100);
        const description = `${raceSalesStatusShortLabel(status, locale)} - ${race.title}`.slice(
          0,
          100,
        );
        return new StringSelectMenuOptionBuilder()
          .setLabel(label || race.raceId)
          .setValue(`${race.raceId}|${race.isResult ? 1 : 0}`)
          .setDescription(description);
      }),
    );
  return new ActionRowBuilder().addComponents(menu);
}

export function buildScheduleBackToVenueButtonRow(
  kaisaiDateYmd,
  currentGroup,
  scheduleKind = 'jra',
  locale = null,
) {
  const group = scheduleKind === 'nar' ? '_' : currentGroup;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`race_sched_back_to_venue|${scheduleKind}|${kaisaiDateYmd}|${group}`)
      .setLabel(t('race_schedule.buttons.to_venue', null, locale))
      .setStyle(ButtonStyle.Secondary),
  );
}
