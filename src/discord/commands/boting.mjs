import {
  SlashCommandBuilder,
  InteractionContextType,
  MessageFlags,
  Locale,
} from 'discord.js';
import { buildBotingPanelPayload } from '../utils/race/raceCommandHub.mjs';
import { runPendingRaceRefundsForUser } from '../utils/race/raceBetRefundSweep.mjs';
import { isDatabaseCapacityError } from '../utils/shared/databaseErrors.mjs';
import { deferEphemeral } from '../utils/shared/interactionResponse.mjs';
import { resolveLocaleFromInteraction, t } from '../../i18n/index.mjs';

const commandObject = {
  command: new SlashCommandBuilder()
    .setName('boting')
    .setDescription(
      'メインメニュー（Daily・馬券・履歴・購入予定・ランキング）',
    )
    .setDescriptionLocalizations({
      [Locale.EnglishUS]: t('slash_commands.boting', null, 'en'),
    })
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    await deferEphemeral(interaction);

    const loc = resolveLocaleFromInteraction(interaction);
    try {
      await runPendingRaceRefundsForUser(interaction.user.id);
      await interaction.editReply(
        await buildBotingPanelPayload({
          user: interaction.user,
          guild: interaction.guild,
          extraFlags: MessageFlags.Ephemeral,
          locale: loc,
        }),
      );
    } catch (e) {
      console.error('boting:', e);
      if (isDatabaseCapacityError(e)) {
        await interaction.editReply({
          content: t('errors.db_quota', null, loc),
        });
        return;
      }
      await interaction.editReply({
        content: t('errors.display_failed', { message: e.message }, loc),
      });
    }
  },
};

export default commandObject;
