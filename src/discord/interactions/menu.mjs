import { BaseInteraction } from "discord.js";

/**
 * @param {BaseInteraction} interaction
 */
export default async function (interaction) {
    if (!interaction.isStringSelectMenu()
    ) return;
    for (const value of interaction.client.menus) {
        await value(interaction);
        if (interaction.deferred || interaction.replied) return;
    }
}