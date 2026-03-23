/**
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 */
export default async function (interaction) {
    if (!interaction.isStringSelectMenu()
    ) return;
    for (const value of interaction.client.menus) {
        await value(interaction);
        if (interaction.deferred || interaction.replied) return;
    }
}