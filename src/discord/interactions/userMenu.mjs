/**
 * @param {import('discord.js').UserSelectMenuInteraction} interaction
 */
export default async function (interaction) {
  if (!interaction.isUserSelectMenu()) return;
  for (const value of interaction.client.userMenus) {
    await value(interaction);
    if (interaction.deferred || interaction.replied) return;
  }
}
