import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';

export const SCHEDULE_KIND_MENU_ID = 'race_menu_schedule_kind';
export const SCHEDULE_KIND_BACK_BUTTON_ID = 'race_sched_back_to_schedule_kind';

export function scheduleKindSelectRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(SCHEDULE_KIND_MENU_ID)
      .setPlaceholder('中央(JRA) か 地方(NAR) を選択')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('中央競馬 (JRA)')
          .setValue('jra')
          .setDescription('race.netkeiba.com'),
        new StringSelectMenuOptionBuilder()
          .setLabel('地方競馬 (NAR)')
          .setValue('nar')
          .setDescription('nar.netkeiba.com'),
      ),
  );
}

/** 開催場選択から JRA/NAR の選び直しへ */
export function scheduleBackToKindSelectButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(SCHEDULE_KIND_BACK_BUTTON_ID)
      .setLabel('JRA/NARを選び直す')
      .setStyle(ButtonStyle.Secondary),
  );
}
