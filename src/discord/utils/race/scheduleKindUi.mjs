import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { t } from '../../../i18n/index.mjs';

export const SCHEDULE_KIND_MENU_ID = 'race_menu_schedule_kind';
export const SCHEDULE_KIND_BACK_BUTTON_ID = 'race_sched_back_to_schedule_kind';

/**
 * @param {'ja'|'en'|string|null} [locale]
 */
export function scheduleKindSelectRow(locale = null) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(SCHEDULE_KIND_MENU_ID)
      .setPlaceholder(t('race_schedule.schedule_kind.placeholder', null, locale))
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel(t('race_schedule.schedule_kind.jra_label', null, locale))
          .setValue('jra')
          .setDescription(t('race_schedule.schedule_kind.jra_desc', null, locale)),
        new StringSelectMenuOptionBuilder()
          .setLabel(t('race_schedule.schedule_kind.nar_label', null, locale))
          .setValue('nar')
          .setDescription(t('race_schedule.schedule_kind.nar_desc', null, locale)),
      ),
  );
}

/** 開催場選択から JRA/NAR の選び直しへ */
export function scheduleBackToKindSelectButtonRow(locale = null) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(SCHEDULE_KIND_BACK_BUTTON_ID)
      .setLabel(t('race_schedule.schedule_kind.back_button', null, locale))
      .setStyle(ButtonStyle.Secondary),
  );
}
